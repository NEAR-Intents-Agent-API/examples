# 08 · Errors and recovery

Read this before writing retry logic. Mistakes here cost real money.

| Example | Run | What it shows |
|---|---|---|
| `01-error-taxonomy.ts` | `pnpm 08:error-taxonomy` | `AgentApiError` fields and the codes you will actually see |
| `02-status-and-uncertain.ts` | `pnpm 08:status-and-uncertain` | Observing a status, `refresh`, and when recovery is legal |
| `03-idempotency.ts` | `pnpm 08:idempotency` | Stable keys, persisting before dispatch, replay behavior |
| `04-recover.ts` | `pnpm 08:recover <record.json>` | The three facts that make `/recover` legal, then recovery with the original key and grant |

## Branch on `code`, never `title`

Errors are JSON:API documents. `AgentApiError.code` is the first error's stable snake_case code;
`layer`, `retryable`, `availableAt`, `retryAfterSeconds` (the `Retry-After` header in whole seconds) and `requestId` are useful hints. Validation failures carry one
entry per field in `errors`.

Every error also names the layer that refused. Read it when you need to decide who acts next:

| `layer` | Whose rule | Next step |
|---|---|---|
| `request` | Shape, validation, idempotency, unknown ids, unsupported tokens, invalid addresses, amount minimums | Fix the input |
| `auth` | Partner API key, owner signature, nonce, intent | Fix the credential or sign again. `invalid_api_key`: check the key. `api_key_retired`: the key was created before the partner portal; create a new one in the portal |
| `grant` | Grant token missing, expired, revoked, limits on grants | Issue or use a live grant |
| `policy` | The account policy: action, asset, destination, schedule, per-asset and per-action limits, frozen | The owner changes the rules (or waits for the window) |
| `budget` | The USD budget and its price | The owner raises the budget, or wait for the period to reset |
| `balance` | The agent's balance | Fund the account or send less (`availableAmount` is what it can spend) |
| `provider` | OutLayer, 1Click, routes, provider quotas and refusals | Retry only if `retryable`, with the same key |
| `api` | This service: internal, database, rate limits | Retry only if `retryable`, with the same key |

`retryable: true` means the same Idempotency-Key can succeed; an absent flag proves nothing.

| Situation | Code | What to do |
|---|---|---|
| No grant on a spend | `agent_grant_required` | Issue a grant |
| Policy turns the action off | `policy_action_denied` | Owner enables it in the policy; no new grant |
| Destination outside the account rule | `policy_destination_denied` | Owner adds it to `policy.destinations`; no new grant |
| Provider policy refuses | `policy_denied` | Change the policy (owner) |
| USD budget exhausted | `spend_budget_exceeded` | Wait until that cap's `usage.budget.<window>.resets_at` (its period ends and the whole cap is back), or the owner raises it; a plain refusal, so a new request needs a new key |
| Per-asset limit or hourly action cap used up (shield and unshield count too) | `policy_limit_exceeded`, `policy_action_limit_exceeded` | Wait for the window or the owner raises it; a plain refusal, so a new request needs a new key |
| Earlier actions the API cannot count against a limit | `policy_usage_unavailable` | Nothing was sent; wait until they leave the window |
| Not enough available balance | `insufficient_balance` | Fund the account or send at most `availableAmount` |
| The agent's own NEAR account holds less NEAR than the operation needs (a native NEAR call, or any custody operation that costs NEAR) | `custody_native_balance_required` | Fund `wallet.near_account_id`; `minAmount` is the call's cost and `availableAmount` what the account holds, both in yoctoNEAR (`details.available_amount` repeats the latter) |
| Withdrawal to a NEAR account with no storage on the token's contract | `invalid_address` (409) | Register the receiver's storage (NEP-145), or move the funds inside NEAR Intents |
| Limit order priced too far from the market | `policy_price_deviation_exceeded` | Price within `limit_order.max_deviation_bps` of the market, or the owner raises it |
| No fresh price for a limit order's assets | `market_price_unavailable` | Retry later; nothing was sent |
| Amount below the route's minimum, or a limit order worth under 0.1 USD | `amount_too_low` | Send more (`minAmount` states the route's minimum) |
| Unknown limit order id | `limit_order_not_found` | Check the id (`listLimitOrders`) |
| Deleting an agent with resting limit orders | `limit_orders_open` | Freeze the account (the API cancels them), then withdraw and delete |
| Provider did not answer a quote | `provider_unavailable` | Retry the same request with the same key when `retryable` |
| No route for this pair or amount | `route_unavailable` | Repeating will not help; try another amount or pair |
| Malformed request | `validation_failed` | Fix the fields named in `errors` |
| Unknown operation id | `operation_not_found` | Check the correlation id |
| Outside the owner's schedule | `policy_schedule_denied` | Submit again at `availableAt` with a new key, or owner changes `schedule` |
| Policy not applied yet | `policy_not_ready` | Wait for `provider_policy_synced` |
| Wallet busy | `wallet_busy` | Retry after the current dispatch |
| Frozen | `wallet_frozen` | Owner unfreezes |
| Creation quota | `agent_creation_quota_exceeded` | Back off until `availableAt` |
| Deposit quota | `deposit_quota_exceeded` | Back off until `availableAt` |
| Throttled | `policy_change_throttled`, `agent_unfreeze_throttled` | Back off until `availableAt` |
| Stale policy revision | `policy_revision_conflict` | Read again, generate fresh |
| Native refused | `signing_recipient_forbidden`, `signing_policy_denied`, `native_method_denied`, `native_contract_forbidden` | See [07 · Native accounts](../07-native-accounts/README.md#refusals) |

Budget and limit refusals (`spend_budget_exceeded`, `spend_price_unavailable`,
`policy_limit_exceeded`, `policy_action_limit_exceeded`, `policy_usage_unavailable`) on a request
that runs now are plain refusals: no operation exists, nothing is charged, and there is no `FAILED`
status to read. Retrying the same key refuses again. Work held by a timelock is judged when it
dispatches. `quote_unavailable`, `invalid_request` and `status_not_found` no longer exist; they are
`provider_unavailable`, `validation_failed` and `operation_not_found`.

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
- `details.amount_out` is final and appears only on `SUCCESS` (or `REFUNDED` after a partial fill).
  Before that, read `details.expected_amount_out`, an estimate.
- An unpaid deposit ends `FAILED` with `deposit_expired` one day after its `expires_at`; a late
  payment is refunded to `refund_to`.
- `UNCERTAIN`: **never submit a new request with a new key.** Observe the original correlation id.
- `NEEDS_REVIEW`: stop polling. Inspect `details.reason`, keep the budget charged, then after
  provider/manual resolution call `getStatus(correlation_id, { refresh: true })`.
- `/recover`: only dispatches work that provably never reached the provider (`UNCERTAIN`, no
  `dispatch_committed_at`, no `details.provider_request_id`). It is not an override for
  uncertainty: it needs the original body, idempotency key and grant, and otherwise answers
  `operation_not_recoverable`. See `04-recover.ts`.
- To prove afterwards what was recorded for an execution, fetch its operation proof and verify it
  offline: [11 · Verify operations](../11-verify-operations/README.md).

## Idempotency in one paragraph

An `Idempotency-Key` names one logical request. Same key + same body = the same work (replay);
same key + different body = `idempotency_conflict`. Generate the key, **persist it with your
intent**, then send. On a transport error, retry with that stored key. Never let a process
restart mint a fresh key for work that may already have happened.

Next: [09 · Raw HTTP](../09-raw-http/README.md).
