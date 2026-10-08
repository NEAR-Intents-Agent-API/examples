# 01 · Getting started

Prove connectivity and learn the token catalog. These examples are read-only and need only
`NEAR_INTENTS_AGENT_API_URL` and `NEAR_INTENTS_AGENT_API_KEY` in `examples/.env`.

| Example | Run | What it shows |
|---|---|---|
| `01-check-api.ts` | `pnpm 01:check-api` | `GET /v1/network`, `/health`, the authenticated `whoami`, quota and the token catalog via the SDK |
| `02-list-tokens.ts` | `pnpm 01:list-tokens` | `GET /v1/tokens`: asset ids, decimals, USD price and quote freshness |

`GET /v1/tokens` is public and returns **exactly** the assets agent wallets support. `asset_id` is
the value every execution takes (`asset`, `origin_asset`, `destination_asset`). A `price` is usable
only until `price_expires_at`; after that, refetch rather than showing a stale number. `null` price
means unknown, never zero.

Next: [02 · Your first agent](../02-your-first-agent/README.md).
