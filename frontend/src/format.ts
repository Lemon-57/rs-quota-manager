import type { Card, ResetCardAutomation, ResetCardSettings, Row } from './types'

export function time(value: string | number | null | undefined): string {
  if (value == null) return '未知'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date) : '未知'
}
export const weeks = (row: Row) => row.quota?.windows.filter(w => w.window_seconds === 604800) ?? []
export const isFree = (row: Row) => row.account.plan_type?.trim().toLowerCase() === 'free'
export const planKey = (row: Row) => row.account.plan_type?.trim().toLowerCase() || 'unknown'
export const canReset = (row: Row) => row.account.provider_id === 'openai' && row.account.authentication_kind === 'oauth' && !isFree(row)
export const week = (row: Row) => weeks(row).find(w => w.key.split(':')[0]?.toLowerCase() === 'codex') ?? weeks(row)[0]
export const isLimited = (row: Row) => (week(row)?.used_percent ?? -1) >= 100 && (week(row)?.reset_at_ms ?? 0) > Date.now()
export const creditBalance = (row: Row) => row.quota?.credits?.unlimited ? '不限' : row.quota?.credits?.balance ?? '—'
export function resetCardTiming(settings: ResetCardSettings | null | undefined): string {
  if (!settings) return '未能读取系统设置'
  if (settings.resetCreditOnLowWeeklyQuota) return `按周额度使用 · 剩余 ≤ ${settings.resetCreditMaxWeeklyRemainingPercent ?? 0}%`
  return `临期使用 · 到期前 ${settings.resetCreditLeadMinutes} 分钟`
}
export function automationResult(automation: ResetCardAutomation | null): string {
  switch (automation?.last_result) {
    case 'pending': return automation.enabled ? '上次自动重置结果待确认，将继续核对' : '上次自动重置结果待确认'
    case 'expired_unknown': return '上次重置结果未能确认，卡片已到期'
    case 'discovery_failed': return '最近查询失败，将按计划重试'
    case 'weekly_quota_above_threshold': return '剩余周额度高于上限，稍后检查'
    case 'awaiting_weekly_recovery': return '已用卡，等待周额度恢复'
    case 'weekly_quota_unavailable': return '暂时无法确认周额度，稍后检查'
    case 'nothing_to_reset': return '当前额度窗口不需要重置，稍后检查'
    case 'not_redeemed': return '上游未完成最近一次自动重置'
    default: return ''
  }
}
export const available = (card: Card, now = Date.now()) => card.status === 'available' && (!card.expiresAt || new Date(card.expiresAt).getTime() > now)
export const selectable = (row: Row) => row.state.cards?.credits.filter(c => available(c)).sort((a, b) => (a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity) - (b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity)) ?? []
export function status(row: Row): string {
  if (row.state.pending) return '结果待确认'
  if (!row.account.enabled) return '已停用'
  if (row.state.awaitingRecovery) return '等待额度回读'
  if (isLimited(row)) return '周限已满'
  if (row.state.error) return '检查异常'
  if (!week(row)) return '无周限数据'
  return '正常'
}

export function visualIndex(text: string, size: number) { return Array.from(text).reduce((sum, c) => sum + (c.codePointAt(0) || 0), 0) % size }
export function avatarTone(id: string) { return ['blue', 'green', 'orange', 'cyan'][visualIndex(id, 4)] }
export function csv(rows: Row[]): string {
  const cell = (value: unknown) => { let s = String(value ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"` }
  const data = [['账号ID', '完整名称', '邮箱', '启用', '订阅', '订阅开始', '订阅结束', '周限已用%', '周限刷新时间', '周限观测时间', '卡张数', '卡到期时间', '卡观测时间', '额度点数', '自动使用额度点数', '自动使用重置卡', '状态'],
    ...rows.map(r => [r.account.account_id, r.account.name, r.account.email, r.account.enabled, r.account.plan_type_display, r.state.subscription?.startsAt, r.state.subscription?.expiresAt, week(r)?.used_percent, time(week(r)?.reset_at_ms), time(r.quota?.observed_at_ms), r.state.cards?.availableCount, selectable(r).map(c => `${c.id}: ${time(c.expiresAt)}`).join(' | '), time(r.state.cardsObservedAtMs), creditBalance(r), r.autoUseQuotaCredits, r.resetCardAutomation?.enabled, status(r)])]
  return '\uFEFF' + data.map(r => r.map(cell).join(',')).join('\r\n')
}
