import { setTimeout as sleep } from "node:timers/promises";
import type { OneClickQuote } from "@near-intents-agent-api/sdk";
import { config } from "./config.js";

/**
 * A minimal client for the 1Click API (https://docs.near-intents.org), the quote and swap service
 * of NEAR Intents. It is not part of the Agent API: the examples call it with plain `fetch`, as
 * your backend would. The Agent API only signs; it checks 1Click's signature on the quote you
 * send with the payload before it signs a transfer to a deposit address.
 *
 * `ONE_CLICK_API_KEY` is optional. It is sent as a bearer token and stays on your backend.
 */
const oneClickUrl = "https://1click.chaindefuser.com";

export class OneClickError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`1Click HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "OneClickError";
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { oneClickApiKey } = config();
  const response = await fetch(oneClickUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(oneClickApiKey ? { authorization: `Bearer ${oneClickApiKey}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new OneClickError(response.status, text);
  return JSON.parse(text) as T;
}

/** Account type of both sides of a quote: the agent's public Intents balance. */
const intents = "INTENTS";

/**
 * A quote that swaps (or withdraws) from the signer's Intents balance and refunds it there.
 *
 * What the Agent API accepts in `sign_intent.one_click_deposits` / `withdrawals`: the quote
 * must refund `signer`, pay `signer` (`recipientType: "INTENTS"`) or a listed address
 * (`"DESTINATION_CHAIN"`), and carry no `rebates`, `customRecipientMsg` or virtual chain fields.
 * `dry: false` creates the deposit address; a dry quote has none and cannot be signed for. The
 * response is returned as 1Click wrote it: the API verifies 1Click's signature on it.
 */
export function requestQuote(input: {
  dry: boolean;
  signer: string;
  originAsset: string;
  destinationAsset: string;
  amount: string;
  /** Pays out to this address on the destination asset's chain instead of back to `signer`. */
  withdrawTo?: string;
  /** Slippage in basis points. Keep it clearly under `max_slippage_bps`: fees count against the cap too. */
  slippageBps: number;
}) {
  return call<Quote>("POST", "/v0/quote", {
    dry: input.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: input.slippageBps,
    originAsset: input.originAsset,
    depositType: intents,
    destinationAsset: input.destinationAsset,
    amount: input.amount,
    refundTo: input.signer,
    refundType: intents,
    recipient: input.withdrawTo ?? input.signer,
    recipientType: input.withdrawTo === undefined ? intents : "DESTINATION_CHAIN",
    // The time the quote is open for; `generate-intent` writes the quote's own, later, deadline.
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
}

/**
 * 1Click's quote response, as returned. The Agent API takes it unchanged in `one_click_quotes`;
 * a dry quote has no deposit address or signature, so only a `dry: false` one can go there.
 */
export type Quote = OneClickQuote & {
  quote: {
    amountIn: string;
    amountInFormatted?: string;
    amountOut: string;
    amountOutFormatted?: string;
    minAmountOut?: string;
    deadline?: string;
  };
};

/** The payload for the signer to sign: one transfer of the quote's `amountIn` to its deposit address. */
export async function generateIntent(depositAddress: string, signer: string) {
  const generated = await call<{ intent: { standard: string; payload: unknown } }>(
    "POST",
    "/v0/generate-intent",
    { type: "swap_transfer", standard: "erc191", depositAddress, signerId: signer },
  );
  const { payload } = generated.intent;
  // The Agent API signs exactly the text it is given, so pass the payload as 1Click wrote it.
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

/** Publishes the signed payload; 1Click pays the deposit from the signer's Intents balance. */
export function submitIntent(signedData: unknown) {
  return call<{ intentHash: string; correlationId: string }>("POST", "/v0/submit-intent", {
    type: "swap_transfer",
    signedData,
  });
}

const terminal = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

/** Polls 1Click's status for a deposit address until the swap ends (or `timeoutMs` passes). */
export async function waitForSwap(depositAddress: string, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (true) {
    const status = await call<{ status: string }>(
      "GET",
      `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
    );
    if (terminal.has(status.status) || Date.now() > until) return status;
    await sleep(5_000);
  }
}
