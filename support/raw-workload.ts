import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto";
import type { WorkloadPrivateJwk } from "@near-intents-agent-api/sdk";

/**
 * Hand-built workload JWTs with `node:crypto` only: the key assertion that is exchanged for a
 * session (RFC 7523) and the proof that signs one request (`X-Grant-Proof`). The SDK does the same
 * in `createKeyAssertion` and `createGrantProof`; the claims are specified in the API's
 * `docs/workload-identity.md`. Only the private key's type comes from the SDK.
 */

const b64url = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

/**
 * The RFC 9278 thumbprint URI of the key: the `iss` and `sub` of everything it signs. RFC 7638
 * hashes the required members only, in lexicographic order, with no whitespace.
 */
export function thumbprintUri(jwk: WorkloadPrivateJwk): string {
  const canonical =
    jwk.kty === "OKP"
      ? `{"crv":"${jwk.crv}","kty":"OKP","x":"${jwk.x}"}`
      : `{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`;
  return `urn:ietf:params:oauth:jwk-thumbprint:sha-256:${createHash("sha256").update(canonical).digest("base64url")}`;
}

/** The claims every workload JWT carries. Add the ones the request needs (`grant_id`, `htm`, …). */
export function workloadClaims(jwk: WorkloadPrivateJwk, audience: string) {
  const iss = thumbprintUri(jwk);
  const iat = Math.floor(Date.now() / 1000);
  // The API accepts at most five minutes between `iat` and `exp`; `jti` is spent on first use.
  return { iss, sub: iss, aud: audience, iat, exp: iat + 60, jti: randomUUID() };
}

/** Signs the claims as a compact JWS: `EdDSA` for an Ed25519 key, `ES256` for a P-256 key. */
export function signJwt(jwk: WorkloadPrivateJwk, claims: Record<string, unknown>): string {
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const alg = jwk.kty === "OKP" ? "EdDSA" : "ES256";
  const input = `${b64url(JSON.stringify({ alg }))}.${b64url(JSON.stringify(claims))}`;
  const signature =
    jwk.kty === "OKP"
      ? sign(null, Buffer.from(input), key)
      : // ieee-p1363 is the raw r || s a JWS carries, not DER.
        sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

/** Lowercase hex SHA-256 of the exact body text sent. */
export const bodySha256 = (body: string) => createHash("sha256").update(body).digest("hex");
