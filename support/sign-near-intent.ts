import { createHash } from "node:crypto";
import type { GenerateIntentResponse, SignedData } from "@near-intents-agent-api/sdk";
import {
  actions,
  encodeDelegateAction,
  encodeSignedDelegate,
  JsonRpcProvider,
  type KeyPair,
  Signature,
} from "near-api-js";
import { signNep413 } from "./near-owner.js";

/**
 * Signs a generated owner intent with a NEAR keypair.
 *
 * The API returns `intent: { standard, payload }`. The owner's wallet signs that payload exactly
 * as returned; your backend submits the wallet's output unchanged. This module is an example
 * signer for a plain ed25519 key. A browser uses its connected wallet instead:
 *
 * - `nep413`: `wallet.signMessage(payload)` — decode the base64 nonce to a `Uint8Array` first;
 * - `nep366`: `wallet.signDelegateActions({ delegateActions: [payload] })`;
 * - `eip712`: `walletClient.signTypedData({ account, ...payload })`;
 * - `webauthn`: `startAuthentication({ optionsJSON: payload })`.
 *
 * Select the method from `intent.standard`; never rebuild or reorder the payload.
 *
 * `nep366` is a gasless delegate action: the API's sponsor submits it on chain. It needs the
 * owner's current access-key nonce, which is why `rpcUrl` is required.
 */
export async function signNearIntent(
  generated: GenerateIntentResponse,
  keyPair: KeyPair,
  rpcUrl: string,
): Promise<SignedData> {
  const { intent, signer } = generated;
  if (signer.type !== "near" || keyPair.getPublicKey().toString() !== signer.public_key)
    throw new Error("owner_account_mismatch");
  if (intent.standard === "nep413")
    return {
      ...intent,
      public_key: signer.public_key,
      signature: await signNep413(keyPair, {
        ...intent.payload,
        nonce: Buffer.from(intent.payload.nonce, "base64"),
      }),
    };
  if (intent.standard !== "nep366") throw new Error("near_signing_standard_required");
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const access = await provider.viewAccessKey({
    accountId: signer.account_id,
    publicKey: signer.public_key,
    finalityQuery: { finality: "final" },
  });
  const delegateAction = {
    senderId: signer.account_id,
    receiverId: intent.payload.receiverId,
    publicKey: keyPair.getPublicKey(),
    nonce: access.nonce + 1n,
    maxBlockHeight: BigInt(access.block_height) + 120n,
    actions: intent.payload.actions.map(({ params }) =>
      actions.functionCall(
        params.methodName,
        Buffer.from(JSON.stringify(params.args)),
        BigInt(params.gas),
        BigInt(params.deposit),
      ),
    ),
  };
  const digest = createHash("sha256").update(encodeDelegateAction(delegateAction)).digest();
  return {
    ...intent,
    signed_delegate: Buffer.from(
      encodeSignedDelegate({
        delegateAction,
        signature: new Signature({ keyType: 0, data: keyPair.sign(digest).signature }),
      }),
    ).toString("base64"),
  };
}
