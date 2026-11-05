/**
 * Sign in to a service with the agent's Solana key, and sign one SOL transfer.
 *
 * What: asks the API to write and sign a Sign-In-With-Solana message for `AGENT_SIGN_RECIPIENT`,
 *       verifies the signature over the returned `signed_message`, then builds a legacy message
 *       that sends `AGENT_TRANSFER_AMOUNT` lamports to `AGENT_SOLANA_RECIPIENT` and has the API
 *       sign it. Nothing is broadcast.
 * When: an agent logs in to a Solana dApp, or pays from its Solana address without the
 *       full-control `sign_transaction` switch.
 * Needs: `AGENT_ID`, `native.solana.sign_in` and `sign_transfer` on (`07:enable-solana`),
 *        `AGENT_SIGN_RECIPIENT` (the domain), `AGENT_SOLANA_RECIPIENT`, stored grant
 *        (`04:issue-grant`).
 * Run: `pnpm 07:solana`
 *
 * Signing moves no money, so it needs no `AGENT_ALLOW_WRITES`. Each signature is recorded in
 * history as type `native`.
 *
 * Sign-in: the caller sends the fields of the wallet standard's `signIn` input, and the API
 * writes the message itself, so a login can never be anything else. `nonce` is the service's
 * (8 to 64 letters and digits, accepted once), `issued_at` within 300 seconds of the API's clock,
 * `expiration_time` at most 10 minutes after it. Give the relying party the UTF-8 bytes of
 * `signed_message` with `signature` and `account_id`.
 *
 * Transfer: `unsigned_tx` is the base64 message (`versionedTx.message.serialize()`), legacy or
 * v0 without lookup tables, with the agent as its only signer and fee payer, and exactly one SOL
 * or SPL token transfer. `recipient` must be allowed by `destinations` as a `withdraw` on chain
 * `sol`. The caller attaches the signature to the transaction and broadcasts it while its
 * blockhash is recent.
 */
import { createPublicKey, verify } from "node:crypto";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { base58Decode, latestBlockhash, transferMessage } from "../support/solana.js";

/** DER header of an Ed25519 public key; the 32 raw key bytes follow it. */
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

export async function solanaSignInAndTransfer(
  agentId: string,
  domain: string,
  recipient: string,
  lamports: bigint,
) {
  const api = agentApi();
  const delegate = api.forGrant((await loadGrant(agentId)).token);
  const { solana_account_id } = await api.getWallet(agentId);
  if (!solana_account_id) throw new Error("The wallet provider has not reported a Solana address yet");

  // 1. Sign-in. The service picks the nonce; the API fixes the rest of the message.
  const now = Date.now();
  const login = await delegate.nativeSolanaSignIn(agentId, {
    domain,
    statement: "Sign in to the example service.",
    uri: `https://${domain}`,
    version: "1",
    chain_id: "mainnet",
    nonce: crypto.randomUUID().replaceAll("-", ""),
    issued_at: new Date(now).toISOString(),
    expiration_time: new Date(now + 5 * 60_000).toISOString(),
  });
  // The relying party's check: an Ed25519 signature over the exact signed text, by the agent's key.
  const verified = verify(
    null,
    Buffer.from(login.signed_message, "utf8"),
    createPublicKey({
      key: Buffer.concat([ed25519SpkiPrefix, base58Decode(solana_account_id)]),
      format: "der",
      type: "spki",
    }),
    base58Decode(login.signature, 64),
  );

  // 2. Transfer. Your backend builds the message; the API reads it before it signs.
  const transfer = await delegate.nativeSolanaSignTransfer(agentId, {
    unsigned_tx: transferMessage({
      from: solana_account_id,
      to: recipient,
      lamports,
      blockhash: await latestBlockhash(),
    }),
    recipient,
  });

  return {
    sign_in: { signed_message: login.signed_message, signature: login.signature, verified },
    transfer: { signature: transfer.signature, account_id: transfer.account_id },
    note: "Nothing was broadcast: attach the signature to the transaction and send it yourself.",
  };
}

if (isMainModule(import.meta.url)) {
  const settings = config();
  const domain = required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  const recipient = required(settings.solanaRecipient, "AGENT_SOLANA_RECIPIENT");
  banner([`Signing in to ${domain} and signing a transfer of ${settings.transferAmount} lamports to ${recipient}…`]);
  void solanaSignInAndTransfer(
    required(settings.agentId, "AGENT_ID"),
    domain,
    recipient,
    BigInt(settings.transferAmount),
  ).then(print);
}
