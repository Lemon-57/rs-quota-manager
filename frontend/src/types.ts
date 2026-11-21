export interface ResetCardSettings { resetCreditOnLowWeeklyQuota: boolean; resetCreditLeadMinutes: number; resetCreditMaxWeeklyRemainingPercent: number | null }
export interface ResetCardAutomation { enabled: boolean; next_consume_at: string | null; last_result: string | null }
export interface PageStatus { scan: { checkedAtMs: number | null }; resetCardSettings: ResetCardSettings | null }
export interface Card { id: string; status: string | null; title: string | null; expiresAt: string | null; expiresAtDisplay: string | null; resetType: string | null }
export interface QuotaWindow { key: string; label: string; limit_id: string | null; window_seconds: number | null; used_percent: number | null; reset_at_ms: number | null }
export interface QuotaCredits { has_credits: boolean; unlimited: boolean; balance: string | null }
export interface Subscription { startsAt: string | null; expiresAt: string; observedAt: string }
export interface Quota { account_id: string; observed_at_ms: number | null; windows: QuotaWindow[]; credits: QuotaCredits | null }
export interface Pending { requestId: string; creditId: string | null; startedAtMs: number; automatic: boolean }
export interface Event { atMs: number; requestId: string; creditId: string | null; automatic: boolean; code: string }
export interface State {
  subscription: Subscription | null; subscriptionCheckedAtMs: number | null;
  cards: { availableCount: number; credits: Card[] } | null;
  cardsObservedAtMs: number | null; cardsCheckedAtMs: number | null; error: string | null;
  pending: Pending | null; awaitingRecovery: boolean; lastAttemptAtMs: number | null; history: Event[];
}
export interface Row {
  account: { account_id: string; provider_id: string; name: string; email: string | null; enabled: boolean; authentication_kind: string; plan_type: string | null; plan_type_display: string };
  quota: Quota | null; state: State;
  autoUseQuotaCredits: boolean | null; resetCardAutomation: ResetCardAutomation | null;
}
export interface Page { accounts: Row[]; excludedPending: Row[]; nextPage: number | null; generatedAtMs: number }
export interface Bridge {
  readonly version: 2; readonly theme: 'light' | 'dark';
  request(input: { method: 'GET' | 'POST'; path: string; query?: string; contentType?: string; body?: string }): Promise<{ status: number; contentType: string; body: ArrayBuffer }>;
}
declare global { interface Window { codexProxyPlugin?: Bridge } }
