// Tokens the user can pay with on a deposit (the source picker of `transfer`, `exchange_transfer` and
// `wallet`). The server builds the list from adapters that know it (for example Relay's currency list)
// and adds the default tokens below. The list is for the picker only: the quote decides what is valid.

import { CHAINS, USDC, nativeDecimals } from './codes.js'
import { isWebUrl } from './url.js'

export type SourceToken = {
  /** CAIP-2 chain */
  chain: string
  /** Token address (lowercase for EVM), or `native` */
  token: string
  symbol: string
  decimals: number
  name?: string
  /** https URL of the token logo. A UI must show a fallback when the image does not load. */
  logoUrl?: string
}

export type SourceChain = { chain: string; name: string; tokens: SourceToken[] }

/** The most tokens kept for one chain */
export const MAX_SOURCE_TOKENS = 50

/** Chains of the default source list: every chain with known USDC */
export function defaultSourceChains(): string[] {
  return Object.keys(USDC)
}

/** Default tokens of a chain, used when no adapter gives a list: USDC when known, and the native token. */
export function defaultSourceTokens(chain: string): SourceToken[] {
  return [
    ...(USDC[chain] ? [{ chain, token: USDC[chain]!, symbol: 'USDC', decimals: 6, name: 'USD Coin' }] : []),
    { chain, token: 'native', symbol: CHAINS[chain]?.nativeSymbol ?? 'ETH', decimals: nativeDecimals(chain) },
  ]
}

/** Token id for comparing: EVM addresses are not case-sensitive, Solana mints are. */
export function sourceTokenKey(chain: string, token: string): string {
  return `${chain}:${chain.startsWith('eip155:') ? token.toLowerCase() : token}`
}

/**
 * A source token with checked fields, or undefined. An adapter list may come from a provider, so the
 * server checks it: a short symbol, whole decimals, a token address of the chain's format, and an https
 * logo only (a logo that is not https is dropped).
 */
export function cleanSourceToken(t: unknown): SourceToken | undefined {
  if (!t || typeof t !== 'object') return undefined
  const { chain, token, symbol, decimals, name, logoUrl } = t as Record<string, unknown>
  if (typeof chain !== 'string' || typeof token !== 'string' || typeof symbol !== 'string') return undefined
  if (!/^[^\s<>"'&]{1,16}$/.test(symbol) || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined
  const okToken =
    token === 'native' ||
    (chain.startsWith('eip155:') ? /^0x[0-9a-fA-F]{40}$/.test(token) : chain.startsWith('solana:') ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) : /^[A-Za-z0-9:._-]{1,128}$/.test(token))
  if (!okToken) return undefined
  return {
    chain,
    token: chain.startsWith('eip155:') ? token.toLowerCase() : token,
    symbol,
    decimals,
    ...(typeof name === 'string' && name.length > 0 && name.length <= 64 ? { name } : {}),
    ...(isWebUrl(logoUrl) && logoUrl.length <= 512 ? { logoUrl } : {}),
  }
}

/**
 * Merge token lists of one chain: the defaults first (USDC, then native), then the others in the
 * order given, with no duplicates and no token that fails `cleanSourceToken`, at most MAX_SOURCE_TOKENS. A later copy of a token only fills
 * fields that the earlier copy does not have (for example a logo).
 */
export function mergeSourceTokens(chain: string, ...lists: SourceToken[][]): SourceToken[] {
  const out = new Map<string, SourceToken>()
  for (const raw of [...defaultSourceTokens(chain), ...lists.flat()]) {
    const t = cleanSourceToken(raw)
    if (!t || t.chain !== chain) continue
    const k = sourceTokenKey(chain, t.token)
    const prev = out.get(k)
    if (prev) out.set(k, { ...t, ...prev })
    else if (out.size < MAX_SOURCE_TOKENS) out.set(k, t)
  }
  return [...out.values()]
}

/** Case-insensitive search on symbol, name and address. An empty query keeps every token. */
export function searchSourceTokens(tokens: SourceToken[], query: string): SourceToken[] {
  const q = query.trim().toLowerCase()
  if (!q) return tokens
  const starts = tokens.filter((t) => t.symbol.toLowerCase().startsWith(q))
  const rest = tokens.filter((t) => !starts.includes(t) && (t.symbol.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q) || t.token.toLowerCase() === q))
  return [...starts, ...rest]
}
