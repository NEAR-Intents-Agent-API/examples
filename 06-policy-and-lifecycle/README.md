# 06 · Policy and lifecycle

The owner's policy is the account's rulebook; lifecycle actions freeze, archive or delete the
whole account. All of them are owner-signed (`generateIntent` → sign → submit).

| Example | Run | What it shows |
|---|---|---|
| `01-edit-policy.ts` | `pnpm 06:edit-policy` | Read → edit → sign the complete policy with `expected_revision` |
| `02-freeze-and-unfreeze.ts` | `pnpm 06:freeze` | Emergency stop and resume, with cooldowns |
| `03-archive-and-delete.ts` | `pnpm 06:archive-and-delete` | Archive/restore, and deletion with an assets guard |
| `04-schedule.ts` | `pnpm 06:schedule` | Limit money actions to weekly hours on the owner's clock; handle `policy_schedule_denied` |

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

- **API-enforced** (`destinations`, `budget`, `timelock_ms`, `schedule`): off-chain owner message,
  `transaction_hash: null`.
- **Provider-enforced** (`frozen`, `actions`, `confidential`, `owner_approval`, `assets`, `limits`,
  `max_actions_per_hour`, `sign`): on-chain wallet request, submitted gaslessly by the API's sponsor. The
  same request shape; the API picks the standard.

## Schedule

`schedule` is optional. It limits swaps, transfers and withdrawals to weekly windows in an IANA
time zone (`mode: "only"`), or pauses them inside the windows (`mode: "except"`):

```ts
schedule: {
  mode: "only",
  time_zone: "Europe/Berlin",
  windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "17:00" }],
}
```

`start` is inclusive and `end` exclusive; an `end` earlier than `start` runs past midnight and
belongs to its start day, and `24:00` closes the day. Hours follow daylight saving. An action is
judged when it would run (after `timelock_ms`), again at timelock release and at dispatch.
Outside the schedule the API answers `403 policy_schedule_denied` with `availableAt`; submit again
then with a new idempotency key. Deposits, identity signing (`sign`) and approval votes are never held.
Omit `schedule` in a `policy_update` to remove it.

## Cooldowns

Policy edits and freeze/unfreeze share a configurable cooldown (default 10
minutes). `agent.cooldowns.policy_change_available_at` and `unfreeze_available_at` say when the next
change is allowed. Pure freeze bypasses the policy cooldown; unfreeze has its own.

## Deletion is final

Deletion previews the exact assets that would be lost (`public`, `confidential`,
`assets_lost`). The owner empties the wallet first; the beneficiary receives only the account's
native NEAR. See `03-archive-and-delete.ts`.

Next: [07 · Identity signing](../07-identity-signing/README.md).
