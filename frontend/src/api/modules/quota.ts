import { request } from '../request'
import { parsePage, parsePolicy, parseResetCardAutomation, parseState, parseStatus, parseUpdate } from '../schemas/quota'

export const api = {
  status: () => request('GET', 'api/status').then(parseStatus),
  accounts: (page = 1) => request('GET', 'api/accounts', undefined, new URLSearchParams({ page: String(page) }).toString()).then(parsePage),
  setQuotaCredits: (accountId: string, enabled: boolean) => request('POST', 'api/auto-use-quota-credits', { accountId, enabled }).then(parsePolicy),
  setResetCards: (accountId: string, enabled: boolean) => request('POST', 'api/auto-use-reset-cards', { accountId, enabled }).then(parseResetCardAutomation),
  refresh: (accountId: string) => request('POST', 'api/refresh', { accountId }).then(parseUpdate),
  refreshCards: (accountId: string) => request('POST', 'api/refresh-cards', { accountId }).then(parseState),
  consume: (accountId: string, creditId: string | null) => request('POST', 'api/consume', { accountId, creditId }).then(parseUpdate),
  retry: (accountId: string, requestId: string) => request('POST', 'api/retry', { accountId, requestId }).then(parseUpdate),
}
