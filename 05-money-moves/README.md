# 05 · Money moves

Delegated actions run through a grant (or, for deposits, just the API key). Every action returns
a `correlation_id`; follow it with `GET /v1/status` until terminal. `dry: true` previews swaps and
withdrawals without executing and needs no idempotency key.

| Example | Run | Policy must allow | Notes |
|---|---|---|---|
| `01-quote-and-swap.ts` | `pnpm 05:quote-and-swap` | `actions: ["swap"]` | Always quotes; live swap when `AGENT_EXECUTE=true` |
| `02-transfer.ts` | `pnpm 05:transfer` | `actions: ["transfer"]` + recipient | Moves between NEAR Intents accounts |
| `03-withdraw.ts` | `pnpm 05:withdraw` | `actions: ["withdraw"]` + chain address | Previews, then withdraws cross-chain |
| `04-deposit.ts` | `pnpm 05:deposit` | nothing | Issues an address; inbound funding needs no grant |
| `05-private-balance.ts` | `pnpm 05:private-balance` | `confidential: true` | Public ↔ confidential balance |
| `06-approvals.ts` | `pnpm 05:approvals` | `owner_approval: true` | `PENDING_APPROVAL` → owner vote → settle |

## Read this once: statuses

- Keep polling `PROCESSING` and `QUEUED`.
- `PENDING_DEPOSIT` waits for external funds; `PENDING_APPROVAL` waits for the owner.
- `UNCERTAIN` means the outcome is unknown. **Never resubmit with a new key** — poll or
  reconcile the original `correlation_id`.
- `NEEDS_REVIEW` stops automatic polling. Inspect `details.reason`; after provider/manual
  resolution, call `getStatus(correlation_id, { refresh: true })`.

See [08 · Errors and recovery](../08-errors-and-recovery/README.md) for the full machine.

Next: [06 · Policy and lifecycle](../06-policy-and-lifecycle/README.md).
