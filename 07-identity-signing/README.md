# 07 · Identity signing

An agent can prove to another service that it controls its NEAR account: the service issues a
short-lived challenge, the API signs it with the agent's key (NEP-413), and the service verifies
the signature. Nothing else is ever signed: no transaction, no intent, no free text.

| Example | Run | What it shows |
|---|---|---|
| `01-enable-signing.ts` | `pnpm 07:enable-signing` | Owner adds a service to `sign.recipients`, with the warning to show |
| `02-sign-and-verify.ts` | `pnpm 07:sign-and-verify` | Both sides: issue a challenge, sign it under a grant, verify it |
| `03-refusals.ts` | `pnpm 07:refusals` | Every refusal code, including `intents.near`/`intents.far` |
| `04-disable-signing.ts` | `pnpm 07:disable-signing [all]` | Remove one service, or omit `sign` to turn signing off |

Set `AGENT_SIGN_RECIPIENT` in `.env` to the NEAR account of the service the agent logs in to.

## Off until the owner turns it on

Signing is a policy rule like any other, and new policies leave it out:

```ts
policy: { ...current.policy, sign: { recipients: ["login.example.near"] } }
```

- **Omitted** means the agent signs nothing (`policy_action_denied`). `recipients` needs at least
  one account, so remove the field to turn signing off.
- **Listed** recipients are the only services the agent may sign for. The custody provider
  enforces the same list, so changing `sign` is an on-chain policy change (`nep366` for NEAR
  owners, sponsored by the API) and the 10-minute policy cooldown applies.
- **Any live grant** may sign for a listed recipient. Revoke the grant to stop one caller.
- **Not delayed or charged:** `timelock_ms`, `schedule`, `budget` and `owner_approval` do not apply,
  because a signature moves no value and a challenge expires within 5 minutes.

Show the owner a warning before they sign a policy that adds `sign`, for example: *"Agents can
prove they control this account to the listed services. Only add services you trust; a service
may treat that proof as you logging in."*

## Never the NEAR Intents contracts

`intents.near` and `intents.far` can never be recipients. A policy listing them is refused with
`validation_failed`, and a sign request naming them with `403 signing_recipient_forbidden`, before
the policy is read. The signed message also could not parse as an intent: it has exactly the
seven envelope fields below and no `signer_id`, `deadline` or `intents`.

## The challenge

```json
{"audience":"login.example.near","chain":"near","challenge":"<64 hex>","domain":"near-intents-agent-api.identity.v1","expires_at_ms":1760000060000,"issued_at_ms":1760000000000,"purpose":"identity"}
```

- Canonical JSON: keys sorted, no whitespace. Any other spelling is
  `signing_identity_challenge_invalid`.
- `audience` equals the request's `recipient`.
- At most 5 minutes from `issued_at_ms` to `expires_at_ms`, not expired, not issued in the future.
- The relying party generates `challenge` (32 random bytes) and accepts each one once.

`support/identity.ts` builds challenges (`identityChallenge`) and verifies signatures
(`verifyIdentitySignature`): the NEP-413 digest, the ed25519 signature, and that the key is a
full-access key of the account on chain (or the key an implicit account is derived from).

## Refusals

| Code | Status | Meaning |
|---|---|---|
| `signing_recipient_forbidden` | 403 | `intents.near`/`intents.far`, whatever the policy says |
| `signing_identity_challenge_invalid` | 400 | Not the canonical, current challenge for this recipient |
| `policy_not_ready` | 409 | The latest policy revision is not applied and synced yet |
| `wallet_frozen` | 409 | The owner froze the account |
| `agent_grant_required` | 403 | No live `X-Grant-Token` |
| `policy_action_denied` | 403 | The policy has no `sign` rule |
| `signing_policy_denied` | 403 | The recipient is not in `sign.recipients` |

The checks run in that order, so a request with several problems gets the first code.

Next: [08 · Errors and recovery](../08-errors-and-recovery/README.md).
