/**
 * A KMS-style signer for a key-bound grant, checked offline.
 *
 * What: wraps a signing service that returns DER ECDSA signatures (as a cloud KMS does) as a
 *       `WorkloadSigner`, signs a real key assertion with it and verifies the JWS.
 * When: before you point `forGrantSession(agentId, { signer, grantId })` at Google Cloud KMS, AWS KMS or an HSM.
 * Needs: nothing: no API, no key, no network. A local P-256 key stands in for the KMS.
 * Run: `pnpm 04:kms-signer`
 *
 * The one thing a KMS signer must get right is the signature encoding. A KMS returns ASN.1 DER
 * (`SEQUENCE { INTEGER r, INTEGER s }`); a JWS carries the raw 64 bytes `r || s`
 * (`support/der-signature.ts`). The SDK refuses anything but 64 bytes before sending, so a
 * forgotten conversion fails here, not as `grant_proof_invalid` at the API. The README of this
 * folder shows the same signer against Google Cloud KMS.
 */

import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import {
  createKeyAssertion,
  DEFAULT_BASE_URL,
  jwkThumbprintUri,
  type WorkloadSigner,
} from "@near-intents-agent-api/sdk";
import { banner, isMainModule, print } from "../support/config.js";
import { derToJoseSignature } from "../support/der-signature.js";

const AGENT_ID = "agent_example";

export async function checkKmsSigner() {
  // The stand-in KMS: a P-256 key that never leaves this closure and answers with DER, as a KMS
  // does. (Real KMS takes the SHA-256 digest of the input; the result is the same ECDSA signature.)
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kmsSign = (input: Uint8Array) =>
    new Uint8Array(sign("sha256", input, { key: privateKey, dsaEncoding: "der" }));

  const { x, y } = publicKey.export({ format: "jwk" });
  if (!x || !y) throw new Error("not an EC key");
  const publicJwk = { kty: "EC", crv: "P-256", x, y } as const;

  const unconverted: WorkloadSigner = { publicJwk, sign: kmsSign };
  const signer: WorkloadSigner = {
    publicJwk,
    sign: (input) => derToJoseSignature(kmsSign(input)),
  };

  // Without the conversion the SDK refuses to sign.
  const refusal = await createKeyAssertion(unconverted, {
    baseUrl: DEFAULT_BASE_URL,
    agentId: AGENT_ID,
  }).catch((error: Error) => error.message);

  const assertion = await createKeyAssertion(signer, {
    baseUrl: DEFAULT_BASE_URL,
    agentId: AGENT_ID,
  });
  const [header, claims, signature] = assertion.split(".");
  const valid = verify(
    "sha256",
    Buffer.from(`${header}.${claims}`),
    { key: createPublicKey({ key: publicJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(signature ?? "", "base64url"),
  );

  return {
    // What the owner signs into `grant_issue`: the public key only.
    credential: { type: "public_key", jwk: publicJwk },
    key: jwkThumbprintUri(publicJwk),
    without_conversion: refusal,
    assertion_header: JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
    assertion_claims: JSON.parse(Buffer.from(claims ?? "", "base64url").toString()),
    signature_bytes: Buffer.from(signature ?? "", "base64url").length,
    signature_valid: valid,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Checking a DER-returning signer as a WorkloadSigner (offline)…"]);
  void checkKmsSigner().then(print);
}
