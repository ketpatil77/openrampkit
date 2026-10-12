---
"@openrampkit/core": minor
"@openrampkit/adapter": minor
"@openrampkit/adapter-relay": minor
"@openrampkit/server": minor
"@openrampkit/client": minor
"@openrampkit/web": minor
---

A token list for the deposit source picker, from the server.

- Core: `SourceToken`, `SourceChain`, `defaultSourceTokens`, `mergeSourceTokens`, `cleanSourceToken` and `searchSourceTokens`.
- Adapter: optional `sourceTokens({ chains, method })`.
- Relay: `sourceTokens` from Relay's verified default list (`/currencies/v2`), only deposit-address tokens for transfers, cached for 6 hours per chain.
- Server: `GET /sessions/:id/sources?method=` merges the adapter lists after USDC and the native token, checks every field, keeps only https logos, and caches the answer for an hour.
- Client: `client.sources()`, and the controller loads `snapshot.sources` when the user picks an address transfer. On an error the picker keeps the default list.
- Web: the token select is now a list with logos (a letter shows when a logo does not load) and a search box when a chain has more than 6 tokens.
