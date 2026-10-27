import models from "../../models/index.js";

// Rows of system_prompt_versionings are written by storeSystemPrompt (conversation.service.js)
// on every prompt save, keyed by the parent agent id (bridge_id). Reads are always scoped to the org.

const ATTRIBUTES = ["id", "bridge_id", "version_id", "system_prompt", "created_at"];

async function listPromptVersions({ org_id, bridge_id, version_id, page, limit }) {
  const where = { org_id, bridge_id };
  if (version_id) where.version_id = version_id;

  const { count, rows } = await models.pg.system_prompt_versionings.findAndCountAll({
    where,
    attributes: ATTRIBUTES,
    order: [
      ["created_at", "DESC"],
      ["id", "DESC"]
    ],
    offset: (page - 1) * limit,
    limit,
    raw: true
  });

  return { prompt_versions: rows, total: count };
}

export default {
  listPromptVersions
};
