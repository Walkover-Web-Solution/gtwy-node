/**
 * Migration: add provider-native web search config for gemini and open_router.
 *
 * The Python service reads `web_search_tool` from the services registry when an
 * agent has the `web_search` built-in tool enabled:
 *   - gemini:      passed as a google.genai `types.Tool(**cfg)` -> Google Search grounding
 *   - open_router: `extra_body` merged into the chat.completions request -> OpenRouter web plugin
 * Both also gain the "Web Search" entry in `in_built_tools` so the Tools dropdown
 * lists it (the per-model `validationConfig.inbuilt_tools.web_search` flag still gates it).
 *
 * Idempotent: only $sets fields on the two documents.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
const WEB_SEARCH_ENTRY = {
  name: "Web Search",
  description: "Allow models to search the web for the latest information before generating a response.",
  value: "web_search"
};

export const up = async (db) => {
  const collection = db.collection("services");

  await collection.updateOne({ service_name: "gemini" }, { $set: { web_search_tool: { google_search: {} }, in_built_tools: [WEB_SEARCH_ENTRY] } });

  await collection.updateOne(
    { service_name: "open_router" },
    { $set: { web_search_tool: { extra_body: { plugins: [{ id: "web" }] } }, in_built_tools: [WEB_SEARCH_ENTRY] } }
  );

  console.log("Backfilled web_search_tool + in_built_tools on services: gemini, open_router.");
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collection = db.collection("services");
  await collection.updateMany({ service_name: { $in: ["gemini", "open_router"] } }, { $unset: { web_search_tool: "", in_built_tools: "" } });
};
