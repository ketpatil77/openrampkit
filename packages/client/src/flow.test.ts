// FlowOptions: how the flow opens (tab, method, lock, amount, presets, default tokens, a withdraw balance).
import { describe, expect, it } from 'vitest'
import { SOLANA_MAINNET, USDC } from '@openrampkit/core'
import type { CreateSessionInput } from '@openrampkit/server'
import { DepositController, WithdrawController, withdrawTokens } from './index.js'
import type { FlowOptions } from './index.js'
import { BASE_DEST, BASE_SOURCE, setupServer, waitFor } from './testctx.js'

async function deposit(flow: FlowOptions, country = 'VN', mock?: Parameters<typeof setupServer>[0]) {
  const srv = setupServer(mock)
  const s = await srv.ramp.sessions.create({ userId: 'u', country, destination: BASE_DEST })
  const c = new DepositController({ client: srv.client, clientSecret: s.clientSecret, flow })
  await c.start()
  return c
}

async function withdraw(flow: FlowOptions, session: Partial<CreateSessionInput> = {}) {
  const srv = setupServer()
  const s = await srv.ramp.sessions.create({ userId: 'u', direction: 'withdraw', source: BASE_SOURCE, country: 'PH', ...session } as CreateSessionInput)
  const c = new WithdrawController({ client: srv.client, clientSecret: s.clientSecret, flow })
  await c.start()
  return c
}

describe('FlowOptions: deposit', () => {
  it('initialTab picks the first tab when it has methods, else the usual tab', async () => {
    expect((await deposit({ initialTab: 'cash' })).getSnapshot().tab).toBe('cash')
    expect((await deposit({ initialTab: 'crypto' })).getSnapshot().tab).toBe('crypto')
    // No crypto methods without the crypto legs: the tab stays cash
    expect((await deposit({ initialTab: 'crypto' }, 'VN', { settleMs: 0 })).getSnapshot().tab).toBe('cash')
  })

  it('initialMethod opens the method; lockMethod hides the way back', async () => {
    const c = await deposit({ initialMethod: 'vietqr', lockMethod: true })
    expect(c.getSnapshot()).toMatchObject({ screen: 'amount', tab: 'cash', method: { method: 'vietqr' } })
    expect(c.canGoBack()).toBe(false)
    c.back()
    expect(c.getSnapshot().screen).toBe('amount')
    const free = await deposit({ initialMethod: 'vietqr' })
    expect(free.canGoBack()).toBe(true)
    free.back()
    expect(free.getSnapshot().screen).toBe('methods')
  })

  it('an initialMethod the plan does not have is ignored', async () => {
    expect((await deposit({ initialMethod: 'pix' })).getSnapshot().screen).toBe('methods')
  })

  it('initialMethod transfer opens the deposit address quotes', async () => {
    const c = await deposit({ initialMethod: 'transfer' })
    await waitFor(() => !c.getSnapshot().quotesLoading)
    expect(c.getSnapshot()).toMatchObject({ screen: 'quotes', tab: 'crypto', method: { method: 'transfer' } })
  })

  it('amount and presets', async () => {
    const c = await deposit({ amount: '1,500.5', presets: { vnd: ['100000', '100000', '200000', '1', '500000', '900000000'] } })
    expect(c.getSnapshot().amount).toBe('1500.5')
    expect(c.getSnapshot().presets).toEqual({ VND: ['100000', '100000', '200000', '1', '500000', '900000000'] })
  })

  it('defaultSource: the chain with USDC, a given token, or native when the chain has no USDC', async () => {
    expect((await deposit({ defaultSource: { chain: 'eip155:10' } })).getSnapshot().source).toEqual({ chain: 'eip155:10', token: USDC['eip155:10'], symbol: 'USDC', decimals: 6 })
    expect((await deposit({ defaultSource: { chain: 'eip155:10', token: 'native' } })).getSnapshot().source).toMatchObject({ token: 'native', symbol: 'ETH', decimals: 18 })
    expect((await deposit({ defaultSource: { chain: 'eip155:143' } })).getSnapshot().source).toMatchObject({ token: 'native', symbol: 'MON' })
    expect((await deposit({ defaultSource: { chain: SOLANA_MAINNET, token: 'native' } })).getSnapshot().source).toMatchObject({ symbol: 'SOL', decimals: 9 })
  })
})

describe('FlowOptions: withdraw', () => {
  it('initialTab cash when allowed', async () => {
    expect((await withdraw({ initialTab: 'cash' })).getSnapshot().tab).toBe('cash')
    expect((await withdraw({})).getSnapshot().tab).toBe('crypto')
  })

  it('defaultTarget picks the receive chain and token', async () => {
    const c = await withdraw({ defaultTarget: { chain: 'eip155:42161', token: 'native' } })
    expect(c.getSnapshot().target).toMatchObject({ chain: 'eip155:42161', token: 'native', symbol: 'ETH' })
  })

  it('balance: a host balance for app custody turns on MAX and the balance check', async () => {
    const c = await withdraw({ balance: '42.5' }, { source: { ...BASE_SOURCE, custody: 'app' } } as Partial<CreateSessionInput>)
    expect(c.getSnapshot().balances).toEqual([{ chain: 'eip155:8453', token: USDC['eip155:8453'], symbol: 'USDC', decimals: 6, amount: '42.5' }])
    expect(c.sourceBalance()?.amount).toBe('42.5')
    // A value that is not a decimal is ignored
    expect((await withdraw({ balance: '1e9' })).getSnapshot().balances).toEqual([])
  })

  it('withdrawTokens: SOL has 9 decimals', () => {
    expect(withdrawTokens(SOLANA_MAINNET).find((t) => t.token === 'native')!.decimals).toBe(9)
  })
})
