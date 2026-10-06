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
| `03-revoke-and-audit.ts` | `pnpm 04:revoke-and-audit` | Revoke one grant, inspect containment, read what remains |

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
(`swap`, `transfer`, `withdraw`), `confidential` balances, `assets`, `limits` and `destinations`.
Enable swaps with one `policy_update` and every live grant can swap at once — no new grant. A new
account sends nowhere until the owner lists a destination the same way.

Store the token encrypted on your backend. `api.forGrant(token)` returns a client that sends it
as `X-Grant-Token` on delegated calls only.

## Refusal codes name the blocking layer

- `agent_grant_required` — no live grant for this token.
- `policy_action_denied` — the policy turns this action off.
- `policy_destination_denied` — the account's destination rule.
- `policy_denied` — the account's provider policy (assets, limits, hourly rate).
- `spend_budget_exceeded` — the account's USD budget.

Raising the USD budget never lifts a per-asset limit. Change the rule that refused; grants never
need reissuing for it.

Next: [05 · Money moves](../05-money-moves/README.md).
