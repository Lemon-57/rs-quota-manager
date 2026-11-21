<script setup lang="ts">
import { AlertTriangle, Clock3, History, RefreshCw, TicketCheck } from '@lucide/vue'
import { ZButton } from '@codex-proxy/ui/button'
import { ZDialog } from '@codex-proxy/ui/dialog'
import { ZEmpty } from '@codex-proxy/ui/empty'
import { ZIconButton } from '@codex-proxy/ui/icon-button'
import { ZSwitch } from '@codex-proxy/ui/switch'
import { ZTag } from '@codex-proxy/ui/tag'
import { computed } from 'vue'
import { automationResult, canReset, creditBalance, resetCardTiming, time } from './format'
import type { Card, Pending, ResetCardSettings, Row } from './types'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  row: Row
  cards: Card[]
  countOnly: boolean
  confirmation: { card: Card | null; pending: Pending | null } | null
  rules: ResetCardSettings | null
  blocked: boolean
  loading: boolean
  consuming: boolean
  cardsError: string
  error: string
}>()
const emit = defineEmits<{
  refresh: []
  request: [card: Card | null]
  cancel: []
  consume: []
  quotaPolicy: [enabled: boolean]
  resetPolicy: [enabled: boolean]
}>()

const title = computed(() => props.confirmation
  ? props.confirmation.pending ? '确认上次重置' : '确认重置额度'
  : '额度重置')
const automation = computed(() => props.row.resetCardAutomation)
const resultText = computed(() => automationResult(automation.value))
const count = computed(() => props.row.state.cards?.availableCount)
const remainingWindows = computed(() => (props.row.quota?.windows ?? [])
  .filter(window => !window.limit_id || window.limit_id === 'codex')
  .slice().sort((a, b) => (a.window_seconds ?? Number.MAX_SAFE_INTEGER) - (b.window_seconds ?? Number.MAX_SAFE_INTEGER))
  .map(window => ({
    ...window,
    remaining: window.used_percent === null ? null : Math.round((100 - Math.min(100, Math.max(0, window.used_percent))) * 10) / 10,
  })))
const cardTitle = (card: Card) => card.title?.trim() || '用量重置'
const expiry = (card: Card) => card.expiresAt ? `将于 ${time(card.expiresAt)} 到期` : card.expiresAtDisplay || '有效期由上游决定'
</script>

