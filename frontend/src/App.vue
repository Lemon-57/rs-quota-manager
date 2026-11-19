<script setup lang="ts">
import { Users, Gauge, Download, RefreshCw, Search, Settings2, TicketCheck, X, History, AlertTriangle, Save, RotateCcw, FilterX, CircleHelp } from '@lucide/vue'
import { ZConfigProvider } from '@codex-proxy/ui/config-provider'
import { zhHans } from '@codex-proxy/ui/locale'
import { ZButton } from '@codex-proxy/ui/button'
import { ZCard } from '@codex-proxy/ui/card'
import { ZCheckbox } from '@codex-proxy/ui/checkbox'
import { ZDialog } from '@codex-proxy/ui/dialog'
import { ZIconButton } from '@codex-proxy/ui/icon-button'
import { ZInput } from '@codex-proxy/ui/input'
import { ZInputNumber } from '@codex-proxy/ui/input-number'
import { ZPagination } from '@codex-proxy/ui/pagination'
import { ZPopover } from '@codex-proxy/ui/popover'
import { ZSelect } from '@codex-proxy/ui/select'
import { ZRadio } from '@codex-proxy/ui/radio'
import { ZSwitch } from '@codex-proxy/ui/switch'
import { ZTable, type TableColumn } from '@codex-proxy/ui/table'
import PlanBadge from './PlanBadge.vue'
import ExportDialog from './ExportDialog.vue'
import { ref } from 'vue'
import { avatarTone, canReset, csv, isAutomaticEligible, isLimited, selectable, status, time, week, weeks } from './format'
import { useQuotaManager } from './useQuotaManager'
import type { Row } from './types'

const {
  rows, loading, refreshing, busy, error, notice, excludedPending, search, filter, membership, order, page, pageSize, settings, draft, dirty, parametersEditing,
  showCards, selectedCard, confirmed, consuming, bulk, stopBulk, bulkDone, bulkTotal, failures, selected, blocked, known, totalCards, limited, pending, automaticCount,
  planOptions, filtered, visible, cardOptions, countOnly, filteredActive, resetDraft, clearFilters, load, refresh, refreshAll, toggleAutomatic, policy, saveSettings, openCards, consume,
} = useQuotaManager()
const preview = import.meta.env.DEV
const showExport = ref(false), exportText = ref('')
function exportAccounts() { exportText.value = csv(filtered.value); showExport.value = true }
const statusOptions = [{ value: 'all', label: '全部状态' }, { value: 'limited', label: '周限已满' }, { value: 'cards', label: '有重置卡' }, { value: 'automatic', label: '自动已开启' }, { value: 'pending', label: '结果待确认' }, { value: 'error', label: '检查异常' }, { value: 'unknown', label: '卡片未查询' }, { value: 'disabled', label: '已停用' }]
const orderOptions = [{ value: 'name', label: '按账号名称' }, { value: 'used', label: '按周限用量' }, { value: 'expiry', label: '按卡片到期' }]
const columns: TableColumn<Row>[] = [
  { key: 'identity', label: '账号', kind: 'identity', minWidth: 320 },
  { key: 'plan', label: '订阅', kind: 'status', width: 95, align: 'center' },
  { key: 'status', label: '状态', kind: 'status', width: 120 },
  { key: 'weekly', label: '周限', kind: 'custom', width: 120 },
  { key: 'reset', label: '周限刷新时间', kind: 'datetime', width: 175 },
  { key: 'cards', label: '重置卡 / 到期时间', kind: 'custom', minWidth: 220 },
  { key: 'automatic', label: '自动', kind: 'custom', width: 80, align: 'center' },
  { key: 'actions', label: '操作', kind: 'actions', width: 100 },
]
const rowKey = (row: Row) => row.account.account_id
const accountEmail = (row: Row) => row.account.email?.trim() || row.account.name
const rowTitle = (row: Row) => accountEmail(row)
const statusTone = (row: Row) => row.state.pending || isLimited(row) ? 'warning' : row.state.error ? 'error' : status(row) === '正常' ? 'success' : 'muted'
</script>

