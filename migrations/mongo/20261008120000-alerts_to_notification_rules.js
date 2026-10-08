/**
 * Copy every legacy alert (alerts collection) into a notification channel + rule, and seed the
 * internal rule that replaces the Python backend's "default alert".
 *
 * Idempotent: channels and rules are upserted on legacy_alert_id, so re-running only refreshes them.
 * The alerts collection is left untouched (read-only rollback path until cutover).
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
import { buildDefaultAlertDocs, buildDocsFromAlert } from "../../src/services/notifications/legacyAlertMapping.js";

async function upsertPair(db, { channel, rule }) {
  const now = new Date();
  const channelResult = await db
    .collection("notification_channels")
    .findOneAndUpdate(
      { legacy_alert_id: channel.legacy_alert_id },
      { $set: { ...channel, updatedAt: now }, $setOnInsert: { consecutive_failures: 0, createdAt: now } },
      { upsert: true, returnDocument: "after" }
    );
  const channelDoc = channelResult?.value ?? channelResult;
  await db
    .collection("notification_rules")
    .updateOne(
      { legacy_alert_id: rule.legacy_alert_id },
      { $set: { ...rule, channel_ids: [String(channelDoc._id)], updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
}

export const up = async (db) => {
  const cursor = db.collection("alerts").find({});
  let migrated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const alert = await cursor.next();
    if (!alert.org_id || !alert.webhookConfiguration?.url) {
      skipped += 1;
      console.warn(`[alerts_to_notification_rules] Skip ${alert._id}: missing org_id or webhook url`);
      continue;
    }
    await upsertPair(db, buildDocsFromAlert(alert));
    migrated += 1;
  }

  await upsertPair(db, buildDefaultAlertDocs());
  console.log(`[alerts_to_notification_rules] migrated=${migrated} skipped=${skipped} (+ default internal rule)`);
};

export const down = async (db) => {
  // Remove only what this migration created; hand-made channels and rules stay.
  await db.collection("notification_rules").deleteMany({ legacy_alert_id: { $type: "string" } });
  await db.collection("notification_channels").deleteMany({ legacy_alert_id: { $type: "string" } });
};
