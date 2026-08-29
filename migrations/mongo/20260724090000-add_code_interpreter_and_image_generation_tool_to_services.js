/**
 * Migration: backfill `image_generation_tool` and `code_interpreter_tool` on
 * the `services` registry collection.
 *
 * Both native tool shapes were previously hardcoded in the Python repo's
 * openai_response.py. They now live on the `services` document and are read
 * at runtime via service_registry.py::image_generation_tool_config(name) /
 * code_interpreter_tool_config(name), falling back to the same hardcoded
 * shape if the DB field is absent. OpenAI-only — neither tool exists on
 * other services.
 *
 * Idempotent: only $sets the fields on the "openai" document.
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
        image_generation_tool: { type: "image_generation" },
        code_interpreter_tool: { type: "code_interpreter" }
      }
    }
  );

  console.log("Backfilled image_generation_tool, code_interpreter_tool on services: openai.");
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collection = db.collection("services");
  await collection.updateOne({ service_name: "openai" }, { $unset: { image_generation_tool: "", code_interpreter_tool: "" } });
};
