# 03 · Owner wallets / Passkey

WebAuthn needs a browser, a real authenticator and a user gesture, so passkey owners cannot be
scripted headlessly. This folder is a copy-paste template: the browser registration and signing
ceremonies, plus the backend calls around them. Nothing here is runnable with `pnpm`; it is
illustrative.

## The shape of a passkey owner

A passkey is a P-256 (ES256) credential held by a platform authenticator. The owner descriptor
sent to the API is:

```ts
type PasskeyOwner = {
  type: "passkey";
  credential_id: string; // base64url credential id
  public_key: string;    // base64url DER SPKI (NOT the COSE key)
  rp_id: string;         // relying party id, e.g. "app.example.com"
  origin: string;       // exact HTTPS origin, e.g. "https://app.example.com"
};
```

Registration must request `pubKeyCredParams` ES256 (`alg: -7`), require user verification, and
keep the **SPKI** public key. If registration only yields a COSE key, convert it in your backend;
`passkey_es256_public_key_required` means the SPKI is missing.

## Browser: register

```ts
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { id: location.hostname, name: "My app" },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email, displayName: name },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256
    authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
    timeout: 120_000,
  },
});
```

Send the credential's `rawId` (base64url) and the SPKI public key to your backend. Persist both
with the owner. This registration belongs to your authentication flow; the SDK contains no
browser helpers and the API never sees the private key.

## Backend: create the agent

The flow is identical to NEAR/EVM; only `intent.standard` is `webauthn`.

```ts
const owner = { type: "passkey", credential_id, public_key, rp_id, origin };
const generated = await api.generateIntent(
  { type: "agent_create", name: "Passkey agent", owner, policy },
  { idempotencyKey },
);
// generated.intent.standard === "webauthn"
// generated.intent.payload is a PublicKeyCredentialRequestOptionsJSON (WebAuthn field names).
```

## Browser: sign

```ts
import { startAuthentication } from "@simplewebauthn/browser";

const credential = await startAuthentication({ optionsJSON: generated.intent.payload });
// Send it back as signed_data: { standard: "webauthn", payload, credential }
```

The server verifies the assertion (user verification required) against the stored public key. The
same `startAuthentication` call signs policy updates, grant issuance and approvals — the standard
is always `webauthn` for this owner type.

## Notes

- Cross-origin iframe ceremonies are rejected; run the passkey on a top-level page.
- `origin` must exactly match the registered site origin. Changing hostname changes passkey scope.
- EVM wallet contracts are externally owned accounts only; EIP-1271 contract wallets are not
  supported. This applies to passkeys, too: the P-256 public key must be a plain ES256 key.

Next: [04 · Grants](../04-grants/README.md).
