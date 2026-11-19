import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const binary = process.argv[2] || fileURLToPath(new URL(`../backend/target/debug/quota-manager${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
const stamp = Date.now()
const account = (id, enabled = true, plan = 'team') => ({ account_id: id, provider_id: 'openai', name: `team+${id}+2026/10/28+workspace3`, email: `${id}@example.com`, group_ids: [], enabled, updated_at_ms: stamp, plan })
const accounts = [account('acct_001'), account('acct_002', false), account('acct_003'), account('acct_004'), account('acct_005'), account('acct_006', true, 'free'), account('acct_007', true, ' Free '), account('acct_008', true, 'plus')]
accounts[7].name = 'free-prefix-but-paid-plus@example.com'
const quota = (id, used = 25, key = 'codex:604800s', seconds = 604800) => ({ schema_version: 1, account_id: id, observed_at_ms: Date.now(), windows: [{ key, window_seconds: seconds, used_percent: used, reset_at_ms: stamp + 86400000 }] })
const quotas = new Map(accounts.map(a => [a.account_id, quota(a.account_id)]))
const cards = new Map(accounts.map(a => [a.account_id, { availableCount: 2, credits: [
  { id: `${a.account_id}_late`, status: 'available', title: 'Full reset (Weekly + 5 hr)', resetType: 'full', expiresAt: new Date(stamp + 86400000 * 7).toISOString(), expiresAtDisplay: null },
  { id: `${a.account_id}_early`, status: 'available', title: 'Full reset (Weekly + 5 hr)', resetType: 'full', expiresAt: new Date(stamp + 86400000 * 2).toISOString(), expiresAtDisplay: null },
] }]))
const records = new Map(), posts = [], refreshCalls = [], reads = [], handles = new Map()
const runtimeAccount = a => ({ account_id: a.account_id, provider_id: a.provider_id, name: a.name, email: a.email, enabled: a.enabled,
  credential_revision: 1, upstream_user_id: null, upstream_account_id: null, plan_type: a.plan, authentication_kind: 'oauth', credential_state: 'ready', has_refresh_token: true, access_token_expires_at_ms: null, next_refresh_at_ms: null })
let consumeMode = 'reset', child, buffered, pending, ready, sequence = 99, errors = '', activeMode = 'normal', incarnation, handleSequence = 0, runtimeReads = 0, cardQueries = 0, failSelectionWrite = false
let callbacks, suspended, resumedCount = 0, consumedCount = 0

function send(meta, payload = Buffer.alloc(0)) {
  if (!(payload instanceof Buffer)) payload = Buffer.from(JSON.stringify(payload))
  meta = structuredClone(meta)
  let data = Buffer.alloc(0)
  const owner = meta.type === 'hello' ? meta.handshake : meta
  const key = meta.type === 'hello' ? 'configuration' : meta.type === 'call' || meta.type === 'callback' ? 'params' : meta.type === 'result' ? 'result' : null
  if (key) {
    data = Buffer.from(JSON.stringify(owner[key])); delete owner[key]
    meta.data_bytes = data.length
  }
  const json = Buffer.from(JSON.stringify(meta)), header = Buffer.alloc(12)
  header.writeUInt32BE(json.length); header.writeBigUInt64BE(BigInt(data.length + payload.length), 4)
  child.stdin.write(Buffer.concat([header, json, data, payload]))
}
function result(id, value = {}, payload = Buffer.alloc(0)) { send({ type: 'result', id, result: value }, payload) }
function error(id, code = 'rejected') { send({ type: 'error', id, error: { code, message: 'mock rejection', send_state: 'not_sent' } }) }
async function callback(meta, payload) {
  reads.push(meta.method)
  const data = payload.length ? JSON.parse(payload.toString()) : meta.params
  if (meta.method === 'host.data.accounts.list' || meta.method === 'host.auth.list') {
    const start = data.cursor ? accounts.findIndex(a => a.account_id === data.cursor) + 1 : 0
    const batch = accounts.slice(start, start + Math.min(data.limit, 2))
    return result(meta.id, {}, { ...(meta.method === 'host.data.accounts.list' ? {schema_version:1} : {}), accounts: meta.method === 'host.auth.list' ? batch.map(runtimeAccount) : batch, next_cursor: start + batch.length < accounts.length ? batch.at(-1).account_id : null })
  }
  if (meta.method === 'host.data.quota.get' || meta.method === 'host.quota_observations.refresh') {
    const q = structuredClone(quotas.get(data.account_id))
    if (meta.method.includes('refresh')) { refreshCalls.push(data.account_id); q.observed_at_ms = Date.now(); if (activeMode === 'recovered') q.windows[0].used_percent = 10 }
    return result(meta.id, {}, q)
  }
  if (meta.method === 'host.auth.get_runtime') {
    runtimeReads++
    const a = accounts.find(a => a.account_id === data.account_id)
    return result(meta.id, {}, runtimeAccount(a))
  }
  if (meta.method === 'host.state.get') return result(meta.id, { record: records.get(data.key) ?? null })
  if (meta.method === 'host.state.put') {
    if (data.key === 'automation' && failSelectionWrite) { failSelectionWrite = false; return error(meta.id) }
    const existing = records.get(data.key)
    if ((existing?.version ?? null) !== data.expected_version) return error(meta.id, 'conflict')
    const version = (existing?.version ?? 0) + 1
    records.set(data.key, { value: structuredClone(data.value), version, schema_version: 1 })
    return result(meta.id, { version })
  }
  if (meta.method === 'host.http.dispatch') {
    const url = new URL(meta.params.uri, 'http://mock.invalid'), id = url.searchParams.get('accountId') || data.accountId
    assert.equal(url.pathname, '/api/admin/accounts/reset-credits')
    let envelope
    if (meta.params.method === 'GET') { cardQueries++; envelope = { code: 200, message: 'ok', data: cards.get(id) }; if (activeMode === 'downgraded') accounts.find(a=>a.account_id===id).plan = 'free'; if (activeMode === 'automation_off') { records.get('settings').value.automatic = false; records.get('settings').version++ } }
    else {
      assert.equal(meta.params.method, 'POST')
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
    const value = handles.get(meta.params.handle)
    if (value) { handles.delete(meta.params.handle); return result(meta.id, { eof: false, trailers: null }, value) }
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
    assert.ok(m <= 65536)
    const dataStart = 12 + m + (meta.request_context_bytes ?? 0), dataEnd = dataStart + (meta.data_bytes ?? 0)
    assert.ok(dataEnd <= total)
    if (meta.type === 'result' || meta.type === 'callback') {
      assert.ok(meta.data_bytes > 0)
      const key = meta.type === 'result' ? 'result' : 'params'
      assert.ok(!(key in meta), 'RPC v7 business JSON belongs in the payload prefix')
      meta[key] = JSON.parse(buffered.subarray(dataStart, dataEnd).toString())
    }
    const payload = buffered.subarray(dataEnd, total); buffered = buffered.subarray(total)
    if (meta.type === 'ready') {
      assert.equal(meta.protocol_version, 7); assert.equal(meta.incarnation, incarnation)
      ready.resolve()
    }
    else if (meta.type === 'suspend') {
      assert.ok(pending.has(meta.id)); assert.ok(!suspended.has(meta.id))
      suspended.set(meta.id, meta.epoch)
    }
    else if (meta.type === 'resume') {
      assert.equal(suspended.get(meta.id), meta.epoch)
      suspended.delete(meta.id); resumedCount++
      send({ type: 'resumed', id: meta.id, epoch: meta.epoch })
    }
    else if (meta.type === 'callback_consumed') {
      assert.equal(callbacks.get(meta.id), meta.parent_id)
      callbacks.delete(meta.id); consumedCount++
    }
    else if (meta.type === 'callback') {
      assert.ok(pending.has(meta.parent_id)); callbacks.set(meta.id, meta.parent_id)
      callback(meta, payload).catch(e => { ready.reject(e); for (const x of pending.values()) x.reject(e) })
    }
    else if (meta.type === 'result' || meta.type === 'error') {
      const waiter = pending.get(meta.id)
      if (waiter) { pending.delete(meta.id); meta.type === 'error' ? waiter.reject(new Error(JSON.stringify(meta.error))) : waiter.resolve({ result: meta.result, payload }) }
    }
  }
}
async function start(protocolVersion = 7) {
  buffered = Buffer.alloc(0); pending = new Map(); ready = Promise.withResolvers(); errors = ''; incarnation = `test_${Date.now()}`
  callbacks = new Map(); suspended = new Map()
  child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { buffered = Buffer.concat([buffered, data]); parse() })
  child.stderr.on('data', data => { errors += data }); child.on('error', e => ready.reject(e))
  child.on('exit', code => { if (code) { const e = new Error(`Plugin exited ${code}: ${errors}`); ready.reject(e); for (const w of pending.values()) w.reject(e) } })
  send({ type: 'hello', handshake: { protocol_version: protocolVersion, artifact_sha256: 'a'.repeat(64), plugin_id: 'personal.quota-manager', instance_id: 'test_instance', generation: 1, incarnation, configuration: {}, contributes: {
    management: { id: 'personal.quota-manager.management', version: 2, stages: ['management'] }, maintenance: { id: 'personal.quota-manager.maintenance', version: 1, stages: ['maintenance'] },
  } } })
  await Promise.race([ready.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Handshake timeout: ${errors}`)), 10000).unref())])
}
async function stop() {
  const exited = new Promise(resolve => child.once('exit', resolve)); send({ type: 'shutdown' }); child.stdin.end(); await exited
  assert.equal(callbacks.size, 0); assert.equal(suspended.size, 0)
}
async function call(method, params = {}, payload = Buffer.alloc(0), stage = 'management') {
  const id = sequence += 2, waiter = Promise.withResolvers(); pending.set(id, waiter)
  send({ type: 'call', id, method, params, context: { call_id: id, instance_id: 'test_instance', generation: 1, incarnation, stage, timeout_ms: stage === 'registration' ? 5000 : 60000, resource_stream: false, resource_scope_id: `scope_${id}` } }, payload)
  return Promise.race([waiter.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Call timeout ${method}: ${errors}`)), 10000).unref())])
}
async function request(path, body, query = '') {
  const reply = await call('management.handle', { method: body === undefined ? 'GET' : 'POST', path, query, content_type: body === undefined ? null : 'application/json', headers: [] }, body === undefined ? Buffer.alloc(0) : body)
  return { status: reply.result.status, value: JSON.parse(reply.payload.toString()) }
}
async function scan() { const s = records.get('scan'); if (s) s.value.nextAtMs = 0; return call('plugin.reconcile', {}, Buffer.alloc(0), 'maintenance') }
const passed = [], check = label => { passed.push(label); console.log(`PASS ${label}`) }
try {
  await assert.rejects(start(2), /Plugin exited/)
  assert.equal(reads.length, 0)
  check('Unsupported RPC version is rejected before business operations')
  await start()
  const registrationReply = await call('management.register', {}, Buffer.alloc(0), 'registration')
  const registration = JSON.parse(registrationReply.payload.toString()); assert.equal(registration.pages[0].entry, 'web/index.html'); assert.equal(registration.routes.length, 8)
  check('RPC v7 handshake and management v2 registration')
  const page = await request('api/accounts'); assert.equal(page.status, 200); assert.equal(page.value.accounts.length, 2); assert.equal(page.value.nextCursor, 'acct_002'); assert.equal(page.value.accounts[0].account.name, accounts[0].name)
  assert.equal(page.value.accounts[0].account.plan_type, 'team'); assert.equal(page.value.accounts[1].account.enabled, false)
  assert.ok(page.value.accounts.every(row=>!row.state.automatic))
  check('Pagination includes complete account ID and name')
  const freePage = await request('api/accounts', undefined, 'cursor=acct_006'); assert.equal(freePage.value.accounts.length, 1); assert.equal(freePage.value.accounts[0].account.account_id, 'acct_008')
  const mixedPage = await request('api/accounts', undefined, 'cursor=acct_005'); assert.equal(mixedPage.value.accounts.length, 0); assert.equal(mixedPage.value.nextCursor, 'acct_007')
  const paidAfterFree = await request('api/accounts', undefined, 'cursor='+mixedPage.value.nextCursor); assert.equal(paidAfterFree.value.accounts[0].account.plan_type, 'plus')
  check('RS plan type excludes Free despite team-like names and preserves empty-page pagination')
  const beforeFreeQueries = cardQueries, beforeFreePosts = posts.length
  for (const path of ['api/consume','api/refresh','api/policy']) { const blocked=await request(path,{accountId:'acct_006',creditId:'acct_006_early',automatic:true}); assert.equal(blocked.status,400) }
  assert.equal(posts.length,beforeFreePosts); assert.equal(cardQueries,beforeFreeQueries)
  check('Free cannot refresh cards, change automation policy or start redemption')
  await scan(); assert.equal(posts.length, 0); check('Automatic consumption is off by default')
  const saved = await request('api/settings', { value: { automatic: true, checkIntervalSeconds: 30, cardsRefreshSeconds: 3600, batchSize: 20 }, expectedVersion: null }); assert.equal(saved.status, 200)
  const conflict = await request('api/settings', { value: saved.value.value, expectedVersion: null }); assert.equal(conflict.status, 409); check('Settings reject stale writers')
  const automatic = enabled => request('api/automatic',{enabled,expectedVersion:records.get('settings')?.version??null})
  let policyResult=await request('api/policy',{accountId:'acct_003',automatic:false,expectedVersion:records.get('settings').version});assert.equal(policyResult.status,200);assert.equal(policyResult.value.state.automatic,false)
  let policyPage=await request('api/accounts',undefined,'cursor=acct_002');assert.equal(policyPage.value.accounts[0].state.automatic,false);assert.equal(policyPage.value.accounts[1].state.automatic,true)
  check('Per-account changes preserve other automatic selections')
  let changedSettings=await request('api/settings',{value:{...saved.value.value,checkIntervalSeconds:60},expectedVersion:records.get('settings').version});assert.equal(changedSettings.status,200)
  policyPage=await request('api/accounts',undefined,'cursor=acct_002');assert.equal(policyPage.value.accounts[0].state.automatic,false)
  check('Inline parameter saves preserve account exclusions')
  let off=await automatic(false);assert.equal(off.status,200);policyPage=await request('api/accounts');assert.ok(policyPage.value.accounts.every(row=>!row.state.automatic))
  await stop();await start();policyPage=await request('api/accounts');assert.ok(policyPage.value.accounts.every(row=>!row.state.automatic))
  check('Master off clears effective account switches and survives restart')
  policyResult=await request('api/policy',{accountId:'acct_003',automatic:true,expectedVersion:records.get('settings').version});assert.equal(policyResult.value.value.automatic,true)
  policyPage=await request('api/accounts');assert.ok(policyPage.value.accounts.every(row=>!row.state.automatic));policyPage=await request('api/accounts',undefined,'cursor=acct_002');assert.equal(policyPage.value.accounts[0].state.automatic,true);assert.equal(policyPage.value.accounts[1].state.automatic,false)
  check('Enabling one account while master is off enables only that account')
  let on=await automatic(true);assert.equal(on.status,200);policyPage=await request('api/accounts');assert.equal(policyPage.value.accounts[0].state.automatic,true);assert.equal(policyPage.value.accounts[1].state.automatic,false)
  check('Master on selects applicable accounts while paused accounts remain off')
  failSelectionWrite=true;off=await automatic(false);assert.equal(off.status,400);assert.equal(records.get('settings').value.automatic,false);policyPage=await request('api/accounts');assert.ok(policyPage.value.accounts.every(row=>!row.state.automatic))
  check('Failure clearing selections cannot reopen an already disabled master gate')
  on=await automatic(true);assert.equal(on.status,200)
  const scanState=records.get('scan');scanState.value.cursor='acct_005';scanState.value.nextAtMs=0;const beforeFreeScan=cardQueries;quotas.set('acct_006',quota('acct_006',100));quotas.set('acct_007',quota('acct_007',100));await scan();assert.equal(cardQueries,beforeFreeScan);assert.equal(posts.length,0)
  check('Background scan skips Free even when a weekly limit exists')
  records.get('scan').value.cursor = null; quotas.set('acct_001', quota('acct_001', 100)); quotas.set('acct_002', quota('acct_002', 100))
  await scan(); assert.equal(posts.length, 1); assert.equal(posts[0].creditId, 'acct_001_early'); assert.ok(refreshCalls.includes('acct_001')); assert.equal(accounts[1].enabled, false)
  check('Fresh weekly exhaustion redeems earliest expiry and preserves pause state')
  records.get('account/acct_001').value.awaitingRecovery = true; records.get('account/acct_001').value.lastAttemptAtMs = Date.now() - 120000
  records.get('scan').value.cursor = null; quotas.set('acct_001', quota('acct_001', 100)); await scan(); assert.equal(posts.length, 1)
  check('A reset awaiting recovery cannot consume another card')
  records.get('account/acct_001').value.awaitingRecovery = false
  records.get('scan').value.cursor = null; quotas.set('acct_001', quota('acct_001', 100, 'review:604800s')); await scan(); assert.equal(posts.length, 1)
  check('Model-specific weekly limits and disabled accounts do not redeem')
  quotas.set('acct_001', quota('acct_001', 100, 'codex:18000s', 18000)); records.get('scan').value.cursor = null; await scan(); assert.equal(posts.length, 1)
  check('Five-hour exhaustion does not trigger weekly redemption')
  quotas.set('acct_003', quota('acct_003', 100)); records.get('scan').value.cursor = 'acct_002'; activeMode = 'recovered'; await scan(); assert.equal(posts.length, 1); activeMode = 'normal'
  check('Cached exhaustion is skipped when upstream has recovered')
  activeMode = 'downgraded';const downgradePosts=posts.length;const downgrade=await request('api/consume',{accountId:'acct_003',creditId:'acct_003_early'});assert.equal(downgrade.status,400);assert.equal(posts.length,downgradePosts);assert.equal(records.get('account/acct_003')?.value.pending??null,null);accounts[2].plan='team';activeMode='normal'
  check('A downgrade observed during refresh blocks consumption')
  consumeMode = 'uncertain'; const unknown = await request('api/consume', { accountId: 'acct_004', creditId: 'acct_004_early' }); assert.equal(unknown.status, 200); assert.ok(unknown.value.state.pending)
  const count = posts.length, original = posts.at(-1).redeemRequestId
  const duplicate = await request('api/consume', { accountId: 'acct_004', creditId: 'acct_004_late' }); assert.equal(duplicate.status, 400); assert.equal(posts.length, count)
  check('Unknown result blocks a new card operation')
  accounts[3].plan='free';const downgradedPending=await request('api/accounts',undefined,'cursor=acct_002');assert.ok(!downgradedPending.value.accounts.some(r=>r.account.account_id==='acct_004'));assert.equal(downgradedPending.value.excludedPending[0].state.pending.requestId,original)
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
  consumeMode='reset';on=await automatic(true);assert.equal(on.status,200);records.get('account/acct_001').value.awaitingRecovery=false;records.get('account/acct_001').value.lastAttemptAtMs=Date.now()-120000;quotas.set('acct_001',quota('acct_001',100));records.get('scan').value.cursor=null;activeMode='automation_off';const beforeOffDuringRefresh=posts.length;await scan();assert.equal(posts.length,beforeOffDuringRefresh);assert.equal(records.get('settings').value.automatic,false);activeMode='normal'
  check('Master off observed during upstream refresh prevents a pending automatic redemption')
  assert.ok(!reads.includes('host.auth.get')); assert.ok(!reads.includes('host.auth.save')); check('No credentials are read or account settings modified')
  await stop()
  assert.ok(resumedCount > 0); assert.ok(consumedCount > 0)
  check('RPC v7 suspension resumes and all callback results are released')
  console.log(JSON.stringify({ passed: passed.length, tests: passed, resumedCount, consumedCount, mockRedemptions: posts.length, productionRequests: 0 }, null, 2))
} catch (e) { child?.kill(); console.error(e); process.exitCode = 1 }
