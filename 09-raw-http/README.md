# 09 · Raw HTTP

The SDK is optional. Everything is ordinary HTTP: `X-API-Key` on every call, `Idempotency-Key`
on writes, `X-Grant-Token` (or `X-Grant-Proof`) on delegated calls, JSON bodies, JSON:API errors. Every field, query parameter and error code is snake_case
(`correlation_id`, `wait_ms`, `policy_action_denied`); the SDK's own options stay camelCase.

| Example | Run | What it shows |
|---|---|---|
| `01-reads.ts` | `pnpm 09:reads` | Network, tokens, agent, policy — plain `fetch` |
| `02-owner-flow.ts` | `pnpm 09:owner-flow` | generate → sign → submit → status over raw HTTP |
| `03-execution.ts` | `pnpm 09:execution` | A delegated action with grant and idempotency headers |
| `04-native.ts` | `pnpm 09:native` | NEP-413 message signing with `X-Grant-Token`, then verifying the signature |
| `05-grant-exchange.ts` | `pnpm 09:grant-exchange` | A hand-signed key assertion traded at `/grants/token` for an `ngs_` session |
| `06-grant-proof.ts` | `pnpm 09:grant-proof` | A hand-built `X-Grant-Proof` for one request, with `node:crypto` only |

## curl cheatsheet

```sh
API=https://api.agentsonintents.com
KEY=...   # partner API key from the partner portal (opaque string, shown once)

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

# Native NEP-413 signing: grant token, no idempotency key. `nonce` is 32 random bytes, base64.
curl "$API/v1/agents/$AGENT_ID/native/near/sign-message" \
  -H "X-API-Key: $KEY" -H "X-Grant-Token: $GRANT_TOKEN" -H "Content-Type: application/json" \
  -d '{"recipient":"app.example.com","message":"Log in to app.example.com","nonce":"<32 bytes, base64>"}'

# Key-bound or OIDC grant: trade a JWT for a 15-minute session (RFC 8693). The subject token is an
# identity token from the platform, or an assertion the key signed (see 05-grant-exchange.ts).
curl "$API/v1/agents/$AGENT_ID/grants/token" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"grant_type":"urn:ietf:params:oauth:grant-type:token-exchange","subject_token":"'"$JWT"'","subject_token_type":"urn:ietf:params:oauth:token-type:jwt"}'
# -> {"access_token":"ngs_…","expires_in":900,…}; send it as X-Grant-Token like a grant token.

# Key-bound grant, no session: a proof the key signs for this exact request replaces X-Grant-Token.
# Never send both headers. Build the proof as in 06-grant-proof.ts.
curl "$API/v1/agents/$AGENT_ID/withdraw" \
  -H "X-API-Key: $KEY" -H "X-Grant-Proof: $PROOF" \
  -H "Idempotency-Key: preview-1" -H "Content-Type: application/json" \
  -d "$BODY"   # the exact bytes whose SHA-256 the proof names
```

## Parity with the SDK

| SDK | HTTP |
|---|---|
| `api.getAgent(id)` | `GET /v1/agents/{agent_id}` |
| `api.generateIntent(body, { idempotencyKey })` | `POST /v1/generate-intent` + `Idempotency-Key` |
| `api.getStatus(cid, { waitMs })` | `GET /v1/status?correlation_id=…&wait_ms=…` |
| `api.forGrant(t).swap(id, body, { idempotencyKey })` | `POST /v1/agents/{agent_id}/swap` + `X-Grant-Token` + `Idempotency-Key` |
| `api.deposit(id, body, { idempotencyKey })` | `POST /v1/agents/{agent_id}/deposit` (no grant) |
| `api.getOperationProof(id, cid, { from_size })` | `GET /v1/agents/{agent_id}/operations/{correlation_id}/proof?from_size=…` |
| `api.forGrant(t).nativeNearSignMessage(id, body)` | `POST /v1/agents/{agent_id}/native/near/sign-message` + `X-Grant-Token` |
| `api.forGrant(t).nativeNearTransfer(id, body, { idempotencyKey })` | `POST /v1/agents/{agent_id}/native/near/transfer` + `X-Grant-Token` + `Idempotency-Key` |
| `api.forGrant(t).nativeEvmSignTypedData(id, body)` | `POST /v1/agents/{agent_id}/native/evm/sign-typed-data` + `X-Grant-Token` |
| `api.exchangeGrantToken(id, { subject_token, grant_id? })` | `POST /v1/agents/{agent_id}/grants/token` (API key only, RFC 8693 JSON body) |
| `api.forGrantSession(id, { signer \| subjectToken, grantId?, refreshBeforeSeconds? })` | the exchange above, repeated before `expires_at`, then `X-Grant-Token: ngs_…` |
| `api.forGrantProof({ grantId, signer }).withdraw(id, body, { idempotencyKey })` | `POST /v1/agents/{agent_id}/withdraw` + `X-Grant-Proof` + `Idempotency-Key` |
| `api.forGrant(t).recover(id, body, { idempotencyKey })` | `POST /v1/agents/{agent_id}/recover` + `X-Grant-Token` + original `Idempotency-Key` |

`GET /openapi.json` is the full schema; `GET /llms.txt` is a compact guide for LLM callers.

Next: [10 · Recipes](../10-recipes/README.md).
