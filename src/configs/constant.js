import ConfigurationServices from "../db_services/configuration.service.js";
import testcaseDbservice from "../db_services/testcase.service.js";
import { renderCardToTailwind } from "../utils/Formatter.utility.js";
import gptMemoryService from "../services/utils/gptMemory.service.js";
import { convertPromptToString } from "../utils/promptWrapper.utils.js";

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
  canonicalizer: "6973200cf60dd5bf64eeb325"
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
    getPrompt: (context) => convertPromptToString(context.bridge.configuration?.prompt) || "",
    getVariables: (req) => ({ query: req.body.query || "" }),
    getMessage: (req, context) => convertPromptToString(context.bridge.configuration?.prompt) || "", // optimize_prompt uses prompt as message
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
    getMessage: () => "create the json shcmea accroding to the dummy json explained in system prompt.",
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
      let html = "";
      try {
        const cardJson = typeof aiResult === "string" ? JSON.parse(aiResult) : aiResult;
        html = renderCardToTailwind(cardJson);
      } catch (error) {
        console.error("Error rendering card to HTML:", error);
      }
      return {
        success: true,
        message: "Rich UI template generated successfully",
        result: aiResult,
        html: html
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
  }
};
