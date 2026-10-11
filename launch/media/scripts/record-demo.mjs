// Records the demo video from the playground, timed to the voiceover clips.
//
// 1. bash launch/media/scripts/tts.sh            (voice clips + .vo/durations.json)
// 2. pnpm playground:build, then serve it:      (cd examples/playground && npx vite preview --port 5188 --strictPort)
// 3. cd examples/playground && node ../../launch/media/scripts/record-demo.mjs [baseUrl]
// 4. bash launch/media/scripts/mix-demo.sh       (voiceover mix + final encodes)
//
// Each scene is a "beat" with one voiceover line (scripts/demo-lines.json). A beat lasts at least as long as its clip.
// The start time of each beat goes to .vo/marks.json, so the mix places each clip at its beat.
import fs from 'node:fs'
import { createRequire } from 'node:module'

// Resolve Playwright from the working directory (examples/playground), not from this file.
const { chromium } = createRequire(`${process.cwd()}/`)('@playwright/test')

const OUT = '/Users/yos/openrampkit/launch/media'
const VO = `${OUT}/.vo`
const BASE = process.argv[2] ?? 'http://localhost:5188/playground/'
const DUR = JSON.parse(fs.readFileSync(`${VO}/durations.json`, 'utf8'))
const PAD = 450 // ms of quiet after each line
const vp = { width: 1280, height: 800 }
const vdir = `${OUT}/.video-d`
fs.rmSync(vdir, { recursive: true, force: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, recordVideo: { dir: vdir, size: vp } })

// A visible cursor and a caption bar, because headless video has no cursor.
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div')
    c.id = '__cursor'
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;border-radius:50%;background:rgba(43,227,160,.55);border:2px solid #10163A;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);transition:transform .12s'
    document.documentElement.appendChild(c)
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', () => { c.style.transform = 'translate(-50%,-50%) scale(.7)' }, true)
    addEventListener('mouseup', () => { c.style.transform = 'translate(-50%,-50%)' }, true)
    const cap = document.createElement('div')
    cap.id = '__caption'
    cap.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:92vw;background:#10163A;color:#fff;font:600 16px/1.3 -apple-system,Segoe UI,sans-serif;padding:10px 18px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:2147483646;pointer-events:none;opacity:0;transition:opacity .3s;text-align:center'
    document.documentElement.appendChild(cap)
  })
})

const p = await ctx.newPage()
const t0 = Date.now() // the video starts with the page; mix-demo.sh measures the small offset
p.setDefaultTimeout(20000)
const now = () => Date.now() - t0
const wait = (ms) => p.waitForTimeout(ms)
const marks = {}
const caption = (text) => p.evaluate((t) => { const c = document.getElementById('__caption'); if (!c) return; c.textContent = t; c.style.opacity = t ? '1' : '0' }, text).catch(() => {})

/** One scene with one voiceover line. It lasts at least as long as the clip plus PAD. */
async function beat(id, cap, fn) {
  if (!(id in DUR)) throw new Error(`no clip for ${id}`)
  const start = now()
  marks[id] = start / 1000
  console.log((start / 1000).toFixed(1), id)
  if (cap !== undefined) await caption(cap)
  await fn()
  const rest = DUR[id] * 1000 + PAD - (now() - start)
  if (rest > 0) await wait(rest)
}

let shotN = 0
const shot = async (name) => { shotN++; await p.screenshot({ path: `${OUT}/frame-${String(shotN).padStart(2, '0')}-${name}.png` }) }

async function moveTo(loc) {
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 })
  await wait(300)
}
async function click(loc) { await moveTo(loc); await loc.click(); await wait(250) }
async function typeSlow(loc, text, delay = 110) { await click(loc); await loc.fill(''); await loc.pressSequentially(text, { delay }) }
async function select(id, value) { const s = p.locator(`#${id}`); await moveTo(s); await s.selectOption(value); await wait(350) }
async function check(name, on) { const b = p.getByRole('checkbox', { name }); await moveTo(b); on ? await b.check() : await b.uncheck(); await wait(350) }
const smoothScroll = (y) => p.evaluate((y) => new Promise((r) => { window.scrollTo({ top: y, behavior: 'smooth' }); setTimeout(r, 900) }), y)

