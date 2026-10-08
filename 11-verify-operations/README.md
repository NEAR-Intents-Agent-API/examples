# 11 · Verify operations

Every audit event the API records goes into an append-only transparency log whose checkpoints are
signed by keys that exist only inside the API's attested enclave. An operation proof lets anyone
check, offline and without trusting the operator, what was recorded for one execution and that
nothing was removed or rewritten afterwards.

| Example | Run | What it shows |
|---|---|---|
| `01-verify-operation.ts` | `pnpm 11:verify-operation [op_…]` | Fetch an execution's proof and check it with `verifyOperationProof` |

## Fetch and verify

```ts
import { verifyOperationProof } from "@near-intents-agent-api/sdk";

const proof = await api.getOperationProof(agentId, correlationId); // an `op_…` execution id
const verified = verifyOperationProof(proof, "api.agentsonintents.com/log"); // pin the origin
// verified.proven: [{ index, fields: { action, createdAt, … }, checkpoint, cosignedAt, evidence }]
// verified.pending / verified.unlogged: counts of events not (yet) provable
```

`verifyOperationProof` checks that:

1. the notary keys belong to the pinned origin and match the birth attestation's `report_data`;
2. each checkpoint carries the log's signature and the notary's timestamped cosignature;
3. each event's opening hashes to a leaf that checkpoint includes, and names this execution, its
   action and its time;
4. each event's `evidence`, the result it recorded with any settlement transaction hashes, hashes to
   the opening's `evidenceHash`. It comes back parsed; `null` when the API served none.

A proof that does not hold, or evidence altered after it was committed, throws `NoteError` or
`ProofError`.

| Event status | Meaning |
|---|---|
| `PROVEN` | In the latest signed checkpoint; carries a `c2sp.org/tlog-proof@v1` |
| `PENDING` | Recorded, waiting for the next checkpoint (seconds to minutes) |
| `UNLOGGED` | Recorded before the log started |

## Pin the origin

The origin is `<API host>/log`: `api.agentsonintents.com/log` for the hosted API. Set
`AGENT_LOG_ORIGIN` for another deployment. Never take it from the proof itself; that is the value
the check compares against. A deployment without a log answers `501 transparency_log_disabled`.

## The last step: attested keys

The SDK checks signatures, not where the keys came from. To tie them to the attested code, verify
the notary's TDX birth quote in `proof.notary.birth` with a quote verifier such as
dstack-verifier and compare its `report_data` with
`verified.birthReportData`. The public log tiles are served at `https://log.agentsonintents.com/`.

Next: [back to the examples index](../README.md).
