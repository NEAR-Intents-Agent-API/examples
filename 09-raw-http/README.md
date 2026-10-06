# 09 · Raw HTTP

The SDK is optional. Everything is ordinary HTTP: `X-API-Key` on every call, `Idempotency-Key`
on writes, `X-Grant-Token` on delegated calls, JSON bodies, JSON:API errors. Every field, query parameter and error code is snake_case
(`correlation_id`, `wait_ms`, `policy_action_denied`); the SDK's own options stay camelCase.

| Example | Run | What it shows |
|---|---|---|
| `01-reads.ts` | `pnpm 09:reads` | Network, tokens, agent, policy — plain `fetch` |
| `02-owner-flow.ts` | `pnpm 09:owner-flow` | generate → sign → submit → status over raw HTTP |
| `03-execution.ts` | `pnpm 09:execution` | A delegated action with grant and idempotency headers |

## curl cheatsheet

```sh
API=https://your-agent-api.example.com
KEY=naa_…

# Public reads
curl "$API/v1/network"
curl "$API/v1/tokens"

# Authenticated reads
curl "$API/v1/agents" -H "X-API-Key: $KEY"
curl "$API/v1/agents/$AGENT_ID/policy" -H "X-API-Key: $KEY"
curl "$API/v1/status?correlation_id=$CID&wait_ms=30000" -H "X-API-Key: $KEY"

# Generate an owner intent (optional idempotency key)
curl "$API/v1/generate-intent" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-1" \
  -d '{"type":"agent_freeze","agent_id":"'"$AGENT_ID"'"}'

# Submit the wallet output
curl "$API/v1/submit-intent" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d @signed.json

# Delegated execution: both headers are required for a spend
curl "$API/v1/agents/$AGENT_ID/transfer" \
  -H "X-API-Key: $KEY" -H "X-Grant-Token: $GRANT_TOKEN" \
  -H "Idempotency-Key: payout-42" -H "Content-Type: application/json" \
  -d '{"asset":"nep141:wrap.near","amount":"1","recipient":"bob.near"}'
```

## Parity with the SDK

| SDK | HTTP |
|---|---|
| `api.getAgent(id)` | `GET /v1/agents/{agent_id}` |
| `api.generateIntent(body, { idempotencyKey })` | `POST /v1/generate-intent` + `Idempotency-Key` |
| `api.getStatus(cid, { waitMs })` | `GET /v1/status?correlation_id=…&wait_ms=…` |
| `api.forGrant(t).swap(id, body, { idempotencyKey })` | `POST /v1/agents/{agent_id}/swap` + `X-Grant-Token` + `Idempotency-Key` |
| `api.deposit(id, body, { idempotencyKey })` | `POST /v1/agents/{agent_id}/deposit` (no grant) |

`GET /openapi.json` is the full schema; `GET /llms.txt` is a compact guide for LLM callers.

Next: [10 · Recipes](../10-recipes/README.md).
