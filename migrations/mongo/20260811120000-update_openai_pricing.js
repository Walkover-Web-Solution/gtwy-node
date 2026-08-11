/**
 * Corrects stale/incorrect OpenAI `modelconfigurations` pricing and adds the
 * long-context tier (input/output/cached rates that kick in once a request's
 * context exceeds ~272K tokens) plus the new "cache writes" rate for the
 * gpt-5.6 family, per OpenAI's current pricing page.
 *
 * Bugs fixed (cached_cost was wrong, independent of the long-context/cache-write additions):
 *   - o4-mini:       cached_cost 0.55  -> 0.275 (was duplicated from o3-mini's rate)
 *   - gpt-5.1:       cached_cost 0.13  -> 0.125 (rounding)
 *   - gpt-5.4:       input_cost 2.25 -> 2.5, output_cost 18 -> 15, cached_cost 0.225 -> 0.25
 *   - gpt-5.6-sol:   cached_cost 2.5  -> 0.5
 *   - gpt-5.6-terra: cached_cost 1.25 -> 0.2
 *   - gpt-5.6-luna:  cached_cost 0    -> 0.02
 *
 * New data added (previously absent):
 *   - caching_write_cost for gpt-5.6-sol/terra/luna
 *   - long_context_threshold (272000) + long_context_cost {input_cost, output_cost,
 *     cached_cost, caching_write_cost} for gpt-5.4, gpt-5.5, gpt-5.6-sol/terra/luna
 *
 * long_context_cost is consumed by gtwy-ai's TokenCalculator.calculate_total_cost,
 * which swaps these rates in once total input tokens exceed long_context_threshold
 * (mirrors the existing Gemini cost_multiplier pattern, but as explicit override
 * rates since OpenAI's long-context multiplier isn't uniform across input/output/cached).
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
const SERVICE = "openai";
const LONG_CONTEXT_THRESHOLD = 272_000;

const FIXES = [
  { model_name: "o4-mini", set: { "outputConfig.usage.0.total_cost.cached_cost": 0.275 } },
  { model_name: "gpt-5.1", set: { "outputConfig.usage.0.total_cost.cached_cost": 0.125 } },
  {
    model_name: "gpt-5.4",
    set: {
      "outputConfig.usage.0.total_cost.input_cost": 2.5,
      "outputConfig.usage.0.total_cost.output_cost": 15,
      "outputConfig.usage.0.total_cost.cached_cost": 0.25,
      "outputConfig.usage.0.total_cost.long_context_threshold": LONG_CONTEXT_THRESHOLD,
      "outputConfig.usage.0.total_cost.long_context_cost": { input_cost: 5, output_cost: 22.5, cached_cost: 0.5 }
    }
  },
  {
    model_name: "gpt-5.5",
    set: {
      "outputConfig.usage.0.total_cost.long_context_threshold": LONG_CONTEXT_THRESHOLD,
      "outputConfig.usage.0.total_cost.long_context_cost": { input_cost: 10, output_cost: 45, cached_cost: 1 }
    }
  },
  {
    model_name: "gpt-5.6-sol",
    set: {
      "outputConfig.usage.0.total_cost.cached_cost": 0.5,
      "outputConfig.usage.0.total_cost.caching_write_cost": 6.25,
      "outputConfig.usage.0.total_cost.long_context_threshold": LONG_CONTEXT_THRESHOLD,
      "outputConfig.usage.0.total_cost.long_context_cost": {
        input_cost: 10,
        output_cost: 45,
        cached_cost: 1,
        caching_write_cost: 12.5
      }
    }
  },
  {
    model_name: "gpt-5.6-terra",
    set: {
      "outputConfig.usage.0.total_cost.cached_cost": 0.2,
      "outputConfig.usage.0.total_cost.caching_write_cost": 2.5,
      "outputConfig.usage.0.total_cost.long_context_threshold": LONG_CONTEXT_THRESHOLD,
      "outputConfig.usage.0.total_cost.long_context_cost": {
        input_cost: 4,
        output_cost: 18,
        cached_cost: 0.4,
        caching_write_cost: 5
      }
    }
  },
  {
    model_name: "gpt-5.6-luna",
    set: {
      "outputConfig.usage.0.total_cost.cached_cost": 0.02,
      "outputConfig.usage.0.total_cost.caching_write_cost": 0.25,
      "outputConfig.usage.0.total_cost.long_context_threshold": LONG_CONTEXT_THRESHOLD,
      "outputConfig.usage.0.total_cost.long_context_cost": {
        input_cost: 0.4,
        output_cost: 1.8,
        cached_cost: 0.04,
        caching_write_cost: 0.5
      }
    }
  }
];

// Prior values, for rollback.
const ROLLBACK = [
  { model_name: "o4-mini", set: { "outputConfig.usage.0.total_cost.cached_cost": 0.55 } },
  { model_name: "gpt-5.1", set: { "outputConfig.usage.0.total_cost.cached_cost": 0.13 } },
  {
    model_name: "gpt-5.4",
    set: {
      "outputConfig.usage.0.total_cost.input_cost": 2.25,
      "outputConfig.usage.0.total_cost.output_cost": 18,
      "outputConfig.usage.0.total_cost.cached_cost": 0.225
    },
    unset: { "outputConfig.usage.0.total_cost.long_context_threshold": "", "outputConfig.usage.0.total_cost.long_context_cost": "" }
  },
  {
    model_name: "gpt-5.5",
    unset: { "outputConfig.usage.0.total_cost.long_context_threshold": "", "outputConfig.usage.0.total_cost.long_context_cost": "" }
  },
  {
    model_name: "gpt-5.6-sol",
    set: { "outputConfig.usage.0.total_cost.cached_cost": 2.5 },
    unset: {
      "outputConfig.usage.0.total_cost.caching_write_cost": "",
      "outputConfig.usage.0.total_cost.long_context_threshold": "",
      "outputConfig.usage.0.total_cost.long_context_cost": ""
    }
  },
  {
    model_name: "gpt-5.6-terra",
    set: { "outputConfig.usage.0.total_cost.cached_cost": 1.25 },
    unset: {
      "outputConfig.usage.0.total_cost.caching_write_cost": "",
      "outputConfig.usage.0.total_cost.long_context_threshold": "",
      "outputConfig.usage.0.total_cost.long_context_cost": ""
    }
  },
  {
    model_name: "gpt-5.6-luna",
    set: { "outputConfig.usage.0.total_cost.cached_cost": 0 },
    unset: {
      "outputConfig.usage.0.total_cost.caching_write_cost": "",
      "outputConfig.usage.0.total_cost.long_context_threshold": "",
      "outputConfig.usage.0.total_cost.long_context_cost": ""
    }
  }
];

export const up = async (db) => {
  const modelConfigs = db.collection("modelconfigurations");
  for (const { model_name, set } of FIXES) {
    const res = await modelConfigs.updateMany({ service: SERVICE, model_name }, { $set: set });
    console.log(`[modelconfigurations] ${model_name}: matched ${res.matchedCount}, modified ${res.modifiedCount}`);
  }
};

export const down = async (db) => {
  const modelConfigs = db.collection("modelconfigurations");
  for (const { model_name, set, unset } of ROLLBACK) {
    const update = {};
    if (set) update.$set = set;
    if (unset) update.$unset = unset;
    const res = await modelConfigs.updateMany({ service: SERVICE, model_name }, update);
    console.log(`[modelconfigurations] reverted ${model_name}: matched ${res.matchedCount}, modified ${res.modifiedCount}`);
  }
};
