/**
 * Migration: add priority (Fast mode) prices to OpenAI models' specification.
 *
 * OpenAI bills requests sent with service_tier "priority" (renamed "fast" on
 * 2026-07-30, both values still work) at a premium per-token rate. The premium
 * is not one fixed multiplier: it is 2x for most current models, 2.5x for
 * gpt-5.5 and about 1.7-1.8x for gpt-4o, gpt-4.1, o3 and gpt-5-mini. So the
 * prices are stored per model, next to the normal prices in
 * validationConfig.specification:
 *
 *   priority_input_cost, priority_cached_cost, priority_output_cost
 *
 * Prices are per 1M tokens, short context, from https://openai.com/api-fast-mode/
 * (read 2026-11-02). Models that page does not list (gpt-4, gpt-5-nano,
 * gpt-5.4-nano) have no priority tier and are left alone. A listed model that
 * is not in this database is skipped.
 *
 * Data only: no code reads these keys yet. The Python repo still bills a
 * priority response as the normal cost * 2 (src/services/utils/token_calculation.py).
 * Safe to re-run.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const PRIORITY_PRICES = {
  "gpt-6-astra": { input: 20, cached: 2, output: 100 },
  "gpt-6.1-sol": { input: 4, cached: 0.2, output: 20 },
  "gpt-6.1-terra": { input: 2, cached: 0.1, output: 10 },
  "gpt-6-sol": { input: 4, cached: 0.4, output: 20 },
  "gpt-6-luna": { input: 0.2, cached: 0.02, output: 1 },
  "gpt-5.6-sol": { input: 8, cached: 0.8, output: 40 },
  "gpt-5.6-terra": { input: 4, cached: 0.4, output: 24 },
  "gpt-5.6-luna": { input: 0.4, cached: 0.04, output: 2.4 },
  "gpt-5.5": { input: 12.5, cached: 1.25, output: 75 },
  "gpt-5.4-mini": { input: 1.5, cached: 0.15, output: 9 },
  "gpt-5.4": { input: 5, cached: 0.5, output: 30 },
  "gpt-5.2": { input: 3.5, cached: 0.35, output: 28 },
  "gpt-5.1": { input: 2.5, cached: 0.25, output: 20 },
  "gpt-5": { input: 2.5, cached: 0.25, output: 20 },
  "gpt-5-mini": { input: 0.45, cached: 0.045, output: 3.6 },
  "gpt-4.1": { input: 3.5, cached: 0.875, output: 14 },
  "gpt-4.1-mini": { input: 0.7, cached: 0.175, output: 2.8 },
  "gpt-4o": { input: 4.25, cached: 2.125, output: 17 },
  "gpt-4o-2024-08-06": { input: 4.25, cached: 2.125, output: 17 },
  "gpt-4o-mini": { input: 0.25, cached: 0.125, output: 1 },
  "gpt-4o-mini-2024-07-18": { input: 0.25, cached: 0.125, output: 1 },
  o3: { input: 3.5, cached: 0.875, output: 14 }
};

const SPEC = "validationConfig.specification";
const PRIORITY_KEYS = ["priority_input_cost", "priority_cached_cost", "priority_output_cost"];

export const up = async (db) => {
  const now = new Date();
  const operations = Object.entries(PRIORITY_PRICES).map(([modelName, price]) => ({
    updateOne: {
      filter: { service: "openai", model_name: modelName },
      update: {
        $set: {
          [`${SPEC}.priority_input_cost`]: price.input,
          [`${SPEC}.priority_cached_cost`]: price.cached,
          [`${SPEC}.priority_output_cost`]: price.output,
          updated_at: now
        }
      }
    }
  }));

  const result = await db.collection("modelconfigurations").bulkWrite(operations, { ordered: false });
  console.log(`[priority pricing] ${result.modifiedCount} of ${operations.length} OpenAI models updated (${result.matchedCount} found).`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const result = await db
    .collection("modelconfigurations")
    .updateMany({ service: "openai" }, { $unset: Object.fromEntries(PRIORITY_KEYS.map((key) => [`${SPEC}.${key}`, ""])) });
  console.log(`[priority pricing] removed priority prices from ${result.modifiedCount} models.`);
};
