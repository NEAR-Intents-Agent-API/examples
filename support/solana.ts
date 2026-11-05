import { config } from "./config.js";

/**
 * Just enough Solana for `solana/sign-transfer`, without a Solana library: base58, a legacy
 * System Program transfer message, and the recent blockhash from a public RPC.
 *
 * Use `@solana/web3.js` or `@solana/kit` in a real project; this keeps the example's
 * dependencies to the ones it already has. The API reads every instruction of the message you
 * send, so the bytes must be exactly one transfer.
 */
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string, length = 32): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error(`${text} is not base58`);
    value = value * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  if (value !== 0n) throw new Error(`${text} is longer than ${length} bytes`);
  return bytes;
}

/** A recent blockhash. The API never reads it; the network needs one only if you broadcast. */
export async function latestBlockhash(): Promise<string> {
  const response = await fetch(config().solanaRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [] }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { result?: { value?: { blockhash?: string } } };
  const blockhash = body.result?.value?.blockhash;
  if (!blockhash) throw new Error("The Solana RPC returned no blockhash");
  return blockhash;
}

/**
 * A legacy message with one System Program `Transfer` of `lamports` from `from` (the only signer
 * and fee payer) to `to`, as base64 for `unsigned_tx`.
 */
export function transferMessage(input: {
  from: string;
  to: string;
  lamports: bigint;
  blockhash: string;
}): string {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // System Program instruction 2: Transfer
  view.setBigUint64(4, input.lamports, true);
  const systemProgram = new Uint8Array(32); // 11111111111111111111111111111111
  const message = Uint8Array.from([
    1, // required signatures: the payer
    0, // read-only signed accounts
    1, // read-only unsigned accounts: the System Program
    3, // account count
    ...base58Decode(input.from),
    ...base58Decode(input.to),
    ...systemProgram,
    ...base58Decode(input.blockhash),
    1, // instruction count
    2, // program: the System Program
    2, // account count: payer, recipient
    0,
    1,
    data.length,
    ...data,
  ]);
  return Buffer.from(message).toString("base64");
}
