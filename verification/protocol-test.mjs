import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const executable = process.platform === 'win32' ? 'quota-manager.exe' : 'quota-manager'
const binary = process.argv[2] || fileURLToPath(new URL(`../backend/target/debug/${executable}`, import.meta.url))
const protocolVersion = 7
const contributes = {
  management: { id: 'personal.quota-manager.management', version: 2, stages: ['management'], inputFormats: [], outputFormats: [] },
  maintenance: { id: 'personal.quota-manager.maintenance', version: 1, stages: ['maintenance'], inputFormats: [], outputFormats: [] },
}
const stamp = Date.now()
const account = (id, enabled = true, plan = 'team') => ({ account_id: id, provider_id: 'openai', name: `team+${id}+2026/10/28+workspace3`, email: `${id}@example.com`, group_ids: [], enabled, updated_at_ms: stamp, plan })
const accounts = [account('acct_001'), account('acct_002', false), account('acct_003'), account('acct_004'), account('acct_005'), account('acct_006', true, 'free'), account('acct_007', true, ' Free '), account('acct_008', true, 'plus')]
accounts[7].name = 'free-prefix-but-paid-plus@example.com'
const quota = (id, used = 25, key = 'codex:604800s', seconds = 604800) => ({ schema_version: 1, account_id: id, observed_at_ms: Date.now(), windows: [{ key, window_seconds: seconds, used_percent: used, reset_at_ms: stamp + 86400000 }] })
const quotas = new Map(accounts.map(a => [a.account_id, quota(a.account_id)]))
const balances = new Map([['acct_001', '0'], ['acct_002', '12.50']])
const useQuotaCredits = new Map([['acct_002', true]]), useResetCards = new Map()
const policyWrites = [], subscriptionReads = [], quotaFactReads = []
let resetCardSettings = { resetCreditOnLowWeeklyQuota: false, resetCreditLeadMinutes: 15, resetCreditMaxWeeklyRemainingPercent: 25 }
const subscription = { startsAt: '2026-10-20T00:00:00Z', expiresAt: '2026-11-20T00:00:00Z', observedAt: new Date(stamp).toISOString() }
const cards = new Map(accounts.map(a => [a.account_id, { availableCount: 2, credits: [
  { id: `${a.account_id}_late`, status: 'available', title: 'Full reset (Weekly + 5 hr)', resetType: 'full', expiresAt: new Date(stamp + 86400000 * 7).toISOString(), expiresAtDisplay: null },
  { id: `${a.account_id}_early`, status: 'available', title: 'Full reset (Weekly + 5 hr)', resetType: 'full', expiresAt: new Date(stamp + 86400000 * 2).toISOString(), expiresAtDisplay: null },
] }]))
const records = new Map(), posts = [], refreshCalls = [], reads = [], handles = new Map()
const runtimeAccount = a => ({ account_id: a.account_id, provider_id: a.provider_id, name: a.name, email: a.email, enabled: a.enabled,
  credential_revision: 1, upstream_user_id: null, upstream_account_id: null, plan_type: a.plan, authentication_kind: 'oauth', credential_state: 'ready', has_refresh_token: true, access_token_expires_at_ms: null, next_refresh_at_ms: null })
let consumeMode = 'reset', child, buffered, pending, ready, sequence = 99, errors = '', activeMode = 'normal', incarnation, handleSequence = 0, cardQueries = 0

