/**
 * Migration: Add capability flags to services collection
 *
 * Adds the registry fields that let the Python repo replace hardcoded
 * per-service-name branches with DB lookups:
 *
 *   - reasoning_param_style: which reasoning/thinking param shape the service
 *     expects (read by src/configs/service_registry.py).
 *   - extra_body: static params always merged into this service's outgoing
 *     request, regardless of whether reasoning is requested. Today only minimax
 *     needs this (`reasoning_split: true`).
 *   - reasoning_extra_body: params merged in only when reasoning is turned on,
 *     for services whose reasoning_param_style is "reasoning_effort_extra_body".
 *     Today deepseek and minimax both need `thinking: {type: "enabled"}`.
 *
 * The extra_body pair replaces the `if service == "minimax"` /
 * `service in (...)` checks in baseService.py (service_formatter) and
 * baseService/utils.py (_apply_reasoning_effort_extra_body).
 *
 * supports_batch was deliberately left out: batch eligibility is already
 * implied by BATCH_RESULT_HANDLERS in the Python repo
 * (src/services/utils/batch_script_utils.py), which maps a service to its
 * result-parsing function, so a DB flag would only be a second source of
 * truth for the same fact.
 *
 * Values reflect current hardcoded behavior in the Python repo
 * (src/services/utils/helper.py, src/services/commonServices/baseService/*)
 * at the time of writing.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */

const CAPABILITY_FLAGS = {
  openai: {
    reasoning_param_style: "summary_flag"
  },
  anthropic: {
    reasoning_param_style: "output_config_effort"
  },
  gemini: {
    reasoning_param_style: "thinking_config"
  },
  groq: {
    reasoning_param_style: "reasoning_effort"
  },
  mistral: {
    reasoning_param_style: null
  },
  deepseek: {
    reasoning_param_style: "reasoning_effort_extra_body"
  },
  minimax: {
    reasoning_param_style: "reasoning_effort_extra_body"
  },
  grok: {
    reasoning_param_style: null
  },
  open_router: {
    reasoning_param_style: null
  },
  neev_cloud: {
    reasoning_param_style: null
  },
  moonshot: {
    reasoning_param_style: null
  },
  openai_completion: {
    reasoning_param_style: null
  },
  deepgram: {
    reasoning_param_style: null
  }
};

// extra_body configs ---------------------------------------------------------
// Kept separate from CAPABILITY_FLAGS because they cover only a couple of
// services each, rather than every entry in the registry.
const EXTRA_BODY = {
  minimax: { reasoning_split: true }
};

const REASONING_EXTRA_BODY = {
  deepseek: { thinking: { type: "enabled" } },
  minimax: { thinking: { type: "enabled" } }
};

// apikey_status_codes corrections -------------------------------------------
// src/services/utils/api_key_status_helper.py in the Python repo is being
// switched from a hardcoded SERVICE_MAPPERS dict to reading this DB field
// directly. Diffing that hardcoded dict against what 20260606120000-seed_services_registry.js
// actually seeded found two gaps that would silently regress api-key status
// detection once the code switch lands:
//   - anthropic: the hardcoded mapper also treated 400 as invalid and 402 as
//     unauthorized; the seeded doc only has 401/403/429.
//   - minimax: never received an apikey_status_codes field from either the
//     seed migration or 20260723120000-add_service_keys.js, even though the
//     hardcoded mapper has always covered it. Written with upsert:true as a
//     safety net in case the minimax document doesn't exist yet.
const APIKEY_STATUS_CODES_FIXES = {
  anthropic: { invalid: [400, 401], unauthorized: [402, 403], limited: [429] },
  minimax: { invalid: [401], unauthorized: [403], limited: [429] }
};

const PRE_MIGRATION_APIKEY_STATUS_CODES = {
  anthropic: { invalid: [401], unauthorized: [403], limited: [429] }
};

export const up = async (db) => {
  const collection = db.collection("services");

  const operations = Object.entries(CAPABILITY_FLAGS).map(([serviceName, flags]) => ({
    updateOne: {
      filter: { service_name: serviceName },
      update: { $set: flags }
    }
  }));

  operations.push(
    ...Object.entries(EXTRA_BODY).map(([serviceName, value]) => ({
      updateOne: { filter: { service_name: serviceName }, update: { $set: { extra_body: value } } }
    })),
    ...Object.entries(REASONING_EXTRA_BODY).map(([serviceName, value]) => ({
      updateOne: { filter: { service_name: serviceName }, update: { $set: { reasoning_extra_body: value } } }
    })),
    ...Object.entries(APIKEY_STATUS_CODES_FIXES).map(([serviceName, codes]) => ({
      updateOne: {
        filter: { service_name: serviceName },
        update: { $set: { apikey_status_codes: codes } },
        upsert: serviceName === "minimax"
      }
    }))
  );

  const result = await collection.bulkWrite(operations, { ordered: false });
  console.log(`Added capability flags to ${result.modifiedCount} services (${result.upsertedCount} upserted).`);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collection = db.collection("services");
  // CAPABILITY_FLAGS covers every service in the registry, so its key list also
  // covers the EXTRA_BODY / REASONING_EXTRA_BODY services (minimax, deepseek).
  const names = Object.keys(CAPABILITY_FLAGS);
  // supports_batch is unset too: an earlier revision of this migration seeded
  // it before the flag was dropped, so local DBs may still carry the field.
  const result = await collection.updateMany(
    { service_name: { $in: names } },
    { $unset: { supports_batch: "", reasoning_param_style: "", extra_body: "", reasoning_extra_body: "" } }
  );

  // Restore anthropic's narrower pre-migration codes; minimax was likely
  // absent before this migration, so unset rather than guess a prior value.
  const restoreOps = Object.entries(PRE_MIGRATION_APIKEY_STATUS_CODES).map(([serviceName, codes]) => ({
    updateOne: { filter: { service_name: serviceName }, update: { $set: { apikey_status_codes: codes } } }
  }));
  await collection.bulkWrite(restoreOps, { ordered: false });
  await collection.updateOne({ service_name: "minimax" }, { $unset: { apikey_status_codes: "" } });

  console.log(`Removed capability flags from ${result.modifiedCount} services.`);
};