<template>
  <ZConfigProvider :locale="zhHans">
  <main class="quota-manager">
    <div v-if="preview" class="preview">本地预览数据</div>
    <div class="metrics">
      <ZCard padding="none" class="metric"><div><span>账号总数</span><strong>{{ rows.length }}</strong><small>非 Free 账号</small></div><span class="metric-icon tone-blue"><Users :size="20" /></span></ZCard>
      <ZCard padding="none" class="metric"><div><span>周限已满</span><strong>{{ limited }}</strong><small>等待额度恢复</small></div><span class="metric-icon tone-orange"><Gauge :size="20" /></span></ZCard>
      <ZCard padding="none" class="metric"><div><span>重置卡库存</span><strong>{{ totalCards }} <em>张</em></strong><small>已查询 {{ known }}/{{ rows.length }} 个账号</small></div><span class="metric-icon tone-green"><TicketCheck :size="20" /></span></ZCard>
      <ZCard padding="none" class="metric"><div><span>结果待确认</span><strong>{{ pending }}</strong><small>自动已开启 {{ automaticCount }} 个账号</small></div><span class="metric-icon tone-orange"><AlertTriangle :size="20" /></span></ZCard>
    </div>

    <div class="work-area">
      <div class="toolbar">
        <ZInput v-model="search" class="account-search" placeholder="搜索账号" clearable aria-label="搜索账号"><template #prefix><Search :size="16" /></template></ZInput>
        <ZSelect v-model="filter" class="status-filter" :options="statusOptions" aria-label="账号状态筛选" />
        <ZSelect v-model="membership" class="plan-filter" :options="planOptions" aria-label="会员标识筛选" />
        <ZSelect v-model="order" class="order-filter" :options="orderOptions" aria-label="账号排序" />
        <ZIconButton v-if="filteredActive" title="清除筛选" aria-label="清除筛选" @click="clearFilters"><FilterX :size="17" /></ZIconButton>
        <div class="toolbar-actions">
          <ZIconButton title="导出筛选账号" aria-label="导出筛选账号" :disabled="!filtered.length || loading" @click="exportAccounts"><Download :size="18" /></ZIconButton>
          <ZIconButton title="读取最新快照" aria-label="读取最新快照" :disabled="blocked || loading || refreshing" @click="load()"><RefreshCw :size="18" :class="{ spin: loading || refreshing }" /></ZIconButton>
          <ZButton v-if="!bulk" :disabled="blocked || loading || !filtered.length" @click="refreshAll"><template #icon><RefreshCw :size="16" /></template>更新筛选账号</ZButton>
          <ZButton v-else :disabled="stopBulk" @click="stopBulk = true"><template #icon><X :size="16" /></template>停止 {{ bulkDone }}/{{ bulkTotal }}</ZButton>
        </div>
      </div>

      <form class="settings-bar" @submit.prevent="saveSettings">
        <span class="settings-label"><Settings2 :size="16" />检测设置</span>
        <label class="parameter"><span>批次间隔</span><ZInputNumber v-model="draft.checkIntervalSeconds" class="parameter-input" :min="30" :max="3600" :precision="0" :controls="false" size="small" :disabled="blocked" aria-label="巡检批次间隔" aria-describedby="check-interval-unit" @input="parametersEditing = true" /><span id="check-interval-unit" class="parameter-unit">秒</span></label>
        <label class="parameter batch"><span>每批账号</span><ZInputNumber v-model="draft.batchSize" class="parameter-input" :min="1" :max="20" :precision="0" :controls="false" size="small" :disabled="blocked" aria-label="每批账号数" aria-describedby="batch-size-unit" @input="parametersEditing = true" /><span id="batch-size-unit" class="parameter-unit">个</span></label>
        <label class="parameter"><span>卡片更新</span><ZInputNumber v-model="draft.cardsRefreshSeconds" class="parameter-input" :min="300" :max="86400" :precision="0" :controls="false" size="small" :disabled="blocked" aria-label="卡片缓存更新间隔" aria-describedby="cards-refresh-unit" @input="parametersEditing = true" /><span id="cards-refresh-unit" class="parameter-unit">秒</span></label>
        <div class="parameter-actions"><ZIconButton title="保存检测设置" aria-label="保存检测设置" :disabled="!dirty || blocked" @click="saveSettings"><Save :size="16" /></ZIconButton><ZIconButton v-if="dirty" title="撤销参数修改" aria-label="撤销参数修改" :disabled="blocked" @click="resetDraft"><RotateCcw :size="16" /></ZIconButton></div>
        <ZPopover trigger="hover-click" placement="top"><template #reference><ZIconButton title="检测设置说明" aria-label="检测设置说明"><CircleHelp :size="16" /></ZIconButton></template><div class="settings-help"><p>按账号轮转，每批最多一个账号查询上游</p><p>自动使用只在通用周限耗尽并重新确认后消费有效卡</p></div></ZPopover>
        <div class="master-switch"><span>自动使用</span><ZSwitch :model-value="settings.value.automatic" :disabled="blocked || loading" aria-label="自动使用总开关" @change="toggleAutomatic" /></div>
      </form>

      <div v-if="error" class="message error" role="alert"><AlertTriangle :size="16" /><span>{{ error }}</span></div>
      <div v-if="notice" class="message" role="status">{{ notice }}</div>
      <details v-if="failures.length" class="failure-list"><summary>{{ failures.length }} 个账号更新失败</summary><p v-for="failure in failures" :key="failure">{{ failure }}</p></details>
      <div v-for="row in excludedPending" :key="row.account.account_id" class="message" role="status"><AlertTriangle :size="16" /><div><b>已排除账号仍有操作待确认</b><span class="sub">{{ row.account.name }}</span></div><ZButton size="small" :disabled="blocked" @click="openCards(row)">确认原操作</ZButton></div>

      <ZTable :columns="columns" :data="visible" :row-key="rowKey" :loading="loading && !rows.length" :empty-text="loading ? '正在读取账号' : filteredActive ? '没有匹配账号' : '暂无账号'">
        <template #identity="{ row }"><div class="account-cell"><span class="account-avatar" :class="`tone-${avatarTone(row.account.account_id)}`">{{ accountEmail(row).slice(0, 1).toUpperCase() }}</span><span class="account-name" :title="rowTitle(row)">{{ accountEmail(row) }}</span></div></template>
        <template #plan="{ row }"><PlanBadge :plan="row.account.plan_type" /></template>
        <template #status="{ row }"><span class="account-status" :class="`status-${statusTone(row)}`" :title="row.state.error || status(row)"><i></i>{{ status(row) }}</span></template>
        <template #weekly="{ row }"><div v-if="week(row)" class="weekly-cell" :title="`额度观测 ${time(row.quota?.observed_at_ms)}`"><div class="quota-value" :class="{ warning: isLimited(row) }">{{ week(row)?.used_percent == null ? '未知' : `${week(row)!.used_percent!.toFixed(1)}%` }}<span>已用</span></div><div class="quota-track"><i :class="{ exhausted: isLimited(row) }" :style="{ width: `${Math.min(100, Math.max(0, week(row)?.used_percent || 0))}%` }"></i></div><details v-if="weeks(row).length > 1" class="extra"><summary>其他周限</summary><span v-for="window in weeks(row)" :key="window.key">{{ window.key }} · {{ window.used_percent ?? '未知' }}%</span></details></div><span v-else class="muted">无周限数据</span></template>
        <template #reset="{ row }"><span class="date" :title="`额度观测 ${time(row.quota?.observed_at_ms)}`">{{ time(week(row)?.reset_at_ms) }}</span></template>
        <template #cards="{ row }"><div class="credits-cell" :title="`卡片观测 ${time(row.state.cardsObservedAtMs)}`"><span class="credit-count" :class="{ muted: !row.state.cards || !row.state.cards.availableCount }"><TicketCheck :size="14" />{{ row.state.cards ? `${row.state.cards.availableCount} 张` : '未查询' }}</span><span v-for="card in selectable(row)" :key="card.id" class="expiry" :title="card.title || '用量重置'">{{ time(card.expiresAt) }}</span><span v-if="row.state.cards && row.state.cards.availableCount > 0 && !selectable(row).length" class="sub">到期信息待更新</span></div></template>
        <template #automatic="{ row }"><ZSwitch :model-value="settings.value.automatic && row.state.automatic" :disabled="blocked || !isAutomaticEligible(row)" :aria-label="`自动使用 ${row.account.name}`" :title="!row.account.enabled ? '账号已停用' : '自动使用重置卡'" @change="policy(row, $event)" /></template>
        <template #actions="{ row }"><div class="row-actions"><ZIconButton size="small" :title="`更新额度与卡片 ${row.account.name}`" :aria-label="`更新 ${row.account.name}`" :disabled="blocked || !canReset(row)" @click="refresh(row)"><RefreshCw :size="16" :class="{ spin: busy === row.account.account_id }" /></ZIconButton><ZIconButton size="small" :title="row.state.pending ? '继续确认原重置' : '查看并使用重置卡'" :aria-label="`重置卡 ${row.account.name}`" :disabled="blocked || (!canReset(row) && !row.state.pending)" @click="openCards(row)"><TicketCheck :size="17" /></ZIconButton></div></template>
      </ZTable>
      <ZPagination v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length" :page-sizes="[10, 20, 50, 100]" :disabled="loading && !rows.length" />
      <div v-if="settings.scan?.checkedAtMs" class="scan-time">最近巡检 {{ time(settings.scan.checkedAtMs) }}<span v-if="refreshing"> · 更新快照中</span></div>
    </div>

    <ZDialog v-model="showCards" :title="selected?.state.pending ? '确认原重置结果' : '主动重置卡'" width="36rem" :show-close="!consuming && !busy" :close-on-click-modal="!consuming && !busy" :close-on-press-escape="!consuming && !busy">
      <template v-if="selected">
        <p class="dialog-identity">{{ accountEmail(selected) }}</p>
        <div class="dialog-quota"><span>周限已用 <b>{{ week(selected)?.used_percent ?? '未知' }}%</b></span><span>刷新 {{ time(week(selected)?.reset_at_ms) }}</span></div>
        <div class="card-head"><b>{{ selected.state.cards ? `${selected.state.cards.availableCount} 张可用` : '尚未查询' }}</b><ZButton size="small" :disabled="blocked || !canReset(selected)" @click="refresh(selected)"><template #icon><RefreshCw :size="15" /></template>更新</ZButton></div>
        <div v-if="selected.state.pending" class="pending"><AlertTriangle :size="18" /><div><b>上次消费结果待确认</b><span>请求 {{ selected.state.pending.requestId }}</span><span>发起 {{ time(selected.state.pending.startedAtMs) }}</span></div></div>
        <fieldset v-else class="card-list" :disabled="blocked"><legend class="sr-only">选择重置卡</legend><ZRadio v-for="card in cardOptions" :key="card.id" :model-value="selectedCard" :value="card.id" name="card" :disabled="blocked" class="card-option" @update:model-value="selectedCard = String($event)"><span class="card-description"><b>{{ card.title || '用量重置' }}</b><span>到期 {{ time(card.expiresAt) }}</span></span></ZRadio><ZRadio v-if="countOnly" :model-value="selectedCard" value="" name="card" :disabled="blocked" class="card-option" @update:model-value="selectedCard = String($event)"><span class="card-description"><b>由上游选择一张卡</b><span>上游未返回具体卡片及到期时间</span></span></ZRadio><p v-if="!cardOptions.length && !countOnly" class="muted">{{ selected.state.cards ? '没有有效重置卡' : '请先更新卡片' }}</p></fieldset>
        <p v-if="selected.state.error" class="error" role="status">{{ selected.state.error }}</p>
        <ZCheckbox v-model="confirmed" class="consume-confirm" :disabled="blocked" :label="selected.state.pending ? '使用原请求标识确认，不发起另一张卡的消费' : '确认消费一张卡，消费无法撤回'" />
        <details v-if="selected.state.history.length" class="history"><summary><History :size="15" />最近重置记录</summary><div v-for="item in selected.state.history" :key="item.requestId"><span>{{ time(item.atMs) }} · {{ item.automatic ? '自动' : '手动' }} · {{ item.code }}</span></div></details>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <template #footer><ZButton :disabled="blocked" @click="showCards = false">取消</ZButton><ZButton type="primary" :loading="consuming" :disabled="blocked || !confirmed || (!selected?.state.pending && !selectedCard && !countOnly)" @click="consume"><template #icon><TicketCheck :size="16" /></template>{{ selected?.state.pending ? '确认原操作' : '使用所选卡' }}</ZButton></template>
    </ZDialog>
    <ExportDialog v-model="showExport" :text="exportText" />
  </main>
  </ZConfigProvider>
</template>
