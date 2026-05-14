import { ObjectId } from "mongodb";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Client: PgClient } = pg;

const PG_CONFIG = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS
};

/**
 * Find bridge_ids where every thread has exactly 1 conversation log.
 * These are "stateless" agents — each thread is a one-shot interaction.
 */
async function fetchStatelessBridgeIds(pgClient) {
  const query = `
    SELECT bridge_id
    FROM (
      SELECT bridge_id, thread_id, COUNT(*) AS conv_count
      FROM conversation_logs
      WHERE bridge_id IS NOT NULL
        AND bridge_id <> ''
        AND thread_id IS NOT NULL
        AND thread_id <> ''
      GROUP BY bridge_id, thread_id
    ) per_thread
    GROUP BY bridge_id
    HAVING MAX(conv_count) = 1
  `;

  const result = await pgClient.query(query);
  return result.rows.map((row) => row.bridge_id);
}

async function fetchBridgeIdsWithConversationLogs(pgClient) {
  const query = `
    SELECT DISTINCT bridge_id
    FROM conversation_logs
    WHERE bridge_id IS NOT NULL
      AND bridge_id <> ''
  `;

  const result = await pgClient.query(query);
  return result.rows.map((row) => row.bridge_id);
}

function toObjectIds(bridgeIds) {
  return bridgeIds.reduce((ids, id) => {
    if (ObjectId.isValid(id)) {
      ids.push(new ObjectId(id));
    }
    return ids;
  }, []);
}

async function fetchApiBridgeIdsWithoutConversationLogs(configurations, bridgeIdsWithConversationLogs) {
  const query = {
    bridgeType: "api",
    _id: { $nin: toObjectIds(bridgeIdsWithConversationLogs) }
  };

  const apiAgents = await configurations.find(query, { projection: { _id: 1 } }).toArray();
  return apiAgents.map((agent) => agent._id.toString());
}

function uniqueBridgeIds(...bridgeIdGroups) {
  return [...new Set(bridgeIdGroups.flat())];
}

async function updateStatelessFlag(db, shouldSetFlag) {
  const pgClient = new PgClient(PG_CONFIG);
  const configurations = db.collection("configurations");
  const configurationVersions = db.collection("configuration_versions");
  const mode = shouldSetFlag ? "up" : "down";

  try {
    console.log(`[${mode}] Connecting to PostgreSQL...`);
    await pgClient.connect();

    const statelessBridgeIdsFromLogs = await fetchStatelessBridgeIds(pgClient);
    const bridgeIdsWithConversationLogs = await fetchBridgeIdsWithConversationLogs(pgClient);
    const apiBridgeIdsWithoutConversationLogs = await fetchApiBridgeIdsWithoutConversationLogs(configurations, bridgeIdsWithConversationLogs);
    const bridgeIds = uniqueBridgeIds(statelessBridgeIdsFromLogs, apiBridgeIdsWithoutConversationLogs);

    console.log(`[${mode}] Stateless bridge_ids from logs found: ${statelessBridgeIdsFromLogs.length}`);
    console.log(`[${mode}] API bridge_ids without conversation logs found: ${apiBridgeIdsWithoutConversationLogs.length}`);
    console.log(`[${mode}] Total stateless bridge_ids found: ${bridgeIds.length}`);

    if (bridgeIds.length === 0) {
      console.log(`[${mode}] No bridge_ids found. Nothing to update.`);
      return { bridgeIds: 0, configurationsUpdated: 0, configurationVersionsUpdated: 0 };
    }

    const objectIds = toObjectIds(bridgeIds);
    const skippedIds = bridgeIds.length - objectIds.length;

    if (skippedIds > 0) {
      console.log(`[${mode}] Skipping ${skippedIds} bridge_id(s) with invalid ObjectId format.`);
    }

    if (objectIds.length === 0) {
      console.log(`[${mode}] No valid ObjectId bridge_ids to update.`);
      return { bridgeIds: bridgeIds.length, configurationsUpdated: 0, configurationVersionsUpdated: 0 };
    }

    const update = shouldSetFlag ? { $set: { "settings.stateless_conversation": true } } : { $unset: { "settings.stateless_conversation": "" } };

    const configResult = await configurations.updateMany({ _id: { $in: objectIds } }, update);
    const versionResult = await configurationVersions.updateMany({ parent_id: { $in: bridgeIds } }, update);

    console.log(`[${mode}] Updated configurations=${configResult.modifiedCount}, configuration_versions=${versionResult.modifiedCount}`);

    return {
      bridgeIds: bridgeIds.length,
      configurationsUpdated: configResult.modifiedCount,
      configurationVersionsUpdated: versionResult.modifiedCount
    };
  } finally {
    await pgClient.end();
  }
}

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  console.log("[up] Starting stateless_conversation migration...");
  await updateStatelessFlag(db, true);
  console.log("[up] Migration completed successfully.");
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  console.log("[down] Reverting stateless_conversation migration...");
  await updateStatelessFlag(db, false);
  console.log("[down] Revert completed successfully.");
};
