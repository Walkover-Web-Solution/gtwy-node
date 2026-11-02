/**
 * Migration: add batch prices to the specification of every batch model.
 *
 * Batch jobs are priced by the Python repo's batch cron
 * (src/services/utils/batch_script.py) as the normal cost * 0.5. This stores
 * the batch price on the model itself, next to the normal prices in
 * validationConfig.specification:
 *
 *   batch_input_cost  = input_cost  * factor
 *   batch_output_cost = output_cost * factor
 *   batch_cached_cost = cached_cost * factor
 *
 * A batch key is written only when its normal price is a number on that model,
 * so image/audio models (empty specification) are left alone. Only services
 * with a batch handler (BATCH_RESULT_HANDLERS in the Python repo's
 * src/services/utils/batch_script_utils.py) are touched. All of them charge
 * 50% of the normal price for batch today; the factor is kept per service so
 * one can change on its own.
 *
 * Data only: no code reads these keys yet, the batch cron still uses * 0.5.
 * Safe to re-run: the batch prices are recomputed from the normal prices.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const BATCH_PRICE_FACTOR = {
  openai: 0.5,
  anthropic: 0.5,
  gemini: 0.5,
  groq: 0.5,
  mistral: 0.5
};

const SPEC = "validationConfig.specification";
const PRICE_KEYS = ["input_cost", "output_cost", "cached_cost"];

// Normal price * factor when the normal price is a number, else no batch key.
const batchPrice = (key, factor) => ({
  $cond: [{ $isNumber: `$${SPEC}.${key}` }, { $multiply: [`$${SPEC}.${key}`, factor] }, "$$REMOVE"]
});

export const up = async (db) => {
  const collection = db.collection("modelconfigurations");

  for (const [service, factor] of Object.entries(BATCH_PRICE_FACTOR)) {
    const batchPrices = Object.fromEntries(PRICE_KEYS.map((key) => [`${SPEC}.batch_${key}`, batchPrice(key, factor)]));
    const result = await collection.updateMany({ service, $or: PRICE_KEYS.map((key) => ({ [`${SPEC}.${key}`]: { $type: "number" } })) }, [
      { $set: { ...batchPrices, updated_at: "$$NOW" } }
    ]);
    console.log(`[batch pricing] ${service}: ${result.modifiedCount} of ${result.matchedCount} models updated.`);
  }
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const result = await db
    .collection("modelconfigurations")
    .updateMany(
      { service: { $in: Object.keys(BATCH_PRICE_FACTOR) } },
      { $unset: Object.fromEntries(PRICE_KEYS.map((key) => [`${SPEC}.batch_${key}`, ""])) }
    );
  console.log(`[batch pricing] removed batch prices from ${result.modifiedCount} models.`);
};
