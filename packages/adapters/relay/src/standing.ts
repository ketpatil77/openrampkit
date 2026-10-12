// Standing deposit addresses on Relay (see `Adapter.standingAddress`): one open deposit address per
// user and route, reused for every deposit; the deposits Relay saw at it; and the status of one
// deposit (a `sreq:{requestId}` ref). The session-bound deposit legs in deposit-address.ts do not use
// these addresses.

import type { AdapterContext, ScopedKV, StandingAddressInput, StandingDeposit, StandingDepositsInput } from '@openrampkit/adapter'
import { OpenRampException, openRampError, toBaseUnits } from '@openrampkit/core'
import type { Amount, CryptoAsset, LegStep } from '@openrampkit/core'
import type { RelayRuntime } from './client.js'
import { STANDING_ADDRESS_TTL_SEC } from './config.js'
import type { DepositAddresses } from './deposit-address.js'
import { addrKey, isSolana, relayOutput, sameAsset, toOpenRamp } from './helpers.js'

type Ctx = Pick<AdapterContext, 'fetch' | 'log' | 'shared'>

/** What the adapter keeps for one standing address */
type StandingRecord = { address: string; refundTo: string; at: number }

/** The ref of one deposit at a standing address: Relay's request id */
export const STANDING_REF = 'sreq:'

/** A store that keeps nothing: `depositQuote` then returns the new address of its quote. */
const NO_CACHE: ScopedKV = { get: async () => undefined, put: async () => {} }

export function standingAddresses(rt: RelayRuntime, deposits: DepositAddresses) {
  const { listRequests, decimalsOf, refundTo } = rt
  const { depositQuote, nominalAmount, requestKey, requestSourceTxHash, mapRequest } = deposits

  const norm = (chain: string, token: string) => (isSolana(chain) ? token : token.toLowerCase())

  /** The `shared` key of a user's address for a route. Relay binds the refund address to the address, so it is part of the key. */
  function standingKey(userId: string, origin: CryptoAsset, dest: CryptoAsset, recipient: string, refund: string) {
    return `sa:${JSON.stringify([userId, origin.chain, norm(origin.chain, origin.token), dest.chain, norm(dest.chain, dest.token), addrKey(recipient), norm(origin.chain, refund)])}`
  }

  /**
   * A Relay open deposit address from `origin` to the destination, with the destination address as the
   * recipient. Relay gives a new address for each quote, so the adapter keeps the first one in `shared`
   * (400 days after the last call) and returns it for the same user and route. The refund address
   * follows `refundTo` (an explicit address, then `'recipient'`, else the sender).
   */
  async function standingAddress(input: StandingAddressInput, ctx: Ctx): Promise<{ address: string; ref: string; data?: Record<string, unknown> }> {
    const origin: CryptoAsset = { kind: 'crypto', chain: input.origin.chain, token: input.origin.token }
    const d = input.destination
    const dest: CryptoAsset = { kind: 'crypto', chain: d.chain, token: d.token, ...(d.symbol ? { symbol: d.symbol } : {}), ...(d.decimals !== undefined ? { decimals: d.decimals } : {}) }
    if (sameAsset(origin.chain, origin.token, dest.chain, dest.token)) {
      throw new OpenRampException(openRampError('BAD_REQUEST', { message: 'Relay has no deposit address for the same token on the same chain.' }), 400)
    }
    const recipient = d.address
    const refund = refundTo(origin.chain, { recipient })
    const key = standingKey(input.userId, origin, dest, recipient, refund)
    const done = async (rec: StandingRecord) => {
      // Each call keeps the address for another 400 days.
      await ctx.shared.put(key, rec, STANDING_ADDRESS_TTL_SEC)
      return { address: rec.address, ref: rec.address, data: { refundTo: rec.refundTo } }
    }
    const cached = await ctx.shared.get<StandingRecord>(key)
    if (cached?.address) return done(cached)
    const decimals = await decimalsOf(ctx, origin)
    const { address } = await depositQuote(
      { fetch: ctx.fetch, log: ctx.log, store: NO_CACHE },
      { origin, dest, recipient, amountBase: toBaseUnits(nominalAmount(decimals), decimals), refundTo: refund },
    )
    const rec: StandingRecord = { address, refundTo: refund, at: Date.now() }
    // Two calls at the same time: the first write wins, and both return its address.
    if (ctx.shared.putIfAbsent && !(await ctx.shared.putIfAbsent(key, rec, STANDING_ADDRESS_TTL_SEC))) {
      const other = await ctx.shared.get<StandingRecord>(key)
      if (other?.address) return done(other)
    }
    return done(rec)
  }

  /**
   * The Relay requests at a standing address since `since`, newest 20. A request with no deposit yet
   * (status `waiting` and no transfer into the address) is left out: no money arrived. `id` is the
   * deposit transaction (Relay can re-quote a deposit under a new request id), else the request id.
   */
  async function standingDeposits(input: StandingDepositsInput, ctx: Ctx): Promise<StandingDeposit[]> {
    const list = await listRequests(ctx, `depositAddress=${encodeURIComponent(input.address)}&limit=20`).catch((e) => {
      throw toOpenRamp(e, ctx.log)
    })
    const origin: Amount = { value: '0', asset: { kind: 'crypto', chain: input.origin.chain, token: input.origin.token } }
    const out: StandingDeposit[] = []
    for (const r of list) {
      if (typeof r?.id !== 'string' || !r.id || typeof r.createdAt !== 'string') continue
      const at = Date.parse(r.createdAt)
      if (!Number.isFinite(at) || at < input.since) continue
      if (r.status === 'waiting' && !requestSourceTxHash(r)) continue
      const amount = relayOutput(r.data?.metadata?.currencyIn, origin)
      out.push({ id: requestKey(r), legRef: `${STANDING_REF}${r.id}`, at, ...(amount ? { input: amount } : {}) })
    }
    return out
  }

  /** The step of one deposit at a standing address, from its Relay request. Until Relay lists it, the deposit is processing. */
  async function standingStatus(ctx: AdapterContext, ref: string): Promise<LegStep> {
    const id = ref.slice(STANDING_REF.length)
    const list = await listRequests(ctx, `id=${encodeURIComponent(id)}`).catch((e) => {
      throw toOpenRamp(e, ctx.log)
    })
    const r = list.find((x) => typeof x?.id === 'string' && x.id.toLowerCase() === id.toLowerCase())
    if (!r) return { status: 'processing', detail: { code: 'processing' }, ref, providerRef: id }
    // The destination asset, so that Relay's output takes the session's asset (see `relayOutput`).
    const d = ctx.destination
    const expected: Amount | undefined = d.type === 'crypto' ? { value: '0', asset: { kind: 'crypto', chain: d.chain, token: d.token } } : undefined
    return mapRequest(ctx, r, ref, expected)
  }

  return { standingAddress, standingDeposits, standingStatus }
}
