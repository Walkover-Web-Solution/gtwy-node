/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
import axios from "axios";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

const UPDATE_FLOW_URL = "https://flow-api.viasocket.com/projects/updateflowembed";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 400;

export const up = async (db) => {
  const apiCalls = await db.collection("aicalls").find({}).toArray();

  const bridgeIds = new Set();
  const versionIds = new Set();

  for (const apiCall of apiCalls) {
    for (const bridgeId of apiCall.bridge_ids || []) {
      if (ObjectId.isValid(bridgeId)) {
        bridgeIds.add(bridgeId.toString());
      }
    }

    for (const versionId of apiCall.version_ids || []) {
      if (ObjectId.isValid(versionId)) {
        versionIds.add(versionId.toString());
      }
    }
  }

  const [bridgeDocs, versionDocs] = await Promise.all([
    bridgeIds.size > 0
      ? db
          .collection("configurations")
          .find({ _id: { $in: [...bridgeIds].map((id) => new ObjectId(id)) } })
          .toArray()
      : [],
    versionIds.size > 0
      ? db
          .collection("configuration_versions")
          .find({ _id: { $in: [...versionIds].map((id) => new ObjectId(id)) } })
          .toArray()
      : []
  ]);

  const bridgeMap = new Map(bridgeDocs.map((doc) => [doc._id.toString(), doc]));
  const versionMap = new Map(versionDocs.map((doc) => [doc._id.toString(), doc]));

  const accessKey = process.env.ACCESS_KEY;
  const orgId = process.env.ORG_ID;
  const projectId = process.env.PROJECT_ID;

  if (!accessKey || !orgId || !projectId) {
    throw new Error("ACCESS_KEY, ORG_ID, and PROJECT_ID must be set to sync tools to ViaSocket.");
  }

  const failures = [];

  for (const apiCall of apiCalls) {
    const scriptId = apiCall.script_id;
    if (!scriptId) {
      continue;
    }

    const sourceFields = hasMeaningfulFields(apiCall.fields) ? apiCall.fields : apiCall.old_fields || {};
    const staticVariables = buildStaticVariables(scriptId, apiCall, bridgeMap, versionMap);
    const payload = buildFlowEmbedPayload(apiCall, sourceFields, staticVariables);
    const userIds = buildViaSocketUserIds(apiCall, bridgeMap, versionMap);

    for (const userId of userIds) {
      const embedToken = jwt.sign(
        {
          org_id: orgId,
          project_id: projectId,
          user_id: userId
        },
        accessKey,
        { algorithm: "HS256" }
      );

      try {
        await putFlowEmbedWithRetry(scriptId, embedToken, payload);
      } catch (error) {
        failures.push({
          script_id: scriptId,
          user_id: userId,
          error: error?.response?.data || error.message
        });
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`ViaSocket sync failed for ${failures.length} tool(s). First failure: ${JSON.stringify(failures[0])}`);
  }
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async () => {
  // No rollback for an external API sync migration.
};

function hasMeaningfulFields(fields) {
  return fields && typeof fields === "object" && Object.keys(fields).length > 0;
}

function buildAiSchema(fields = {}, required = []) {
  return {
    properties: buildSchemaProperties(fields),
    required: Array.isArray(required) ? required : []
  };
}

function buildFlowEmbedPayload(apiCall = {}, fields = {}, staticVariables = {}) {
  const title = getToolTitle(apiCall);
  return {
    description: apiCall?.description || "",
    title,
    endpoint_name: title,
    AISchema: buildAiSchema(fields, Array.isArray(apiCall?.required_params) ? apiCall.required_params : []),
    staticVariables
  };
}

function getToolTitle(apiCall = {}) {
  return apiCall?.title || apiCall?.endpoint_name || apiCall?.function_name || apiCall?.script_id || "";
}

function buildSchemaProperties(fields = {}) {
  const properties = {};

  for (const [key, field] of Object.entries(fields || {})) {
    properties[key] = buildSchemaNode(field);
  }

  return properties;
}

function buildSchemaNode(field = {}) {
  const type = field?.type || "string";
  const schema = {
    type,
    description: field?.description || ""
  };

  if (Array.isArray(field?.enum)) {
    schema.enum = field.enum;
  }

  if (type === "object") {
    schema.properties = buildSchemaProperties(field?.properties || field?.parameter || {});
    schema.required = Array.isArray(field?.required_params) ? field.required_params : Array.isArray(field?.required) ? field.required : [];
  }

  if (type === "array") {
    schema.items = field?.items ? buildSchemaNode(field.items) : {};
  }

  return schema;
}

function buildStaticVariables(scriptId, apiCall, bridgeMap, versionMap) {
  const staticVariables = {};
  const sourceIds = [...(apiCall.bridge_ids || []), ...(apiCall.version_ids || [])];

  for (const sourceId of sourceIds) {
    const sourceDoc = bridgeMap.get(sourceId.toString()) || versionMap.get(sourceId.toString());
    const variablesPath = sourceDoc?.variables_path?.[scriptId];

    if (!variablesPath || typeof variablesPath !== "object") {
      continue;
    }

    for (const key of Object.keys(variablesPath)) {
      staticVariables[key] = true;
    }
  }

  return staticVariables;
}

function buildViaSocketUserIds(apiCall, bridgeMap, versionMap) {
  const orgScopedUserId = toStringOrEmpty(apiCall?.org_id);
  const fallbackUserId = orgScopedUserId || toStringOrEmpty(process.env.ORG_ID);

  const sourceDocs = getLinkedSourceDocs(apiCall, bridgeMap, versionMap);
  const folderId = toStringOrEmpty(apiCall?.folder_id) || sourceDocs.map((doc) => toStringOrEmpty(doc?.folder_id)).find(Boolean) || "";
  const userId = toStringOrEmpty(apiCall?.user_id) || sourceDocs.map((doc) => toStringOrEmpty(doc?.user_id)).find(Boolean) || "";

  const userIds = [fallbackUserId];

  // Match app behavior for folder embed users: <org_id>_<folder_id>_<user_id>
  if (orgScopedUserId && folderId && userId) {
    userIds.push(`${orgScopedUserId}_${folderId}_${userId}`);
  }

  return [...new Set(userIds.filter(Boolean))];
}

function getLinkedSourceDocs(apiCall, bridgeMap, versionMap) {
  const sourceIds = [...(apiCall?.bridge_ids || []), ...(apiCall?.version_ids || [])];
  return sourceIds.map((sourceId) => bridgeMap.get(sourceId?.toString()) || versionMap.get(sourceId?.toString())).filter(Boolean);
}

function toStringOrEmpty(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value).trim();
  return stringValue;
}

async function putFlowEmbedWithRetry(scriptId, embedToken, payload) {
  const url = `${UPDATE_FLOW_URL}/${scriptId}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await axios.put(url, payload, {
        headers: {
          Authorization: embedToken,
          "Content-Type": "application/json"
        }
      });
      return;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = RETRY_BASE_DELAY_MS * attempt;
      await wait(delay);
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
