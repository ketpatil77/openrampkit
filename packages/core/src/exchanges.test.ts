import { describe, expect, it } from 'vitest'
import { exchangeOptions, isExchangeMethod } from './exchanges.js'
import type { MethodOption } from './planner.js'

const opt = (method: string, extra: Partial<MethodOption> = {}): MethodOption => ({ method, name: method, kind: 'exchange', group: 'more', providers: [], pathwayIds: [], eta: { min: 1, max: 2 }, ...extra })

describe('exchange picker rows', () => {
  it('none without a connect method: the plain "From an exchange" row is enough', () => {
    expect(exchangeOptions([opt('exchange_transfer'), opt('card', { kind: 'card' })])).toEqual([])
  })

  it('connect rows where a method exists, deposit rows for the rest, then Other', () => {
    const rows = exchangeOptions([opt('coinbase_account'), opt('exchange_transfer')])
    expect(rows.map((r) => [r.id, r.mode, r.method])).toEqual([
      ['binance', 'deposit', 'exchange_transfer'],
      ['coinbase', 'connect', 'coinbase_account'],
      ['okx', 'deposit', 'exchange_transfer'],
      ['bybit', 'deposit', 'exchange_transfer'],
      ['kraken', 'deposit', 'exchange_transfer'],
      ['other', 'deposit', 'exchange_transfer'],
    ])
    expect(rows[1]!.fallback).toBe('exchange_transfer')
  })

  it('the generic `exchange` method counts for Binance only when the Binance adapter offers it', () => {
    expect(exchangeOptions([opt('exchange', { providers: ['Binance'] })]).map((r) => [r.id, r.method])).toEqual([['binance', 'exchange']])
    expect(exchangeOptions([opt('exchange', { providers: ['Other'] })])).toEqual([])
    // Binance Pay through Meld is the second choice; without exchange_transfer there is no fallback and no Other row
    const rows = exchangeOptions([opt('binance_pay', { kind: 'ewallet' })])
    expect(rows).toEqual([{ id: 'binance', name: 'Binance', mode: 'connect', method: 'binance_pay' }])
  })

  it('unavailable methods do not count', () => {
    expect(exchangeOptions([opt('coinbase_account', { group: 'unavailable' }), opt('exchange_transfer')])).toEqual([])
  })

  it('isExchangeMethod: kind exchange, and the connect methods of the list', () => {
    expect(isExchangeMethod({ method: 'binance_pay', kind: 'ewallet' })).toBe(true)
    expect(isExchangeMethod({ method: 'exchange_transfer', kind: 'exchange' })).toBe(true)
    expect(isExchangeMethod({ method: 'gcash', kind: 'ewallet' })).toBe(false)
  })
})
