import { createHash, randomBytes } from "node:crypto";
import type { Signature } from "@near-intents-agent-api/sdk";
import { JsonRpcProvider, PublicKey } from "near-api-js";

/**
 * Identity signing, from both sides.
 *
 * The agent proves to another service (the *relying party*) that it controls its NEAR account.
 * The relying party issues a short-lived challenge naming itself as `audience`; the agent's backend
 * asks the API to sign it (`api.sign`); the relying party verifies the NEP-413 signature and that
 * the key controls the account.
 *
 * The API signs nothing else: only this exact envelope, never a transaction, an intent or free
 * text, and never for the NEAR Intents contracts. The owner turns signing on per account with the
 * policy rule `sign: { recipients }`.
 */

/** The NEAR Intents contracts. The API never signs for them, whatever the policy says. */
export const intentsContracts = ["intents.near", "intents.far"] as const;

export function isIntentsContract(account: string) {
  return (intentsContracts as readonly string[]).includes(account);
}

/** The only message the API signs. Every field is required and no other field is accepted. */
export type IdentityChallenge = {
  domain: "near-intents-agent-api.identity.v1";
  purpose: "identity";
  chain: "near";
  /** The relying party's NEAR account; also the NEP-413 `recipient`. */
  audience: string;
  /** 32 random bytes, hex. The relying party accepts each one once. */
  challenge: string;
  issued_at_ms: number;
  /** At most 5 minutes after `issued_at_ms`. */
  expires_at_ms: number;
};

/** Canonical JSON: keys sorted, no whitespace. The API refuses any other spelling. */
export function canonicalJson(value: Record<string, string | number>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}

/**
 * Relying party: a fresh challenge for `audience` (your service's NEAR account). Store
 * `challenge.challenge` until it expires and accept it once.
 */
export function identityChallenge(audience: string, lifetimeMs = 60_000) {
  if (isIntentsContract(audience))
    throw new Error(`${audience} is a NEAR Intents contract; the API never signs for it`);
  const issuedAtMs = Date.now();
  const challenge: IdentityChallenge = {
    domain: "near-intents-agent-api.identity.v1",
    purpose: "identity",
    chain: "near",
    audience,
    challenge: randomBytes(32).toString("hex"),
    issued_at_ms: issuedAtMs,
    expires_at_ms: issuedAtMs + lifetimeMs,
  };
  return { challenge, message: canonicalJson(challenge) };
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
 * Relying party: checks a signature from `api.sign` against the challenge you issued. Throws with
 * the reason when any check fails; returns the proven account otherwise.
 */
export async function verifyIdentitySignature(input: {
  issued: { challenge: IdentityChallenge; message: string };
  signature: Signature;
  rpcUrl: string;
  /** The account you expect, when you already know it. */
  expectedAccountId?: string;
}) {
  const { issued, signature } = input;
  if (signature.recipient !== issued.challenge.audience)
    throw new Error("signature is for another recipient");
  if (Date.now() >= issued.challenge.expires_at_ms) throw new Error("challenge expired");
  if (input.expectedAccountId && signature.near_account_id !== input.expectedAccountId)
    throw new Error("signature is from another account");

  const publicKey = PublicKey.fromString(signature.public_key);
  const digest = nep413Digest({
    message: issued.message,
    nonce: Buffer.from(signature.nonce, "base64"),
    recipient: signature.recipient,
  });
  if (!publicKey.verify(digest, Buffer.from(signature.signature, "hex")))
    throw new Error("signature does not verify");
  if (!(await keyControlsAccount(signature.near_account_id, publicKey, input.rpcUrl)))
    throw new Error("public key does not control the account");
  return { account_id: signature.near_account_id, public_key: signature.public_key };
}
