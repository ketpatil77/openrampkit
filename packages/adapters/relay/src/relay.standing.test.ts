// Standing deposit addresses: one Relay open deposit address per user and route, the deposits Relay
// saw at it, and the status of one deposit (`sreq:` ref).
import { describe, expect, it } from 'vitest'
import { USDC } from '@openrampkit/core'
import type { Destination, PathwayLeg } from '@openrampkit/core'
import type { ScopedKV } from '@openrampkit/adapter'
import { fakeFetch, makeCtx, memoryKV } from '@openrampkit/adapter/testing'
import type { FakeCall } from '@openrampkit/adapter/testing'
import { relay } from './index.js'

const DEST = { type: 'crypto' as const, chain: 'eip155:8453', token: USDC['eip155:8453']!, address: '0x000000000000000000000000000000000000beef' }
const ORIGIN = { chain: 'eip155:42161', token: USDC['eip155:42161']! }
const ZERO = '0x0000000000000000000000000000000000000000'
const ADDR = '0x5555555555555555555555555555555555555555'
const usdc = (chainId: number, address: string) => ({ chainId, address, symbol: 'USDC', name: 'USD Coin', decimals: 6 })
const transferLeg: PathwayLeg = {
  adapterId: 'relay',
  legId: 'transfer',
  from: { asset: { kind: 'crypto', chain: ORIGIN.chain, token: ORIGIN.token }, location: { kind: 'user_wallet' } },
  to: { asset: { kind: 'crypto', chain: DEST.chain, token: DEST.token }, location: { kind: 'address', address: DEST.address } },
  method: 'transfer',
}

/** A quote route that gives a new deposit address per quote */
function quotes() {
  let n = 0
  return {
    method: 'POST',
    match: '/quote/v2',
    reply: (c: FakeCall) => {
      const amount = String((c.body as { amount: string }).amount)
      const address = `0x${String(++n).padStart(40, '7')}`
      return {
        requestId: `0xq${n}`,
        steps: [{ id: 'deposit', kind: 'transaction', depositAddress: address, items: [] }],
        details: { currencyIn: { currency: usdc(42161, ORIGIN.token), amount }, currencyOut: { currency: usdc(8453, DEST.token), amount } },
      }
    },
  }
}

/** A memory KV with an atomic `putIfAbsent` (like the built-in server stores) */
function atomicKV(): ScopedKV & { data: Map<string, unknown> } {
  const kv = memoryKV()
  return {
    ...kv,
    data: kv.data,
    // No await between the check and the write, so this is atomic (expiry is not checked: tests only).
    async putIfAbsent(key, value, ttl) {
      if (kv.data.has(key)) return false
      await kv.put(key, value, ttl)
      return true
    },
  }
}

const request = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'success',
  createdAt: new Date().toISOString(),
  depositAddress: { address: ADDR, depositTxHash: `0x${id.padStart(64, '0')}` },
  data: {
    inTxs: [{ hash: `0x${id.padStart(64, '0')}` }],
    outTxs: [{ hash: `0xout${id}` }],
    metadata: { currencyIn: { currency: usdc(42161, ORIGIN.token), amount: '10000000' }, currencyOut: { currency: usdc(8453, DEST.token), amount: '9960000' } },
  },
  ...extra,
})

