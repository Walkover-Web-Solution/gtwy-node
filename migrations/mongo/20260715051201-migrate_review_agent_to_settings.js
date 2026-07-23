/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  console.log("=== Starting migrate_review_agent_to_settings migration ===");

  const collections = [
    { name: "configurations", label: "configurations (agents)" },
    { name: "configuration_versions", label: "configuration_versions (versions)" }
  ];

  for (const { name, label } of collections) {
    console.log(`\n[${label}] Processing...`);
    const coll = db.collection(name);

    // Find all documents where outer reviewer_agent exists
    const cursor = coll.find({
      reviewer_agent: { $exists: true }
    });

    let processed = 0;
    let modified = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();

      const settings = doc.settings || {};
      const reviewAgentConfig = settings.review_agent || {};

      let hasChanges = false;
      const unsetOp = {};

      // 1. Check outer reviewer_agent
      if (doc.reviewer_agent !== undefined) {
        reviewAgentConfig.reviewer_agent =
          typeof doc.reviewer_agent === "string" ? doc.reviewer_agent : doc.reviewer_agent ? doc.reviewer_agent.toString() : null;
        reviewAgentConfig.reviewer_enabled = true;
        unsetOp.reviewer_agent = "";
        hasChanges = true;
      }

      if (hasChanges) {
        settings.review_agent = reviewAgentConfig;

        const updateDoc = {
          $set: { settings }
        };

        if (Object.keys(unsetOp).length > 0) {
          updateDoc.$unset = unsetOp;
        }

        await coll.updateOne({ _id: doc._id }, updateDoc);
        modified++;
      }
      processed++;
    }

    console.log(`[${label}] Done. Processed ${processed} docs, modified ${modified}.`);
  }

  console.log("\n=== Migration completed successfully ===");
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  console.log("=== Starting rollback of migrate_review_agent_to_settings migration ===");

  const collections = [
    { name: "configurations", label: "configurations (agents)" },
    { name: "configuration_versions", label: "configuration_versions (versions)" }
  ];

  for (const { name, label } of collections) {
    console.log(`\n[${label}] Processing rollback...`);
    const coll = db.collection(name);

    const cursor = coll.find({ "settings.review_agent": { $exists: true } });

    let processed = 0;
    let modified = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const reviewAgent = doc.settings?.review_agent;

      if (reviewAgent && reviewAgent.reviewer_agent) {
        await coll.updateOne(
          { _id: doc._id },
          {
            $set: { reviewer_agent: reviewAgent.reviewer_agent },
            $unset: { "settings.review_agent": "" }
          }
        );
        modified++;
      }
      processed++;
    }

    console.log(`[${label}] Rollback done. Processed ${processed} docs, modified ${modified}.`);
  }

  console.log("\n=== Rollback completed successfully ===");
};