const LOGO = (s) => `<svg viewBox="0 0 64 64" width="${s}" height="${s}"><rect width="64" height="64" rx="15" fill="#2BE3A0"/><path d="M10 51 L54 51 L54 20 Z" fill="#10163A"/><circle cx="32.5" cy="25.5" r="7" fill="#10163A"/><circle cx="32.5" cy="25.5" r="3" fill="#2BE3A0"/></svg>`
const card = (inner) => `<body style="margin:0;background:#10163A;color:#fff;font-family:Inter,-apple-system,'Helvetica Neue',Arial,sans-serif;height:100vh;display:grid;place-items:center;text-align:center"><div>${inner}</div></body>`
const WORDMARK = `<div style="font-size:76px;letter-spacing:-2px;margin-top:24px"><b>OpenRamp</b>Kit</div>`

const m = p.locator('openramp-modal')
const amount = () => m.getByRole('textbox', { name: /Amount/ })
const quotes = () => m.getByRole('radiogroup', { name: 'Quotes' }).getByRole('radio')

// 1. Intro: the playground
await beat('01-intro', 'Playground: the OpenRampKit server runs in the browser, with mock providers', async () => {
  await p.goto(`${BASE}?country=SG`)
  await m.getByRole('tab', { name: 'Use Cash' }).waitFor()
  await wait(3500)
  await moveTo(p.getByTestId('demo-banner'))
  await wait(2500)
  await moveTo(p.locator('#country'))
})

// 2. Singapore: PayNow
await beat('02-sg', 'Singapore: local cash methods. PayNow, 200 dollars.', async () => {
  await click(m.getByRole('tab', { name: 'Use Cash' }))
  await wait(1500)
  await shot('sg-methods')
  await click(m.getByRole('button', { name: /PayNow/ }))
  await typeSlow(amount(), '200')
  await wait(400)
})

// 3. Quotes
await beat('03-quotes', 'Providers quote the same route. Best price first.', async () => {
  await click(m.getByRole('button', { name: 'Continue' }))
  await quotes().nth(1).waitFor()
  await wait(1200)
  await moveTo(quotes().first())
  await wait(1200)
  await shot('sg-quotes')
  await moveTo(quotes().nth(Math.min(2, (await quotes().count()) - 1)))
  await wait(800)
})

// 4. QR and simulated bank payment
await beat('04-qr', 'Scan with any banking app', async () => {
  await click(m.getByRole('button', { name: 'Confirm' }))
  const sim = m.getByRole('button', { name: /Simulate payment/ })
  await sim.waitFor()
  await wait(2500)
  await shot('sg-qr')
  await caption('Test mode: simulate the bank payment')
  await click(sim)
})

// 5. Deposit complete, events and signed webhook
await beat('05-webhook', 'Widget events on your page. Signed webhooks to your backend.', async () => {
  await m.getByRole('heading', { name: 'Deposit complete' }).waitFor({ timeout: 30000 })
  await wait(1000)
  await shot('sg-complete')
  await smoothScroll(420)
  await moveTo(p.getByTestId('webhooks').getByText('signature ok').first())
  await wait(1200)
  await shot('events-webhooks')
})

// 6. United States
await beat('06-us', 'United States: card, Apple Pay and Google Pay', async () => {
  await smoothScroll(0)
  await select('country', 'US')
  await m.getByRole('tab', { name: 'Use Cash' }).waitFor()
  await click(m.getByRole('tab', { name: 'Use Cash' }))
  await m.getByRole('button', { name: /Apple Pay/ }).waitFor()
  await wait(1200)
  await shot('us-methods')
  await click(m.getByRole('button', { name: /^Card/ }))
  await typeSlow(amount(), '100')
  await click(m.getByRole('button', { name: 'Continue' }))
  await quotes().nth(1).waitFor()
  await wait(1000)
})

