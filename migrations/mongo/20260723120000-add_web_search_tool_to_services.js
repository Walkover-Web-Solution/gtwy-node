/**
 * Migration: backfill `web_search_tool` on the `services` registry collection.
 *
 * The native web-search tool shape for openai/anthropic was previously
 * hardcoded in the Python repo's openai_response.py / anthropicCall.py. It now
 * lives on the `services` document and is read at runtime via
 * service_registry.py::web_search_tool_config(name), falling back to the same
 * hardcoded shape if the DB field is absent.
 *
 * Idempotent: only $sets the field on the two affected documents.
 *
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const collection = db.collection("services");

  await collection.updateOne(
    { service_name: "openai" },
    {
      $set: {
        web_search_tool: {
          unfiltered: { type: "web_search_preview" },
          filtered: { type: "web_search", filters: { allowed_domains: null } }
        }
      }
    }
  );

  await collection.updateOne({ service_name: "anthropic" }, { $set: { web_search_tool: { type: "web_search_20250305", name: "web_search" } } });

  console.log("Backfilled web_search_tool on services: openai, anthropic.");
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collection = db.collection("services");
  await collection.updateMany({ service_name: { $in: ["openai", "anthropic"] } }, { $unset: { web_search_tool: "" } });
};
