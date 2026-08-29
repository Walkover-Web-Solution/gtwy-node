/**
 * Migration: backfill capability flags on existing `services` documents.
 *
 * Two independent backfills, both prerequisites for moving service behaviour out
 * of hardcoded Python allow-lists and into the registry.
 *
 * 1. apikey_status_codes — the Python middleware used to carry its own per-service
 *    HTTP-code table (api_key_status_helper.SERVICE_MAPPERS) and now reads these
 *    fields instead. Two documents disagreed with that table and would silently
 *    change behaviour on the switch:
 *      - anthropic: seeded without 400 (invalid) and 402 (unauthorized), so those
 *        codes would start reporting the key as "working".
 *      - minimax:   never seeded at all, so every code would report "working".
 *    Values here reproduce the old Python table exactly, making the switch a no-op.
 *
 * 2. supports_batch — batch result parsing is being gated on this flag. No document
 *    carries it today, so without this backfill every service would be treated as
 *    batch-incapable. True for the five services with a batch handler
 *    (gemini, anthropic, openai, groq, mistral), false for the rest.
 *
 * Idempotent: plain $set on documents matched by service_name; a service that does
 * not exist is a no-op rather than an insert.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

// Mirrors the retired Python SERVICE_MAPPERS entries that the seeded documents did
// not already match.
const APIKEY_STATUS_CODE_FIXES = {
  anthropic: { invalid: [400, 401], unauthorized: [402, 403], limited: [429] },
  minimax: { invalid: [401], unauthorized: [403], limited: [429] }
};

// Services with a handler registered in batch_script_utils.BATCH_RESULT_HANDLERS.
const BATCH_CAPABLE = ["gemini", "anthropic", "openai", "groq", "mistral"];

export const up = async (db) => {
  const collection = db.collection("services");

  const operations = Object.entries(APIKEY_STATUS_CODE_FIXES).map(([serviceName, codes]) => ({
    updateOne: {
      filter: { service_name: serviceName },
      update: { $set: { apikey_status_codes: codes } }
    }
  }));

  const allServices = await collection.distinct("service_name");
  for (const serviceName of allServices) {
    operations.push({
      updateOne: {
        filter: { service_name: serviceName },
        update: { $set: { supports_batch: BATCH_CAPABLE.includes(serviceName) } }
      }
    });
  }

  const result = await collection.bulkWrite(operations, { ordered: false });
  console.log(`Backfilled service capability flags: ${result.modifiedCount} documents updated.`);
};

/**
 * Only supports_batch is removed. apikey_status_codes is left in place: it is a
 * field the seed migration owns, and unsetting it would leave those services with
 * no api-key status mapping at all.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const result = await db.collection("services").updateMany({}, { $unset: { supports_batch: "" } });
  console.log(`Removed supports_batch from ${result.modifiedCount} services.`);
};
