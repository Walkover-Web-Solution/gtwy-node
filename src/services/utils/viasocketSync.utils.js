import axios from "axios";
import configurationModel from "../../mongoModel/Configuration.model.js";
import versionModel from "../../mongoModel/BridgeVersion.model.js";
import Helper from "./helper.utils.js";

const getViasocketEmbedToken = ({ org_id, folder_id = null, user_id = null, isEmbedUser = false }) => {
  let viasocket_embed_user_id = String(org_id);
  if (user_id && isEmbedUser && folder_id) {
    viasocket_embed_user_id = `${viasocket_embed_user_id}_${folder_id}_${user_id}`;
  }

  return Helper.generate_token(
    {
      org_id: process.env.ORG_ID,
      project_id: process.env.PROJECT_ID,
      user_id: viasocket_embed_user_id
    },
    process.env.ACCESS_KEY
  );
};

const getVersionDocFromToolReferences = async (tool, org_id, explicitVersionId = null) => {
  if (explicitVersionId) {
    try {
      const explicitVersionDoc = await versionModel.findById(explicitVersionId).lean();
      if (explicitVersionDoc) {
        return explicitVersionDoc;
      }
    } catch {
      // ignore invalid explicit version id and continue fallback
    }
  }

  const versionIds = Array.isArray(tool?.version_ids) ? tool.version_ids : [];
  const bridgeIds = Array.isArray(tool?.bridge_ids) ? tool.bridge_ids : [];
  const candidates = [...versionIds, ...bridgeIds].filter(Boolean);

  for (const candidateId of candidates) {
    try {
      const versionDoc = await versionModel.findById(candidateId).lean();
      if (versionDoc) {
        return versionDoc;
      }
    } catch {
      // ignore invalid ids
    }

    try {
      const bridgeDoc = await configurationModel.findOne({ _id: candidateId, org_id }, { published_version_id: 1, versions: 1 }).lean();
      if (!bridgeDoc) {
        continue;
      }

      const versionIdToUse =
        bridgeDoc.published_version_id ||
        (Array.isArray(bridgeDoc.versions) && bridgeDoc.versions.length > 0 ? bridgeDoc.versions[bridgeDoc.versions.length - 1] : null);

      if (!versionIdToUse) {
        continue;
      }

      const versionDoc = await versionModel.findById(versionIdToUse).lean();
      if (versionDoc) {
        return versionDoc;
      }
    } catch {
      // ignore invalid ids
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

const getStaticVariablesBySource = (tool, versionDoc, source = "tool") => {
  if (source === "pre_tool") {
    return buildPreToolStaticVariables(tool, versionDoc);
  }
  if (source === "tool") {
    return buildToolStaticVariables(tool, versionDoc);
  }

  // Auto: use pre-tool args only when this function is the configured custom pre-tool in the resolved version.
  const preToolVars = buildPreToolStaticVariables(tool, versionDoc);
  if (Object.keys(preToolVars).length > 0) {
    return preToolVars;
  }
  return buildToolStaticVariables(tool, versionDoc);
};

const syncToolToViasocketEmbed = async (tool, org_id, tokenContext = {}, explicitVersionId = null, source = "auto") => {
  if (!tool?.script_id) {
    return { success: false, reason: "Missing script_id" };
  }

  const versionDoc = await getVersionDocFromToolReferences(tool, org_id, explicitVersionId);
  const staticVariables = getStaticVariablesBySource(tool, versionDoc, source);
  const embedToken = getViasocketEmbedToken({ org_id, ...tokenContext });
  const url = `https://flow-api.viasocket.com/projects/updateflowembed/${tool.script_id}`;
  const payload = {
    AISchema: {
      properties: tool.fields || {},
      required: tool.required || tool.required_params || []
    },
    staticVariables
  };
  const response = await axios.put(url, payload, {
    headers: {
      "Content-Type": "application/json",
      authorization: embedToken
    }
  });

  console.log(`Viasocket updateflowembed response for ${tool.script_id}:`, response?.data);

  return { success: true };
};

export {
  getViasocketEmbedToken,
  getVersionDocFromToolReferences,
  buildToolStaticVariables,
  buildPreToolStaticVariables,
  getStaticVariablesBySource,
  syncToolToViasocketEmbed
};
