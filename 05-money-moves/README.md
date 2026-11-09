# 05 · Money moves

Delegated actions run through a grant (or, for deposits, just the API key). Every action returns
a `correlation_id`; follow it with `GET /v1/status` until terminal. `dry: true` previews swaps,
limit orders and withdrawals without executing. A swap or limit-order preview needs only the API
key. A withdrawal preview needs the grant and an idempotency key (the SDK creates one). The API
sets no preview cap: each preview counts toward the wallet's 1,000 custody operations per rolling
24 hours at the provider.

No preview refuses for rules or balance. Every rule the live request would fail comes back in
`warnings`: `policy_action_denied`, `policy_destination_denied` and `insufficient_balance` (with
`available_amount`), beside the budget, limit and schedule codes, `high_fee` and
`asset_delivered_as_is`. Read them before you execute. An unlisted asset (`unsupported_token`) or an
invalid recipient (`invalid_address`) refuses the preview itself, before any provider call. So does
a token withdrawal to a NEAR account with no storage on that token's contract, such as a fresh 1Click
deposit address for NEAR USDC: it answers `invalid_address` (409). Register the receiver's storage
first (NEP-145 `storage_deposit`), or move the funds inside NEAR Intents.

| Example | Run | Policy must allow | Notes |
|---|---|---|---|
| `01-quote-and-swap.ts` | `pnpm 05:quote-and-swap` | `actions: ["swap"]` | Always quotes; live swap when `AGENT_EXECUTE=true` |
| `02-transfer.ts` | `pnpm 05:transfer` | `actions: ["transfer"]` + recipient | Moves between NEAR Intents accounts |
| `03-withdraw.ts` | `pnpm 05:withdraw` | `actions: ["withdraw"]` + chain address | Previews, then withdraws cross-chain |
| `04-deposit.ts` | `pnpm 05:deposit` | nothing | Issues an address (`origin_asset`, optional `amount`); no grant, refunds go to the agent |
| `05-private-balance.ts` | `pnpm 05:private-balance` | `confidential: true` | Public ↔ confidential balance |
| `06-approvals.ts` | `pnpm 05:approvals` | `owner_approval: true` | `PENDING_APPROVAL` → owner vote → settle |
| `07-limit-order.ts` | `pnpm 05:limit-order` | `actions: ["limit_order"]` | Previews with the API key alone; places a resting order when `AGENT_EXECUTE=true`; needs `AGENT_LIMIT_PRICE` |
| `08-limit-orders.ts` | `pnpm 05:limit-orders` | nothing (cancels need only a grant) | Lists, reads, cancels one, cancels all; cancels only when `AGENT_EXECUTE=true` |

## Limit orders

A limit order rests on the NEAR Intents order book until it fills, is cancelled or reaches its
`deadline` (default and maximum seven days). A `sell` spends `quantity` (atomic units) of the base
asset; a `buy` spends `ceil(quantity × price)` of the quote asset; `price` is quote units per one
whole base unit. The policy must list `limit_order` in `actions` (and `confidential` for
`confidential: true`). An optional `limit_order: { max_deviation_bps }` (0 to 300, default 100)
bounds how far worse than the market the price may be:

```ts
const request = await buildPolicyUpdate(api, agentId, (policy) => ({
  ...policy,
  actions: [...policy.actions, "limit_order"],
  limit_order: { max_deviation_bps: 50 },
}));
```

- The order runs the swap rules on the asset it spends (`assets`, `limits`, `max_actions_per_hour`,
  USD `budget`, `timelock_ms`, `schedule`, `owner_approval`); `destinations` does not apply. A
  cancel is exempt from all of them and needs only a live grant, so it works while the agent is
  frozen. The budget charged at placement is not given back.
- `SUCCESS` means funded and resting, not filled; `details.order_id` names the order.
- Refusals and warnings add `amount_too_low` (the order must be worth at least 0.1 USD),
  `policy_price_deviation_exceeded` and `market_price_unavailable` (no fresh price for either asset).
- Every order pays 1Click's fee (20 bps, in `app_fees`); it is not an API fee.
- Freezing the agent, or applying a policy without `limit_order`, makes the API cancel its resting
  orders. Deleting the agent is refused with `limit_orders_open` while any is not payout-final.

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
