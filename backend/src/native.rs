//! 复用宿主账号目录、订阅查询和自动使用设置
use crate::{
    host::{account_path, admin, fault},
    model::Subscription,
};
use gateway_plugin_sdk::{
    PluginFault,
    call::services::accounts::{
        GetResetCreditAutomation, ResetCreditAutomationStatus, SetResetCreditAutomation,
    },
    client::HostClient,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPage {
    pub items: Vec<Account>,
    pub page: Page,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub total_pages: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub email: Option<String>,
    pub enabled: bool,
    pub authentication_kind: String,
    pub plan_type: Option<String>,
    pub plan_type_display: String,
    pub auto_use_quota_credits: bool,
    pub capabilities: Capabilities,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub quota_credits: bool,
    pub reset_credits: bool,
    pub consume_reset_credit: bool,
}

pub async fn accounts(host: &HostClient, page: u32) -> Result<AccountPage, PluginFault> {
    let path = format!("/api/admin/accounts?page={page}&pageSize=20");
    let data = admin(host, "GET", &path, None).await?;
    serde_json::from_value(data).map_err(|_| fault("宿主账号列表无效"))
}

pub async fn subscription(
    host: &HostClient,
    id: &str,
) -> Result<Option<Subscription>, PluginFault> {
    #[derive(Deserialize)]
    struct PersonalInfo {
        subscription: Option<Subscription>,
    }
    let data = admin(host, "GET", &account_path("personal-info", id), None).await?;
    let info: PersonalInfo = serde_json::from_value(data).map_err(|_| fault("宿主订阅信息无效"))?;
    Ok(info.subscription)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetCardSettings {
    reset_credit_on_low_weekly_quota: bool,
    reset_credit_lead_minutes: u32,
    reset_credit_max_weekly_remaining_percent: Option<u32>,
}

pub async fn reset_card_settings(host: &HostClient) -> Result<ResetCardSettings, PluginFault> {
    let data = admin(host, "GET", "/api/admin/settings", None).await?;
    serde_json::from_value(data).map_err(|_| fault("宿主主动重置卡设置无效"))
}

pub async fn reset_card_policy(
    host: &HostClient,
    id: &str,
) -> Result<ResetCreditAutomationStatus, PluginFault> {
    host.service::<GetResetCreditAutomation>(id.to_owned())
        .await
        .map_err(|error| fault(&error.message))
}

pub async fn set_reset_card_policy(
    host: &HostClient,
    id: &str,
    enabled: bool,
) -> Result<ResetCreditAutomationStatus, PluginFault> {
    host.service::<SetResetCreditAutomation>((id.to_owned(), enabled))
        .await
        .map_err(|error| fault(&error.message))
}

pub async fn set_quota_credit_policy(
    host: &HostClient,
    id: &str,
    enabled: bool,
) -> Result<bool, PluginFault> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UpdatedAccounts {
        account_ids: Vec<String>,
    }
    let data = admin(
        host,
        "POST",
        "/api/admin/accounts/batch-update",
        Some(json!({"accountIds":[id],"autoUseQuotaCredits":enabled})),
    )
    .await?;
    let updated: UpdatedAccounts =
        serde_json::from_value(data).map_err(|_| fault("宿主额度点数设置结果无效"))?;
    if updated.account_ids != [id] {
        return Err(fault("宿主未确认更新该账号"));
    }
    Ok(enabled)
}
