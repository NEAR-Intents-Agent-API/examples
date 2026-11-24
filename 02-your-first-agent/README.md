# 02 · Your first agent

Create one agent account, sign once, and read everything it owns.

| Example | Run | What it shows |
|---|---|---|
| `01-create-agent.ts` | `pnpm 02:create-agent` | The owner onboarding flow: `agent_create` → wallet signs → submit → active |
| `02-inspect-agent.ts` | `pnpm 02:inspect-agent` | Agent, wallet and NEAR address, policy and its revisions, balances (held and available), history and provider records in one read |
| `03-multiple-agents.ts` | `pnpm 02:multiple-agents` | One owner, several agents (each with its own agent wallet) |
| `04-create-with-grant.ts` | `pnpm 02:create-with-grant` | One signature creates the agent and its first grant: `verifyAgentCreateIntent` before signing, `grant_install` after |

## The owner flow

```
your backend                     owner's wallet                 API
    │ generate-intent  ────────────────────────────────────────▶ intent {standard, payload}
    │ persist correlation_id
    │                  ── sign(payload) ──▶ signature
    │ submit-intent    ────────────────────────────────────────▶ status
    │ status?correlation_id=…         ─────────────────────────▶ SUCCESS
```

The wallet signs `intent.payload` **exactly as returned**. Your backend never rebuilds it. Select
the wallet method from `intent.standard`: `nep413` for off-chain consent, `nep366` for gasless
on-chain updates (NEAR), `eip712` (EVM), `webauthn` (passkey). See
[03 · Owner wallets](../03-owner-wallets/README.md).

`AGENT_ALLOW_WRITES=true` is required: creating an agent is an on-chain onboarding.

## The first grant in the same signature

`agent_create` takes an optional `grant` with the same terms as `grant_issue`. The grant is hashed
into the policy commitment the owner signs, so one signature creates the agent and authorizes the
grant. A NEAR or EVM wallet shows the owner only that hash (a passkey signs a challenge over it),
so check the payload on your backend before handing it to the wallet:

```ts
const { token, commitment } = createGrantCredential(); // keep the token secret
const grantTerms = {
  label: "Trading assistant", // ASCII only: wallets break on other characters in signed strings
  credential: commitment,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};
const generated = await api.generateIntent({ type: "agent_create", name, owner, policy, grant: grantTerms });
verifyAgentCreateIntent(generated, { grant: grantTerms }); // throws AgentCreateVerificationError
// The wallet signs generated.intent; your backend submits it and polls the status.
status.details.grant_install; // "installed" | "refused:grant_credential_reused" | "refused:grant_expired"
const assistant = api.forGrant(token); // only when "installed"
```

The agent is created whatever `grant_install` says; on a refusal it simply has no grant, and
`04:issue-grant` adds one. `expires_at` must outlast the signing window, and a token already bound
to another grant is refused when you call `generateIntent`, before any agent exists. `listGrants`
shows the grant with `issued_via: { type: "agent_create", … }`.

## What the policy controls

The single policy signed at creation caps everything the account can ever do, across every future
grant. Every field is required: `frozen`, `actions`, `confidential`, `owner_approval`, `assets`,
`limits`, `max_actions_per_hour`, `destinations`, `budget` and `timelock_ms`; `schedule` is optional. A new policy must set `confidential: true`
(the agent's account is its confidential balance), and every `transfer` destination must be a
confidential account. The tight starter
policy allows one asset, one destination and transfers only; deleting the account stays
owner-only. Edit it any time with `policy_update`
(see [06 · Policy and lifecycle](../06-policy-and-lifecycle/README.md)).

Next: [03 · Owner wallets](../03-owner-wallets/README.md).
