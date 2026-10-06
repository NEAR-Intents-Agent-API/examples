# 08 · Errors and recovery

Read this before writing retry logic. Mistakes here cost real money.

| Example | Run | What it shows |
|---|---|---|
| `01-error-taxonomy.ts` | `pnpm 08:error-taxonomy` | `AgentApiError` fields and the codes you will actually see |
| `02-status-and-uncertain.ts` | `pnpm 08:status-and-uncertain` | Observing a status, `refresh`, and when recovery is legal |
| `03-idempotency.ts` | `pnpm 08:idempotency` | Stable keys, persisting before dispatch, replay behavior |

## Branch on `code`, never `title`

Errors are JSON:API documents. `AgentApiError.code` is the first error's stable snake_case code;
`retryable`, `availableAt` and `requestId` are useful hints. Validation failures carry one entry
per field in `errors`.

| Situation | Code | What to do |
|---|---|---|
| No grant on a spend | `agent_grant_required` | Issue a grant |
| Policy turns the action off | `policy_action_denied` | Owner enables it in the policy; no new grant |
| Destination outside the account rule | `policy_destination_denied` | Owner adds it to `policy.destinations`; no new grant |
| Provider policy refuses | `policy_denied` | Change the policy (owner) |
| USD budget exhausted | `spend_budget_exceeded` | Wait for the window or raise the cap |
| Policy not applied yet | `policy_not_ready` | Wait for `provider_policy_synced` |
| Wallet busy | `wallet_busy` | Retry after the current dispatch |
| Frozen | `wallet_frozen` | Owner unfreezes |
| Creation quota | `agent_creation_quota_exceeded` | Back off until `availableAt` |
| Deposit quota | `deposit_quota_exceeded` | Back off until `availableAt` |
| Throttled | `policy_change_throttled`, `agent_unfreeze_throttled` | Back off until `availableAt` |
| Stale policy revision | `policy_revision_conflict` | Read again, generate fresh |

## The status machine

```
PENDING_SIGNATURE ──sign──▶ PROCESSING ──▶ SUCCESS | FAILED | REFUNDED
PENDING_DEPOSIT ──funds──▶ PROCESSING ──▶ …
PENDING_APPROVAL ──vote──▶ PROCESSING ──▶ …
QUEUED ──timelock──▶ PROCESSING ──▶ …
PROCESSING ──lost evidence──▶ UNCERTAIN ──reconcile──▶ …
PROCESSING ──provider cannot tell──▶ NEEDS_REVIEW ──refresh──▶ …
```

Rules:

- Poll `PROCESSING`/`QUEUED`. `waitMs` long-polls at most 30 s.
- `UNCERTAIN`: **never submit a new request with a new key.** Observe the original correlation id.
- `NEEDS_REVIEW`: stop polling. Inspect `details.reason`, keep the budget charged, then after
  provider/manual resolution call `getStatus(correlation_id, { refresh: true })`.
- `/recover`: only dispatches work that provably never reached the provider. It is not an
  override for uncertainty and needs the original idempotency key.

## Idempotency in one paragraph

An `Idempotency-Key` names one logical request. Same key + same body = the same work (replay);
same key + different body = `idempotency_conflict`. Generate the key, **persist it with your
intent**, then send. On a transport error, retry with that stored key. Never let a process
restart mint a fresh key for work that may already have happened.

Next: [09 · Raw HTTP](../09-raw-http/README.md).
