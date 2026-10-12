---
"@openrampkit/adapter-relay": minor
"@openrampkit/server": patch
"@openrampkit/web": patch
---

Safer deposits from exchanges, and no double payment on restart.

- Relay: new option `exchangeTransfer` offers the transfer leg as the `exchange_transfer` method ("From an exchange"). A refund for it does not go to the exchange's hot wallet when a better address is known: an explicit `refundTo` address, then the connected wallet, then the recipient. Otherwise the deposit screen warns the user. `refundTo` also takes `'recipient'`. Relay binds the refund address to the deposit address, so an address with another refund address gets its own store key.
- Server: `restart` first asks the provider for the status of the active leg. A payment that the provider already took (on its page, by QR code or by bank transfer) now blocks the restart. The server also asks the adapter to cancel the left provider order (`cancel`, best effort).
- Web: the native token of a chain uses the chain's decimals (SOL: 9, not 18).
