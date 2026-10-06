import type { OwnerWallet } from "@near-intents-agent-api/sdk";
import { KeyPair, type KeyPairEd25519, KeyPairSigner, type KeyPairString } from "near-api-js";
import { config, required } from "./config.js";

type NearOwnerWallet = Extract<OwnerWallet, { type: "near" }>;

/**
 * The owner wallet.
 *
 * The owner is the identity that signs every privileged action — creating an agent, editing its
 * rules, issuing grants, approving or deleting. Keys never leave the wallet; the API only ever
 * receives the wallet's output. This module loads a plain ed25519 keypair from `.env`, exactly
 * the way a backend would hold the owner's wallet adapter.
 */
export function loadOwner(input?: { accountId?: string; privateKey?: string }) {
  const accountId = input?.accountId ?? required(config().ownerAccountId, "AGENT_OWNER_ACCOUNT_ID");
  const privateKey =
    input?.privateKey ?? required(config().ownerPrivateKey, "AGENT_OWNER_PRIVATE_KEY");
  const keyPair = KeyPair.fromString(privateKey as KeyPairString) as KeyPairEd25519;
  const publicKey = keyPair.getPublicKey().toString();
  const implicitAccountId = Buffer.from(keyPair.getPublicKey().data).toString("hex");
  if (/^[0-9a-f]{64}$/.test(accountId) && accountId !== implicitAccountId)
    throw new Error("Configured implicit owner account does not match private key");
  return {
    keyPair,
    owner: { type: "near", account_id: accountId, public_key: publicKey } satisfies NearOwnerWallet,
  };
}

/** NEP-413 signature for one payload, as a connected NEAR wallet returns it. */
export async function signNep413(
  keyPair: KeyPair,
  payload: { message: string; nonce: Uint8Array; recipient: string },
) {
  const signer = KeyPairSigner.fromSecretKey(keyPair.toString());
  return Buffer.from((await signer.signNep413Message("owner.near", payload)).signature).toString(
    "base64",
  );
}
