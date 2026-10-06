import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
