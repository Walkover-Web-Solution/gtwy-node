import ConfigurationServices from "../db_services/configuration.service.js";
import testcaseDbservice from "../db_services/testcase.service.js";
import gptMemoryService from "../services/utils/gptMemory.service.js";
import { convertPromptToString } from "../utils/promptWrapper.utils.js";
import { buildSchemaFromTemplateFormat } from "../utils/templateVariables.utils.js";

const collectionNames = {
  ApikeyCredentials: "ApikeyCredentials",
  configuration: "configuration",
  Folder: "Folder"
};

const bridge_ids = {
  gpt_memory: "6752d9fc232e8659b2b65f0d",
  suggest_model: "67a75ab42d85a6d4f16a4c7e",
  make_question: "67459164ea7147ad4b75f92a",
  optimze_prompt: "6843d832aab19264b8967f3b",
  create_bridge_using_ai: "67e4e7934e58b9c3b991a29c",
  structured_output_optimizer: "67766c4eec020b944b3e0670",
  chatbot_response_with_actions: "67b3157bdd16f681b71b06a4",
  chatbot_response_without_actions: "67b30d46f8ab2d672f1682b4",
  get_csv_query_type: "67c2f4b40ef03932ed9a2b40",
  chatbot_suggestions: "674710c9141fcdaeb820aeb8",
  generate_summary: "679ca9520a9b42277fd2a3c1",
  function_agrs_using_ai: "67c81a424f3136bfb0e81906",
  compare_result: "67ce993c8407023ad4f7b277",
  generate_description: "6800d48f7dfc8ddcc495f918",
  improve_prompt_optimizer: "68e4ac02739a8b89ba27b22a",
  generate_test_cases: "68e8d1fbf8c9ba2043cf7afd",
  prompt_checker: "692ee19da04fbf2a132b252c",
  rich_ui_template: "6967b36c17a69473fa7fdb90",
  canonicalizer: "6973200cf60dd5bf64eeb325",
  template_validator: "69c134229df6d4d2d1dd2ae5"
};

const redis_keys = {
  bridgeusedcost_: "bridgeusedcost_",
  folderusedcost_: "folderusedcost_",
  apikeyusedcost_: "apikeyusedcost_",
  bridge_data_with_tools_: "bridge_data_with_tools_",
  get_bridge_data_: "get_bridge_data_",
  apikeylastused_: "apikeylastused_",
  bridgelastused_: "bridgelastused_",
  files_: "files_",
  gpt_memory_: "gpt_memory_",
  pdf_url_: "pdf_url_",
  metrix_bridges_: "metrix_bridges_",
  rate_limit_: "rate_limit_",
  openai_batch_: "openai_batch_",
  avg_response_time_: "avg_response_time_",
  timezone_and_org_: "timezone_and_org_",
  conversation_: "conversation_",
  last_transffered_agent_: "last_transffered_agent_"
};

const cost_types = {
  bridge: "bridge",
  folder: "folder",
  apikey: "apikey"
};

const prebuilt_prompt_bridge_id = [
  "optimze_prompt",
  "gpt_memory",
  "structured_output_optimizer",
  "chatbot_suggestions",
  "generate_summary",
  "generate_test_cases"
];

const new_agent_service = {
  openai: "gpt-5-nano",
  anthropic: "claude-sonnet-4-20250514",
  groq: "openai/gpt-oss-120b",
  open_router: "openai/gpt-4o",
  mistral: "mistral-small-latest",
  gemini: "gemini-2.5-pro",
  ai_ml: "gpt-oss-120b",
  grok: "grok-4-fast"
};

export { collectionNames, bridge_ids, redis_keys, cost_types, prebuilt_prompt_bridge_id, new_agent_service };

