// Source tokens for the deposit picker, from Relay's currency list (`POST /currencies/v2`).

import { cachedJson } from '@openrampkit/adapter'
import type { AdapterContext } from '@openrampkit/adapter'
import { isWebUrl } from '@openrampkit/core'
import type { SourceToken } from '@openrampkit/core'
import type { RelayRuntime } from './client.js'
import { EVM_NATIVE, SOLANA_NATIVE } from './config.js'
import { caip2FromRelay, isSolana, relayChainId } from './helpers.js'

/** How long a chain's list stays cached */
const SOURCES_TTL_SEC = 6 * 60 * 60
/** Relay's largest page */
const SOURCES_LIMIT = 100

type RelayCurrency = {
  chainId: number
  address: string
  symbol: string
  name?: string
  decimals: number
  metadata?: { logoURI?: string; verified?: boolean; isNative?: boolean }
}

export function relaySources(rt: Pick<RelayRuntime, 'api'>) {
  /**
   * Relay's default list of verified tokens for each chain. Deposit-address methods ask only for the
   * tokens Relay accepts on a deposit address. A chain that fails is left out (the server still adds
   * the default tokens), and a chain Relay does not know is skipped.
   */
  async function sourceTokens(input: { chains: string[]; method: string }, ctx: Pick<AdapterContext, 'fetch' | 'log' | 'shared'>): Promise<SourceToken[]> {
    const depositAddressOnly = input.method !== 'wallet'
    const lists = await Promise.all(
      input.chains.map(async (chain) => {
        let chainId: number
        try {
          chainId = relayChainId(chain)
        } catch {
          return []
        }
        try {
          return await cachedJson(
            ctx.shared,
            `src:${depositAddressOnly ? 'da' : 'w'}:${chain}`,
            SOURCES_TTL_SEC,
            async () => {
              const list = await rt.api<RelayCurrency[]>(ctx, '/currencies/v2', { chainIds: [chainId], defaultList: true, verified: true, limit: SOURCES_LIMIT, ...(depositAddressOnly ? { depositAddressOnly } : {}) })
              return (Array.isArray(list) ? list : []).flatMap((c) => toSourceToken(c, chain))
            },
            { valid: (v) => Array.isArray(v) },
          )
        } catch (e) {
          ctx.log.warn('relay: could not read the currency list', { chain, error: String((e as Error)?.message ?? e).slice(0, 200) })
          return []
        }
      }),
    )
    return lists.flat()
  }

  return { sourceTokens }
}

/** One Relay currency as a source token of `chain`, or nothing when a field is not valid */
function toSourceToken(c: RelayCurrency, chain: string): SourceToken[] {
  if (!c || typeof c.address !== 'string' || caip2FromRelay(c.chainId) !== chain) return []
  if (typeof c.symbol !== 'string' || !c.symbol || c.symbol.length > 16) return []
  if (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 36) return []
  const native = c.metadata?.isNative || c.address === EVM_NATIVE || c.address === SOLANA_NATIVE
  const token = native ? 'native' : isSolana(chain) ? c.address : c.address.toLowerCase()
  if (!native && !(isSolana(chain) ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) : /^0x[0-9a-f]{40}$/.test(token))) return []
  const logo = c.metadata?.logoURI
  return [
    {
      chain,
      token,
      symbol: c.symbol,
      decimals: c.decimals,
      ...(typeof c.name === 'string' && c.name && c.name.length <= 64 ? { name: c.name } : {}),
      ...(isWebUrl(logo) && logo.length <= 512 ? { logoUrl: logo } : {}),
    },
  ]
}
