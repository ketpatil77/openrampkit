---
"@openrampkit/core": minor
"@openrampkit/adapter": minor
"@openrampkit/adapter-relay": minor
"@openrampkit/server": minor
---

Standing deposit addresses: one permanent deposit address per user and route.

- Server: `openramp.depositAddresses.get({ userId, origin, destination, adapterId? })` makes the address on the first call and returns the same one after that. `depositAddresses.list(userId)` lists a user's addresses.
- `sweep()` polls each address (every 30 s after a deposit, up to every 10 minutes when idle, and not after 90 idle days until the next `get`). Each new deposit becomes a deposit session with an observed payment, so the usual session webhooks follow. `SweepResult.standing` counts the polls and the deposits.
- New webhook event `deposit_address.deposit` (`depositAddressId`, `sessionId`, `depositId`, `input`). Such a session has `standingAddressId`, and its failure is final.
- Core: the `StandingAddress` type, and `Session.standingAddressId`.
- Adapter API: two optional methods, `standingAddress()` and `standingDeposits()`. `checkAdapterShape` checks that they come together with `status()` and a `transfer` leg.
- Relay: standing addresses are Relay open deposit addresses. A deposit's ref is `sreq:<requestId>`.
