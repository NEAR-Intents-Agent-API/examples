/**
 * Archive, restore and delete an agent.
 *
 * What: archives and restores the account; on `AGENT_EXECUTE=true`, deletes it if no balance
 *       would be lost.
 * When: retiring an account. Archive is reversible; deletion is not.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`; `AGENT_EXECUTE=true` for deletion.
 * Run: `pnpm 06:archive-and-delete`
 *
 * Archive does not delete custody — it stops the account being usable while keeping the wallet
 * and its history. Deletion previews exactly what would be destroyed. If `assets_lost` is true,
 * withdraw the public and confidential balances first: this example refuses to continue.
 */
import { type AgentApi, agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { waitForStatus } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

async function control(
  api: AgentApi,
  agentId: string,
  type: "agent_archive" | "agent_restore" | "agent_delete",
  keyPair: ReturnType<typeof loadOwner>["keyPair"],
  rpcUrl: string,
) {
  const generated = await api.generateIntent(
    { type, agent_id: agentId },
    { idempotencyKey: crypto.randomUUID() },
  );
  // Check the preview before the owner signs: deletion is permanent and loses every balance.
  if (generated.preview.deletion?.assets_lost)
    throw new Error(
      "Deletion would destroy balances. Withdraw public and confidential funds first, then retry.",
    );
  await api.submitIntent({
    type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, rpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `${type} ${status.status}`);
  return status;
}

export async function archiveAndDelete(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  const archived = await control(api, agentId, "agent_archive", keyPair, settings.nearRpcUrl);
  const afterArchive = await api.getAgent(agentId);
  const restored = await control(api, agentId, "agent_restore", keyPair, settings.nearRpcUrl);
  const afterRestore = await api.getAgent(agentId);

  if (!settings.execute) {
    return {
      archive: { status: archived.status, archived: afterArchive.archived },
      restore: { status: restored.status, archived: afterRestore.archived },
      note: "Set AGENT_EXECUTE=true to delete. Deletion is irreversible.",
    };
  }
  const deleted = await control(api, agentId, "agent_delete", keyPair, settings.nearRpcUrl);
  const afterDelete = await api.getAgent(agentId);
  return {
    archive: { status: archived.status, archived: afterArchive.archived },
    restore: { status: restored.status, archived: afterRestore.archived },
    delete: {
      status: deleted.status,
      deleted: afterDelete.deleted,
      status_now: afterDelete.status,
    },
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("archiving an agent");
  banner([`Archiving, restoring${config().execute ? " and deleting" : ""}…`]);
  void archiveAndDelete(required(config().agentId, "AGENT_ID")).then(print);
}