// 7. Test card
await beat('07-card', 'Test card 4242 4242 4242 4242, right in the widget', async () => {
  await click(m.getByRole('button', { name: 'Confirm' }))
  await typeSlow(m.getByRole('textbox', { name: /Card number/ }), '4242 4242 4242 4242', 40)
  await typeSlow(m.getByRole('textbox', { name: /Expiry/ }), '12/30', 80)
  await typeSlow(m.getByRole('textbox', { name: 'CVC' }), '123', 80)
  await wait(300)
  await shot('us-card')
  await click(m.getByRole('button', { name: 'Pay (test mode)' }))
  await m.getByRole('heading', { name: 'Deposit complete' }).waitFor({ timeout: 30000 })
  await caption('Deposit complete')
})

// 8. From an exchange
await beat('08-exchange', 'From an exchange: a deposit address, with the network and the token', async () => {
  await p.goto(`${BASE}?country=US`) // a new session
  await m.getByRole('tab', { name: 'Use Crypto' }).waitFor()
  await wait(500)
  await click(m.getByRole('tab', { name: 'Use Crypto' }))
  await wait(700)
  await click(m.getByRole('button', { name: /From an exchange/ }))
  await m.getByRole('combobox', { name: 'Network' }).waitFor()
  await wait(900)
  await click(m.getByRole('button', { name: 'Continue' }))
  await m.getByText(/Send USDC on \w+ to this address/).waitFor()
  await wait(2500)
  await shot('exchange-address')
  await click(m.getByRole('button', { name: /Simulate deposit/ }))
  await m.getByRole('heading', { name: 'Deposit complete' }).waitFor({ timeout: 30000 })
})

// 9. Customization
await beat('09-custom', 'Choose payment sources. Match your brand.', async () => {
  await check(/^Card/, false)
  await wait(1200)
  const cashTab = m.getByRole('tab', { name: 'Use Cash' })
  if (await cashTab.count()) await click(cashTab)
  await wait(1000)
  await select('theme', 'dark')
  await select('radius', 'small')
  await select('font', 'rounded')
  await wait(500)
  await p.mouse.move(490, 300, { steps: 20 })
  await shot('custom-dark')
})

// 10. Withdraw to GCash: quote
await beat('10-withdraw', 'Withdraw: USDC to GCash in the Philippines', async () => {
  await check(/^Card/, true)
  await select('country', 'PH')
  await select('direction', 'withdraw')
  await m.getByRole('tab', { name: 'To cash' }).waitFor()
  await click(m.getByRole('tab', { name: 'To cash' }))
  await wait(700)
  await click(m.getByRole('button', { name: /GCash/ }))
  await typeSlow(amount(), '25')
  await click(m.getByRole('button', { name: 'Continue' }))
  await caption('Payout quotes in PHP')
  await quotes().first().waitFor()
  await wait(1200)
  await shot('withdraw-quote')
})

// 11. Details, wallet approval, done
await beat('11-withdraw-done', 'Payout details, then one wallet approval', async () => {
  await click(m.getByRole('button', { name: 'Confirm' }))
  await typeSlow(m.getByRole('textbox', { name: 'Account holder name' }), 'Maria Santos', 45)
  await typeSlow(m.getByRole('textbox', { name: 'GCash phone number' }), '09171234567', 45)
  await click(m.getByRole('button', { name: 'Continue' }))
  await click(m.getByRole('button', { name: 'Confirm in wallet' }))
  await m.getByRole('heading', { name: 'Withdrawal complete' }).waitFor({ timeout: 30000 })
  await caption('Withdrawal complete')
  await wait(800)
  await shot('withdraw-complete')
})

// 12. Admin dashboard
await beat('12-admin', 'Ops dashboard: deposits, withdrawals, stuck payments, webhook replays', async () => {
  await click(p.locator('#admin-open'))
  await p.locator('#admin-frame').waitFor()
  await wait(3500)
  await p.mouse.move(640, 420, { steps: 25 })
  await wait(2500)
  await shot('admin')
  await p.mouse.move(640, 600, { steps: 25 })
  await wait(1500)
  await click(p.locator('#admin-close'))
})

// 13. Code
await beat('13-code', 'A few lines: create a session on your server, open the widget on your page', async () => {
  await select('direction', 'deposit')
  await wait(400)
  await moveTo(p.locator('#code'))
  await p.mouse.move(900, 180, { steps: 20 })
  await wait(1500)
  await p.mouse.move(900, 420, { steps: 30 })
  await wait(800)
  await shot('code')
})