export const AI_OPERATION_CONFIG = {
  optimize_prompt: {
    bridgeIdConst: bridge_ids["optimze_prompt"],
    prebuiltKey: "optimze_prompt",
    getContext: async (req, org_id) => {
      const { version_id, bridge_id } = req.body;
      const bridgeResult = await ConfigurationServices.getAgents(bridge_id, org_id, version_id);
      return { bridge: bridgeResult.bridges };
    },
    getPrompt: (context) => context.bridge.configuration?.prompt || "",
    getVariables: (req, context) => ({ query: req.body.query, fields: context.bridge.configuration?.prompt }),
    getMessage: () => "optimize the prompt according the data contain in the fields",
    successMessage: "Prompt optimized successfully"
  },
  generate_summary: {
    bridgeIdConst: bridge_ids["generate_summary"],
    prebuiltKey: "generate_summary",
    getContext: async (req, org_id) => {
      const { version_id } = req.body;
      const bridgeResult = await ConfigurationServices.getAgentsWithTools(null, org_id, version_id);
      if (!bridgeResult.bridges) throw new Error("Version data not found");
      return { bridgeData: bridgeResult.bridges };
    },
    getVariables: (req, context) => {
      const { bridgeData } = context;
      const tools = {};
      if (bridgeData.apiCalls) {
        Object.values(bridgeData.apiCalls).forEach((tool) => {
          tools[tool.title] = tool.description;
        });
      }
      let system_prompt = convertPromptToString(bridgeData.configuration?.prompt) || "";
      if (Object.keys(tools).length > 0) {
        system_prompt += `Available tool calls :-  ${JSON.stringify(tools)}`;
      }
      return { prompt: system_prompt };
    },
    getMessage: () => "generate summary from the user message provided in system prompt",
    successMessage: "Summary generated successfully"
  },
  generate_json: {
    bridgeIdConst: bridge_ids["function_agrs_using_ai"],
    getMessage: (req) => {
      const exampleJson = typeof req.body.example_json === "object" ? JSON.stringify(req.body.example_json) : req.body.example_json;
      return `geneate the json using the example json data : ${exampleJson}`;
    },
    successMessage: "json generated successfully"
  },
  generate_test_cases: {
    bridgeIdConst: bridge_ids["generate_test_cases"],
    prebuiltKey: "generate_test_cases",
    getContext: async (req, org_id) => {
      const { version_id, bridge_id } = req.body;
      const bridgeResult = await ConfigurationServices.getAgentsWithTools(bridge_id, org_id, version_id);
      if (!bridgeResult.bridges) throw new Error("Bridge data not found");
      return { bridgeData: bridgeResult.bridges };
    },
    getVariables: (req, context) => ({ system_prompt: convertPromptToString(context.bridgeData.configuration?.prompt) || "" }),
    getMessage: () =>
      "Generate 10 comprehensive test cases for this AI assistant based on its system prompt and available tools. Each test case should include a UserInput and ExpectedOutput.",
    postProcess: async (aiResult, req) => {
      const savedTestcases = await testcaseDbservice.parseAndSaveTestcases(aiResult, req.body.bridge_id);
      return {
        success: true,
        message: `Test cases generated and ${savedTestcases.length} saved successfully`,
        result: aiResult,
        saved_testcase_ids: savedTestcases
      };
    }
  },
  structured_output: {
    bridgeIdConst: bridge_ids["structured_output_optimizer"],
    prebuiltKey: "structured_output_optimizer",
    getVariables: (req) => ({ json_schema: req.body.json_schema, query: req.body.query }),
    getMessage: () => "create the json schema according to the dummy json explained in system prompt.",
    successMessage: "Structured output optimized successfully" // Or whatever default success message is appropriate, though callAiMiddleware returns result directly usually
  },
  improve_prompt: {
    bridgeIdConst: bridge_ids["improve_prompt_optimizer"],
    getVariables: (req) => req.body.variables, // Assuming variables are passed directly in body as 'variables' object based on original code
    getMessage: () => "improve the prompt",
    successMessage: "Prompt improved successfully"
  },
  rich_ui_template: {
    bridgeIdConst: bridge_ids["rich_ui_template"],
    getVariables: (req) => req.body,
    getMessage: () => "generate the rich ui template",
    successMessage: "Rich UI template generated successfully",
    postProcess: async (aiResult) => {
      let ui = null;
      let variables = {};
      let originalRawUi = null;
      try {
        const parsed = typeof aiResult === "string" ? JSON.parse(aiResult) : aiResult;
        ui = parsed.ui || (parsed.type ? parsed : null);
        variables = parsed.variables || parsed.data || parsed.default_json || {};
        originalRawUi = JSON.parse(JSON.stringify(ui)); // copy raw template (unreplaced)

        if (ui && Object.keys(variables).length > 0) {
          // ─── Path resolver ─────────────────────────────────────────────────
          const getValue = (obj, path) => {
            if (!obj || !path) return undefined;
            const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
            let val = obj;
            for (const k of keys) {
              if (val == null || typeof val !== "object") return undefined;
              val = val[k];
            }
            return val;
          };

          // ─── Recursive resolver ────────────────────────────────────────────
          const resolve = (node, context) => {
            if (typeof node === "string") {
              return node.replace(/\{\{([\w.[\]]+)\}\}/g, (match, path) => {
                const val = getValue(context, path);
                return val !== undefined ? String(val) : match;
              });
            }
            if (Array.isArray(node)) {
              return node.map((n) => resolve(n, context));
            }
            if (node && typeof node === "object") {
              // ── Generic binding mode (new: itemTemplate + binding + itemAlias) ──
              if (node.type === "ListView" && node.binding && node.itemTemplate) {
                // binding may be a direct key ("rows") or a placeholder ("{{trips}}")
                const bpMatch = typeof node.binding === "string" ? node.binding.match(/^\{\{([\w.]+)\}\}$/) : null;
                const bindingKey = bpMatch ? bpMatch[1] : node.binding;
                const listData = getValue(context, bindingKey);
                if (Array.isArray(listData)) {
                  const alias = node.itemAlias || "item";
                  const siblingScope = Object.fromEntries(Object.entries(context).filter(([k]) => k !== bindingKey));
                  const resolvedChildren = listData.map((item) => {
                    const itemContext = { ...context, ...siblingScope, [alias]: item };
                    return resolve(node.itemTemplate, itemContext);
                  });
                  const rest = Object.fromEntries(
                    Object.entries(node).filter(([k]) => !["itemTemplate", "binding", "itemAlias", "idField"].includes(k))
                  );
                  return { ...rest, children: resolvedChildren };
                }
              }

              // ── Legacy binding mode (children[0] as template, binding may be {{placeholder}}) ──
              if (node.type === "ListView" && node.binding && !node.itemTemplate) {
                // Unwrap "{{trips}}" → "trips", or use direct key "rows" as-is
                const bpMatch = typeof node.binding === "string" ? node.binding.match(/^\{\{([\w.]+)\}\}$/) : null;
                const bindingKey = bpMatch ? bpMatch[1] : node.binding;
                const listData = getValue(context, bindingKey);
                if (Array.isArray(listData) && node.children?.length > 0) {
                  const itemTemplate = node.children[0];
                  // Alias priority: node.itemAlias > node.key > ListViewItem.key > "item"
                  let localKey = node.itemAlias || node.key;
                  if (!localKey) {
                    if (itemTemplate.key && typeof itemTemplate.key === "string") {
                      const match = itemTemplate.key.match(/^\{\{([\w]+)\./);
                      localKey = match ? match[1] : itemTemplate.key;
                    } else {
                      localKey = "item";
                    }
                  }
                  const resolvedChildren = listData.map((item) => {
                    const localContext =
                      item && typeof item === "object" && !Array.isArray(item)
                        ? { ...context, ...item, [localKey]: item }
                        : { ...context, [localKey]: item };
                    return resolve(itemTemplate, localContext);
                  });
                  return { ...node, children: resolvedChildren };
                }
              }

              // ── Normal object traversal ───────────────────────────────────
              const newNode = {};
              for (const [k, v] of Object.entries(node)) {
                newNode[k] = resolve(v, context);
              }
              return newNode;
            }
            return node;
          };

          ui = resolve(ui, variables);
        }
      } catch (error) {
        console.error("Error parsing rich UI template result:", error);
      }

      return {
        success: true,
        message: "Rich UI template generated successfully",
        result: ui,
        ui,
        variables,
        template_format: originalRawUi,
        json_schema: originalRawUi ? buildSchemaFromTemplateFormat(originalRawUi, {}, variables ?? {}) : null
      };
    }
  },
  gpt_memory: {
    handler: async (req) => {
      const { bridge_id, thread_id, sub_thread_id, version_id } = req.body;
      const { memoryId, memory } = await gptMemoryService.retrieveGptMemoryService({
        bridge_id,
        thread_id,
        sub_thread_id,
        version_id
      });
      return {
        bridge_id,
        thread_id,
        sub_thread_id,
        version_id,
        memory_id: memoryId,
        found: !!memory,
        memory
      };
    }
  },
  template_validator: {
    bridgeIdConst: bridge_ids["template_validator"],
    getVariables: (req) => req.body,
    getMessage: () => "validate the template",
    successMessage: "Template validated successfully"
  }
};
