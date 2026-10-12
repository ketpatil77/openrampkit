---
"@openrampkit/core": minor
"@openrampkit/client": minor
"@openrampkit/web": minor
"@openrampkit/adapter-mock": minor
---

Exchange picker ("From an exchange").

- Core: `EXCHANGES` (Binance, Coinbase, OKX, Bybit, Kraken), `exchangeOptions(methods)` and `isExchangeMethod`. Each exchange row has a mode: `connect` (pay on the exchange's page: the Binance adapter's `exchange`, Meld `binance_pay`, Coinbase `coinbase_account`) or `deposit` (`exchange_transfer`). The plan decides which methods exist (adapters and regions), so the rows follow the plan.
- Client: screen `exchanges`, `openExchanges()`, `selectExchange(id)`, `snapshot.exchange`, `depositFallback()` and `depositInstead()`. When the payment on the exchange's page waits or fails, the user can send from the same exchange to a deposit address. The server refuses this restart when the exchange already took the payment.
- Web: with a connect method, one "From an exchange" row opens the picker. The deposit hint names the picked exchange. 6 locales.
- Mock: `exchangeConnect` offers `coinbase_account` on the card leg, for tests and demos.
