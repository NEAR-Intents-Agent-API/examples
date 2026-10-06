# NEAR Intents Agent API — Examples

Runnable, standalone examples for the NEAR Intents Agent API. You need two things: the API URL
of your deployment and one API key (`naa_…`), both from your dashboard. Paste them into `.env`
and run.

This folder is self-contained: it does not import this repository's internal packages, tests or
apps. Copy it anywhere, `pnpm install`, and it works.

## Quickstart

```sh
cd examples
cp .env.example .env
# Edit .env: AGENT_API_URL and AGENT_API_KEY. Add owner keys for write examples.
pnpm install
pnpm 01:check-api        # read-only: verifies connectivity and your key
pnpm 01:list-tokens      # read-only: the asset catalog
```

Node.js 24+ and pnpm.

## How to read these examples

Each numbered folder is a topic with its own README and numbered scripts. Every file starts with
a doc header (**what / when / needs / run**). Read them in order the first time; afterwards use
the folders as a reference.

| Folder | Topic | Writes? |
|---|---|---|
| [`01-getting-started`](01-getting-started/README.md) | Connectivity, token catalog | No |
| [`02-your-first-agent`](02-your-first-agent/README.md) | Onboarding, reading an account | Yes (on-chain) |
| [`03-owner-wallets`](03-owner-wallets/README.md) | NEAR, EVM and passkey owners | Yes |
| [`04-grants`](04-grants/README.md) | Delegated access: issue, use, revoke | Yes |
| [`05-money-moves`](05-money-moves/README.md) | Swap, transfer, withdraw, deposit, private, approvals | Yes |
| [`06-policy-and-lifecycle`](06-policy-and-lifecycle/README.md) | Edit rules, freeze, archive, delete | Yes |
| [`08-errors-and-recovery`](08-errors-and-recovery/README.md) | Error codes, statuses, idempotency | Some |
| [`09-raw-http`](09-raw-http/README.md) | The same API with plain `fetch` + curl | Some |
| [`10-recipes`](10-recipes/README.md) | BFF, timelocks, AI assistants, full journey | Yes |

## Safety

- **Reads need nothing but the API key.** Every example that changes state or spends checks
  `AGENT_ALLOW_WRITES=true` before its first request.
- **Dry-run first.** Swaps, withdrawals and delegated actions default to preview mode; set
  `AGENT_EXECUTE=true` to actually execute.
- **Owner keys are real.** Creating an agent performs a real on-chain onboarding. Use a dedicated
  account for examples.
- **Never commit `.env`.** It is gitignored; so is `.intents/`, where these examples cache a
  grant token between scripts (a real backend stores it encrypted in its database).

## SDK or HTTP

Every core flow exists in both forms:

- SDK: what `support/client.ts` wraps, used by sections 01–06, 08, 10.
- Raw HTTP: section [09-raw-http](09-raw-http/README.md), including a curl cheatsheet and a
  parity table. `GET /openapi.json` has every schema; `GET /llms.txt` is a compact guide for
  LLM callers.

### Installing the SDK in your own project

The SDK is `@near-intents-agent-api/sdk`, a thin typed HTTP client: one method per endpoint,
JSON:API errors, no wallet signers and no automatic retries. Install it from npm:

```sh
pnpm add @near-intents-agent-api/sdk
```

Dependencies used by the examples: `near-api-js` (NEAR owner signing), `viem` (EVM owner
signing). Passkeys use `@simplewebauthn/browser` in your frontend.

## Support modules

`support/` holds documented helpers the examples share, not abstractions to hide behind:

| Module | Purpose |
|---|---|
| `config.ts` | Loads `.env`, typed config, `requireWrites`, `print` |
| `client.ts` | `agentApi()` built from `.env` |
| `flow.ts` | `runOwnerIntent`, `waitForStatus`, `buildPolicyUpdate`, `settleExecution` |
| `policy.ts` | `transferPolicy` (tight) and `fullAccessPolicy` (broad), both complete `Policy` objects |
| `near-owner.ts` / `sign-near-intent.ts` | NEAR owner: keypair, NEP-413, NEP-366 |
| `evm-owner.ts` | EVM owner: `viem`, EIP-712 |
| `raw-http.ts` | Plain `fetch` transport |
| `destinations.ts` | Typed policy destinations |
| `grant-store.ts` | Example-only grant token cache (`.intents/`) |
| `format.ts` | Atomic ↔ decimal conversion |

## The model in one paragraph

An **agent** is one financial account: a custody wallet, one owner-signed **policy**, and one USD
usage ledger. **Access belongs to a grant; rules belong to the account.** Your backend holds the
API key; the owner signs once to create the agent and to issue each grant. The agent executes
inside NEAR Intents (public or confidential) under all controls at once: the grant (who may act,
until when), the policy (`actions`, `assets`, `limits`, `destinations`, owner approval, freeze),
the USD `budget` and the `timelock_ms` execution delay. None overrides another. The API handles authorization,
owner-signed intents, sponsored gas, operation state and reconciliation.
