import { describe, expect, it } from 'vitest'
import { SOLANA_MAINNET, USDC } from './codes.js'
import { cleanSourceToken, defaultSourceTokens, mergeSourceTokens, searchSourceTokens } from './sources.js'

const BASE = 'eip155:8453'
const usdt = { chain: BASE, token: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', symbol: 'USDT', decimals: 6, name: 'Tether USD' }

describe('source tokens', () => {
  it('defaults: USDC, then native with the chain decimals', () => {
    expect(defaultSourceTokens(BASE).map((t) => t.symbol)).toEqual(['USDC', 'ETH'])
    expect(defaultSourceTokens(SOLANA_MAINNET)[1]).toMatchObject({ token: 'native', symbol: 'SOL', decimals: 9 })
  })

  it('merge keeps the defaults first, drops duplicates (any case), and fills missing fields', () => {
    const logo = 'https://x.test/usdc.png'
    const out = mergeSourceTokens(BASE, [usdt, { chain: BASE, token: USDC[BASE]!.toUpperCase().replace('0X', '0x'), symbol: 'USDC', decimals: 6, logoUrl: logo }])
    expect(out.map((t) => t.symbol)).toEqual(['USDC', 'ETH', 'USDT'])
    expect(out[0]).toMatchObject({ token: USDC[BASE], name: 'USD Coin', logoUrl: logo })
  })

  it('merge drops tokens of other chains and tokens that are not valid', () => {
    const out = mergeSourceTokens(BASE, [
      { ...usdt, chain: 'eip155:1' },
      { ...usdt, token: 'nope' },
      { ...usdt, symbol: '<script>' },
      { ...usdt, decimals: 1.5 },
      { ...usdt, logoUrl: 'http://x.test/a.png' },
    ])
    expect(out.map((t) => t.symbol)).toEqual(['USDC', 'ETH', 'USDT'])
    expect(out[2]!.logoUrl).toBeUndefined()
  })

  it('cleanSourceToken keeps Solana mints as they are', () => {
    expect(cleanSourceToken({ chain: SOLANA_MAINNET, token: USDC[SOLANA_MAINNET], symbol: 'USDC', decimals: 6 })).toMatchObject({ token: USDC[SOLANA_MAINNET] })
  })

  it('search: symbol prefix first, then name or symbol matches, then an exact address', () => {
    const list = mergeSourceTokens(BASE, [usdt, { chain: BASE, token: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' }])
    expect(searchSourceTokens(list, 'us').map((t) => t.symbol)).toEqual(['USDC', 'USDT'])
    expect(searchSourceTokens(list, 'stable').map((t) => t.symbol)).toEqual(['DAI'])
    expect(searchSourceTokens(list, usdt.token.toUpperCase()).map((t) => t.symbol)).toEqual(['USDT'])
    expect(searchSourceTokens(list, ' ')).toHaveLength(4)
  })
})
