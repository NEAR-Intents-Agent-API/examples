/**
 * Pay with a reference, then read, list and verify the receipt.
 *
 * What: sends a confidential transfer with a `reference` and a `note`, reads its receipt, lists the
 *       agent's transfer receipts, and verifies the receipt the way a payee would: against a
 *       witness-signed checkpoint and the log's public tiles, with `verifyPaymentReceipt`.
 * When: you pay someone and want them to check the payment without an API key, or you want a
 *       receipt to keep with your own records.
 * Needs: `AGENT_ALLOW_WRITES=true`, `NEAR_INTENTS_AGENT_API_KEY`, `AGENT_ID`, `AGENT_RECIPIENT`, a
 *        stored grant, and a policy whose `actions` include `transfer` and whose `destinations`
 *        allow that recipient as a confidential account. `AGENT_LOG_ORIGIN`, `AGENT_LOG_URL` and
 *        `AGENT_WITNESS_KEY` when your API is not the hosted one.
 * Run: `pnpm 11:payment-receipt`
 *
 * `reference` (1 to 128 printable ASCII characters, no spaces) is the payer's and payee's shared
 * handle for the payment, such as an order id. It goes into the receipt and nowhere else: never to
 * the provider or on chain. `note` is the agent's own words (up to 500 characters, one line) for
 * the owner: it is kept in the account's records and shown in `details`, and never enters the
 * receipt. A receipt commits only to the settled terms, the execution's id and the time; it names
 * no agent, account or grant, so it is safe to hand to the payee, who does not prove who paid by
 * holding it. Hand over the operation proof as well when identity matters (11/01).
 *
 * A receipt appears as `PENDING` until a published checkpoint covers it (seconds to minutes), then
 * `PROVEN`; this example reads again until it is. To verify, pin the origin, the log URL and the
 * witness key yourself, never from an API response, and read a fresh witnessed head. A receipt
 * newer than that head throws `ReceiptNotCoveredError` and a log that does not serve a tile throws
 * `LogUnavailableError`: both say nothing about the receipt, so verify again a moment later.
 * `NoteError` or `ProofError` means the receipt does not prove the payment.
 *
 * `verifyPaymentReceipt` also checks the exact recipient, asset, amount and reference you expect,
 * and refuses anything that is not a transfer or withdrawal. A payee accepts each `correlationId`
 * once. Leaving `expect.confidential` out accepts a confidential payment only, the account's
 * default; it settles on the provider's word with nothing to check on chain. A payment from the
 * legacy public balance (a withdrawal sent with `confidential: false`) matches only
 * `expect.confidential: false`. To check a withdrawal, add its `chain` and `memo` to `expect`; a
 * withdrawal's `amount` is the debit, so confirm what arrived from `amountOut` or on the chain.
 */
import { setTimeout as sleep } from "node:timers/promises";
import {
  createIdempotencyKey,
  fetchWitnessCheckpoint,
  LogUnavailableError,
  logTileReader,
  NoteError,
  ProofError,
  type Receipt,
  ReceiptNotCoveredError,
  verifyPaymentReceipt,
} from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { settleExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

/** How long to wait for a checkpoint to cover the receipt. */
const WAIT_MS = 3 * 60_000;

/** Reads the receipt until its checkpoint is published: `PENDING` carries none yet. */
async function provenReceipt(agentId: string, correlationId: string) {
  const api = agentApi();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const item = await api.getReceipt(agentId, correlationId);
    if (item.status !== "PENDING" || Date.now() > deadline) return item;
    await sleep(5_000);
  }
}

export async function paymentReceipt(agentId: string) {
  const { apiUrl, logOrigin, logUrl, witnessKey, token, transferAmount } = config();
  const api = agentApi();
  const recipient = required(config().recipient, "AGENT_RECIPIENT");
  const stored = await loadGrant(agentId);

  // The payee issues the reference, one per order. Generated here to keep the example whole.
  const reference = `order-${crypto.randomUUID()}`;
  const status = await settleExecution(
    api,
    api.forGrant(stored.token).transfer(
      agentId,
      {
        asset: token,
        amount: transferAmount,
        recipient,
        reference,
        note: "Example payment, receipt walkthrough",
      },
      { idempotencyKey: createIdempotencyKey() },
    ),
  );
  if (status.status !== "SUCCESS")
    return {
      correlation_id: status.correlation_id,
      status: status.status,
      failure_code: status.failure_code,
    };

  // The account's view: the settled terms plus what only the owner is shown (`note`, `usd_value`,
  // `grant_id`, `policy_epoch`). `receipt` is what the payee gets.
  const item = await provenReceipt(agentId, status.correlation_id);

  // Newest first; `type` narrows the list. With `type`, a page may come short while `next_cursor`
  // is set, so read on until it is null.
  const page = await api.listReceipts(agentId, { type: "transfer", limit: 5 });

  if (!item.receipt)
    return {
      correlation_id: status.correlation_id,
      receipt_status: item.status,
      details: item.details,
      verified: false,
      reason: "No receipt to verify yet: no checkpoint covers it. Read it again in a moment.",
    };

  // From here on, only `receipt` and what the payee expects are used: this is the payee's side.
  const receipt: Receipt = item.receipt;
  const readTile = logTileReader(logUrl);
  const deadline = Date.now() + WAIT_MS;
  try {
    for (;;) {
      // Fetch the trusted head signed by the pinned witness key right before each attempt.
      const trusted = await fetchWitnessCheckpoint(apiUrl, logOrigin, witnessKey);
      try {
        const payment = await verifyPaymentReceipt(receipt, {
          origin: logOrigin,
          trusted,
          readTile,
          expect: { recipient, asset: token, amount: transferAmount, reference },
        });
        return {
          correlation_id: status.correlation_id,
          receipt_status: item.status,
          details: item.details,
          listed: {
            correlation_ids: page.data.map((entry) => entry.correlation_id),
            more: page.next_cursor !== null,
          },
          verified: true,
          payment: { ...payment, leafIndex: payment.leafIndex.toString() },
        };
      } catch (error) {
        const retryable =
          error instanceof ReceiptNotCoveredError || error instanceof LogUnavailableError;
        if (!retryable || Date.now() > deadline) throw error;
        await sleep(5_000);
      }
    }
  } catch (error) {
    // Not covered or unreachable says nothing about the receipt; the rest means it does not hold.
    if (error instanceof ReceiptNotCoveredError || error instanceof LogUnavailableError)
      return { verified: false, retry_later: true, reason: `${error.name}: ${error.message}` };
    if (error instanceof NoteError || error instanceof ProofError)
      return { verified: false, reason: `${error.name}: ${error.message}` };
    throw error;
  }
}

if (isMainModule(import.meta.url)) {
  requireWrites("sending a payment");
  banner(["Paying with a reference, then verifying the receipt…"]);
  void paymentReceipt(required(config().agentId, "AGENT_ID")).then(print);
}
