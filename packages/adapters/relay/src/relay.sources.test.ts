// Source tokens for the deposit picker, from Relay's currency list.
import { describe, expect, it } from 'vitest'
import { SOLANA_MAINNET, USDC } from '@openrampkit/core'
import { fakeFetch, memoryKV, recordingLog, silentLog } from '@openrampkit/adapter/testing'
import { relay } from './index.js'

const base = (extra: Record<string, unknown> = {}) => ({ chainId: 8453, address: USDC['eip155:8453']!, symbol: 'USDC', name: 'USD Coin', decimals: 6, metadata: { logoURI: 'https://assets.relay.link/usdc.png', verified: true }, ...extra })

describe('relay: sourceTokens', () => {
  it('maps Relay currencies, asks for deposit-address tokens, and caches each chain', async () => {
    const { fetch, calls } = fakeFetch([
      {
        method: 'POST',
        match: '/currencies/v2',
        reply: (c) =>
          (c.body as { chainIds: number[] }).chainIds[0] === 8453
            ? [
                base({ address: USDC['eip155:8453']!.toUpperCase().replace('0X', '0x') }),
                { chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', name: 'Ether', decimals: 18, metadata: { isNative: true, logoURI: 'javascript:alert(1)' } },
                { chainId: 8453, address: 'not-an-address', symbol: 'BAD', decimals: 18 },
                { chainId: 8453, address: '0x1111111111111111111111111111111111111111', symbol: 'X'.repeat(40), decimals: 18 },
              ]
            : [{ chainId: 792703809, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 }],
      },
    ])
    const shared = memoryKV()
    const a = relay()
    const ctx = { fetch, shared, log: silentLog }
    const out = await a.sourceTokens!({ chains: ['eip155:8453', SOLANA_MAINNET, 'eip155:999999999999'], method: 'transfer' }, ctx)
    expect(out).toEqual([
      { chain: 'eip155:8453', token: USDC['eip155:8453'], symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: 'https://assets.relay.link/usdc.png' },
      // a logo that is not https is dropped
      { chain: 'eip155:8453', token: 'native', symbol: 'ETH', name: 'Ether', decimals: 18 },
      { chain: SOLANA_MAINNET, token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
    ])
    expect(calls[0]!.body).toMatchObject({ chainIds: [8453], defaultList: true, verified: true, depositAddressOnly: true })
    const n = calls.length
    await a.sourceTokens!({ chains: ['eip155:8453'], method: 'transfer' }, ctx)
    expect(calls.length).toBe(n)
    // the wallet method has its own list, without depositAddressOnly
    await a.sourceTokens!({ chains: ['eip155:8453'], method: 'wallet' }, ctx)
    expect(calls.at(-1)!.body).not.toHaveProperty('depositAddressOnly')
  })

  it('a chain that fails is left out; the others still come back', async () => {
    const { fetch } = fakeFetch([
      { method: 'POST', match: '/currencies/v2', reply: (c) => ((c.body as { chainIds: number[] }).chainIds[0] === 8453 ? [base()] : new Response('{"message":"down"}', { status: 500 })) },
    ])
    const log = recordingLog()
    const out = await relay().sourceTokens!({ chains: ['eip155:8453', 'eip155:42161'], method: 'transfer' }, { fetch, shared: memoryKV(), log })
    expect(out.map((t) => t.chain)).toEqual(['eip155:8453'])
    expect(log.warnings.some((w) => /currency list/.test(w))).toBe(true)
  })
})
