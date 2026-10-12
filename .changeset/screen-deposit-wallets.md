---
"@openrampkit/server": minor
---

New option `screenDepositWallets`: run `screenAddress` on the wallet that pays a `wallet` deposit, on the chain it pays from, before the payment starts. A refused wallet gets `403 ADDRESS_REJECTED`. Default off.
