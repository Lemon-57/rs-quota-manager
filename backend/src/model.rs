//! 额度恢复判断、重置卡与订阅快照的持久化数据

use gateway_plugin_sdk::call::data::{QuotaFacts, QuotaWindowFacts};
use serde::{Deserialize, Serialize};

pub fn is_free(plan_type: Option<&str>) -> bool {
    plan_type.is_some_and(|plan| plan.trim().eq_ignore_ascii_case("free"))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub check_interval_seconds: u64,
    pub cards_refresh_seconds: u64,
    pub batch_size: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            check_interval_seconds: 30,
            cards_refresh_seconds: 3600,
            batch_size: 20,
        }
    }
}

impl Settings {
    pub fn valid(&self) -> bool {
        (30..=3600).contains(&self.check_interval_seconds)
            && (300..=86400).contains(&self.cards_refresh_seconds)
            && (1..=20).contains(&self.batch_size)
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cards {
    pub available_count: u64,
    pub credits: Vec<Card>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub status: Option<String>,
    pub title: Option<String>,
    pub expires_at: Option<String>,
    pub expires_at_display: Option<String>,
    pub reset_type: Option<String>,
}

impl Card {
    pub fn expiry_ms(&self) -> Option<i64> {
        self.expires_at
            .as_ref()
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            .map(|v| v.timestamp_millis())
    }

    pub fn available(&self, now: i64) -> bool {
        self.status
            .as_deref()
            .is_some_and(|v| v.eq_ignore_ascii_case("available"))
            && self
                .expires_at
                .as_ref()
                .is_none_or(|_| self.expiry_ms().is_some_and(|v| v > now))
    }
}

pub fn weekly_windows(quota: &QuotaFacts) -> Vec<&QuotaWindowFacts> {
    quota
        .windows
        .iter()
        .filter(|v| v.window_seconds == Some(604800))
        .collect()
}

pub fn account_weekly(quota: &QuotaFacts) -> Option<&QuotaWindowFacts> {
    let mut windows = weekly_windows(quota).into_iter().filter(|v| {
        v.key
            .split(':')
            .next()
            .is_some_and(|s| s.eq_ignore_ascii_case("codex"))
    });
    let first = windows.next()?;
    if windows.next().is_some() {
        return None;
    }
    Some(first)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub request_id: String,
    pub credit_id: Option<String>,
    pub started_at_ms: i64,
    pub automatic: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub at_ms: i64,
    pub request_id: String,
    pub credit_id: Option<String>,
    pub automatic: bool,
    pub code: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub starts_at: Option<String>,
    pub expires_at: String,
    pub observed_at: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    pub subscription: Option<Subscription>,
    pub subscription_checked_at_ms: Option<i64>,
    pub cards: Option<Cards>,
    pub cards_observed_at_ms: Option<i64>,
    pub cards_checked_at_ms: Option<i64>,
    pub error: Option<String>,
    pub pending: Option<Pending>,
    pub awaiting_recovery: bool,
    pub last_attempt_at_ms: Option<i64>,
    pub history: Vec<Event>,
}

impl AccountState {
    pub fn note_recovery(&mut self, quota: &QuotaFacts) {
        if self.awaiting_recovery
            && quota
                .observed_at_ms
                .is_some_and(|t| self.last_attempt_at_ms.is_some_and(|last| t > last))
            && account_weekly(quota).is_some_and(|w| w.used_percent.is_some_and(|v| v < 100.0))
        {
            self.awaiting_recovery = false;
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub cursor: Option<String>,
    pub next_at_ms: i64,
    pub checked_at_ms: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quota(key: &str, seconds: u64, used: f64, observed: i64, reset: i64) -> QuotaFacts {
        QuotaFacts {
            schema_version: 1,
            account_id: "a".into(),
            observed_at_ms: Some(observed),
            windows: vec![QuotaWindowFacts {
                key: key.into(),
                window_seconds: Some(seconds),
                used_percent: Some(used),
                reset_at_ms: Some(reset),
            }],
        }
    }

    #[test]
    fn recovery_must_postdate_consumption() {
        let mut state = AccountState {
            awaiting_recovery: true,
            last_attempt_at_ms: Some(1000),
            ..Default::default()
        };
        state.note_recovery(&quota("codex:604800s", 604800, 0.0, 999, 99999));
        assert!(state.awaiting_recovery);
        state.note_recovery(&quota("codex:604800s", 604800, 0.0, 1001, 99999));
        assert!(!state.awaiting_recovery);
    }
}
