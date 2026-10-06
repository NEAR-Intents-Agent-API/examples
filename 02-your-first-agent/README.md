# 02 · Your first agent

Create one agent account, sign once, and read everything it owns.

| Example | Run | What it shows |
|---|---|---|
| `01-create-agent.ts` | `pnpm 02:create-agent` | The owner onboarding flow: `agent_create` → wallet signs → submit → active |
| `02-inspect-agent.ts` | `pnpm 02:inspect-agent` | Agent, wallet, policy, balances and history in one read |
| `03-multiple-agents.ts` | `pnpm 02:multiple-agents` | One owner, several agents (each with its own custody wallet) |

## The owner flow

```
your backend                     owner's wallet                 API
    │ generate-intent  ────────────────────────────────────────▶ intent {standard, payload}
    │ persist correlation_id
    │                  ── sign(payload) ──▶ signature
    │ submit-intent    ────────────────────────────────────────▶ status
    │ status?correlation_id=…         ─────────────────────────▶ SUCCESS
```

The wallet signs `intent.payload` **exactly as returned**. Your backend never rebuilds it. Select
the wallet method from `intent.standard`: `nep413` for off-chain consent, `nep366` for gasless
on-chain updates (NEAR), `eip712` (EVM), `webauthn` (passkey). See
[03 · Owner wallets](../03-owner-wallets/README.md).

`AGENT_ALLOW_WRITES=true` is required: creating an agent is an on-chain onboarding.

## What the policy controls

The single policy signed at creation caps everything the account can ever do, across every future
grant. Every field is required: `frozen`, `actions`, `confidential`, `owner_approval`, `assets`,
`limits`, `max_actions_per_hour`, `destinations`, `budget` and `timelock_ms`. The tight starter
policy allows one asset, one destination and transfers only; deleting the account stays
owner-only. Edit it any time with `policy_update`
(see [06 · Policy and lifecycle](../06-policy-and-lifecycle/README.md)).

Next: [03 · Owner wallets](../03-owner-wallets/README.md).
