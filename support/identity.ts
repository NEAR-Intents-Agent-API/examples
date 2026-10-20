import { createHash, randomBytes } from "node:crypto";
import type { Signature } from "@near-intents-agent-api/sdk";
import { JsonRpcProvider, PublicKey } from "near-api-js";

/**
 * NEP-413 login, from both sides.
 *
 * A service (the *relying party*) issues a login `message` and a random 32-byte `nonce`, naming
 * itself as `recipient` (its NEAR account or domain). The agent's backend asks the API to sign
 * exactly those (`api.nativeNearSignMessage`); the service verifies the NEP-413 signature, that
 * the nonce is the one it issued, and that the key controls the account.
 *
 * The API signs only the NEP-413 payload, never a transaction or an intent, and never for the
 * NEAR Intents contracts. The owner turns signing on per recipient with the policy's
 * `native.near.sign_message` list.
 */

/** The NEAR Intents contracts. The API never signs for them, whatever the policy says. */
export const intentsContracts = ["intents.near", "intents.far"] as const;

export function isIntentsContract(account: string) {
  return (intentsContracts as readonly string[]).includes(account.toLowerCase());
}

/**
 * Relying party: a login request for `recipient` (your service's NEAR account or domain). Keep
 * `nonce` until the login completes and accept it once.
 */
export function loginRequest(recipient: string) {
  if (isIntentsContract(recipient))
    throw new Error(`${recipient} is a NEAR Intents contract; the API never signs for it`);
  const nonce = randomBytes(32).toString("base64");
  return {
    recipient,
    nonce,
    message: `Log in to ${recipient} at ${new Date().toISOString()}`,
  };
}

function borshString(value: string) {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

/** The NEP-413 digest a NEAR wallet signs: sha256 of the tag and the Borsh payload. */
export function nep413Digest(input: { message: string; nonce: Uint8Array; recipient: string }) {
  if (input.nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  const payload = Buffer.concat([
    tag,
    borshString(input.message),
    Buffer.from(input.nonce),
    borshString(input.recipient),
    Buffer.from([0]), // callbackUrl: none
  ]);
  return createHash("sha256").update(payload).digest();
}

/**
 * Whether `publicKey` controls `accountId` now: a full-access key on chain, or, for an implicit
 * account that does not exist on chain yet, the key it is derived from.
 */
async function keyControlsAccount(accountId: string, publicKey: PublicKey, rpcUrl: string) {
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const exists = await provider.viewAccount({ accountId }).then(
    () => true,
    () => false,
  );
  if (!exists)
    return (
      /^[0-9a-f]{64}$/.test(accountId) && Buffer.from(publicKey.data).toString("hex") === accountId
    );
  const key = await provider
    .viewAccessKey({ accountId, publicKey, finalityQuery: { finality: "final" } })
    .catch(() => null);
  return key?.permission === "FullAccess";
}

/**
 * Relying party: checks a signature from `api.nativeNearSignMessage` against the login request you
 * issued. Throws with the reason when any check fails; returns the proven account otherwise.
 */
export async function verifyLogin(input: {
  issued: ReturnType<typeof loginRequest>;
  signature: Signature;
  rpcUrl: string;
  /** The account you expect, when you already know it. */
  expectedAccountId?: string;
}) {
  const { issued, signature } = input;
  if (signature.recipient !== issued.recipient) throw new Error("signature is for another recipient");
  if (signature.nonce !== issued.nonce) throw new Error("signature answers another nonce");
  if (input.expectedAccountId && signature.near_account_id !== input.expectedAccountId)
    throw new Error("signature is from another account");

  const publicKey = PublicKey.fromString(signature.public_key);
  const digest = nep413Digest({
    message: issued.message,
    nonce: Buffer.from(issued.nonce, "base64"),
    recipient: issued.recipient,
  });
  if (!publicKey.verify(digest, Buffer.from(signature.signature, "base64")))
    throw new Error("signature does not verify");
  if (!(await keyControlsAccount(signature.near_account_id, publicKey, input.rpcUrl)))
    throw new Error("public key does not control the account");
  return { account_id: signature.near_account_id, public_key: signature.public_key };
}
