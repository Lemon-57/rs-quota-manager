//! 隔离管理页面的路由、账号分页与设置保存

use crate::{
    engine,
    host::{fault, load, now, save},
    model::*,
    native,
};
use gateway_plugin_sdk::{
    ErrorCode, PluginFault,
    call::{data::QuotaFactsQuery, management::*},
    client::{TypedCall, TypedReply},
};
use serde::Deserialize;
use serde_json::{Value, json};

pub fn registration() -> ManagementRegistration {
    let route = |method: &str, path: &str| ManagementRoute {
        method: method.into(),
        path: path.into(),
        request_content_types: if method == "GET" {
            vec![]
        } else {
            vec!["application/json".into()]
        },
        response_content_types: vec!["application/json".into()],
    };
    ManagementRegistration {
        routes: vec![
            route("GET", "api/accounts"),
            route("GET", "api/status"),
            route("POST", "api/auto-use-quota-credits"),
            route("POST", "api/auto-use-reset-cards"),
            route("POST", "api/refresh"),
            route("POST", "api/refresh-cards"),
            route("POST", "api/consume"),
            route("POST", "api/retry"),
        ],
        resources: ["web/index.html", "web/app.js", "web/app.css"]
            .into_iter()
            .map(|p| ManagementResource {
                path: p.into(),
                public: false,
            })
            .collect(),
        pages: vec![ManagementPage {
            id: "quota-manager".into(),
            title: "周限与重置卡".into(),
            description: Some("账号额度与重置记录".into()),
            entry: "web/index.html".into(),
            icon: None,
        }],
        callbacks: vec![],
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountRequest {
    account_id: String,
    #[serde(default)]
    credit_id: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
}

async fn handle_inner(call: TypedCall<ManagementRequest>) -> Result<Value, PluginFault> {
    let host = &call.host;
    if call.request.method == "GET" {
        if !call.payload.is_empty() {
            return Err(fault("查询不能包含正文"));
        }
        if call.request.path == "api/status" {
            let (scan, _) = load::<Scan>(host, "scan").await?;
            let reset_cards = native::reset_card_settings(host).await.ok();
            return Ok(json!({"scan":scan,"resetCardSettings":reset_cards}));
        }
        if call.request.path == "api/accounts" {
            let mut page_number = 1;
            let mut pairs =
                url::form_urlencoded::parse(call.request.query.trim_start_matches('?').as_bytes());
            if let Some((key, value)) = pairs.next() {
                if key != "page" || pairs.next().is_some() {
                    return Err(fault("分页参数无效"));
                }
                page_number = value
                    .parse::<u32>()
                    .ok()
                    .filter(|page| *page > 0)
                    .ok_or_else(|| fault("分页参数无效"))?;
            }
            let page = native::accounts(host, page_number).await?;
            let mut rows = Vec::new();
            let mut excluded_pending = Vec::new();
            for account in page.items {
                let (state, _) = load::<AccountState>(host, &engine::key(&account.id)).await?;
                let account_view = json!({
                    "account_id": account.id, "provider_id": account.provider, "name": account.name,
                    "email": account.email, "enabled": account.enabled,
                    "authentication_kind": account.authentication_kind,
                    "plan_type": account.plan_type, "plan_type_display": account.plan_type_display,
                });
                if is_free(account.plan_type.as_deref()) {
                    if state.pending.is_some() {
                        excluded_pending.push(json!({
                            "account": account_view, "quota": null, "state": state,
                            "autoUseQuotaCredits": null, "resetCardAutomation": null,
                        }));
                    }
                    continue;
                }
                let reset_card_automation = if account.capabilities.reset_credits
                    && account.capabilities.consume_reset_credit
                {
                    native::reset_card_policy(host, &account.id).await.ok()
                } else {
                    None
                };
                let quota = host
                    .quota_details(QuotaFactsQuery {
                        account_id: account.id,
                    })
                    .await
                    .ok();
                rows.push(json!({
                    "account": account_view, "quota": quota, "state": state,
                    "autoUseQuotaCredits": account.capabilities.quota_credits
                        .then_some(account.auto_use_quota_credits),
                    "resetCardAutomation": reset_card_automation,
                }));
            }
            let next_page = (page_number < page.page.total_pages).then(|| page_number + 1);
            return Ok(json!({
                "accounts": rows, "excludedPending": excluded_pending,
                "nextPage": next_page, "generatedAtMs": now(),
            }));
        }
        return Err(fault("路由不存在"));
    }
    if call.request.method != "POST" || call.payload.len() > 8192 {
        return Err(fault("请求无效"));
    }
    let request: AccountRequest =
        serde_json::from_slice(&call.payload).map_err(|_| fault("账号操作参数无效"))?;
    if request.account_id.len() > 128
        || request.account_id.is_empty()
        || request.account_id.chars().any(char::is_control)
    {
        return Err(fault("账号 ID 无效"));
    }
    let id = &request.account_id;
    match call.request.path.as_str() {
        "api/auto-use-quota-credits" | "api/auto-use-reset-cards" => {
            let account = engine::detail(host, id).await?;
            engine::require_non_free(&account)?;
            let enabled = request.enabled.ok_or_else(|| fault("未指定自动使用开关"))?;
            if call.request.path == "api/auto-use-quota-credits" {
                let enabled = native::set_quota_credit_policy(host, id, enabled).await?;
                Ok(json!({"enabled": enabled}))
            } else {
                let automation = native::set_reset_card_policy(host, id, enabled).await?;
                Ok(json!(automation))
            }
        }
        "api/refresh" | "api/refresh-cards" => {
            let (mut state, version) = load::<AccountState>(host, &engine::key(id)).await?;
            let account = engine::detail(host, id).await?;
            engine::require_non_free(&account)?;
            if account.provider_id != "openai" || account.authentication_kind != "oauth" {
                return Err(fault("该账号不支持重置卡"));
            }
            if call.request.path == "api/refresh-cards" {
                let refreshed = engine::refresh_cards(host, id, &mut state).await;
                save(host, &engine::key(id), &state, version).await?;
                refreshed?;
                return Ok(json!(state));
            }
            let quota = host
                .refresh_account_quota(QuotaFactsQuery {
                    account_id: id.into(),
                })
                .await
                .ok();
            if let Some(q) = &quota {
                state.note_recovery(q);
            }
            engine::refresh_subscription(host, id, &mut state).await;
            let refreshed = engine::refresh_cards(host, id, &mut state).await;
            save(host, &engine::key(id), &state, version).await?;
            refreshed?;
            let quota = host
                .quota_details(QuotaFactsQuery {
                    account_id: id.into(),
                })
                .await
                .ok();
            Ok(json!({"state":state,"quota":quota}))
        }
        "api/consume" | "api/retry" => {
            if call.request.path == "api/retry" && request.request_id.is_none() {
                return Err(fault("缺少原操作标识"));
            }
            if call.request.path == "api/consume" && request.request_id.is_some() {
                return Err(fault("新操作不能复用确认路由"));
            }
            let state = engine::consume(
                host,
                id,
                request.credit_id.as_deref(),
                request.request_id.as_deref(),
            )
            .await?;
            let quota = host
                .quota_details(QuotaFactsQuery {
                    account_id: id.into(),
                })
                .await
                .ok();
            Ok(json!({"state":state,"quota":quota}))
        }
        _ => Err(fault("路由不存在")),
    }
}

pub async fn handle(
    call: TypedCall<ManagementRequest>,
) -> Result<TypedReply<ManagementResponse>, PluginFault> {
    let (status, value) = match handle_inner(call).await {
        Ok(value) => (200, value),
        Err(error) => (
            if error.code == ErrorCode::Conflict {
                409
            } else {
                400
            },
            json!({"error":{"message":error.message}}),
        ),
    };
    Ok(TypedReply::new(ManagementResponse {
        status,
        content_type: "application/json".into(),
        headers: vec![],
    })
    .with_payload(serde_json::to_vec(&value).map_err(|_| fault("响应编码失败"))?))
}
