# 05 · Money moves

Delegated actions run through a grant (or, for deposits, just the API key). Every action returns
a `correlation_id`; follow it with `GET /v1/status` until terminal. `dry: true` previews swaps and
withdrawals without executing. A swap quote needs only the API key. A withdrawal preview needs the
grant and an idempotency key (the SDK creates one), and each agent gets 20 previews per rolling 24
hours, failed ones included (a refusal the provider states before it quotes gives its attempt
back).

Neither preview refuses for rules or balance. Every check the live request would fail comes back in
`warnings`: `policy_action_denied`, `policy_destination_denied`, `unsupported_token`,
`invalid_address` and `insufficient_balance` (with `available_amount`), beside the budget, limit and
schedule codes, `high_fee` and `asset_delivered_as_is`. Read them before you execute.

| Example | Run | Policy must allow | Notes |
|---|---|---|---|
| `01-quote-and-swap.ts` | `pnpm 05:quote-and-swap` | `actions: ["swap"]` | Always quotes; live swap when `AGENT_EXECUTE=true` |
| `02-transfer.ts` | `pnpm 05:transfer` | `actions: ["transfer"]` + recipient | Moves between NEAR Intents accounts |
| `03-withdraw.ts` | `pnpm 05:withdraw` | `actions: ["withdraw"]` + chain address | Previews, then withdraws cross-chain |
| `04-deposit.ts` | `pnpm 05:deposit` | nothing | Issues an address (`origin_asset`, optional `amount`); no grant, refunds go to the agent |
| `05-private-balance.ts` | `pnpm 05:private-balance` | `confidential: true` | Public ↔ confidential balance |
| `06-approvals.ts` | `pnpm 05:approvals` | `owner_approval: true` | `PENDING_APPROVAL` → owner vote → settle |

## Read this once: statuses

- Keep polling `PROCESSING` and `QUEUED`.
- `PENDING_DEPOSIT` waits for external funds; `PENDING_APPROVAL` waits for the owner.
- `UNCERTAIN` means the outcome is unknown. **Never resubmit with a new key** — poll or
  reconcile the original `correlation_id`.
- `details.amount_out` is final and present only on `SUCCESS` (or `REFUNDED` after a partial fill);
  until then `details.expected_amount_out` is an estimate.
- `NEEDS_REVIEW` stops automatic polling. Inspect `details.reason`; after provider/manual
  resolution, call `getStatus(correlation_id, { refresh: true })`.

See [08 · Errors and recovery](../08-errors-and-recovery/README.md) for the full machine.

Next: [06 · Policy and lifecycle](../06-policy-and-lifecycle/README.md).
