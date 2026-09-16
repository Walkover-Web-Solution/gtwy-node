/**
 * Migration: add `in_built_tools` (display metadata for provider-native
 * prebuilt tools) to the `services` registry collection.
 *
 * The list returned by GET /api/tools/inbuilt was previously hardcoded in
 * apiCall.controller.js. Non-GTWY tools now live on the owning service's
 * document and are read at runtime via the services registry. GTWY-owned
 * tools (Gtwy_Web_Search, Gtwy_Browser) stay static in the controller since
 * they are not tied to any provider.
 *
 * Idempotent: only $sets the field on the openai and anthropic documents.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const collection = db.collection("services");

  await collection.updateOne(
    { service_name: "openai" },
    {
      $set: {
        in_built_tools: [
          {
            name: "Web Search",
            description: "Allow models to search the web for the latest information before generating a response.",
            value: "web_search"
          },
          {
            name: "Image Generation",
            description: "Allow models to generate images based on the user's input.",
            value: "image_generation"
          },
          {
            name: "Code Interpreter",
            description:
              "Allow models to write and run Python code in a sandboxed container to analyze data, perform calculations, and generate files.",
            value: "code_interpreter"
          }
        ]
      }
    }
  );

  await collection.updateOne(
    { service_name: "anthropic" },
    {
      $set: {
        in_built_tools: [
          {
            name: "Web Search",
            description: "Allow models to search the web for the latest information before generating a response.",
            value: "web_search"
          }
        ]
      }
    }
  );

  console.log("Backfilled in_built_tools on services: openai, anthropic.");
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collection = db.collection("services");
  await collection.updateMany({ service_name: { $in: ["openai", "anthropic"] } }, { $unset: { in_built_tools: "" } });
};
