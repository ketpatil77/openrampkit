---
"@openrampkit/client": minor
"@openrampkit/web": minor
"@openrampkit/react": minor
"@openrampkit/vue": minor
"@openrampkit/svelte": minor
"@openrampkit/solid": minor
---

Flow options and `autoClose`, for each session.

- `flow` (`FlowOptions`): `initialTab`, `initialMethod` (also `exchanges`), `lockMethod`, `amount`, `presets` per currency, `defaultSource` (deposit), `defaultTarget` (withdraw) and `balance` (withdraw with app custody: turns on MAX and the balance check). An option that does not fit the session is ignored.
- `autoClose`: close as soon as the payment completes, with no success screen. The element attribute is `auto-close`.
- `openDeposit`, `openWithdraw`, `createDepositController`, `beginDeposit`, `beginWithdraw` and the embedded components take them.
- The native token of a withdraw chain uses the chain's decimals (SOL: 9).
