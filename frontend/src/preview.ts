import type { Row, Settings, State } from './types'
import { isAutomaticEligible, isFree } from './format'
import { applyTheme, createTheme } from '@codex-proxy/ui/theme'

export function installPreview() {
  if (window.codexProxyPlugin) return
  const theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light'
  applyTheme(document.documentElement, createTheme({ scheme: theme }))
  const stamp = Date.now()
  const state = (): State => ({ automatic: true, cards: null, cardsObservedAtMs: stamp, cardsCheckedAtMs: stamp, error: null, pending: null, awaitingRecovery: false, lastAttemptAtMs: null, history: [] })
  const rows: Row[] = Array.from({ length: 43 }, (_, i) => ({
    account: { account_id: `acct_preview_${String(i + 1).padStart(3, '0')}`, provider_id: i === 42 ? 'xai' : 'openai', name: `team+sample${i + 1}@example.com+2026/10/28+workspace3+region-a`, email: `sample${i + 1}@example.com`, enabled: i !== 7, authentication_kind: i === 42 ? 'api_key' : 'oauth', plan_type: i === 0 || i === 5 || i === 40 ? 'free' : i === 41 ? 'plus' : i === 10 ? 'pro' : 'team' },
    quota: i === 42 ? null : { account_id: `acct_preview_${String(i + 1).padStart(3, '0')}`, observed_at_ms: stamp - 40000, windows: [{ key: 'codex:604800s', window_seconds: 604800, used_percent: i % 7 === 0 ? 100 : (i * 13 + 22) % 98, reset_at_ms: stamp + (i + 1) * 7200000 }] },
    state: { ...state(), cards: i === 41 ? null : { availableCount: i % 3, credits: Array.from({ length: i % 3 }, (_, n) => ({ id: `card_${i}_${n}`, status: 'available', title: 'Full reset (Weekly + 5 hr)', expiresAt: new Date(stamp + (n + 1) * 86400000 * 6).toISOString(), expiresAtDisplay: null, resetType: 'full' })) } },
  }))
  rows[2]!.state.pending = { requestId: 'c85eac15-2fde-4d55-92bd-f328f272f40b', creditId: 'card_2_0', startedAtMs: stamp - 20000, automatic: false }
  rows[2]!.state.error = '消费结果待确认，自动使用已暂停'
  let settings: Settings = { automatic: false, checkIntervalSeconds: 30, cardsRefreshSeconds: 3600, batchSize: 20 }
  let version: number | null = null
  const view = (row: Row): Row => ({ ...row, state: { ...row.state, automatic: settings.automatic && row.state.automatic && isAutomaticEligible(row) } })
  const encode = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer })
  window.codexProxyPlugin = {
    version: 2, theme,
    async request(input) {
      const data = input.body ? JSON.parse(input.body) : {}
      if (input.path === 'api/settings') {
        if (input.method === 'POST') { if (data.expectedVersion !== version) return encode({ error: { message: '设置已更新，请重新加载' } }, 409); settings = data.value; version = (version ?? 0) + 1 }
        return encode({ value: settings, version, scan: { checkedAtMs: stamp } })
      }
      if (input.path === 'api/automatic') {
        if (data.expectedVersion !== version) return encode({ error: { message: '自动设置已更新，请重新加载' } }, 409)
        settings.automatic = data.enabled; version = (version ?? 0) + 1
        for (const row of rows) row.state.automatic = data.enabled && isAutomaticEligible(row)
        return encode({ value: settings, version })
      }
      if (input.path === 'api/accounts') {
        const cursor = new URLSearchParams(input.query).get('cursor'), start = cursor ? rows.findIndex(r => r.account.account_id === cursor) + 1 : 0
        const page = new URLSearchParams(location.search).get('empty') ? [] : rows.slice(start, start + 30)
        return encode({ accounts: page.filter(r => !isFree(r)).map(view), excludedPending: page.filter(r => isFree(r) && r.state.pending).map(view), nextCursor: start + 30 < rows.length && page.length ? page.at(-1)!.account.account_id : null, generatedAtMs: Date.now() })
      }
      const row = rows.find(r => r.account.account_id === data.accountId)
      if (!row) return encode({ error: { message: '账号不存在' } }, 400)
      if (input.path === 'api/policy') {
        if (data.expectedVersion !== version) return encode({ error: { message: '自动设置已更新，请重新加载' } }, 409)
        if (data.automatic && !settings.automatic) { for (const current of rows) current.state.automatic = false; settings.automatic = true; version = (version ?? 0) + 1 }
        row.state.automatic = data.automatic
        return encode({ state: view(row).state, value: settings, version })
      }
      else if (input.path === 'api/refresh') row.state.cardsObservedAtMs = Date.now()
      else if (input.path === 'api/consume' || input.path === 'api/retry') {
        const creditId = data.creditId ?? row.state.pending?.creditId
        row.state.pending = null; row.state.error = null
        row.state.cards!.availableCount = Math.max(0, row.state.cards!.availableCount - 1)
        row.state.cards!.credits = row.state.cards!.credits.filter(c => c.id !== creditId)
        row.quota!.windows[0]!.used_percent = 0
        row.state.history.unshift({ atMs: Date.now(), creditId: data.creditId ?? null, requestId: data.requestId ?? 'preview-operation', automatic: false, code: 'reset' })
      }
      return encode({ state: view(row).state, quota: row.quota })
    },
  }
}
