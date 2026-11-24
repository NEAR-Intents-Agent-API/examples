# 04 · Grants

**Owner signs the policy → owner issues a grant → the grantee acts within the policy.** The
policy says what is allowed; a grant says who may act.

An API key proves which partner is calling. It never authorizes moving an owner's funds. Spending
needs an owner-signed **grant**: a bounded delegation to one token (`ngt_…`) that your backend
holds for one session, assistant or bot. One agent can hold up to 50 live grants; issuing or
revoking one never touches another.

| Example | Run | What it shows |
|---|---|---|
| `01-issue-grant.ts` | `pnpm 04:issue-grant` | Create a token, sign its commitment and expiry |
| `02-delegate-client.ts` | `pnpm 04:delegate-client` | `api.forGrant(token)` — the client a bot or assistant runs under |
| `03-revoke-and-audit.ts` | `pnpm 04:revoke-and-audit [grant_id]` | Revoke one grant, inspect containment, read what remains |
| `04-issue-key-grant.ts` | `pnpm 04:issue-key-grant` | Bind a grant to a key the workload holds: no token exists |
| `05-delegate-with-key.ts` | `pnpm 04:delegate-with-key` | `forGrantSession(agentId, { signer, grantId })` and `forGrantProof({ grantId, signer })`, both with that key |
| `06-issue-oidc-grant.ts` | `pnpm 04:issue-oidc-grant` | Bind a grant to a GitHub Actions repository and environment |
| `07-delegate-from-ci.ts` | `pnpm 04:delegate-from-ci` | `forGrantSession(agentId, { subjectToken })` from a CI job (runs only inside GitHub Actions) |
| `08-kms-signer.ts` | `pnpm 04:kms-signer` | A KMS-style signer that returns DER, converted to the JWS signature (offline) |

## The commitment trick

Your backend creates the token and sends only its SHA-256 commitment in `grant_issue`:

```ts
const { token, commitment } = createGrantCredential();
// The owner signs the commitment; the API never sees the token.
await api.generateIntent({
  type: "grant_issue",
  agent_id,
  label: "Claude — trading helper",
  credential: commitment,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
});
```

A grant carries no permissions. What every grantee may do is the account policy: its `actions`
(`swap`, `transfer`, `withdraw`, `limit_order`), `confidential` (on in every new policy), `assets`, `limits` and `destinations`.
Enable swaps with one `policy_update` and every live grant can swap at once — no new grant. A new
account sends nowhere until the owner lists a destination the same way.

To authorize the first grant in the same signature that creates the agent, pass it as `grant` to
`agent_create` (`pnpm 02:create-with-grant`, see
[02 · Your first agent](../02-your-first-agent/README.md)); later grants use `grant_issue`.

Store the token encrypted on your backend. `api.forGrant(token)` returns a client that sends it
as `X-Grant-Token` on delegated calls only.

## Workload identity: no long-lived token

A grant token is a secret that lives as long as the grant. Where a platform already vouches for the
workload, or the workload can keep a private key, the owner signs that identity as the grant's
`credential` instead, and nothing long-lived sits on the workload. The grant still carries no
permissions, and everything after admission (policy, timelock, approvals, budget) is unchanged. The
API key is still required on every call: it identifies your backend, the grant says who acts.

| `credential` | The workload holds | Sends |
|---|---|---|
| SHA-256 of an `ngt_…` token | The token | `X-Grant-Token: ngt_…` |
| `{ type: "public_key", jwk }` | A private key (file, TPM, HSM, KMS) | `X-Grant-Token: ngs_…` from an exchange, or `X-Grant-Proof` per request |
| `{ type: "oidc", issuer, claims }` | Nothing: its platform issues short-lived identity tokens | `X-Grant-Token: ngs_…` from an exchange |

