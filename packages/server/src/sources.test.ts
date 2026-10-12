// GET /sessions/:id/sources: the source picker list.
import { describe, expect, it } from 'vitest'
import { createAdapter } from '@openrampkit/adapter'
import { USDC } from '@openrampkit/core'
import type { LegSpec, SourceToken } from '@openrampkit/core'
import { createOpenRamp } from './index.js'

const BASE_URL = 'https://app.test/api/openramp'
const quiet = { debug() {}, info() {}, warn() {}, error() {} }
const DEST = { type: 'crypto' as const, chain: 'eip155:8453', token: USDC['eip155:8453']!, address: '0x000000000000000000000000000000000000beef' }
const USDT: SourceToken = { chain: 'eip155:42161', token: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', decimals: 6, logoUrl: 'https://x.test/usdt.png' }

function make(sourceTokens?: () => Promise<SourceToken[]>) {
  const calls: Array<{ chains: string[]; method: string }> = []
  const spec: LegSpec = {
    id: 'transfer', kind: 'bridge_swap', methods: ['transfer'],
    from: { asset: { kind: 'crypto', chains: '*' }, location: ['user_wallet'] },
    to: { asset: { kind: 'crypto', chains: '*' }, location: ['address'] },
    regions: { allow: ['*'], deny: [] }, eta: { min: 1, max: 2 }, surfaces: ['DEPOSIT_ADDRESS'],
  }
  const adapter = createAdapter({
    id: 'src', name: 'Src', legs: [spec],
    async quote() {
      throw new Error('not used')
    },
    async start() {
      throw new Error('not used')
    },
    ...(sourceTokens
      ? {
          async sourceTokens(input: { chains: string[]; method: string }) {
            calls.push(input)
            return sourceTokens()
          },
        }
      : {}),
  })
  const ramp = createOpenRamp({ secret: 's'.repeat(40), baseUrl: BASE_URL, adapters: [adapter], logger: quiet })
  const get = async (direction: 'deposit' | 'withdraw' = 'deposit', method = 'transfer') => {
    const s = direction === 'deposit'
      ? await ramp.sessions.create({ userId: 'u', country: 'SG', destination: DEST })
      : await ramp.sessions.create({ userId: 'u', direction: 'withdraw', source: { chain: 'eip155:8453', token: USDC['eip155:8453']!, custody: 'user_wallet' } } as never)
    const res = await ramp.handle(new Request(`${BASE_URL}/sessions/${s.id}/sources?method=${method}`, { headers: { authorization: `Bearer ${s.clientSecret}` } }))
    return { status: res.status, body: (await res.json()) as { chains: Array<{ chain: string; name: string; tokens: SourceToken[] }> } }
  }
  return { get, calls }
}

describe('GET /sessions/:id/sources', () => {
  it('adds the adapter tokens after the defaults, and caches the list', async () => {
    const { get, calls } = make(async () => [USDT])
    const r = await get()
    expect(r.status).toBe(200)
    const arb = r.body.chains.find((c) => c.chain === 'eip155:42161')!
    expect(arb.name).toBe('Arbitrum')
    expect(arb.tokens.map((t) => t.symbol)).toEqual(['USDC', 'ETH', 'USDT'])
    expect(arb.tokens[2]).toMatchObject({ logoUrl: 'https://x.test/usdt.png' })
    expect(calls[0]).toMatchObject({ method: 'transfer' })
    await get()
    expect(calls).toHaveLength(1)
  })

  it('a failing adapter gives the defaults, and the answer is not cached', async () => {
    let fail = true
    const { get, calls } = make(async () => {
      if (fail) throw new Error('down')
      return [USDT]
    })
    expect((await get()).body.chains.find((c) => c.chain === 'eip155:42161')!.tokens.map((t) => t.symbol)).toEqual(['USDC', 'ETH'])
    fail = false
    expect((await get()).body.chains.find((c) => c.chain === 'eip155:42161')!.tokens.map((t) => t.symbol)).toEqual(['USDC', 'ETH', 'USDT'])
    expect(calls).toHaveLength(2)
  })

  it('with no adapter list: the defaults; an adapter without the method is not asked', async () => {
    const none = make()
    expect((await none.get()).body.chains[0]!.tokens.length).toBeGreaterThan(0)
    const other = make(async () => [USDT])
    await other.get('deposit', 'wallet')
    expect(other.calls).toHaveLength(0)
  })

  it('refuses a bad method and a withdrawal', async () => {
    const { get } = make(async () => [USDT])
    expect((await get('deposit', 'card')).status).toBe(400)
    expect((await get('withdraw')).status).toBe(409)
  })
})