function send(meta, data, payload = Buffer.alloc(0)) {
  if (!(payload instanceof Buffer)) payload = Buffer.from(JSON.stringify(payload))
  if (data !== undefined) {
    const dataBytes = Buffer.from(JSON.stringify(data))
    meta = { ...meta, data_bytes: dataBytes.length }
    payload = Buffer.concat([dataBytes, payload])
  }
  const json = Buffer.from(JSON.stringify(meta)), header = Buffer.alloc(12)
  header.writeUInt32BE(json.length); header.writeBigUInt64BE(BigInt(payload.length), 4)
  child.stdin.write(Buffer.concat([header, json, payload]))
}
function result(id, value = {}, payload = Buffer.alloc(0)) { send({ type: 'result', id }, value, payload) }
function error(id, code = 'rejected') { send({ type: 'error', id, error: { code, message: 'mock rejection', send_state: 'not_sent' } }) }
async function callback(meta, params, payload) {
  reads.push(meta.method)
  const data = payload.length ? JSON.parse(payload.toString()) : params
  if (meta.method === 'host.data.accounts.list' || meta.method === 'host.auth.list') {
    const start = data.cursor ? accounts.findIndex(a => a.account_id === data.cursor) + 1 : 0
    const batch = accounts.slice(start, start + Math.min(data.limit, 2))
    return result(meta.id, {}, { ...(meta.method === 'host.data.accounts.list' ? {schema_version:1} : {}), accounts: meta.method === 'host.auth.list' ? batch.map(runtimeAccount) : batch, next_cursor: start + batch.length < accounts.length ? batch.at(-1).account_id : null })
  }
  if (['host.data.quota.get', 'host.data.quota.details', 'host.quota_observations.refresh'].includes(meta.method)) {
    if (meta.method === 'host.data.quota.get') {
      quotaFactReads.push(data.account_id)
      if (data.account_id === 'acct_003') return error(meta.id)
    }
    const q = structuredClone(quotas.get(data.account_id))
    if (meta.method.includes('refresh')) { refreshCalls.push(data.account_id); q.observed_at_ms = Date.now() }
    if (meta.method.endsWith('details')) {
      q.limit_reached = false
      q.windows = q.windows.map(window => ({ ...window, group: 'codex', label: '周限', limit_reached: false }))
      q.credits = { has_credits: true, unlimited: false, balance: balances.get(data.account_id) ?? null }
    }
    return result(meta.id, {}, q)
  }
  if (meta.method === 'host.auth.get_runtime') {
    const a = accounts.find(a => a.account_id === data.account_id)
    return result(meta.id, {}, runtimeAccount(a))
  }
  if (meta.method === 'host.state.get') return result(meta.id, { record: records.get(data.key) ?? null })
  if (meta.method === 'host.state.put') {
    const existing = records.get(data.key)
    if ((existing?.version ?? null) !== data.expected_version) return error(meta.id, 'conflict')
    const version = (existing?.version ?? 0) + 1
    records.set(data.key, { value: structuredClone(data.value), version, schema_version: 1 })
    return result(meta.id, { version })
  }
  if (meta.method === 'host.services.call') {
    const { operation, input } = data
    let id = input
    if (operation === 'accounts.set_reset_credit_automation') {
      const [accountId, enabled] = input
      id = accountId
      assert.equal(typeof enabled, 'boolean')
      useResetCards.set(id, enabled)
      policyWrites.push({ id, key: 'resetCards', enabled })
    } else assert.equal(operation, 'accounts.reset_credit_automation_status')
    const enabled = useResetCards.get(id) ?? false
    return result(meta.id, { Ok: { enabled, lead_minutes: 15, weekly_trigger_remaining_percent: null, next_discovery_at: null, next_consume_at: enabled ? '2026-12-01T18:00:00Z' : null, last_result: null } })
  }
  if (meta.method === 'host.http.dispatch') {
    const url = new URL(params.uri, 'http://mock.invalid'), id = url.searchParams.get('accountId') || data.accountId
    let envelope
    if (url.pathname === '/api/admin/settings') {
      assert.equal(params.method, 'GET')
      if (activeMode === 'settings_error') return error(meta.id)
      envelope = { code: 200, data: { ...resetCardSettings, unrelated: 'settings-private-marker' } }
    } else if (url.pathname === '/api/admin/accounts') {
      assert.equal(params.method, 'GET')
      assert.equal(url.searchParams.get('pageSize'), '20')
      const offset = (Number(url.searchParams.get('page')) - 1) * 2
      const items = accounts.slice(offset, offset + 2).map(a => ({
        id: a.account_id, name: a.name, email: a.email, enabled: a.enabled, provider: a.provider_id,
        authenticationKind: 'oauth', planType: a.plan, planTypeDisplay: a.plan === 'team' ? 'Team' : a.plan,
        autoUseQuotaCredits: useQuotaCredits.get(a.account_id) ?? false,
        capabilities: { quotaCredits: a.account_id !== 'acct_008', resetCredits: a.account_id !== 'acct_008', consumeResetCredit: a.account_id !== 'acct_008' },
      }))
      envelope = { code: 200, data: { items, page: { totalPages: Math.ceil(accounts.length / 2) } } }
    } else if (url.pathname === '/api/admin/accounts/personal-info') {
      assert.equal(params.method, 'GET')
      subscriptionReads.push(id)
      if (activeMode === 'subscription_error') return error(meta.id)
      envelope = { code: 200, data: { subscription, profile: { privateMarker: 'ignored-profile-field' } } }
    } else if (url.pathname === '/api/admin/accounts/batch-update') {
      assert.equal(params.method, 'POST')
      const [accountId] = data.accountIds
      assert.deepEqual(data, { accountIds: [accountId], autoUseQuotaCredits: data.autoUseQuotaCredits })
      assert.equal(typeof data.autoUseQuotaCredits, 'boolean')
      useQuotaCredits.set(accountId, data.autoUseQuotaCredits)
      policyWrites.push({ id: accountId, key: 'quotaCredits', enabled: data.autoUseQuotaCredits })
      envelope = { code: 200, data: { accountIds: [accountId] } }
    } else if (url.pathname === '/api/admin/accounts/reset-credits' && params.method === 'GET') {
      cardQueries++
      envelope = { code: 200, message: 'ok', data: cards.get(id) }
      if (activeMode === 'downgraded') accounts.find(a => a.account_id === id).plan = 'free'
    } else {
      assert.equal(url.pathname, '/api/admin/accounts/reset-credits')
      assert.equal(params.method, 'POST')
      const state = records.get(`account/${id}`).value
      assert.equal(state.pending.requestId, data.redeemRequestId, 'Pending UUID must be durable before POST')
      assert.equal(state.pending.creditId, data.creditId)
      assert.match(data.redeemRequestId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
      posts.push(structuredClone(data))
      if (consumeMode === 'uncertain') return error(meta.id, 'uncertain')
      if (consumeMode === 'invalid') envelope = { code: 200, message: 'ok', data: {} }
      else {
        const c = cards.get(id)
        c.availableCount = Math.max(0, c.availableCount - 1); c.credits = c.credits.filter(c => c.id !== data.creditId)
        quotas.set(id, quota(id, 0))
        envelope = { code: 200, message: 'ok', data: { code: consumeMode, credit: null } }
      }
    }
    const handle = `body_${++handleSequence}`; handles.set(handle, Buffer.from(JSON.stringify(envelope)))
    return result(meta.id, { status: 200, version: 'HTTP/1.1', headers: [], body: { kind: 'handle', handle }, response: null, session: false })
  }
  if (meta.method === 'host.http.body_read') {
    const value = handles.get(params.handle)
    if (value) { handles.delete(params.handle); return result(meta.id, { eof: false, trailers: null }, value) }
    return result(meta.id, { eof: true, trailers: null })
  }
  if (meta.method === 'host.http.body_close') return result(meta.id, {})
  throw new Error(`Unhandled callback: ${meta.method}`)
}
function parse() {
  while (buffered.length >= 12) {
    const m = buffered.readUInt32BE(), p = Number(buffered.readBigUInt64BE(4)), total = 12 + m + p
    if (buffered.length < total) return
    const meta = JSON.parse(buffered.subarray(12, 12 + m).toString())
    const dataStart = 12 + m + (meta.request_context_bytes ?? 0)
    const dataEnd = dataStart + (meta.data_bytes ?? 0)
    assert.ok(dataEnd <= total)
    const data = meta.data_bytes ? JSON.parse(buffered.subarray(dataStart, dataEnd).toString()) : undefined
    const payload = buffered.subarray(dataEnd, total)
    buffered = buffered.subarray(total)
    if (meta.type === 'ready') {
      assert.equal(meta.protocol_version, protocolVersion)
      assert.equal(meta.incarnation, incarnation)
      ready.resolve()
    }
    else if (meta.type === 'callback') {
      assert.ok(pending.has(meta.parent_id))
      callback(meta, data, payload).catch(e => { ready.reject(e); for (const x of pending.values()) x.reject(e) })
    }
    else if (meta.type === 'suspend') {
      const waiter = pending.get(meta.id)
      assert.ok(waiter && !waiter.suspended)
      assert.equal(meta.epoch, ++waiter.epoch)
      waiter.suspended = true
    }
    else if (meta.type === 'resume') {
      const waiter = pending.get(meta.id)
      assert.ok(waiter?.suspended)
      assert.equal(meta.epoch, waiter.epoch)
      waiter.suspended = false
      send({ type: 'resumed', id: meta.id, epoch: meta.epoch })
    }
    else if (meta.type === 'result' || meta.type === 'error') {
      const waiter = pending.get(meta.id)
      if (waiter) { pending.delete(meta.id); meta.type === 'error' ? waiter.reject(new Error(JSON.stringify(meta.error))) : waiter.resolve({ result: data, payload }) }
    }
  }
}
async function start() {
  buffered = Buffer.alloc(0); pending = new Map(); ready = Promise.withResolvers(); errors = ''; incarnation = `test_${Date.now()}`
  child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { buffered = Buffer.concat([buffered, data]); parse() })
  child.stderr.on('data', data => { errors += data }); child.on('error', e => ready.reject(e))
  child.on('exit', code => { if (code) { const e = new Error(`Plugin exited ${code}: ${errors}`); ready.reject(e); for (const w of pending.values()) w.reject(e) } })
  send({ type: 'hello', handshake: { protocol_version: protocolVersion, artifact_sha256: 'a'.repeat(64), plugin_id: 'personal.quota-manager', instance_id: 'test_instance', generation: 1, incarnation, contributes } }, {})
  await Promise.race([ready.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Handshake timeout: ${errors}`)), 10000).unref())])
}
async function stop() { const exited = new Promise(resolve => child.once('exit', resolve)); send({ type: 'shutdown' }); child.stdin.end(); await exited }
async function call(method, params = {}, payload = Buffer.alloc(0), stage = 'management') {
  const id = sequence += 2, waiter = Promise.withResolvers(); pending.set(id, waiter)
  waiter.epoch = 0
  waiter.suspended = false
  const timeoutMs = stage === 'registration' ? 5000 : 60000
  send({ type: 'call', id, method, context: { call_id: id, instance_id: 'test_instance', generation: 1, incarnation, stage, timeout_ms: timeoutMs, resource_stream: false, resource_scope_id: `scope_${id}` } }, params, payload)
  return Promise.race([waiter.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Call timeout ${method}: ${errors}`)), 10000).unref())])
}
async function request(path, body, query = '') {
  const reply = await call('management.handle', { method: body === undefined ? 'GET' : 'POST', path, query, content_type: body === undefined ? null : 'application/json', headers: [] }, body === undefined ? Buffer.alloc(0) : body)
  return { status: reply.result.status, value: JSON.parse(reply.payload.toString()) }
}
async function scan() { const s = records.get('scan'); if (s) s.value.nextAtMs = 0; return call('plugin.reconcile', {}, Buffer.alloc(0), 'maintenance') }
const passed = [], check = label => { passed.push(label); console.log(`PASS ${label}`) }
try {
  await start()
  const pluginRegistration = await call('plugin.register', {}, Buffer.alloc(0), 'registration')
  assert.deepEqual(pluginRegistration.result.contributes, contributes)
  const registrationReply = await call('management.register', {}, Buffer.alloc(0), 'registration')
  const registration = JSON.parse(registrationReply.payload.toString()); assert.equal(registration.pages[0].entry, 'web/index.html'); assert.equal(registration.routes.length, 8)
  check('RPC v7 handshake and management v2 registration')
  const page = await request('api/accounts')
  assert.equal(page.status, 200)
  assert.equal(page.value.nextPage, 2)
  assert.deepEqual(page.value.accounts.map(r => r.account.account_id), ['acct_001', 'acct_002'])
  const [first, second] = page.value.accounts
  assert.equal(first.account.name, accounts[0].name)
  assert.equal(first.account.plan_type_display, 'Team')
  assert.equal(first.quota.credits.balance, '0')
  assert.equal(second.quota.credits.balance, '12.50')
  assert.equal(second.account.enabled, false)
  assert.equal(second.autoUseQuotaCredits, true)
  assert.equal(second.resetCardAutomation.enabled, false)
  assert.equal(first.state.subscription, null)
  assert.deepEqual(subscriptionReads, [])
  assert.equal(cardQueries, 0)
  check('List reads cached facts and native flags without querying upstream')

  const mixed = await request('api/accounts', undefined, 'page=3')
  assert.deepEqual(mixed.value.accounts.map(r => r.account.account_id), ['acct_005'])
  assert.equal(mixed.value.nextPage, 4)
  const last = await request('api/accounts', undefined, 'page=4')
  assert.equal(last.value.nextPage, null)
  assert.deepEqual(last.value.accounts.map(r => r.account.account_id), ['acct_008'])
  assert.equal(last.value.accounts[0].autoUseQuotaCredits, null)
  assert.equal(last.value.accounts[0].resetCardAutomation, null)
  check('Free accounts are excluded and unsupported switches stay unavailable')

  for (const [path, input] of [
    ['api/consume', { creditId: 'acct_006_early' }],
    ['api/refresh', {}],
    ['api/refresh-cards', {}],
    ['api/auto-use-quota-credits', { enabled: true }],
    ['api/auto-use-reset-cards', { enabled: true }],
  ]) {
    assert.equal((await request(path, { accountId: 'acct_006', ...input })).status, 400)
  }
  assert.deepEqual(subscriptionReads, [])
  assert.deepEqual(policyWrites, [])
  assert.equal(posts.length, 0)
  assert.equal(cardQueries, 0)
  check('Free accounts cannot refresh, set native flags or redeem')

  const setQuotaCredits = enabled => request('api/auto-use-quota-credits', { accountId: 'acct_001', enabled })
  const setResetCards = enabled => request('api/auto-use-reset-cards', { accountId: 'acct_001', enabled })
  const readFirst = async () => (await request('api/accounts')).value.accounts[0]
  assert.deepEqual((await setQuotaCredits(true)).value, { enabled: true })
  assert.equal((await readFirst()).autoUseQuotaCredits, true)
  assert.equal((await readFirst()).resetCardAutomation.enabled, false)
  assert.equal((await setResetCards(true)).value.next_consume_at, '2026-12-01T18:00:00Z')
  assert.deepEqual((await setQuotaCredits(false)).value, { enabled: false })
  assert.equal((await readFirst()).autoUseQuotaCredits, false)
  assert.equal((await readFirst()).resetCardAutomation.enabled, true)
  assert.equal(useQuotaCredits.get('acct_002'), true)
  assert.equal(useResetCards.has('acct_002'), false)
  check('Two switches write independent native settings for the selected account')

  const settings = { checkIntervalSeconds: 30, cardsRefreshSeconds: 3600, batchSize: 20 }
  records.set('settings', { value: { ...settings, automatic: true }, version: 1, schema_version: 1 })
  records.set('automation', { value: { mode: 'all' }, version: 1, schema_version: 1 })
  records.set('account/acct_001', { value: { ...first.state, automatic: true }, version: 1, schema_version: 1 })
  quotas.set('acct_001', quota('acct_001', 100))
  const writesBeforeScan = [...policyWrites]
  await scan()
  assert.deepEqual(policyWrites, writesBeforeScan)
  assert.equal(posts.length, 0)
  assert.deepEqual(subscriptionReads, ['acct_001'])
  assert.equal(cardQueries, 1)
  const observed = await readFirst()
  assert.deepEqual(observed.state.subscription, subscription)
  assert.ok(!JSON.stringify(observed).includes('ignored-profile-field'))
  assert.deepEqual(Object.keys(observed.state.subscription).sort(), ['expiresAt', 'observedAt', 'startsAt'])
  check('Legacy automation never redeems or writes native flags; maintenance caches only subscription dates')

  await scan()
  assert.equal(subscriptionReads.at(-1), 'acct_003')
  assert.equal(cardQueries, 1)
  const uncachedQuota = (await request('api/accounts', undefined, 'page=2')).value.accounts[0]
  assert.deepEqual(uncachedQuota.state.subscription, subscription)
  check('Subscription cache fills even when cached quota facts are unavailable')

  const quotaFactsBefore = quotaFactReads.length
  const cardQueriesBefore = cardQueries
  const persistedBefore = records.get('account/acct_001').version
  const subscriptionReadsBefore = subscriptionReads.length
  records.get('scan').value.cursor = null
  records.set('account/acct_002', {
    value: { ...first.state, cardsCheckedAtMs: Date.now(), subscriptionCheckedAtMs: Date.now() },
    version: 1, schema_version: 1,
  })
  await scan()
  assert.equal(quotaFactReads.length, quotaFactsBefore)
  assert.equal(cardQueries, cardQueriesBefore)
  assert.equal(subscriptionReads.length, subscriptionReadsBefore)
  assert.equal(records.get('account/acct_001').version, persistedBefore)
  check('A fresh cache with no pending quota recovery makes no quota or upstream read and no account state write')

  const refreshedCards = await request('api/refresh-cards', { accountId: 'acct_001' })
  assert.equal(refreshedCards.status, 200)
  assert.equal(refreshedCards.value.cards.availableCount, 2)
  assert.equal(cardQueries, cardQueriesBefore + 1)
  assert.equal(subscriptionReads.length, subscriptionReadsBefore)
  assert.equal(refreshCalls.length, 0)
  assert.equal(posts.length, 0)
  check('Interactive inventory refresh queries cards without refreshing subscription, quota, or consuming a card')

  activeMode = 'subscription_error'
  const refreshed = await request('api/refresh', { accountId: 'acct_001' })
  assert.equal(refreshed.status, 200)
  assert.deepEqual(refreshed.value.state.subscription, subscription)
  assert.equal(refreshed.value.quota.credits.balance, '0')
  assert.ok(refreshCalls.includes('acct_001'))
  activeMode = 'normal'
  check('Manual refresh preserves last subscription when its lookup fails')

  const loaded = await request('api/status')
  assert.deepEqual(loaded.value.resetCardSettings, resetCardSettings)
  assert.ok(!JSON.stringify(loaded).includes('settings-private-marker'))
  resetCardSettings = { ...resetCardSettings, resetCreditOnLowWeeklyQuota: true }
  assert.deepEqual((await request('api/status')).value.resetCardSettings, resetCardSettings)
  activeMode = 'settings_error'
  assert.equal((await request('api/status')).value.resetCardSettings, null)
  activeMode = 'normal'
  check('Status reads the current host rules, projects only reset-card fields, and tolerates unavailability')

  activeMode = 'downgraded';const downgradePosts=posts.length;const downgrade=await request('api/consume',{accountId:'acct_003',creditId:'acct_003_early'});assert.equal(downgrade.status,400);assert.equal(posts.length,downgradePosts);assert.equal(records.get('account/acct_003')?.value.pending??null,null);accounts[2].plan='team';activeMode='normal'
  check('A downgrade observed during refresh blocks consumption')
  consumeMode = 'uncertain'; const unknown = await request('api/consume', { accountId: 'acct_004', creditId: 'acct_004_early' }); assert.equal(unknown.status, 200); assert.ok(unknown.value.state.pending)
  const count = posts.length, original = posts.at(-1).redeemRequestId
  const duplicate = await request('api/consume', { accountId: 'acct_004', creditId: 'acct_004_late' }); assert.equal(duplicate.status, 400); assert.equal(posts.length, count)
  check('Unknown result blocks a new card operation')
  accounts[3].plan='free';const downgradedPending=await request('api/accounts',undefined,'page=2');assert.ok(!downgradedPending.value.accounts.some(r=>r.account.account_id==='acct_004'));assert.equal(downgradedPending.value.excludedPending[0].state.pending.requestId,original)
  check('Downgraded Free leaves the active list but retains an unresolved original request')
  await stop(); await start(); consumeMode = 'already_redeemed'
  const retry = await request('api/retry', { accountId: 'acct_004', requestId: original }); assert.equal(retry.status, 200); assert.equal(posts.at(-1).redeemRequestId, original); assert.equal(retry.value.state.pending, null); assert.equal(retry.value.state.history[0].code, 'already_redeemed')
  check('Process restart retry reuses the durable original UUID')
  assert.equal(accounts[3].plan,'free');check('An existing uncertain operation can be confirmed after plan downgrade')
  consumeMode = 'invalid'; const invalid = await request('api/consume', { accountId: 'acct_005', creditId: 'acct_005_early' }); assert.ok(invalid.value.state.pending)
  check('HTTP success without a semantic result remains uncertain')
  consumeMode = 'unexpected_code'
  const unexpected = await request('api/retry', { accountId: 'acct_005', requestId: invalid.value.state.pending.requestId }); assert.ok(unexpected.value.state.pending)
  check('Unrecognized upstream result does not clear pending operation')
  assert.deepEqual(policyWrites, writesBeforeScan)
  assert.ok(!reads.includes('host.auth.get'))
  assert.ok(!reads.includes('host.auth.save'))
  check('No raw credentials are read or saved')
  await stop(); console.log(JSON.stringify({ passed: passed.length, tests: passed, mockRedemptions: posts.length, productionRequests: 0 }, null, 2))
} catch (e) { child?.kill(); console.error(e); process.exitCode = 1 }