// 14. Many countries and methods: 13 adapters
await beat('14-explorer', '13 provider adapters. Self-hosted, next to your backend.', async () => {
  for (const c of ['TH', 'ID', 'PH', 'SG']) {
    await select('country', c)
    const cash = m.getByRole('tab', { name: 'Use Cash' })
    if (await cash.count()) await click(cash)
    await wait(1100)
  }
})

// 15. Settlement onchain on the prize-track chains
const PAGES = [
  { url: 'https://explorer.solana.com/tx/4cAv4h7Pv8FGBx55yidQwJcww5uqF54usUy7juR8hnViRm4UBbAZ7NEdTuZuwWJXtyBQ9eLvozWjRPi7MYnBxiKY?cluster=devnet', fb: 'frame-solana-fallback.png', cap: 'Solana devnet: SPL transfer verified onchain', ms: 4000 },
  { url: 'https://explore.testnet.tempo.xyz/tx/0x40a152bb98f2fd9e99d8592381903279eba20a344dc737cc2d7938b728aa44d3', fb: 'frame-tempo-fallback.png', cap: 'Tempo testnet: OpenRampSettlement', ms: 4000 },
  { url: 'https://arbitrum-sepolia.blockscout.com/tx/0xf370773565bd5340b17f1a00e969fdd15f84229d73be10346c7f0ab197aa4fdf?tab=logs', fb: 'frame-arbitrum-settled.png', cap: 'Arbitrum Sepolia: OpenRampSettlement emits Settled', ms: 5000, still: true },
]
const fails = []
async function showPage({ url, fb, cap, ms, until, still }, i) {
  const t = now()
  let ok = true
  try {
    if (still) throw new Error('still image (slow explorer)')
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await wait(3500)
    const body = (await p.locator('body').innerText()).slice(0, 4000)
    if (body.length < 200) throw new Error('page looks empty')
    if (until) {
      await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      await wait(5000)
      const hit = p.getByText(until).first()
      await hit.waitFor({ timeout: 25000 })
      const y = await hit.evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 180)
      for (let k = 1; k <= 6; k++) { await p.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), (y * k) / 6); await wait(300) }
      await moveTo(hit)
      await wait(2500)
    }
  } catch (e) {
    ok = false
    if (!still) fails.push(url)
    console.log('explorer fallback:', url, e.message)
    const img = fs.readFileSync(`${OUT}/${fb}`).toString('base64')
    await p.setContent(`<body style="margin:0;background:#fff"><img src="data:image/png;base64,${img}" style="width:100vw;height:100vh;object-fit:contain"></body>`)
  }
  await caption(cap)
  if (ok) await shot(`explorer-${i}`)
  const rest = ms - (now() - t)
  if (rest > 0) await wait(rest)
}
await beat('15-settled', undefined, async () => {
  for (let i = 0; i < PAGES.length; i++) await showPage(PAGES[i], i)
})

// 16. End card
await beat('16-end', undefined, async () => {
  await p.setContent(card(`${LOGO(100)}${WORDMARK}
<div style="font-size:30px;font-weight:600;margin-top:16px">Open-source, unified deposit infrastructure for crypto apps</div>
<div style="font-size:22px;margin-top:14px;opacity:.85">13 provider adapters · Solana · Tempo · EVM · Self-hosted · AI agents via MCP · MIT</div>
<div style="font-size:26px;color:#2BE3A0;font-weight:600;margin-top:30px">github.com/yosriady/openrampkit</div>
<div style="font-size:24px;color:#2BE3A0;margin-top:8px">openrampkit.vercel.app</div>`))
  await wait(300)
  await shot('end')
})
await wait(800)
marks.end = now() / 1000

const video = p.video()
await ctx.close()
fs.renameSync(await video.path(), `${OUT}/demo-raw.webm`)
fs.rmSync(vdir, { recursive: true, force: true })
fs.writeFileSync(`${VO}/marks.json`, JSON.stringify({ ...marks, explorerOk: fails.length === 0 }, null, 2))
await browser.close()
console.log('saved', `${OUT}/demo-raw.webm`, 'length', marks.end.toFixed(1), 's', 'explorer fails', fails.length)
