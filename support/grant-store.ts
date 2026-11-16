import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkloadPrivateJwk } from "@near-intents-agent-api/sdk";

/**
 * Example-only grant storage.
 *
 * A real backend stores the grant token encrypted in its database. These examples need to pass
 * one between scripts, so they persist it under `examples/.intents/` (gitignored). Never store
 * grant tokens in plain files in production.
 */

const directory = join(process.cwd(), ".intents");

export type StoredGrant = {
  agent_id: string;
  grant_id: string;
  token: string;
  label: string;
  expires_at: string;
};

export async function saveGrant(grant: StoredGrant) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${grant.agent_id}.grant.json`), JSON.stringify(grant, null, 2), {
    mode: 0o600,
  });
  return grant;
}

export async function loadGrant(agentId: string): Promise<StoredGrant> {
  try {
    return JSON.parse(await readFile(join(directory, `${agentId}.grant.json`), "utf8"));
  } catch {
    throw new Error(
      `No stored grant for agent ${agentId}; run "pnpm 04:issue-grant" first (examples/.intents/)`,
    );
  }
}

/**
 * A key-bound grant: the workload's private key and the grant it was bound to. The private key
 * belongs on the workload (a file, a TPM, a KMS) and nowhere else; these examples keep it here
 * so the issuing script and the delegating script can be two separate runs.
 */
export type StoredKeyGrant = {
  agent_id: string;
  grant_id: string;
  label: string;
  expires_at: string;
  private_jwk: WorkloadPrivateJwk;
};

export async function saveKeyGrant(grant: StoredKeyGrant) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${grant.agent_id}.key-grant.json`),
    JSON.stringify(grant, null, 2),
    { mode: 0o600 },
  );
  return grant;
}

export async function loadKeyGrant(agentId: string): Promise<StoredKeyGrant> {
  try {
    return JSON.parse(await readFile(join(directory, `${agentId}.key-grant.json`), "utf8"));
  } catch {
    throw new Error(
      `No stored key grant for agent ${agentId}; run "pnpm 04:issue-key-grant" first (examples/.intents/)`,
    );
  }
}
