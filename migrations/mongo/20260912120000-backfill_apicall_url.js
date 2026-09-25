/**
 * Migration: Backfill the `url` field on `apicalls` documents that only have `script_id`.
 *
 * Previously the execution URL for a tool was rebuilt at runtime as
 * `https://flow.sokt.io/func/{script_id}`. We now store the full URL on the document
 * itself, so existing docs need a one-time backfill using the same pattern.
 */

export const up = async (db) => {
  console.log("=== Starting backfill_apicall_url migration ===");

  const coll = db.collection("apicalls");

  const cursor = coll.find({
    script_id: { $exists: true, $ne: "" },
    $or: [{ url: { $exists: false } }, { url: "" }, { url: null }]
  });

  let processed = 0;
  let modified = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    processed += 1;

    if (!doc.script_id) continue;

    const url = `https://flow.sokt.io/func/${doc.script_id}`;
    await coll.updateOne({ _id: doc._id }, { $set: { url } });
    modified += 1;

    if (processed % 500 === 0) {
      console.log(`Processed ${processed} docs so far, modified ${modified}...`);
    }
  }

  console.log(`Done. Processed ${processed} docs, modified ${modified}.`);
  console.log("=== Migration completed successfully ===");
};

export const down = async (db) => {
  const coll = db.collection("apicalls");
  await coll.updateMany({}, { $unset: { url: "" } });
  console.log("Reverted: removed `url` field from all apicalls documents.");
};
