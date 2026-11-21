import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from './api'
import { canReset, isFree, isLimited, planKey, selectable, status, week } from './format'
import type { Card, PageStatus, Pending, Row } from './types'

export type Policy = 'quotaCredits' | 'resetCards'
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败'
const canSetPolicy = (row: Row, key: Policy) => key === 'quotaCredits' ? row.autoUseQuotaCredits !== null : row.resetCardAutomation !== null

export function useQuotaManager() {
  const rows = ref<Row[]>([]), excludedPending = ref<Row[]>([])
  const loading = ref(false), refreshing = ref(false), busy = ref(''), error = ref(''), notice = ref('')
  const search = ref(''), filter = ref('all'), membership = ref('all'), order = ref('name'), page = ref(1), pageSize = ref(10)
  const pageStatus = ref<PageStatus>({ scan: { checkedAtMs: null }, resetCardSettings: null })
  const showCards = ref(false), selectedId = ref(''), consuming = ref(false), cardsLoading = ref(false), cardsError = ref('')
  const confirmation = ref<{ card: Card | null; pending: Pending | null } | null>(null)
  const bulk = ref(false), stopBulk = ref(false), bulkDone = ref(0), bulkTotal = ref(0), failures = ref<string[]>([])
  const selected = computed(() => [...rows.value, ...excludedPending.value].find(row => row.account.account_id === selectedId.value))
  const blocked = computed(() => !!busy.value || bulk.value || consuming.value || cardsLoading.value)
  const known = computed(() => rows.value.filter(row => row.state.cards !== null).length)
  const totalCards = computed(() => rows.value.reduce((sum, row) => sum + (row.state.cards?.availableCount ?? 0), 0))
  const limited = computed(() => rows.value.filter(isLimited).length)
  const pending = computed(() => rows.value.filter(row => row.state.pending).length + excludedPending.value.length)
  const automaticCount = computed(() => rows.value.filter(row => row.resetCardAutomation?.enabled).length)
  const planOptions = computed(() => {
    const plans = new Map<string, { label: string; count: number }>()
    for (const row of rows.value) {
      const key = planKey(row)
      plans.set(key, { label: row.account.plan_type_display, count: (plans.get(key)?.count ?? 0) + 1 })
    }
    return [{ label: '全部会员', value: 'all' }, ...Array.from(plans).sort(([a], [b]) => a.localeCompare(b)).map(([value, plan]) => ({ value, label: `${plan.label} (${plan.count})` }))]
  })
  const filtered = computed(() => {
    const query = search.value.trim().toLowerCase()
    return rows.value.filter(row => `${row.account.name} ${row.account.account_id} ${row.account.email ?? ''}`.toLowerCase().includes(query)
      && (membership.value === 'all' || planKey(row) === membership.value)
      && (filter.value === 'all' || (filter.value === 'limited' && isLimited(row)) || (filter.value === 'cards' && (row.state.cards?.availableCount ?? 0) > 0)
        || (filter.value === 'pending' && !!row.state.pending) || (filter.value === 'unknown' && !row.state.cards) || (filter.value === 'error' && !!row.state.error)
        || (filter.value === 'disabled' && !row.account.enabled) || (filter.value === 'automatic' && row.resetCardAutomation?.enabled === true)))
      .sort((a, b) => order.value === 'used' ? (week(b)?.used_percent ?? -1) - (week(a)?.used_percent ?? -1)
        : order.value === 'expiry' ? (Date.parse(selectable(a)[0]?.expiresAt || '') || Infinity) - (Date.parse(selectable(b)[0]?.expiresAt || '') || Infinity)
          : a.account.name.localeCompare(b.account.name))
  })
  const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
  const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
  const policyTargets = computed(() => ({
    quotaCredits: filtered.value.filter(row => canSetPolicy(row, 'quotaCredits')),
    resetCards: filtered.value.filter(row => canSetPolicy(row, 'resetCards')),
  }))
  const cardOptions = computed(() => selected.value ? selectable(selected.value) : [])
  const countOnly = computed(() => !!selected.value?.state.cards && selected.value.state.cards.availableCount > 0 && selected.value.state.cards.credits.length === 0)
  const filteredActive = computed(() => !!search.value || filter.value !== 'all' || membership.value !== 'all')
  let mutation = 0, stopped = false

  function clearFilters() { search.value = ''; filter.value = 'all'; membership.value = 'all' }
  function applyRow(row: Row, result: { state: Row['state']; quota?: Row['quota'] }) {
    row.state = result.state
    if ('quota' in result) row.quota = result.quota ?? null
  }
  async function load(silent = false) {
    if (loading.value || refreshing.value || blocked.value || showCards.value) return
    if (silent) refreshing.value = true
    else { loading.value = true; error.value = '' }
    const started = mutation
    try {
      const found = new Map<string, Row>(), excluded = new Map<string, Row>()
      let next = 1
      while (!stopped) {
        const result = await api.accounts(next)
        for (const row of result.accounts) if (!isFree(row)) found.set(row.account.account_id, row)
        for (const row of result.excludedPending) excluded.set(row.account.account_id, row)
        if (result.nextPage === null) break
        if (result.nextPage !== next + 1) throw new Error('账号分页无效，请重新加载')
        next = result.nextPage
      }
      const current = await api.status()
      // 后台读回不能覆盖读期间发生的开关修改
      if (!stopped && started === mutation && !blocked.value) {
        rows.value = [...found.values()]
        excludedPending.value = [...excluded.values()]
        pageStatus.value = current
      }
    } catch (cause) { error.value = message(cause) }
    finally { loading.value = false; refreshing.value = false }
  }
  async function refresh(row: Row, report = true): Promise<boolean> {
    mutation++; busy.value = row.account.account_id
    if (report) { error.value = ''; notice.value = '' }
    try {
      applyRow(row, await api.refresh(row.account.account_id))
      if (report) notice.value = '已更新账号快照'
      return true
    } catch (cause) {
      if (report) error.value = message(cause)
      else failures.value.push(`${row.account.name}：${message(cause)}`)
      return false
    } finally { busy.value = '' }
  }
  async function refreshAll() {
    if (blocked.value) return
    bulk.value = true; stopBulk.value = false; error.value = ''; notice.value = ''; failures.value = []; bulkDone.value = 0
    const targets = filtered.value.filter(canReset)
    bulkTotal.value = targets.length
    try {
      for (const row of targets) {
        if (stopBulk.value || stopped) break
        await refresh(row, false)
        bulkDone.value++
        if (bulkDone.value < targets.length) await new Promise(resolve => setTimeout(resolve, 1000))
      }
      notice.value = `已更新 ${bulkDone.value}/${bulkTotal.value} 个账号${failures.value.length ? `，失败 ${failures.value.length} 个` : ''}`
    } finally { bulk.value = false }
  }
  async function policy(row: Row, key: Policy, enabled: boolean) {
    if (blocked.value || !canSetPolicy(row, key)) return
    mutation++; busy.value = row.account.account_id; error.value = ''; notice.value = ''
    try { await writePolicy(row, key, enabled) }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = '' }
    if (error.value) await load(true)
  }
  async function writePolicy(row: Row, key: Policy, enabled: boolean) {
    if (key === 'quotaCredits') row.autoUseQuotaCredits = await api.setQuotaCredits(row.account.account_id, enabled)
    else row.resetCardAutomation = await api.setResetCards(row.account.account_id, enabled)
  }
  async function setFilteredPolicy(key: Policy, enabled: boolean) {
    if (blocked.value || loading.value) return
    const targets = policyTargets.value[key].filter(row => (
      key === 'quotaCredits' ? row.autoUseQuotaCredits : row.resetCardAutomation?.enabled
    ) !== enabled)
    if (!targets.length) return
    mutation++; bulk.value = true; stopBulk.value = false; error.value = ''; notice.value = ''; failures.value = []
    bulkDone.value = 0; bulkTotal.value = targets.length
    try {
      for (const row of targets) {
        if (stopBulk.value || stopped) break
        try { await writePolicy(row, key, enabled) }
        catch (cause) { failures.value.push(`${row.account.email ?? row.account.name}：${message(cause)}`) }
        bulkDone.value++
      }
      const label = key === 'quotaCredits' ? '自动使用额度点数' : '自动使用重置卡'
      notice.value = `${enabled ? '开启' : '关闭'}${label}，成功 ${bulkDone.value - failures.value.length}/${targets.length} 个账号${failures.value.length ? `，失败 ${failures.value.length} 个` : ''}${stopBulk.value && bulkDone.value < targets.length ? '，已停止' : ''}`
    } finally { bulk.value = false }
  }
  function openCards(row: Row) {
    selectedId.value = row.account.account_id
    error.value = ''; cardsError.value = ''
    confirmation.value = null; showCards.value = true
    if (canReset(row) && !row.state.pending) void refreshCardInventory()
  }
  async function refreshCardInventory() {
    const row = selected.value
    if (!row || blocked.value || !canReset(row)) return
    mutation++; cardsLoading.value = true; cardsError.value = ''
    try { row.state = await api.refreshCards(row.account.account_id) }
    catch (cause) { cardsError.value = message(cause) }
    finally { cardsLoading.value = false }
  }
  function requestConsume(card: Card | null) {
    const row = selected.value
    if (!row || blocked.value) return
    const pending = row.state.pending
    if (!pending && (cardsError.value || (card ? !cardOptions.value.some(item => item.id === card.id) : !countOnly.value))) return
    error.value = ''
    confirmation.value = { card, pending }
  }
  async function consume() {
    const row = selected.value, operation = confirmation.value
    if (!row || !operation || blocked.value) return
    mutation++; consuming.value = true; error.value = ''; notice.value = ''
    try {
      applyRow(row, operation.pending ? await api.retry(row.account.account_id, operation.pending.requestId) : await api.consume(row.account.account_id, operation.card?.id ?? null))
      if (row.state.pending) notice.value = '结果待确认，请确认原操作'
      else {
        notice.value = row.state.error ?? '重置已完成'
        showCards.value = false
        if (isFree(row)) excludedPending.value = excludedPending.value.filter(item => item.account.account_id !== row.account.account_id)
      }
    } catch (cause) {
      error.value = message(cause)
      // 不确定时先回读原操作，避免下一次点击成为新消费
      try {
        let next = 1
        while (!stopped) {
          const result = await api.accounts(next)
          const found = [...result.accounts, ...result.excludedPending].find(item => item.account.account_id === row.account.account_id)
          if (found) { applyRow(row, found); break }
          if (result.nextPage === null) break
          if (result.nextPage !== next + 1) throw new Error('分页无效')
          next = result.nextPage
        }
      } catch { notice.value = '请重新加载账号记录，确认原操作结果' }
    } finally { consuming.value = false; confirmation.value = null }
  }
  watch([search, filter, membership, order, pageSize], () => { page.value = 1 })
  watch(pages, count => { page.value = Math.min(page.value, count) })
  onMounted(() => { void load() })
  onUnmounted(() => { stopped = true; stopBulk.value = true })
  return { rows, loading, refreshing, busy, error, notice, excludedPending, search, filter, membership, order, page, pageSize, pageStatus, policyTargets,
    showCards, confirmation, consuming, cardsLoading, cardsError, bulk, stopBulk, bulkDone, bulkTotal, failures, selected, blocked, known, totalCards, limited, pending, automaticCount,
    planOptions, filtered, visible, cardOptions, countOnly, filteredActive, clearFilters, load, refresh, refreshAll, policy, setFilteredPolicy, openCards, refreshCardInventory, requestConsume, consume }
}
