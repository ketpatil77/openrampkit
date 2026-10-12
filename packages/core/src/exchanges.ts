// Exchanges in the "From an exchange" picker. An exchange either has a connect method (the user pays from
// their exchange balance on the exchange's own page, for example Binance Pay or the Coinbase account), or
// the user withdraws from the exchange to a deposit address (`exchange_transfer`). The plan decides which
// methods exist for this user (adapters, regions), so the picker follows the plan and never adds a method.

import type { MethodOption } from './planner.js'

export type ExchangeInfo = {
  id: string
  name: string
  /**
   * Methods that pay from the user's account at this exchange, best first. `provider` (the adapter name)
   * is set when the method id alone does not name the exchange, for example the generic `exchange`.
   */
  connect: Array<{ method: string; provider?: string }>
}

export const EXCHANGES: ExchangeInfo[] = [
  { id: 'binance', name: 'Binance', connect: [{ method: 'exchange', provider: 'Binance' }, { method: 'binance_pay' }] },
  { id: 'coinbase', name: 'Coinbase', connect: [{ method: 'coinbase_account' }] },
  { id: 'okx', name: 'OKX', connect: [] },
  { id: 'bybit', name: 'Bybit', connect: [] },
  { id: 'kraken', name: 'Kraken', connect: [] },
]

/** Id of the "Other exchange" row */
export const OTHER_EXCHANGE = 'other'

export type ExchangeOption = {
  id: string
  name: string
  /** `connect`: pay on the exchange's page. `deposit`: withdraw from the exchange to a deposit address. */
  mode: 'connect' | 'deposit'
  /** The method to start */
  method: string
  /** For `connect`: the deposit method to offer when the connect payment fails */
  fallback?: string
}

/**
 * The picker rows for a plan: each known exchange with its first available connect method, else with
 * `exchange_transfer`, then "Other exchange" (deposit). Empty when the plan has no connect method: then
 * the plain "From an exchange" method row is enough.
 */
export function exchangeOptions(methods: MethodOption[]): ExchangeOption[] {
  const ok = methods.filter((m) => m.group !== 'unavailable')
  const has = (method: string, provider?: string) => ok.some((m) => m.method === method && (!provider || m.providers.includes(provider)))
  const deposit = has('exchange_transfer') ? 'exchange_transfer' : undefined
  const rows: ExchangeOption[] = []
  for (const x of EXCHANGES) {
    const c = x.connect.find((c) => has(c.method, c.provider))
    if (c) rows.push({ id: x.id, name: x.name, mode: 'connect', method: c.method, ...(deposit ? { fallback: deposit } : {}) })
    else if (deposit) rows.push({ id: x.id, name: x.name, mode: 'deposit', method: deposit })
  }
  if (!rows.some((r) => r.mode === 'connect')) return []
  if (deposit) rows.push({ id: OTHER_EXCHANGE, name: 'Other exchange', mode: 'deposit', method: deposit })
  return rows
}

/** Methods that the picker row stands for: every method of kind `exchange`, and the connect methods of the list */
export function isExchangeMethod(m: Pick<MethodOption, 'method' | 'kind'>): boolean {
  return m.kind === 'exchange' || EXCHANGES.some((x) => x.connect.some((c) => c.method === m.method))
}
