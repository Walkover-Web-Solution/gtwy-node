import axios from "axios";
import Helper from "../../src/services/utils/helper.utils.js";

const BATCH_SIZE = 50;

const getViasocketEmbedUserId = (tool) => {
  let viasocketEmbedUserId = String(tool.org_id);
  const toolUserId = tool?.user_id ? String(tool.user_id) : "";
  const toolFolderId = tool?.folder_id ? String(tool.folder_id) : "";

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

const syncToolToViasocket = async (db, tool) => {
  if (!tool?.script_id) {
    throw new Error("Missing script_id");
  }
  if (!tool?.org_id) {
    throw new Error("Missing org_id in apicalls document");
  }

  const embedToken = getViasocketEmbedToken(tool);
  await axios.put(
    `https://flow-api.viasocket.com/projects/updateflowembed/${tool.script_id}`,
    {
      AISchema: {
        properties: tool.fields || {},
        required: tool.required || tool.required_params || []
      }
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

  try {
    while (true) {
      const tools = await apiCallsCollection.find({}).skip(offset).limit(BATCH_SIZE).toArray();
      if (tools.length === 0) break;

      // 1. Fire all API calls in parallel for the current batch
      const results = await Promise.allSettled(tools.map((tool) => syncToolToViasocket(db, tool)));

      // 2. Tally results without throwing
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          processed += 1;
        } else {
          failed += 1;
          const tool = tools[index];
          console.error(
            `Viasocket sync failed for tool ${tool?._id?.toString?.() || "unknown"} (script_id: ${tool?.script_id || "N/A"}):`,
            result.reason?.message
          );
        }
      });

      offset += tools.length;
    }
  } catch (error) {
    console.error("Viasocket sync migration encountered an unexpected error:", error.message);
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
