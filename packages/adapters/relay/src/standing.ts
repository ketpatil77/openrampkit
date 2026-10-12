// Standing deposit addresses on Relay (see `Adapter.standingAddress`): one open deposit address per
// user and route, reused for every deposit; the deposits Relay saw at it; and the status of one
// deposit (a `sreq:{requestId}` ref). The session-bound deposit legs in deposit-address.ts do not use
// these addresses.

import { claimOnce } from '@openrampkit/adapter'
import type { AdapterContext, ScopedKV, StandingAddressInput, StandingDeposit, StandingDepositsInput } from '@openrampkit/adapter'
import { OpenRampException, openRampError, toBaseUnits } from '@openrampkit/core'
import type { Amount, CryptoAsset, LegStep } from '@openrampkit/core'
import type { RelayRuntime } from './client.js'
import { STANDING_ADDRESS_TTL_SEC, USED_TTL_SEC } from './config.js'
import type { DepositAddresses } from './deposit-address.js'
import type { RelayRequest } from './types.js'
import { addrKey, isSolana, relayOutput, sameAsset, toOpenRamp } from './helpers.js'

type Ctx = Pick<AdapterContext, 'fetch' | 'log' | 'shared'>

/** What the adapter keeps for one standing address */
type StandingRecord = { address: string; refundTo: string; at: number }

/**
 * The ref of one deposit at a standing address: `sreq:{requestId}|{address}|{depositKey}`. Relay can
 * re-quote a deposit under a new request id, so the status follows the deposit (the address and the
 * deposit transaction), and the request id is the fallback.
 */
export const STANDING_REF = 'sreq:'

function standingRef(requestId: string, address: string, depositKey: string): string {
  return `${STANDING_REF}${requestId}|${address}|${depositKey}`
}

function parseStandingRef(ref: string): { id: string; address?: string; depositKey?: string } {
  const [id = '', address, depositKey] = ref.slice(STANDING_REF.length).split('|')
  return { id, ...(address && depositKey ? { address, depositKey } : {}) }
}

/** How far before `since` a poll reads, for deposits that Relay indexed late (24 h) */
const STANDING_LOOKBACK_MS = 24 * 60 * 60_000
/** Requests per page, and the most pages one poll reads */
const STANDING_PAGE_SIZE = 20
const STANDING_MAX_PAGES = 5

/** A store that keeps nothing: `depositQuote` then returns the new address of its quote. */
const NO_CACHE: ScopedKV = { get: async () => undefined, put: async () => {} }

export function standingAddresses(rt: RelayRuntime, deposits: DepositAddresses) {
  const { listRequests, listRequestsPage, decimalsOf, refundTo } = rt
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
   * The Relay requests at a standing address since `since` (with a look-back), newest first, up to 5
   * pages of 20. A request with no deposit
   * transaction yet is left out until Relay shows it: then no session exists before money arrived, and
   * `id` is always the deposit transaction. Relay can re-quote a deposit under a new request id, and the
   * same `id` keeps one deposit to one session.
   */
  async function standingDeposits(input: StandingDepositsInput, ctx: Ctx): Promise<StandingDeposit[]> {
    // Relay can index the deposit transaction of a request some time after it made the request. So this
    // looks back STANDING_LOOKBACK_MS before `since`, and the server drops deposits it already has.
    const floor = input.since - STANDING_LOOKBACK_MS
    const list: RelayRequest[] = []
    let continuation: string | undefined
    for (let page = 0; page < STANDING_MAX_PAGES; page++) {
      const q = `depositAddress=${encodeURIComponent(input.address)}&limit=${STANDING_PAGE_SIZE}${continuation ? `&continuation=${encodeURIComponent(continuation)}` : ''}`
      const res = await listRequestsPage(ctx, q).catch((e) => {
        throw toOpenRamp(e, ctx.log)
      })
      list.push(...res.requests)
      const oldest = Math.min(...res.requests.map((r) => Date.parse(r?.createdAt ?? '')).filter(Number.isFinite))
      continuation = res.continuation
      if (!continuation || !res.requests.length || oldest < floor) break
      if (page === STANDING_MAX_PAGES - 1) ctx.log.warn('relay: more requests at a standing address than one poll reads', { address: input.address })
    }
    const origin: Amount = { value: '0', asset: { kind: 'crypto', chain: input.origin.chain, token: input.origin.token } }
    const out: StandingDeposit[] = []
    for (const r of list) {
      if (typeof r?.id !== 'string' || !r.id || typeof r.createdAt !== 'string') continue
      const at = Date.parse(r.createdAt)
      if (!Number.isFinite(at) || at < floor) continue
      if (!requestSourceTxHash(r)) continue
      const key = requestKey(r)
      // Relay can give a session's transfer leg the same address. The session flow and this one claim a
      // deposit with the same key (`relayreq:`), so one deposit goes to one of them only.
      const used = `relayreq:${key}`
      const owner = `standing:${input.address}`
      const usedBy = await ctx.shared.get<string>(used)
      if (usedBy && usedBy !== owner) continue
      if (!usedBy && !(await claimOnce(ctx.shared, used, owner, USED_TTL_SEC))) continue
      const amount = relayOutput(r.data?.metadata?.currencyIn, origin)
      out.push({ id: key, legRef: standingRef(r.id, input.address, key), at, ...(amount ? { input: amount } : {}) })
    }
    return out
  }

  /**
   * The step of one deposit at a standing address. It reads the requests at the address and takes the
   * newest one for the same deposit transaction (a re-quote replaces the first request), else the request
   * by id. Until Relay lists it, the deposit is processing.
   */
  async function standingStatus(ctx: AdapterContext, ref: string): Promise<LegStep> {
    const { id, address, depositKey } = parseStandingRef(ref)
    const fail = (e: unknown) => {
      throw toOpenRamp(e, ctx.log)
    }
    let r: RelayRequest | undefined
    if (address && depositKey) {
      const atAddress = await listRequests(ctx, `depositAddress=${encodeURIComponent(address)}&limit=20`).catch(fail)
      r = atAddress
        .filter((x) => typeof x?.id === 'string' && requestKey(x) === depositKey)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
    }
    if (!r) {
      const byId = await listRequests(ctx, `id=${encodeURIComponent(id)}`).catch(fail)
      r = byId.find((x) => typeof x?.id === 'string' && x.id.toLowerCase() === id.toLowerCase())
    }
    if (!r) return { status: 'processing', detail: { code: 'processing' }, ref, providerRef: id }
    // The destination asset, so that Relay's output takes the session's asset (see `relayOutput`).
    const d = ctx.destination
    const expected: Amount | undefined = d.type === 'crypto' ? { value: '0', asset: { kind: 'crypto', chain: d.chain, token: d.token } } : undefined
    return mapRequest(ctx, r, ref, expected)
  }

  return { standingAddress, standingDeposits, standingStatus }
}
