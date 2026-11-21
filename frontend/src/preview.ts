import type { ResetCardSettings, Row, State } from './types'
import { isFree } from './format'
import { applyResolvedTheme, resolveTheme, DEFAULT_THEME_COLOR, DEFAULT_CUSTOM_THEME_COLOR } from '@codex-proxy/ui/theme'

export function installPreview() {
  if (window.codexProxyPlugin) return
  const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light'
  applyResolvedTheme(document.documentElement, resolveTheme(theme, DEFAULT_THEME_COLOR, DEFAULT_CUSTOM_THEME_COLOR))
  const stamp = Date.now()
  const state = (): State => ({ subscription: { startsAt: new Date(stamp - 86400000 * 15).toISOString(), expiresAt: new Date(stamp + 86400000 * 15).toISOString(), observedAt: new Date(stamp).toISOString() }, subscriptionCheckedAtMs: stamp, cards: null, cardsObservedAtMs: stamp, cardsCheckedAtMs: stamp, error: null, pending: null, awaitingRecovery: false, lastAttemptAtMs: null, history: [] })
  const rows: Row[] = Array.from({ length: 43 }, (_, i) => ({
    account: { account_id: `acct_preview_${String(i + 1).padStart(3, '0')}`, provider_id: i === 42 ? 'xai' : 'openai', name: `team+sample${i + 1}@example.com+2026/10/28+workspace3+region-a`, email: `sample${i + 1}@example.com`, enabled: i !== 7, authentication_kind: i === 42 ? 'api_key' : 'oauth', plan_type: i === 0 || i === 5 || i === 40 ? 'free' : i === 41 ? 'plus' : i === 10 ? 'pro' : 'team', plan_type_display: i === 41 ? 'Plus' : i === 10 ? 'Pro' : 'Team' },
    autoUseQuotaCredits: i === 42 ? null : i % 3 === 1,
    resetCardAutomation: i === 42 ? null : { enabled: i % 3 === 2, next_consume_at: i % 3 === 2 ? new Date(stamp + 3 * 3600000).toISOString() : null, last_result: null },
    quota: i === 42 ? null : { account_id: `acct_preview_${String(i + 1).padStart(3, '0')}`, observed_at_ms: stamp - 40000, credits: i % 3 === 0 ? null : { has_credits: true, unlimited: i % 5 === 0, balance: i % 4 === 0 ? '0' : '120.5' }, windows: [
      { key: 'codex:18000s', label: '5 小时限额', limit_id: 'codex', window_seconds: 18000, used_percent: 28, reset_at_ms: stamp + 7200000 },
      { key: 'codex:604800s', label: '每周限额', limit_id: 'codex', window_seconds: 604800, used_percent: i % 7 === 0 ? 100 : (i * 13 + 22) % 98, reset_at_ms: stamp + (i + 1) * 7200000 },
    ] },
    state: { ...state(), cards: i === 41 ? null : { availableCount: i % 3, credits: Array.from({ length: i % 3 }, (_, n) => ({ id: `card_${i}_${n}`, status: 'available', title: 'Full reset (Weekly + 5 hr)', expiresAt: new Date(stamp + (n + 1) * 86400000 * 6).toISOString(), expiresAtDisplay: null, resetType: 'full' })) } },
  }))
  rows[2]!.state.pending = { requestId: 'c85eac15-2fde-4d55-92bd-f328f272f40b', creditId: 'card_2_0', startedAtMs: stamp - 20000, automatic: false }
  rows[2]!.state.error = '消费结果待确认，请确认原操作'
  const resetCardSettings: ResetCardSettings = { resetCreditOnLowWeeklyQuota: false, resetCreditLeadMinutes: 15, resetCreditMaxWeeklyRemainingPercent: 20 }
  const encode = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer })
  window.codexProxyPlugin = {
    version: 2, theme,
    async request(input) {
      const data = input.body ? JSON.parse(input.body) : {}
      if (input.path === 'api/status') {
        return encode({ resetCardSettings, scan: { checkedAtMs: stamp } })
      }
      if (input.path === 'api/accounts') {
        const pageNumber = Number(new URLSearchParams(input.query).get('page') ?? '1')
        const start = (pageNumber - 1) * 20
        const page = new URLSearchParams(location.search).get('empty') ? [] : rows.slice(start, start + 20)
        return encode({ accounts: page.filter(r => !isFree(r)), excludedPending: page.filter(r => isFree(r) && r.state.pending), nextPage: start + 20 < rows.length && page.length ? pageNumber + 1 : null, generatedAtMs: Date.now() })
      }
      const row = rows.find(r => r.account.account_id === data.accountId)
      if (!row) return encode({ error: { message: '账号不存在' } }, 400)
      if (input.path === 'api/auto-use-quota-credits') {
        row.autoUseQuotaCredits = data.enabled
        return encode({ enabled: row.autoUseQuotaCredits })
      }
      if (input.path === 'api/auto-use-reset-cards' && row.resetCardAutomation) {
        row.resetCardAutomation.enabled = data.enabled
        return encode(row.resetCardAutomation)
      }
      if (input.path === 'api/refresh-cards') {
        row.state.cards ??= { availableCount: 0, credits: [] }
        row.state.cardsObservedAtMs = Date.now()
        return encode(row.state)
      }
      if (input.path === 'api/refresh') { row.state.cardsObservedAtMs = Date.now(); row.state.subscriptionCheckedAtMs = Date.now() }
      else if (input.path === 'api/consume' || input.path === 'api/retry') {
        const creditId = data.creditId ?? row.state.pending?.creditId
        row.state.pending = null; row.state.error = null
        row.state.cards!.availableCount = Math.max(0, row.state.cards!.availableCount - 1)
        row.state.cards!.credits = row.state.cards!.credits.filter(c => c.id !== creditId)
        for (const window of row.quota?.windows ?? []) window.used_percent = 0
        row.state.history.unshift({ atMs: Date.now(), creditId: data.creditId ?? null, requestId: data.requestId ?? 'preview-operation', automatic: false, code: 'reset' })
      }
      return encode({ state: row.state, quota: row.quota })
    },
  }
}
