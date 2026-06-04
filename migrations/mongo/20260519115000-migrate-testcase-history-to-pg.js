import pg from "pg";

const BATCH_SIZE = 500;

function getPgClient() {
  return new pg.Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS
  });
}

function sanitize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj.replace(/\0/g, "");
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = sanitize(obj[k]);
    return out;
  }
  return obj;
}

async function insertBatch(pgClient, rows) {
  if (rows.length === 0) return;

  const columns = [
    "message_id",
    "bridge_id",
    "version_id",
    "org_id",
    "testcase_id",
    "testcase_data",
    "chatbot_message",
    "status",
    "user_feedback",
    "tools_call_data",
    "user_urls",
    "llm_urls",
    "created_at",
    "updated_at"
  ];

  // message_id has no unique constraint, so filter out already-inserted rows manually
  const messageIds = rows.map((r) => r.message_id);
  const { rows: existing } = await pgClient.query(`SELECT message_id FROM conversation_logs WHERE message_id = ANY($1::text[])`, [messageIds]);
  const existingSet = new Set(existing.map((r) => r.message_id));
  const newRows = rows.filter((r) => !existingSet.has(r.message_id));

  if (newRows.length === 0) return;

  const placeholders = newRows
    .map((_, rowIdx) => `(${columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(", ")})`)
    .join(", ");

  const values = newRows.flatMap((row) => columns.map((col) => row[col]));

  await pgClient.query(
    `INSERT INTO conversation_logs (${columns.join(", ")})
     VALUES ${placeholders}`,
    values
  );
}

/**
 * Reads every document from the `testcases_history` MongoDB collection and
 * inserts a corresponding row into the Postgres `conversation_logs` table.
 *
 * Run AFTER the PG migration (add-testcase-columns-conversation-logs) so the
 * testcase_id / testcase_data columns already exist.
 * Run BEFORE the drop-testcases_history_collection Mongo migration.
 *
 * @param db {import('mongodb').Db}
 */
export const up = async (db) => {
  const collections = await db.listCollections({ name: "testcases_history" }).toArray();
  if (collections.length === 0) {
    console.log("testcases_history collection not found — skipping.");
    return;
  }

  const collection = db.collection("testcases_history");
  const totalCount = await collection.countDocuments();
  console.log(`Found ${totalCount} testcase history records to migrate.`);

  if (totalCount === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  // Build bridge_id → org_id lookup from configurations
  const configDocs = await db
    .collection("configurations")
    .find({}, { projection: { _id: 0, bridge_id: 1, org_id: 1 } })
    .toArray();

  const bridgeToOrg = new Map();
  for (const c of configDocs) {
    if (c.bridge_id && c.org_id) bridgeToOrg.set(String(c.bridge_id), String(c.org_id));
  }

  const pgClient = getPgClient();
  await pgClient.connect();

  try {
    let batch = [];
    let migratedCount = 0;
    let skippedCount = 0;

    const cursor = collection.find({});

    for await (const doc of cursor) {
      const createdAt = doc.created_at ? new Date(doc.created_at) : new Date();

      const row = sanitize({
        message_id: doc._id.toString(),
        bridge_id: doc.bridge_id || null,
        version_id: doc.version_id || null,
        org_id: bridgeToOrg.get(String(doc.bridge_id)) || null,
        testcase_id: doc.testcase_id ? String(doc.testcase_id) : null,
        testcase_data: JSON.stringify({
          score: doc.score ?? null,
          model_output: doc.model_output ?? null,
          metadata: doc.metadata ?? {}
        }),
        chatbot_message: doc.model_output || null,
        status: true,
        user_feedback: 0,
        tools_call_data: JSON.stringify([]),
        user_urls: JSON.stringify([]),
        llm_urls: JSON.stringify([]),
        created_at: createdAt,
        updated_at: createdAt
      });

      batch.push(row);

      if (batch.length >= BATCH_SIZE) {
        await insertBatch(pgClient, batch);
        migratedCount += batch.length;
        console.log(`Migrated ${migratedCount}/${totalCount}...`);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await insertBatch(pgClient, batch);
      migratedCount += batch.length;
    }

    console.log(`Migration complete. Migrated: ${migratedCount}, Skipped (conflicts): ${skippedCount}.`);
  } finally {
    await pgClient.end();
  }
};

/**
 * Down: removes the rows that were inserted by this migration.
 * Identified by message_id values that match Mongo ObjectId strings
 * (24-char hex) and have testcase_data set.
 *
 * NOTE: this will also remove any live testcase rows written by the log queue
 * after the migration ran — only use during a full rollback of the feature.
 *
 * @param db {import('mongodb').Db}
 */
export const down = async (db) => {
  const collections = await db.listCollections({ name: "testcases_history" }).toArray();
  if (collections.length === 0) {
    console.log("testcases_history collection not found — cannot rebuild the delete list.");
  }

  const pgClient = getPgClient();
  await pgClient.connect();

  try {
    if (collections.length > 0) {
      // Delete only the specific rows we inserted (matched by their mongo _id as message_id)
      const docs = await db
        .collection("testcases_history")
        .find({}, { projection: { _id: 1 } })
        .toArray();
      const ids = docs.map((d) => d._id.toString());

      if (ids.length > 0) {
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const batch = ids.slice(i, i + BATCH_SIZE);
          await pgClient.query(`DELETE FROM conversation_logs WHERE message_id = ANY($1::text[])`, [batch]);
        }
        console.log(`Rollback complete. Removed ${ids.length} rows.`);
      }
    } else {
      // Fallback: delete all rows that look like migrated testcase records
      const result = await pgClient.query(
        `DELETE FROM conversation_logs WHERE testcase_id IS NOT NULL AND testcase_data IS NOT NULL AND message_id ~ '^[0-9a-f]{24}$'`
      );
      console.log(`Rollback complete (fallback). Removed ${result.rowCount} rows.`);
    }
  } finally {
    await pgClient.end();
  }
};
