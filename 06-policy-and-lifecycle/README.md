# 06 · Policy and lifecycle

The owner's policy is the account's rulebook; lifecycle actions freeze, archive or delete the
whole account. All of them are owner-signed (`generateIntent` → sign → submit).

| Example | Run | What it shows |
|---|---|---|
| `01-edit-policy.ts` | `pnpm 06:edit-policy` | Read → edit → sign the complete policy with `expected_revision` |
| `02-freeze-and-unfreeze.ts` | `pnpm 06:freeze` | Emergency stop and resume, with cooldowns |
| `03-archive-and-delete.ts` | `pnpm 06:archive-and-delete` | Archive/restore, and deletion with an assets guard |

## Editing a policy

Read the complete policy, change the sections you want, and submit the **whole** object with the
current revision:

```ts
const current = await api.getPolicy(agentId);
const generated = await api.generateIntent({
  type: "policy_update",
  agent_id,
  expected_revision: current.revision,
  policy: { ...current.policy, budget: { daily_usd: "100", weekly_usd: "500", monthly_usd: null } },
});
```

Every policy field is required and nothing is merged, so always start from the current policy. On
`policy_revision_conflict`, read again and generate a fresh intent. A signed revision is not in
force until `/policy` shows `APPLIED` with `provider_policy_synced: true`; until then executions
fail with `policy_not_ready`.

## Local vs provider changes

- **API-enforced** (`destinations`, `budget`, `timelock_ms`): off-chain owner message,
  `transaction_hash: null`.
- **Provider-enforced** (`frozen`, `actions`, `confidential`, `owner_approval`, `assets`, `limits`,
  `max_actions_per_hour`): on-chain wallet request, submitted gaslessly by the API's sponsor. The
  same request shape; the API picks the standard.

## Cooldowns

Policy edits and freeze/unfreeze share a configurable cooldown (default 10
minutes). `agent.cooldowns.policy_change_available_at` and `unfreeze_available_at` say when the next
change is allowed. Pure freeze bypasses the policy cooldown; unfreeze has its own.

## Deletion is final

Deletion previews the exact assets that would be lost (`public`, `confidential`,
`assets_lost`). The owner empties the wallet first; the beneficiary receives only the account's
native NEAR. See `03-archive-and-delete.ts`.

Next: [08 · Errors and recovery](../08-errors-and-recovery/README.md).