An exchange (`POST /v1/agents/{agent_id}/grants/token`, RFC 8693) trades an identity token, or a
single-use assertion the key signs, for an `ngs_…` session token. It lives 15 minutes, never
outlives the grant, and ends at once when the grant is revoked or expires. The SDK does it for you:
the session is opened on the first delegated call. It keeps serving the current session while it
exchanges again in the background, from `refreshBeforeSeconds` before the end (60 by default, never
more than half the session's life). A failed exchange is not retried for 5 seconds, and the old
session keeps serving until it ends. If the API refuses a session with `agent_grant_required` (the
grant was revoked or replaced), that call throws, the cached session is dropped and the next call
exchanges again. A grant holds at most 100 live sessions, so keep one client per grant and reuse it,
rather than creating one per invocation.

### A key the workload holds

The one federated flow that needs no identity provider, so you can run it end to end:

```sh
pnpm 04:issue-key-grant    # generate a key, the owner signs a public_key grant, keep key + grant_id
pnpm 04:delegate-with-key  # preview a withdrawal by session, then by signed proof
pnpm 04:revoke-and-audit "$(jq -r .grant_id .intents/$AGENT_ID.key-grant.json)"
```

```ts
const { privateJwk, publicJwk } = createWorkloadKey("Ed25519"); // or "P-256"
// The owner signs grant_issue with credential: { type: "public_key", jwk: publicJwk }.
const signer = localJwkSigner(privateJwk);

const viaSession = api.forGrantSession(agentId, { signer }); // one signature per 15-minute session
const viaProof = api.forGrantProof({ grantId, signer }); // a signature per request, no bearer token
```

Choose a **session** when the key is slow or billed per use (a cloud KMS) or the workload sends
many requests. Choose a **proof** when no bearer token should exist anywhere, not in memory, logs
or a proxy: each proof binds one grant, method, URL, body and `Idempotency-Key`. A retry signs a new
proof and repeats the same `Idempotency-Key`. `grantId` is the one returned when the grant was
issued (`status.details.grant.grant_id`, or `listGrants`).

The example keeps the private key in `.intents/` so two scripts can share it. In production the key
is generated on the workload and never leaves it: only `publicJwk` goes to the owner.

### An OIDC grant (GitHub Actions)

```sh
pnpm 04:issue-oidc-grant   # owner side, on your machine: needs AGENT_GITHUB_REPOSITORY=owner/repo
```

then run the job in [`github-actions.example.yml`](github-actions.example.yml), which calls
`pnpm 04:delegate-from-ci`. **That script runs only inside GitHub Actions**: GitHub hands out the
identity token only to a job with `permissions: id-token: write`, and the script says so when run
anywhere else.

```ts
const audience = oidcGrantAudience(baseUrl, agentId); // ask GitHub for a token with this audience
const bot = api.forGrantSession(agentId, { subjectToken: () => githubIdToken(audience) });
```

The binding pins immutable ids (`repository_owner_id`, `repository_id`) and an `environment`, never
names: a shared issuer signs tokens for every repository on GitHub, and a renamed repository's old
name can be registered by someone else. For GitHub the API fixes the audience to
`{API url}/v1/agents/{agent_id}`; leave `audience` out of the credential. Only Microsoft Entra ID
names its own. `baseUrl` must be the URL the API publishes (`https://api.agentsonintents.com` for
the hosted API), because the audience is built from it.

The same pattern covers GitLab CI, Google Cloud, AWS, Kubernetes (EKS, GKE, AKS and self-hosted),
Microsoft Entra ID and Vercel: only the `issuer`, the pinned `claims` and where the job gets its token
change. The API's `docs/workload-identity.md` lists each. These examples exercise the exchange with a
key grant and GitHub's token endpoint; they do not claim every platform has been run live.

### A key in a cloud KMS

`WorkloadSigner` is `{ publicJwk, sign }`: the SDK never needs the private key, only a signature,
so a TPM, HSM or cloud KMS works. `sign(input)` must return the raw 64-byte JWS signature, and for
P-256 that is `r || s`, not the DER a KMS returns. `pnpm 04:kms-signer` shows the conversion
(`support/der-signature.ts`) against a stand-in KMS, offline, and shows the SDK refusing an
unconverted signature before anything is sent.

For Google Cloud KMS, create the key with purpose `ASYMMETRIC_SIGN` and algorithm
`EC_SIGN_P256_SHA256`. The examples do not depend on `@google-cloud/kms`, so this is a snippet to
adapt (`pnpm add @google-cloud/kms`):

```ts
import { createHash, createPublicKey } from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import type { WorkloadSigner } from "@near-intents-agent-api/sdk";
import { derToJoseSignature } from "../support/der-signature.js";

const kms = new KeyManagementServiceClient();
const name = "projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>/cryptoKeyVersions/1";

// Once: the public key the owner signs into the grant, { kty: "EC", crv: "P-256", x, y }.
const [{ pem }] = await kms.getPublicKey({ name });
const { x, y } = createPublicKey(pem!).export({ format: "jwk" });
const publicJwk = { kty: "EC", crv: "P-256", x: x!, y: y! } as const;

const signer: WorkloadSigner = {
  publicJwk,
  async sign(signingInput) {
    // This algorithm takes the SHA-256 digest of the JWS signing input, not the data.
    const [{ signature }] = await kms.asymmetricSign({
      name,
      digest: { sha256: createHash("sha256").update(signingInput).digest() },
    });
    return derToJoseSignature(signature as Uint8Array); // DER -> r || s
  },
};

const bot = api.forGrantSession(agentId, { signer, grantId });
```

Each `asymmetricSign` is a network call and a billed operation. `forGrantSession` signs once per
session; `forGrantProof` signs once per request (and per retry), so prefer a session at high rates.

## Refusal codes name the blocking layer

- `agent_grant_required` — no live grant for this grant or session token, or neither `X-Grant-Token`
  nor `X-Grant-Proof` was sent; or at an exchange, an identity token no live grant accepts. A
  session client drops its cached session on it. A proof with no live key-bound grant reads
  `grant_proof_invalid` instead.
- `policy_action_denied` — the policy turns this action off.
- `policy_destination_denied` — the account's destination rule.
- `policy_denied` — the account's provider policy (assets, limits, hourly rate).
- `spend_budget_exceeded` — the account's USD budget.
- `policy_limit_exceeded`, `policy_action_limit_exceeded` — the per-asset limits and hourly action
  cap, which the API counts across every grant (shield included).

Federation adds its own, on the exchange and the proof: `subject_token_invalid` (401, an identity
token or assertion that does not verify, or one already used), `grant_proof_invalid` (401, a proof
that does not match its request or was already spent), `grant_ambiguous` (409, several live grants
accept the token: send `grant_id`), `grant_session_limit_reached` (429, retry at `meta.available_at`)
and `issuer_unavailable` (503, retryable). Never send `X-Grant-Token` and `X-Grant-Proof` together.

Raising the USD budget never lifts a per-asset limit. Change the rule that refused; grants never
need reissuing for it.

Next: [05 · Money moves](../05-money-moves/README.md).