<template>
  <ZDialog v-model="open" :title="title" :description="row.account.email || row.account.name" :type="confirmation ? 'warning' : 'default'" :width="confirmation ? '28rem' : '36rem'"
    :show-close="!consuming" :close-on-click-modal="!consuming" :close-on-press-escape="!consuming">
    <div v-if="confirmation" class="grid gap-3">
      <section class="rounded-cp bg-cp-fill-quaternary px-4 py-3.5">
        <p class="m-0 text-cp-xs font-heavy text-cp-text-quaternary">{{ confirmation.pending ? '上次操作' : '本次使用' }}</p>
        <p class="mt-1.5 mb-0 text-cp-lg leading-snug font-heavy text-cp-text">
          {{ confirmation.pending ? '确认原重置结果' : confirmation.card ? cardTitle(confirmation.card) : '使用一次重置（由上游选择）' }}
        </p>
        <p v-if="confirmation.pending" class="mt-1 mb-0 text-cp-xs text-cp-text-secondary">发起于 {{ time(confirmation.pending.startedAtMs) }} · 将继续确认同一笔操作</p>
        <p v-else-if="confirmation.card" class="mt-1 mb-0 text-cp-xs text-cp-text-secondary">{{ expiry(confirmation.card) }}</p>
      </section>
    </div>

    <div v-else class="grid gap-4">
      <section class="grid gap-4 rounded-cp bg-cp-fill-quaternary p-4" aria-label="当前额度">
        <div v-for="window in remainingWindows" :key="window.key" class="grid gap-2 sm:grid-cols-2 sm:items-center sm:gap-5">
          <div class="min-w-0">
            <h3 class="m-0 text-cp-sm font-heavy text-cp-text">{{ window.label }}</h3>
            <p class="mt-1 mb-0 text-cp-xs text-cp-text-secondary">刷新 {{ time(window.reset_at_ms) }}</p>
          </div>
          <div class="flex min-w-0 items-center gap-3">
            <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-cp-border-secondary" role="progressbar"
              :aria-label="`${window.label}剩余额度`" :aria-valuenow="window.remaining ?? undefined">
              <div class="h-full rounded-full bg-cp-success" :style="{ width: `${window.remaining ?? 0}%` }" />
            </div>
            <span class="shrink-0 text-cp-xs font-heavy tabular-nums" :class="window.remaining === 0 ? 'text-cp-error-text' : 'text-cp-text-secondary'">
              {{ window.remaining === null ? '待观测' : `剩余 ${window.remaining}%` }}
            </span>
          </div>
        </div>
        <p v-if="!remainingWindows.length" class="m-0 text-cp-sm text-cp-text-secondary">暂无额度数据</p>
      </section>

      <section v-if="row.quota?.credits || row.autoUseQuotaCredits !== null" class="grid gap-3 rounded-cp bg-cp-fill-quaternary px-4 py-3.5" aria-label="额度点数">
        <div class="flex items-baseline justify-between gap-4 text-cp-sm font-heavy">
          <span>额度点数</span><span class="tabular-nums">{{ creditBalance(row) }}</span>
        </div>
        <div v-if="row.autoUseQuotaCredits !== null" class="flex items-center justify-between gap-4">
          <span class="text-cp-sm font-heavy">自动使用额度点数</span>
          <ZSwitch :model-value="row.autoUseQuotaCredits" :disabled="blocked" aria-label="自动使用额度点数" @update:model-value="emit('quotaPolicy', $event)" />
        </div>
      </section>

      <section v-if="automation" class="grid gap-2 rounded-cp bg-cp-fill-quaternary px-4 py-3" aria-label="自动使用重置卡">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="m-0 text-cp-sm font-heavy text-cp-text">自动使用重置卡</h3>
          <div class="flex flex-wrap items-center gap-3">
            <span class="flex items-center gap-1.5 text-cp-xs text-cp-text-secondary" title="系统设置 → 主动重置卡"><Clock3 :size="14" />{{ resetCardTiming(rules) }}</span>
            <ZSwitch :model-value="automation.enabled" :disabled="blocked" aria-label="自动使用重置卡" @update:model-value="emit('resetPolicy', $event)" />
          </div>
        </div>
        <p v-if="automation.enabled && automation.next_consume_at" class="m-0 text-cp-xs text-cp-text-secondary">临期用卡时间 {{ time(automation.next_consume_at) }}</p>
        <p v-if="resultText" class="m-0 text-cp-xs text-cp-warning-text" role="status">{{ resultText }}</p>
      </section>

      <section v-if="row.state.pending" class="flex items-start gap-3 rounded-cp bg-cp-warning-container px-4 py-3.5" role="status">
        <AlertTriangle :size="16" class="mt-0.5 shrink-0 text-cp-warning-on-container" />
        <div class="min-w-0 flex-1">
          <p class="m-0 text-cp-sm font-heavy text-cp-warning-on-container">上次操作结果待确认</p>
          <p class="mt-1 mb-0 text-cp-xs text-cp-text-secondary">请继续确认上次重置结果</p>
        </div>
        <ZButton size="small" type="primary" variant="plain" :disabled="blocked" @click="emit('request', null)">继续确认</ZButton>
      </section>

      <section class="grid gap-3" aria-label="可用重置卡">
        <div class="flex items-center gap-2">
          <h3 class="m-0 min-w-0 flex-1 text-cp-sm font-heavy text-cp-text">可用重置卡</h3>
          <ZTag size="small" :type="count ? 'success' : 'default'" role="status">{{ count === undefined ? (loading ? '查询中' : '待查询') : `可用 ${count} 次` }}</ZTag>
          <ZIconButton size="small" title="刷新主动重置卡" aria-label="刷新主动重置卡" :loading="loading"
            :disabled="blocked || !canReset(row)" @click="emit('refresh')"><RefreshCw :size="14" /></ZIconButton>
        </div>

        <p v-if="cardsError" class="m-0 text-cp-xs text-cp-error-text" role="alert">{{ cardsError }}</p>
        <div v-else :aria-busy="loading || consuming">
          <p v-if="loading && count === undefined" class="m-0 p-4 text-cp-xs text-cp-text-secondary" role="status">正在查询可用重置次数</p>
          <ul v-else-if="cards.length" class="m-0 grid list-none gap-2 p-0">
            <li v-for="card in cards" :key="card.id" class="flex items-center gap-4 rounded-cp bg-cp-fill-quaternary px-4 py-3.5">
              <div class="min-w-0 flex-1">
                <p class="m-0 text-cp-sm leading-normal font-heavy wrap-anywhere text-cp-text">{{ cardTitle(card) }}</p>
                <p class="mt-1 mb-0 text-cp-xs text-cp-text-secondary">{{ expiry(card) }}</p>
              </div>
              <ZButton size="small" type="primary" :disabled="blocked || !!row.state.pending || !count"
                :aria-label="`使用重置 ${cardTitle(card)}，${expiry(card)}`" @click="emit('request', card)">使用重置</ZButton>
            </li>
          </ul>
          <ZEmpty v-else-if="!countOnly" :icon="TicketCheck" size="small" surface="none" title="暂无可用重置卡" />
        </div>
      </section>

      <details v-if="row.state.history.length" class="history">
        <summary><History :size="15" />最近重置记录</summary>
        <div v-for="item in row.state.history" :key="item.requestId">{{ time(item.atMs) }} · {{ item.automatic ? '自动' : '手动' }} · {{ item.code }}</div>
      </details>
    </div>

    <p v-if="error" class="text-cp-xs text-cp-error-text" role="alert">{{ error }}</p>
    <template v-if="confirmation || (countOnly && !cardsError)" #footer>
      <template v-if="confirmation">
        <ZButton :disabled="consuming" @click="emit('cancel')">返回</ZButton>
        <ZButton type="primary" :loading="consuming" :disabled="blocked" @click="emit('consume')">{{ confirmation.pending ? '再次确认' : '确认重置' }}</ZButton>
      </template>
      <ZButton v-else size="small" type="primary" :disabled="blocked || !!row.state.pending" @click="emit('request', null)">使用一次重置（由上游选择）</ZButton>
    </template>
  </ZDialog>
</template>
