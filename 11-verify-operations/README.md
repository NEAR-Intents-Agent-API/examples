# 11 · Verify operations

Every audit event the API records goes into an append-only transparency log whose checkpoints are
signed by keys that exist only inside the API's attested enclave. An operation proof lets anyone
check, without trusting the operator, what was recorded for one execution and that nothing was
removed or rewritten afterwards. A signed log alone cannot prove it was not rolled back, so you
also pass a trusted checkpoint: the head of the checkpoint witness, which you read and verify with a
witness key you pinned.

| Example | Run | What it shows |
|---|---|---|
| `01-verify-operation.ts` | `pnpm 11:verify-operation [op_…]` | Read the witness head, fetch an execution's proof that extends it, and check it with `verifyOperationProof` |
| `02-payment-receipt.ts` | `pnpm 11:payment-receipt` | Transfer with a `reference` and a `note`, read and list its receipt, verify it as a payee with `verifyPaymentReceipt` (writes: needs `AGENT_ALLOW_WRITES=true`) |

## Fetch and verify

```ts
import { fetchWitnessCheckpoint, verifyOperationProof } from "@near-intents-agent-api/sdk";

// Pin both yourself; never take them from an API response.
const origin = "api.agentsonintents.com/log";
const witnessKey = "598165a18b588f504e159c0e2573d73983ae22bf15cf80d36902276d63a11101";

// The trusted head, signed by the witness key. Fetch it right before the proof.
const head = await fetchWitnessCheckpoint("https://api.agentsonintents.com", origin, witnessKey);
const proof = await api.getOperationProof(agentId, correlationId, { from_size: String(head.size) }); // an `op_…` execution id
const verified = verifyOperationProof(proof, origin, head);
// verified.proven: [{ index, fields: { action, createdAt, … }, checkpoint, cosignedAt, evidence }]
// verified.pending / verified.unlogged: counts of events not (yet) provable
```

`verifyOperationProof` checks that:

1. the proof's checkpoint extends the trusted `head`: a smaller tree, a fork or a missing
   consistency path is refused;
2. the notary keys belong to the pinned origin and match the birth attestation's `report_data`;
3. each checkpoint carries the log's signature and the notary's timestamped cosignature;
4. each event's opening hashes to a leaf that checkpoint includes, and names this execution, its
   action and its time;
5. each event's `evidence`, the result it recorded with any settlement transaction hashes, hashes to
   the opening's `evidenceHash`. It comes back parsed; `null` when the API served none.

A proof that does not hold, a log that does not extend the witness head, or evidence altered after
it was committed throws `NoteError` or `ProofError`. If the API's log has not yet reached the witness
head, `getOperationProof` answers `409 transparency_checkpoint_behind`; nothing is wrong with the
proof, so run it again in a moment (the example prints this instead of failing).

| Event status | Meaning |
|---|---|
| `PROVEN` | In the latest signed checkpoint; carries a `c2sp.org/tlog-proof@v1` |
| `PENDING` | Recorded, waiting for the next checkpoint (seconds to minutes) |
| `UNLOGGED` | Recorded before the log started |

## Receipts

A completed transfer, withdrawal, swap, limit order or deposit has a **receipt**: its own leaf of the
same log, written when the execution settles. It commits only to the settled terms, the
execution's id and the time, so it names no agent, account or grant and is safe to hand to a payee,
who verifies it without an API key. It does not prove who paid; hand over the operation proof as
well when identity matters.

```ts
import {
  fetchWitnessCheckpoint,
  logTileReader,
  verifyPaymentReceipt,
} from "@near-intents-agent-api/sdk";

// Pay with a reference the payee issued. `note` stays with the owner and never enters the receipt.
const { correlation_id } = await bot.transfer(
  agentId,
  { asset, amount, recipient, reference: "order-123", note: "Invoice 123" },
  { idempotencyKey },
);

const item = await api.getReceipt(agentId, correlation_id); // `receipt` is null while `PENDING`
const page = await api.listReceipts(agentId, { type: "transfer" }); // newest first

// The payee, with only `item.receipt` and what it is owed:
const verified = await verifyPaymentReceipt(item.receipt, {
  origin,
  trusted: await fetchWitnessCheckpoint(apiUrl, origin, witnessKey),
  readTile: logTileReader("https://log.agentsonintents.com/"),
  expect: { recipient, asset, amount, reference: "order-123" },
});
```

- `verifyReceipt` checks any receipt and returns its terms; `verifyPaymentReceipt` also checks the
  exact recipient, asset, amount and reference (plus `chain` and `memo` for a withdrawal) of a
  transfer or withdrawal.
- Leaving `expect.confidential` out accepts a confidential payment only, the account's default. A
  payment from the legacy public balance (a withdrawal sent with `confidential: false`) needs
  `expect.confidential: false`.
- A withdrawal's `amount` is the debit, fees come out of it, so the receipt does not prove what
  arrived; read `amountOut` or the destination chain. A limit order's receipt proves it was funded
  and placed, not filled.
- `ReceiptNotCoveredError` (the trusted head is older than the receipt) and `LogUnavailableError`
  say nothing about the receipt: fetch a newer head or wait, then verify again. `NoteError` or
  `ProofError` means it does not prove the settlement.
- A receipt lasts as long as the audit log keeps it (90 days). Executions settled before receipts
  existed have none, and native signing routes, shield and unshield never do.
- The log's tiles are read from `AGENT_LOG_URL` (default `https://log.agentsonintents.com/`).

## Pin the origin and the witness key

The origin is `<API host>/log`: `api.agentsonintents.com/log` for the hosted API. It defaults to
the host of `NEAR_INTENTS_AGENT_API_URL`; set `AGENT_LOG_ORIGIN` to pin it explicitly. The witness
key defaults to the hosted API's (`598165a1…1101`); set `AGENT_WITNESS_KEY` when your API is another
deployment. Never take either from an API response; they are the values the check compares
against. The witness is read over HTTPS only. A deployment without a log answers
`501 transparency_log_disabled`.

## The last step: attested keys

The SDK checks signatures, not where the keys came from. To tie them to the attested code, verify
the notary's TDX birth quote in `proof.notary.birth` with a quote verifier such as
dstack-verifier and compare its `report_data` with
`verified.birthReportData`. The public log tiles are served at `https://log.agentsonintents.com/`.

`01-verify-operation.ts` needs the partner API key and `AGENT_ID` (it lists the agent's history and
reads its proof), so it is not a keyless read.

Next: [back to the examples index](../README.md).
