import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js'

const server = await createServer({ root: fileURLToPath(new URL('../frontend', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const passed = []
const check = name => passed.push(name)
try {
  const { request } = await server.ssrLoadModule('/src/api/request.ts')
  const { api } = await server.ssrLoadModule('/src/api/index.ts')
  const { parsePage, parseStatus, parseUpdate } = await server.ssrLoadModule('/src/api/schemas/quota.ts')
  const { creditBalance, csv, isFree, resetCardTiming } = await server.ssrLoadModule('/src/format.ts')
  globalThis.window = {}
  await assert.rejects(api.status(), /宿主桥不可用/)
  check('Missing host bridge fails without network fallback')
  const calls = []
  const reply = (data, status = 200, contentType = 'application/json') => ({ status, contentType, body: new TextEncoder().encode(JSON.stringify(data)).buffer })
  const rules = { resetCreditOnLowWeeklyQuota: false, resetCreditLeadMinutes: 15, resetCreditMaxWeeklyRemainingPercent: null }
  const status = { resetCardSettings: rules, scan: { checkedAtMs: null } }
  let response = reply(status)
  window.codexProxyPlugin = { version: 2, theme: 'light', request: async input => { calls.push(input); return response } }
  assert.deepEqual(await api.status(), status)
  assert.deepEqual(calls.at(-1), { method: 'GET', path: 'api/status' })
  check('GET uses only public bridge and sends no synthetic content type')
  response.contentType = 'Application/JSON; charset=utf-8'
  await api.status()
  check('JSON media type normalization matches official example')
  assert.equal(resetCardTiming(rules), '临期使用 · 到期前 15 分钟')
  assert.equal(resetCardTiming({ ...rules, resetCreditOnLowWeeklyQuota: true }), '按周额度使用 · 剩余 ≤ 0%')
  check('Native settings report expiry timing and the host weekly depletion default')
  for (const path of ['', '/api/status', 'https://example.com', '../api/status', 'api/status?x=1', 'api/../settings']) await assert.rejects(request('GET', path), /相对路径/)
  check('Absolute paths, traversal and unregistered route syntax are rejected locally')
  response = { status: 200, contentType: 'application/json', body: new TextEncoder().encode('{').buffer }
  await assert.rejects(api.status(), /无效 JSON/)
  response = reply({}, 200, 'text/html')
  await assert.rejects(api.status(), /内容类型/)
  check('Invalid JSON and unexpected response types fail explicitly')
  response = reply({ error: { message: '设置冲突' } }, 409)
  await assert.rejects(api.status(), /设置冲突/)
  response = reply(['untrusted'], 502)
  await assert.rejects(api.status(), /HTTP 502/)
  check('Structured errors and malformed error payloads are handled safely')
  const stamp = Date.now()
  const subscription = { startsAt: '2026-10-20T00:00:00Z', expiresAt: '2026-11-20T00:00:00Z', observedAt: new Date(stamp).toISOString() }
  const state = { subscription, subscriptionCheckedAtMs: stamp, cards: { availableCount: 1, credits: [{ id: 'card-1', status: 'available', title: 'Weekly', expiresAt: new Date(stamp + 86400000).toISOString(), expiresAtDisplay: null, resetType: 'full' }] }, cardsObservedAtMs: stamp, cardsCheckedAtMs: stamp, error: null, pending: null, awaitingRecovery: false, lastAttemptAtMs: null, history: [] }
  const credits = { has_credits: true, unlimited: false, balance: '0' }
  const row = { account: { account_id: 'acct-1', provider_id: 'openai', name: '=sample full name', email: 'sample@example.com', enabled: false, authentication_kind: 'oauth', plan_type: 'team', plan_type_display: 'Team' }, state, quota: { account_id: 'acct-1', observed_at_ms: stamp, credits, windows: [{ key: 'codex:604800s', label: '每周限额', limit_id: 'codex', window_seconds: 604800, used_percent: 100, reset_at_ms: stamp + 86400000 }] }, autoUseQuotaCredits: false, resetCardAutomation: null }
  const page = { accounts: [row], excludedPending: [], nextPage: 2, generatedAtMs: stamp }
  assert.deepEqual(parsePage(page), page)
  response = reply(page)
  await api.accounts(2)
  assert.equal(new URLSearchParams(calls.at(-1).query).get('page'), '2')
  assert.equal(creditBalance(row), '0')
  assert.equal(creditBalance({ ...row, quota: { ...row.quota, credits: { ...credits, balance: null } } }), '—')
  assert.equal(creditBalance({ ...row, quota: { ...row.quota, credits: { ...credits, unlimited: true } } }), '不限')
  check('Page decoder and formatter preserve subscription dates, native switches, and zero versus unknown credit balance')
  response = reply({ enabled: true })
  assert.equal(await api.setQuotaCredits('acct-1', true), true)
  assert.equal(calls.at(-1).path, 'api/auto-use-quota-credits')
  assert.deepEqual(JSON.parse(calls.at(-1).body), { accountId: 'acct-1', enabled: true })
  const automation = { enabled: false, next_consume_at: null, last_result: 'expired_unknown' }
  response = reply(automation)
  assert.deepEqual(await api.setResetCards('acct-1', false), automation)
  assert.equal(calls.at(-1).path, 'api/auto-use-reset-cards')
  assert.deepEqual(JSON.parse(calls.at(-1).body), { accountId: 'acct-1', enabled: false })
  check('Each switch sends its own bridge request and uses the returned state')
  assert.throws(() => parsePage({ ...page, accounts: [{ ...row, resetCardAutomation: 'false' }] }), /自动使用/)
  assert.throws(() => parsePage({ ...page, accounts: [{ ...row, state: { ...state, cards: { availableCount: -1, credits: [] } } }] }), /卡片数量/)
  assert.throws(() => parseUpdate({ state, quota: {} }), /额度账号/)
  assert.throws(() => parseStatus({ ...status, resetCardSettings: { ...rules, resetCreditLeadMinutes: '10' } }), /提前使用时间/)
  check('Malformed successful responses cannot silently become business state')
  response = reply(state)
  assert.deepEqual(await api.refreshCards('acct-1'), state)
  assert.equal(calls.at(-1).path, 'api/refresh-cards')
  assert.deepEqual(JSON.parse(calls.at(-1).body), { accountId: 'acct-1' })
  check('Opening or refreshing the inventory uses the dedicated card query')
  const uncertain = { ...state, pending: { requestId: 'original-request', creditId: 'card-1', startedAtMs: stamp, automatic: false }, history: [{ atMs: stamp, requestId: 'previous', creditId: null, automatic: false, code: 'reset' }] }
  assert.deepEqual(parseUpdate({ state: uncertain, quota: null }), { state: uncertain, quota: null })
  response = reply({ state: uncertain, quota: null })
  await api.retry('acct-1', 'original-request')
  assert.equal(JSON.parse(calls.at(-1).body).requestId, 'original-request')
  check('Unknown result and retry retain original durable request ID')
  const exported = csv([row])
  assert.ok(exported.startsWith('\uFEFF'))
  assert.ok(exported.includes('"acct-1"') && exported.includes('"\'=sample full name"') && exported.includes('"sample@example.com"'))
  assert.ok(exported.includes('"订阅","订阅开始","订阅结束"') && exported.includes(subscription.expiresAt))
  assert.ok(exported.includes('"额度点数","自动使用额度点数","自动使用重置卡"'))
  assert.ok(isFree({ ...row, account: { ...row.account, plan_type: ' Free ' } }))
  check('CSV retains full identity and formula escaping; Free scope remains normalized')
  console.log(JSON.stringify({ passed: passed.length, tests: passed, productionRequests: 0 }, null, 2))
} finally { delete globalThis.window; await server.close() }
