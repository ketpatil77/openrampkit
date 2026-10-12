import { cmp } from './money.js'
import type { PublicQuote } from './types.js'

export type RankOptions<T> = {
  /**
   * The recent success rate of a quote's providers (0 to 1). It breaks ties of the same output and the
   * same ETA: the higher rate goes first. Undefined on either side is a tie. Give every quote a number
   * (a neutral one for no data) to keep the order well defined.
   */
  successRate?: (q: T) => number | undefined
}

/**
 * Rank quotes: most delivered first, then fastest, then the higher success rate (when given), then the
 * input order (the app's provider preference). Marks 'best_price' and 'fastest'.
 * All quotes in one call must deliver the same asset (they do: same destination).
 */
export function rankQuotes<T extends PublicQuote>(quotes: T[], opts: RankOptions<T> = {}): T[] {
  const rate = opts.successRate
  const byRate = (a: T, b: T) => {
    if (!rate) return 0
    const ra = rate(a)
    const rb = rate(b)
    return ra === undefined || rb === undefined ? 0 : rb - ra
  }
  const sorted = [...quotes].sort((a, b) => cmp(b.output.value, a.output.value) || a.eta.max - b.eta.max || byRate(a, b))
  if (!sorted.length) return sorted
  const fastest = [...sorted].sort((a, b) => a.eta.max - b.eta.max)[0]!
  return sorted.map((q, i) => {
    const badges: PublicQuote['badges'] = []
    if (i === 0) badges.push('best_price')
    if (q.id === fastest.id && sorted.length > 1) badges.push('fastest')
    return badges.length ? { ...q, badges } : q
  })
}
