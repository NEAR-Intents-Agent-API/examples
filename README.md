<div align="center">

# NEAR Intents Agent API: Examples

**Runnable, standalone scripts for every flow of the NEAR Intents Agent API.**

[Quick start](#quick-start) · [Examples](#examples) · [Safety](#safety) · [SDK or HTTP](#sdk-or-http) · [Support modules](#support-modules)

</div>

Create an agent account, sign its rules, delegate access, move funds, recover from failures and
verify an operation offline. Every script is short, documented and runs on its own with one API
key (`naa_…`) from the [partner dashboard](https://partners.near-intents.org/) (**API keys**; shown once).

This folder is self-contained: it imports nothing from the API repository. Copy it anywhere,
`pnpm install`, and it works.

## Quick start

Requirements: Node.js 24+ and pnpm.

```sh
cp .env.example .env
# Set NEAR_INTENTS_AGENT_API_URL (hosted: https://api.agentsonintents.com) and
# NEAR_INTENTS_AGENT_API_KEY. Add owner keys for the write examples.
pnpm install
pnpm 01:check-api        # read-only: verifies connectivity and your key
pnpm 01:list-tokens      # read-only: the asset catalog
```

> [!WARNING]
> The hosted API is mainnet with real funds. Creating an agent performs a real on-chain
> onboarding, so use a dedicated owner account that holds little value.

## Examples

Each numbered folder has its own README and numbered scripts. Every file starts with a doc header
(**what / when / needs / run**). Read them in order the first time, then use them as a reference.

| Folder | Topic | Writes? |
|---|---|---|
| [`01-getting-started`](01-getting-started/README.md) | Connectivity, token catalog | No |
| [`02-your-first-agent`](02-your-first-agent/README.md) | Onboarding, reading an account | Yes (on-chain) |
| [`03-owner-wallets`](03-owner-wallets/README.md) | NEAR, EVM and passkey owners | Yes |
| [`04-grants`](04-grants/README.md) | Delegated access: issue, use, revoke | Yes |
| [`05-money-moves`](05-money-moves/README.md) | Swap, transfer, withdraw, deposit, private balance, approvals | Yes |
| [`06-policy-and-lifecycle`](06-policy-and-lifecycle/README.md) | Edit rules, schedule hours, freeze, archive, delete | Yes |
| [`07-identity-signing`](07-identity-signing/README.md) | Agent proves its NEAR account to a service (NEP-413) | Some |
| [`08-errors-and-recovery`](08-errors-and-recovery/README.md) | Error codes, statuses, idempotency, recovery | Some |
| [`09-raw-http`](09-raw-http/README.md) | The same API with plain `fetch` and curl | Some |
| [`10-recipes`](10-recipes/README.md) | BFF, timelocks, AI assistants, full journey | Yes |
| [`11-verify-operations`](11-verify-operations/README.md) | Prove an execution's audit trail offline | No |

## Safety

- **Reads need only the API key.** Every example that changes state or spends checks
  `AGENT_ALLOW_WRITES=true` before its first request.
- **Dry-run first.** Swaps, withdrawals and delegated actions default to preview mode; set
  `AGENT_EXECUTE=true` to execute.
- **Never commit `.env`.** It is gitignored, as is `.intents/`, where the examples cache a grant
  token between scripts. A real backend stores it encrypted in its database.

## The model in one paragraph

An **agent** is one agent account: an agent wallet, one owner-signed **policy** and one USD usage
ledger. **Access belongs to a grant; rules belong to the account.** Your backend holds the API
key; the owner signs once to create the agent and once to issue each grant. The agent executes
inside NEAR Intents (public or confidential) under all controls at once: the grant (who may act,
until when), the policy (`actions`, `assets`, `limits`, `destinations`, owner approval, freeze),
the USD `budget`, the `timelock_ms` execution delay and the owner's `schedule` of hours. None
overrides another. The optional `sign` rule lets the agent prove its account to services the
owner lists; it is off by default and never covers the NEAR Intents contracts.

## SDK or HTTP

Every core flow exists in both forms:

- **SDK**, used by sections 01–08, 10 and 11, through `support/client.ts`.
- **Raw HTTP**, section [09-raw-http](09-raw-http/README.md), with a curl cheatsheet and a parity table.

`GET /openapi.json` has every schema; `GET /llms.txt` is a compact guide for LLM callers.

To use the SDK in your own project:

```sh
pnpm add @near-intents-agent-api/sdk
```

The examples also use `near-api-js` (NEAR owner signing) and `viem` (EVM owner signing). Passkeys
use `@simplewebauthn/browser` in your frontend.

## Support modules

`support/` holds documented helpers the examples share, not abstractions to hide behind.

| Module | Purpose |
|---|---|
| `env.ts`, `config.ts` | Validate the environment once (zod); typed config, `requireWrites`, `print` |
| `client.ts` | `agentApi()` built from `.env` |
| `flow.ts` | `runOwnerIntent`, `waitForStatus`, `buildPolicyUpdate`, `settleExecution`, `settleApprovedExecution`, `assertCanUnfreeze` |
| `policy.ts` | `transferPolicy` (tight) and `fullAccessPolicy` (broad), both complete `Policy` objects |
| `near-owner.ts`, `sign-near-intent.ts` | NEAR owner: keypair, NEP-413, NEP-366 |
| `evm-owner.ts` | EVM owner: `viem`, EIP-712 |
| `raw-http.ts` | Plain `fetch` transport |
| `destinations.ts`, `grant-store.ts`, `format.ts` | Typed destinations, example-only grant cache, atomic ↔ decimal conversion |
| `identity.ts` | Identity challenges and NEP-413 verification (the relying party's side) |

## Related

[api](https://github.com/NEAR-Intents-Agent-API/api) ·
[sdk-typescript](https://github.com/NEAR-Intents-Agent-API/sdk-typescript) ·
[skills](https://github.com/NEAR-Intents-Agent-API/skills) ·
[demo](https://github.com/NEAR-Intents-Agent-API/demo) ·
[agent-connect](https://github.com/NEAR-Intents-Agent-API/agent-connect)