describe('relay: standingAddress', () => {
  it('quotes an open deposit address to the destination once, and returns it for the same user and route', async () => {
    const { fetch, calls } = fakeFetch([quotes()])
    const shared = atomicKV()
    const a = relay({ apiKey: 'k' })
    const ctx = { fetch, shared, log: makeCtx({ fetch }).log }
    const first = await a.standingAddress!({ userId: 'u1', origin: ORIGIN, destination: DEST }, ctx)
    expect(first).toMatchObject({ address: `0x${'1'.padStart(40, '7')}`, ref: `0x${'1'.padStart(40, '7')}`, data: { refundTo: ZERO } })
    const quote = calls.find((c) => c.url.includes('/quote/v2'))!
    expect(quote.body).toMatchObject({ recipient: DEST.address, useDepositAddress: true, refundTo: ZERO, tradeType: 'EXACT_INPUT', originChainId: 42161, destinationChainId: 8453 })
    const again = await a.standingAddress!({ userId: 'u1', origin: ORIGIN, destination: DEST }, ctx)
    expect(again.address).toBe(first.address)
    expect(calls.filter((c) => c.url.includes('/quote/v2'))).toHaveLength(1)
    // Another user gets its own address.
    const other = await a.standingAddress!({ userId: 'u2', origin: ORIGIN, destination: DEST }, ctx)
    expect(other.address).not.toBe(first.address)
    expect([...shared.data.keys()].filter((k) => k.startsWith('sa:'))).toHaveLength(2)
  })

  it('two calls at the same time return one address', async () => {
    const { fetch } = fakeFetch([quotes()])
    const shared = atomicKV()
    const a = relay({ apiKey: 'k' })
    const ctx = { fetch, shared, log: makeCtx({ fetch }).log }
    const [x, y] = await Promise.all([a.standingAddress!({ userId: 'u1', origin: ORIGIN, destination: DEST }, ctx), a.standingAddress!({ userId: 'u1', origin: ORIGIN, destination: DEST }, ctx)])
    expect(x.address).toBe(y.address)
  })

  it("refundTo: 'recipient' refunds to the destination address, with its own address", async () => {
    const { fetch, calls } = fakeFetch([quotes()])
    const shared = atomicKV()
    const ctx = { fetch, shared, log: makeCtx({ fetch }).log }
    const sender = await relay({ apiKey: 'k' }).standingAddress!({ userId: 'u1', origin: ORIGIN, destination: DEST }, ctx)
    const toUser = await relay({ apiKey: 'k', refundTo: 'recipient' }).standingAddress!({ userId: 'u1', origin: ORIGIN, destination: DEST }, ctx)
    expect(toUser.address).not.toBe(sender.address)
    expect(toUser.data).toEqual({ refundTo: DEST.address })
    expect(calls.filter((c) => c.url.includes('/quote/v2')).at(-1)!.body).toMatchObject({ refundTo: DEST.address })
  })

  it('refuses the same token on the same chain', async () => {
    const { fetch } = fakeFetch([quotes()])
    const a = relay({ apiKey: 'k' })
    const dest: Destination = { ...DEST, chain: ORIGIN.chain, token: ORIGIN.token }
    await expect(a.standingAddress!({ userId: 'u1', origin: ORIGIN, destination: dest as typeof DEST }, { fetch, shared: memoryKV(), log: makeCtx({ fetch }).log })).rejects.toMatchObject({ status: 400 })
  })
})

describe('relay: standingDeposits', () => {
  it('lists the requests at the address since a time, keyed by the deposit transaction', async () => {
    // Older than the 24 h look-back before `since`: left out
    const old = request('1', { createdAt: new Date(Date.now() - 30 * 60 * 60_000).toISOString() })
    // Before `since` but inside the look-back (Relay indexed it late): kept
    const late = request('4', { createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() })
    const waiting = { id: 'w', status: 'waiting', createdAt: new Date().toISOString(), depositAddress: { address: ADDR } }
    const noHash = request('2', { depositAddress: { address: ADDR }, data: { metadata: {} }, status: 'pending' })
    const { fetch, calls } = fakeFetch([{ method: 'GET', match: '/requests/v3', reply: () => ({ requests: [request('3'), noHash, waiting, late, old] }) }])
    const a = relay({ apiKey: 'k' })
    const out = await a.standingDeposits!({ ref: ADDR, address: ADDR, origin: ORIGIN, since: Date.now() - 60 * 60_000 }, { fetch, shared: memoryKV(), log: makeCtx({ fetch }).log })
    expect(calls[0]!.url).toContain(`depositAddress=${ADDR}`)
    expect(calls[0]!.url).toContain('limit=20')
    const key = `tx:0x${'3'.padStart(64, '0')}`
    expect(out).toEqual([
      { id: key, legRef: `sreq:3|${ADDR}|${key}`, at: expect.any(Number), input: { value: '10', asset: { kind: 'crypto', chain: ORIGIN.chain, token: ORIGIN.token } } },
      // A request with no deposit transaction yet waits for the next poll: every id is a deposit transaction.
      { id: `tx:0x${'4'.padStart(64, '0')}`, legRef: `sreq:4|${ADDR}|tx:0x${'4'.padStart(64, '0')}`, at: expect.any(Number), input: expect.anything() },
    ])
  })

  it('reads more pages while the oldest request is inside the window, and stops at the look-back', async () => {
    const recent = (id: string) => request(id)
    const ancient = request('9', { createdAt: new Date(Date.now() - 30 * 60 * 60_000).toISOString() })
    const { fetch, calls } = fakeFetch([
      {
        method: 'GET',
        match: '/requests/v3',
        reply: (c) => (new URL(c.url).searchParams.get('continuation') === 'p2' ? { requests: [recent('6'), ancient], continuation: 'p3' } : { requests: [recent('5')], continuation: 'p2' }),
      },
    ])
    const out = await relay({ apiKey: 'k' }).standingDeposits!({ ref: ADDR, address: ADDR, origin: ORIGIN, since: Date.now() - 60_000 }, { fetch, shared: memoryKV(), log: makeCtx({ fetch }).log })
    expect(out.map((d) => d.legRef.split('|')[0])).toEqual(['sreq:5', 'sreq:6'])
    // Page 2 reached past the look-back, so there is no page 3
    expect(calls).toHaveLength(2)
  })
})

