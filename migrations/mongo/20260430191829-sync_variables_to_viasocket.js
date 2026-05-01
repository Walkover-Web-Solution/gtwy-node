import axios from "axios";
import { ObjectId } from "mongodb";
import Helper from "../../src/services/utils/helper.utils.js";

const BATCH_SIZE = 50;
const toObjectId = (value) => {
  try {
    return new ObjectId(value);
  } catch {
    return null;
  }
};

const getVersionDocFromTool = async (db, tool) => {
  const versionsCollection = db.collection("configuration_versions");
  const configurationsCollection = db.collection("configurations");

  const versionIds = Array.isArray(tool?.version_ids) ? tool.version_ids : [];
  const bridgeIds = Array.isArray(tool?.bridge_ids) ? tool.bridge_ids : [];
  const candidates = [...versionIds, ...bridgeIds].filter(Boolean);

  for (const candidateId of candidates) {
    const candidateObjectId = toObjectId(candidateId);
    const versionDoc = await versionsCollection.findOne(candidateObjectId ? { _id: candidateObjectId } : { _id: candidateId });
    if (versionDoc) {
      return versionDoc;
    }

    const bridgeDoc = await configurationsCollection.findOne(
      candidateObjectId ? { _id: candidateObjectId, org_id: tool.org_id } : { _id: candidateId, org_id: tool.org_id },
      { projection: { published_version_id: 1, versions: 1 } }
    );

    if (!bridgeDoc) {
      continue;
    }

    const versionIdToUse =
      bridgeDoc.published_version_id ||
      (Array.isArray(bridgeDoc.versions) && bridgeDoc.versions.length > 0 ? bridgeDoc.versions[bridgeDoc.versions.length - 1] : null);

    if (!versionIdToUse) {
      continue;
    }

    const versionObjectId = toObjectId(versionIdToUse);
    const resolvedVersionDoc = await versionsCollection.findOne(versionObjectId ? { _id: versionObjectId } : { _id: versionIdToUse });
    if (resolvedVersionDoc) {
      return resolvedVersionDoc;
    }
  }

  return null;
};

const buildToolStaticVariables = (tool, versionDoc) => {
  const staticVariables = {};
  const scriptId = tool?.script_id;
  const variablesPath = versionDoc?.variables_path || {};

  if (scriptId && variablesPath && typeof variablesPath[scriptId] === "object" && variablesPath[scriptId] !== null) {
    Object.assign(staticVariables, variablesPath[scriptId]);
  }

  return staticVariables;
};

const buildPreToolStaticVariables = (tool, versionDoc) => {
  const staticVariables = {};
  const preTools = Array.isArray(versionDoc?.pre_tools) ? versionDoc.pre_tools : [];
  const toolId = tool?._id?.toString?.() || tool?._id || null;

  for (const preTool of preTools) {
    if (preTool?.type !== "custom_function" || !preTool?.config?.function_id) {
      continue;
    }
    if (toolId && preTool.config.function_id.toString() !== toolId.toString()) {
      continue;
    }
    if (preTool?.args && typeof preTool.args === "object" && !Array.isArray(preTool.args)) {
      Object.assign(staticVariables, preTool.args);
      break;
    }
  }

  return staticVariables;
};

const getStaticVariablesBySource = (tool, versionDoc, source) => {
  if (source === "tool") {
    return buildToolStaticVariables(tool, versionDoc);
  }
  if (source === "pre_tool") {
    return buildPreToolStaticVariables(tool, versionDoc);
  }

  const preToolVars = buildPreToolStaticVariables(tool, versionDoc);
  if (Object.keys(preToolVars).length > 0) {
    return preToolVars;
  }
  return buildToolStaticVariables(tool, versionDoc);
};

const getViasocketEmbedUserId = (tool) => {
  let viasocketEmbedUserId = String(tool.org_id);
  const toolUserId = tool?.user_id ? String(tool.user_id) : "";
  const toolFolderId = tool?.folder_id ? String(tool.folder_id) : "";

  // Match getAllAgent style for embed-scoped identity.
  if (toolUserId && toolFolderId) {
    viasocketEmbedUserId = `${viasocketEmbedUserId}_${toolFolderId}_${toolUserId}`;
  }

  return viasocketEmbedUserId;
};

const getViasocketEmbedToken = (tool) =>
  Helper.generate_token(
    {
      org_id: process.env.ORG_ID,
      project_id: process.env.PROJECT_ID,
      user_id: getViasocketEmbedUserId(tool)
    },
    process.env.ACCESS_KEY
  );

const syncToolToViasocket = async (db, tool, explicitVersionDoc = null, source = "auto") => {
  if (!tool?.script_id) {
    throw new Error("Missing script_id");
  }
  if (!tool?.org_id) {
    throw new Error("Missing org_id in apicalls document");
  }

  const versionDoc = explicitVersionDoc || (await getVersionDocFromTool(db, tool));
  const staticVariables = getStaticVariablesBySource(tool, versionDoc, source);
  const embedToken = getViasocketEmbedToken(tool);

  await axios.put(
    `https://flow-api.viasocket.com/projects/updateflowembed/${tool.script_id}`,
    {
      AISchema: {
        properties: tool.fields || {},
        required: tool.required || tool.required_params || []
      },
      staticVariables
    },
    {
      headers: {
        "Content-Type": "application/json",
        authorization: embedToken
      }
    }
  );
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const apiCallsCollection = db.collection("apicalls");
  let processed = 0;
  let failed = 0;
  let offset = 0;

  while (true) {
    const tools = await apiCallsCollection.find({}).skip(offset).limit(BATCH_SIZE).toArray();
    if (tools.length === 0) {
      break;
    }

    for (const tool of tools) {
      try {
        await syncToolToViasocket(db, tool);
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `Viasocket sync failed for tool ${tool?._id?.toString?.() || "unknown"} (script_id: ${tool?.script_id || "N/A"}):`,
          error.message
        );
      }
    }

    offset += tools.length;
  }

  console.log(`Viasocket sync migration completed. Success: ${processed}, Failed: ${failed}`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async () => {
  // No rollback: this migration syncs external Viasocket embed metadata.
};
