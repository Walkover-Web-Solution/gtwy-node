import csvParser from "csv-parser";
import { Readable } from "stream";
import ConfigurationServices from "../db_services/configuration.service.js";
import agentVersionDbService from "../db_services/agentVersion.service.js";

const parseCsv = (csvBuffer) =>
  new Promise(() => {
    // let parsedData = '';
    const csvStream = csvParser();
    // .on('data', (row) => {
    //   parsedData = parsedData + row
    // })
    // .on('end', () => {
    //   console.log('CSV parsing complete');
    //   // console.log('Parsed Data:', parsedData);
    //   resolve(parsedData);
    // })
    // .on('error', (error) => {
    //   console.error('Error parsing CSV:', error.message);
    //   reject(error);
    // });

    const readableStream = new Readable();
    readableStream.push(csvBuffer);
    readableStream.push(null);

    readableStream.pipe(csvStream);
  });

const ensureChatbotPreview = async (org_id, user_id, agents) => {
  if (agents.some((item) => item.slugName === "chatbot_preview")) return null;
  const name = "chatbot preview";
  const { name: uniqueName, slugName: uniqueSlugName } = await ConfigurationServices.getUniqueAgentNameAndSlug(org_id, name);

  const prompt = {
    role: "AI Bot",
    goal: "Respond logically and clearly, maintaining a neutral, automated tone.",
    instruction:
      "Guidelines:\nIdentify the task or question first.\nProvide brief reasoning before the answer or action.\nKeep responses concise and contextually relevant.\nAvoid emotion, filler, or self-reference.\nUse examples or placeholders only when helpful."
  };

  const model_data = {
    type: "chat",
    model: "gpt-5-nano",
    is_rich_text: false,
    prompt: prompt,
    response_type: "default",
    reasoning: "default",
    max_tokens: "default"
  };

  const result = await ConfigurationServices.createAgent({
    configuration: model_data,
    name: uniqueName || name,
    slugName: uniqueSlugName || name,
    service: "openai",
    bridgeType: "chatbot",
    org_id: org_id,
    gpt_memory: true,
    folder_id: null,
    user_id: user_id,
    settings: {
      maximum_iterations: 3,
      publicUsers: [],
      editAccess: [],
      response_format: {
        type: "default"
      },
      guardrails: {
        is_enabled: false,
        guardrails_custom_prompt: ""
      },
      fall_back: {
        is_enable: false,
        service: "",
        model: ""
      }
    },
    bridge_status: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const create_version = await agentVersionDbService.createAgentVersion(result.bridge);
  const update_fields = { versions: [create_version._id.toString()] };
  const updated_agent_result = await ConfigurationServices.updateAgent(result.bridge._id.toString(), update_fields);
  return updated_agent_result.result;
};

export { parseCsv, ensureChatbotPreview };