describe('relay: a standing deposit that Relay re-quotes', () => {
  it('the status follows the newest request for the same deposit transaction', async () => {
    const tx = `0x${'7'.padStart(64, '0')}`
    const same = (id: string, status: string, ageMs: number) =>
      request(id, { status, createdAt: new Date(Date.now() - ageMs).toISOString(), depositAddress: { address: ADDR, depositTxHash: tx }, data: { inTxs: [{ hash: tx }], outTxs: [{ hash: `0xout${id}` }], metadata: {} } })
    const { fetch, calls } = fakeFetch([{ method: 'GET', match: '/requests/v3', reply: () => ({ requests: [same('new', 'success', 1_000), same('old', 'failure', 60_000)] }) }])
    const ctx = makeCtx({ fetch, destination: DEST })
    const a = relay({ apiKey: 'k' })
    const [dep] = await a.standingDeposits!({ ref: ADDR, address: ADDR, origin: ORIGIN, since: 0 }, { fetch, shared: memoryKV(), log: ctx.log })
    // One deposit, even with two requests
    expect(dep!.id).toBe(`tx:${tx}`)
    const oldRef = `sreq:old|${ADDR}|tx:${tx}`
    expect(await a.status!({ leg: transferLeg, ref: oldRef }, ctx)).toMatchObject({ status: 'succeeded', transactions: expect.arrayContaining([{ role: 'destination', hash: '0xoutnew' }]) })
    expect(calls.at(-1)!.url).toContain(`depositAddress=${ADDR}`)
  })
})

describe('relay: status of a standing deposit (sreq: ref)', () => {
  function setup(requests: () => unknown[]) {
    const { fetch, calls } = fakeFetch([{ method: 'GET', match: '/requests/v3', reply: () => ({ requests: requests() }) }])
    const ctx = makeCtx({ fetch, destination: DEST })
    const a = relay({ apiKey: 'k' })
    return { calls, status: () => a.status!({ leg: transferLeg, ref: 'sreq:abc' }, ctx) }
  }

  it('maps the Relay request: processing, then succeeded with the output and the transactions', async () => {
    let r: Record<string, unknown> = request('abc', { status: 'pending' })
    const t = setup(() => [r])
    expect(await t.status()).toMatchObject({ status: 'processing', detail: { code: 'bridging' }, ref: 'sreq:abc', providerRef: 'abc' })
    expect(t.calls[0]!.url).toContain('id=abc')
    r = request('abc')
    expect(await t.status()).toMatchObject({
      status: 'succeeded',
      ref: 'sreq:abc',
      output: { value: '9.96', asset: { kind: 'crypto', chain: DEST.chain, token: DEST.token } },
      transactions: [
        { role: 'source', hash: `0x${'abc'.padStart(64, '0')}` },
        { role: 'destination', hash: '0xoutabc' },
      ],
    })
  })

  it('a failed or refunded request ends the leg; a request Relay does not list yet is processing', async () => {
    let list: unknown[] = []
    const t = setup(() => list)
    expect(await t.status()).toEqual({ status: 'processing', detail: { code: 'processing' }, ref: 'sreq:abc', providerRef: 'abc' })
    list = [request('abc', { status: 'failure' })]
    expect(await t.status()).toMatchObject({ status: 'failed', error: { code: 'DELIVERY_FAILED' } })
    list = [request('abc', { status: 'refund' })]
    expect(await t.status()).toMatchObject({ status: 'refunded', transactions: [{ role: 'source' }, { role: 'refund', hash: '0xoutabc' }] })
  })
})
