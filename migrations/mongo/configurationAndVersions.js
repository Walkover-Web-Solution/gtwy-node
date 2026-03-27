import { MongoClient, ObjectId } from "mongodb";
import { Sequelize, QueryTypes } from "sequelize";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;
const TODAY = new Date();

async function migrateConfigurations() {
  const client = new MongoClient(MONGODB_URI);
  const sequelize = new Sequelize(process.env.POSTGRES_URI, {
    dialect: "postgres",
    logging: false
  });

  let migratedCount = 0;
  let deletedCount = 0;
  let softDeletedCount = 0;
  let skippedCount = 0;
  const orgOwnerCache = {};

  try {
    await client.connect();
    console.log("Connected to MongoDB");
    await sequelize.authenticate();
    console.log("Connected to PostgreSQL");

    const db = client.db();
    const configurations = db.collection("configurations");
    const versions = db.collection("configuration_versions");

    // -------------------------------------------------------
    // STEP 1 + 9: Remove extra keys (parallel — different collections)
    // -------------------------------------------------------
    console.log("\n--- Step 1 + 9: Removing extra keys from configurations & versions ---");

    const [step1, step9] = await Promise.all([
      configurations.updateMany(
        {},
        {
          $unset: {
            agent_details: "",
            apikey_ids_object: "",
            apikeys: "",
            bridge_id: "",
            expected_qna: "",
            hello_id: "",
            openai_completion: "",
            pre_tools_data: "",
            rag_data: "",
            type: "",
            updated_at: "",
            apikey: "",
            gpt_memory: "",
            gpt_memory_context: "",
            is_drafted: "",
            version_description: "",
            bridge_summary: "",
            total_tokens: "",
            is_api_call: "",
            responseIds: "",
            defaultQuestions: "",
            created_at: "",
            api_endpoints: "",
            "configuration.conversation": "",
            "configuration.encoding_format": "",
            "configuration.fall_back": "",
            "configuration.n": "",
            "configuration.name": "",
            "configuration.new_id": "",
            "configuration.outputConfig": "",
            "configuration.rtlayer": "",
            "configuration.rtllayer": "",
            "configuration.seed": "",
            "configuration.service": "",
            "configuration.specification": "",
            "configuration.stop": "",
            "configuration.stop_sequences": "",
            "configuration.stream": "",
            "configuration.system_prompt_version_id": "",
            "configuration.temperature": "",
            "configuration.tools": "",
            "configuration.top_k": "",
            "configuration.top_p": "",
            "configuration.user": "",
            "configuration.validationConfig": "",
            "configuration.vision": ""
          }
        }
      ),
      versions.updateMany(
        {},
        {
          $unset: {
            bridge_id: "",
            apikeys: "",
            type: "",
            pre_tools_data: "",
            agent_details: "",
            rag_data: "",
            bridge_summary: "",
            expected_qna: "",
            apikey_ids_object: "",
            updated_at: "",
            apiCalls: "",
            "configuration.rtlayer": "",
            "configuration.top_p": "",
            "configuration.n": "",
            "configuration.temperature": "",
            "configuration.stop_sequences": "",
            "configuration.tools": "",
            "configuration.user": "",
            "configuration.top_k": "",
            "configuration.stop": "",
            "configuration.name": "",
            "configuration.conversation": "",
            "configuration.service": "",
            "configuration.encoding_format": "",
            "configuration.seed": "",
            "configuration.new_id": "",
            "configuration.stream": "",
            "configuration.validationConfig": "",
            "configuration.fall_back": "",
            "configuration.system_prompt_version_id": "",
            "configuration.specification": "",
            "configuration.outputConfig": "",
            "configuration.rtllayer": ""
          }
        }
      )
    ]);
    console.log(`  ✓ Removed extra keys from ${step1.modifiedCount} configuration documents`);
    console.log(`  ✓ Removed extra keys from ${step9.modifiedCount} version documents`);

    // -------------------------------------------------------
    // STEP 2 + 3 + 10: Set safe defaults (parallel — different collections + independent updates)
    // -------------------------------------------------------
    console.log("\n--- Step 2 + 3 + 10: Setting safe defaults (configurations & versions in parallel) ---");

    const rootDefaults = [
      [{ meta: { $exists: false } }, { $set: { meta: {} } }],
      [{ deletedAt: { $exists: false } }, { $set: { deletedAt: null } }],
      [{ last_used: { $exists: false } }, { $set: { last_used: null } }],
      [{ chatbot_auto_answers: { $exists: false } }, { $set: { chatbot_auto_answers: false } }],
      [{ bridge_limit: { $exists: false } }, { $set: { bridge_limit: 0, bridge_usage: 0 } }],
      [
        { guardrails: { $exists: false } },
        { $set: { guardrails: { is_enabled: false, guardrails_configuration: {}, guardrails_custom_prompt: "" } } }
      ],
      [{ "guardrails.is_enabled": { $exists: false }, guardrails: { $type: "object" } }, { $set: { "guardrails.is_enabled": false } }],
      [
        { "guardrails.guardrails_configuration": { $exists: false }, guardrails: { $type: "object" } },
        { $set: { "guardrails.guardrails_configuration": {} } }
      ],
      [{ pre_tools: { $exists: false } }, { $set: { pre_tools: [] } }],
      [{ fall_back: { $exists: false } }, { $set: { fall_back: { is_enable: false, service: "", model: "" } } }],
      [{ "fall_back.is_enable": { $exists: false }, fall_back: { $type: "object" } }, { $set: { "fall_back.is_enable": false } }],
      [{ bridge_status: { $exists: false } }, { $set: { bridge_status: 1 } }],
      [{ web_search_filters: { $exists: false } }, { $set: { web_search_filters: [] } }],
      [{ agent_variables: { $exists: false } }, { $set: { agent_variables: {} } }],
      [{ connected_agent_details: { $exists: false } }, { $set: { connected_agent_details: {} } }],
      [{ variables_path: { $exists: false } }, { $set: { variables_path: {} } }],
      [{ variables_state: { $exists: false } }, { $set: { variables_state: {} } }],
      [{ criteria_check: { $exists: false } }, { $set: { criteria_check: {} } }],
      [{ actions: { $exists: false } }, { $set: { actions: [] } }],
      [{ function_ids: { $exists: false } }, { $set: { function_ids: [] } }],
      [{ connected_agents: { $exists: false } }, { $set: { connected_agents: {} } }],
      [{ built_in_tools: { $exists: false } }, { $set: { built_in_tools: [] } }],
      [{ doc_ids: { $exists: false } }, { $set: { doc_ids: [] } }],
      [{ tool_call_count: { $exists: false } }, { $set: { tool_call_count: 0 } }],
      [{ prompt_enhancer_percentage: { $exists: false } }, { $set: { prompt_enhancer_percentage: 0 } }],
      [{ prompt_total_tokens: { $exists: false } }, { $set: { prompt_total_tokens: 0 } }],
      [{ IsstarterQuestionEnable: { $exists: false } }, { $set: { IsstarterQuestionEnable: false } }],
      [{ starterQuestion: { $exists: false } }, { $set: { starterQuestion: [] } }],
      [{ apikey_object_id: { $exists: false } }, { $set: { apikey_object_id: {} } }]
    ];

    const configDefaults = [
      [
        { "configuration.response_format": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.response_format": { type: "default", cred: {} } } }
      ],
      [{ "configuration.is_rich_text": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.is_rich_text": false } }],
      [
        { "configuration.fine_tune_model": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.fine_tune_model": "" } }
      ],
      [
        { "configuration.creativity_level": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.creativity_level": 0.5 } }
      ],
      [
        { "configuration.token_selection_limit": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.token_selection_limit": 0 } }
      ],
      [{ "configuration.response_count": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.response_count": 1 } }],
      [
        { "configuration.best_response_count": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.best_response_count": 1 } }
      ],
      [{ "configuration.novelty_penalty": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.novelty_penalty": 0 } }],
      [
        { "configuration.repetition_penalty": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.repetition_penalty": 0 } }
      ],
      [
        { "configuration.probability_cutoff": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.probability_cutoff": 0 } }
      ],
      [
        { "configuration.additional_stop_sequences": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.additional_stop_sequences": [] } }
      ],
      [{ "configuration.echo_input": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.echo_input": false } }],
      [
        { "configuration.parallel_tool_calls": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.parallel_tool_calls": false } }
      ],
      [{ "configuration.responseStyle": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.responseStyle": "" } }],
      [
        { "configuration.responseStylePrompt": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.responseStylePrompt": "" } }
      ],
      [{ "configuration.tone": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.tone": "" } }],
      [{ "configuration.tonePrompt": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.tonePrompt": "" } }],
      [
        { "configuration.log_probability": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.log_probability": false } }
      ],
      [{ "configuration.size": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.size": "" } }],
      [{ "configuration.image_size": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.image_size": "" } }],
      [
        { "configuration.number_of_images": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.number_of_images": 1 } }
      ],
      [{ "configuration.aspect_ratio": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.aspect_ratio": "" } }],
      [{ "configuration.dimensions": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.dimensions": "" } }],
      [{ "configuration.quality": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.quality": "standard" } }],
      [{ "configuration.style": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.style": "" } }],
      [{ "configuration.frame_rate": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.frame_rate": 0 } }],
      [
        { "configuration.duration_seconds": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.duration_seconds": 0 } }
      ],
      [{ "configuration.resolution": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.resolution": "" } }],
      [{ "configuration.video_settings": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.video_settings": {} } }],
      [{ "configuration.camera_fixed": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.camera_fixed": false } }],
      [
        { "configuration.person_generation": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.person_generation": false } }
      ],
      [
        { "configuration.auto_model_select": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.auto_model_select": false } }
      ],
      [{ "configuration.max_tokens": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.max_tokens": "default" } }],
      [
        { "configuration.response_type": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.response_type": "default" } }
      ],
      [{ "configuration.tool_choice": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.tool_choice": "default" } }]
    ];

    const versionRootDefaults = [
      [{ connected_agents: { $exists: false } }, { $set: { connected_agents: {} } }],
      [{ chatbot_auto_answers: { $exists: false } }, { $set: { chatbot_auto_answers: false } }],
      [{ published_version_id: { $exists: false } }, { $set: { published_version_id: null } }],
      [{ doc_ids: { $exists: false } }, { $set: { doc_ids: [] } }],
      [{ pre_tools: { $exists: false } }, { $set: { pre_tools: [] } }],
      [{ built_in_tools: { $exists: false } }, { $set: { built_in_tools: [] } }],
      [{ variables_path: { $exists: false } }, { $set: { variables_path: {} } }],
      [{ gtwy_web_search_filters: { $exists: false } }, { $set: { gtwy_web_search_filters: [] } }],
      [{ function_ids: { $exists: false } }, { $set: { function_ids: [] } }],
      [{ starterQuestion: { $exists: false } }, { $set: { starterQuestion: [] } }],
      [{ apikey_object_id: { $exists: false } }, { $set: { apikey_object_id: {} } }],
      [{ tool_call_count: { $exists: false } }, { $set: { tool_call_count: 0 } }],
      [
        { guardrails: { $exists: false } },
        { $set: { guardrails: { is_enabled: false, guardrails_configuration: {}, guardrails_custom_prompt: "" } } }
      ],
      [
        { "guardrails.guardrails_configuration": { $exists: false }, guardrails: { $type: "object" } },
        { $set: { "guardrails.guardrails_configuration": {} } }
      ],
      [{ folder_id: { $exists: false } }, { $set: { folder_id: null } }],
      [{ variables_state: { $exists: false } }, { $set: { variables_state: {} } }],
      [{ agent_variables: { $exists: false } }, { $set: { agent_variables: {} } }],
      [{ web_search_filters: { $exists: false } }, { $set: { web_search_filters: [] } }],
      [{ user_reference: { $exists: false } }, { $set: { user_reference: "" } }],
      [{ fall_back: { $exists: false } }, { $set: { fall_back: { is_enable: false, service: "", model: "" } } }],
      [{ IsstarterQuestionEnable: { $exists: false } }, { $set: { IsstarterQuestionEnable: false } }],
      [{ connected_agent_details: { $exists: false } }, { $set: { connected_agent_details: {} } }]
    ];

    const versionConfigDefaults = [
      [{ "configuration.response_count": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.response_count": 1 } }],
      [
        { "configuration.creativity_level": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.creativity_level": 0.5 } }
      ],
      [{ "configuration.image_size": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.image_size": "" } }],
      [{ "configuration.max_tokens": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.max_tokens": "default" } }],
      [{ "configuration.novelty_penalty": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.novelty_penalty": 0 } }],
      [
        { "configuration.probability_cutoff": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.probability_cutoff": 0 } }
      ],
      [{ "configuration.camera_fixed": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.camera_fixed": false } }],
      [
        { "configuration.responseStylePrompt": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.responseStylePrompt": "" } }
      ],
      [
        { "configuration.response_type": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.response_type": "default" } }
      ],
      [
        { "configuration.log_probability": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.log_probability": false } }
      ],
      [{ "configuration.dimensions": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.dimensions": "" } }],
      [{ "configuration.echo_input": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.echo_input": false } }],
      [{ "configuration.is_rich_text": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.is_rich_text": false } }],
      [{ "configuration.style": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.style": "" } }],
      [
        { "configuration.token_selection_limit": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.token_selection_limit": 0 } }
      ],
      [
        { "configuration.fine_tune_model": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.fine_tune_model": "" } }
      ],
      [{ "configuration.quality": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.quality": "standard" } }],
      [{ "configuration.tone": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.tone": "" } }],
      [{ "configuration.resolution": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.resolution": "" } }],
      [
        { "configuration.auto_model_select": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.auto_model_select": false } }
      ],
      [{ "configuration.size": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.size": "" } }],
      [
        { "configuration.duration_seconds": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.duration_seconds": 0 } }
      ],
      [{ "configuration.tonePrompt": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.tonePrompt": "" } }],
      [
        { "configuration.person_generation": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.person_generation": false } }
      ],
      [
        { "configuration.response_format": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.response_format": { type: "default", cred: {} } } }
      ],
      [{ "configuration.frame_rate": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.frame_rate": 0 } }],
      [{ "configuration.aspect_ratio": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.aspect_ratio": "" } }],
      [
        { "configuration.best_response_count": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.best_response_count": 1 } }
      ],
      [{ "configuration.video_settings": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.video_settings": {} } }],
      [
        { "configuration.additional_stop_sequences": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.additional_stop_sequences": [] } }
      ],
      [{ "configuration.tool_choice": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.tool_choice": "default" } }],
      [{ "configuration.responseStyle": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.responseStyle": "" } }],
      [
        { "configuration.repetition_penalty": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.repetition_penalty": 0 } }
      ],
      [
        { "configuration.parallel_tool_calls": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.parallel_tool_calls": false } }
      ],
      [
        { "configuration.number_of_images": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.number_of_images": 1 } }
      ]
    ];

    // Fire all 4 default arrays in parallel (root+config for configurations, root+config for versions)
    const [rootResults, configResults, versionRootResults, versionConfigResults] = await Promise.all([
      Promise.all(rootDefaults.map(([filter, update]) => configurations.updateMany(filter, update))),
      Promise.all(configDefaults.map(([filter, update]) => configurations.updateMany(filter, update))),
      Promise.all(versionRootDefaults.map(([filter, update]) => versions.updateMany(filter, update))),
      Promise.all(versionConfigDefaults.map(([filter, update]) => versions.updateMany(filter, update)))
    ]);

    console.log("  Configurations root defaults:");
    rootResults.forEach((r, i) => {
      if (r.modifiedCount > 0) console.log(`    ✓ ${JSON.stringify(rootDefaults[i][1].$set)} → ${r.modifiedCount} docs`);
    });
    console.log("  Configurations config defaults:");
    configResults.forEach((r, i) => {
      if (r.modifiedCount > 0) console.log(`    ✓ ${Object.keys(configDefaults[i][1].$set)[0]} → ${r.modifiedCount} docs`);
    });
    console.log("  Versions root defaults:");
    versionRootResults.forEach((r, i) => {
      if (r.modifiedCount > 0) console.log(`    ✓ ${Object.keys(versionRootDefaults[i][1].$set)[0]} → ${r.modifiedCount} docs`);
    });
    console.log("  Versions config defaults:");
    versionConfigResults.forEach((r, i) => {
      if (r.modifiedCount > 0) console.log(`    ✓ ${Object.keys(versionConfigDefaults[i][1].$set)[0]} → ${r.modifiedCount} docs`);
    });

    // -------------------------------------------------------
    // STEP 5: Hard delete agents with missing configuration.model + their versions
    // -------------------------------------------------------
    console.log("\n--- Step 5: Deleting agents with missing configuration.model ---");

    const missingModelAgents = await configurations
      .find({
        "configuration.model": { $exists: false }
      })
      .toArray();

    const step5ConfigOps = [];
    const step5VersionDeleteIds = [];
    for (const agent of missingModelAgents) {
      step5ConfigOps.push({ deleteOne: { filter: { _id: agent._id } } });
      const vIds = (agent.versions || [])
        .map((id) => {
          try {
            return new ObjectId(id);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      step5VersionDeleteIds.push(...vIds);
    }

    if (step5ConfigOps.length > 0 || step5VersionDeleteIds.length > 0) {
      await Promise.all([
        step5ConfigOps.length > 0 ? configurations.bulkWrite(step5ConfigOps) : null,
        step5VersionDeleteIds.length > 0 ? versions.deleteMany({ _id: { $in: step5VersionDeleteIds } }) : null
      ]);
    }
    deletedCount += missingModelAgents.length;
    console.log(`  ✓ Hard deleted ${missingModelAgents.length} agents + ${step5VersionDeleteIds.length} versions`);

    // -------------------------------------------------------
    // STEP 6: Handle agents with missing configuration.prompt
    // -------------------------------------------------------
    console.log("\n--- Step 6: Handling agents with missing configuration.prompt ---");

    const missingPromptAgents = await configurations
      .find({
        "configuration.prompt": { $exists: false }
      })
      .toArray();

    const step6HardDeleteConfigOps = [];
    const step6HardDeleteVersionIds = [];
    const step6SoftDeleteConfigOps = [];
    const step6SoftDeleteVersionIds = [];

    for (const agent of missingPromptAgents) {
      const vIds = (agent.versions || [])
        .map((id) => {
          try {
            return new ObjectId(id);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const hasEmptyOrg = !agent.org_id || agent.org_id === "";

      if (hasEmptyOrg) {
        step6HardDeleteConfigOps.push({ deleteOne: { filter: { _id: agent._id } } });
        step6HardDeleteVersionIds.push(...vIds);
      } else {
        step6SoftDeleteConfigOps.push({ updateOne: { filter: { _id: agent._id }, update: { $set: { deletedAt: TODAY } } } });
        step6SoftDeleteVersionIds.push(...vIds);
      }
    }

    await Promise.all([
      step6HardDeleteConfigOps.length > 0 ? configurations.bulkWrite(step6HardDeleteConfigOps) : null,
      step6HardDeleteVersionIds.length > 0 ? versions.deleteMany({ _id: { $in: step6HardDeleteVersionIds } }) : null,
      step6SoftDeleteConfigOps.length > 0 ? configurations.bulkWrite(step6SoftDeleteConfigOps) : null,
      step6SoftDeleteVersionIds.length > 0 ? versions.updateMany({ _id: { $in: step6SoftDeleteVersionIds } }, { $set: { deletedAt: TODAY } }) : null
    ]);

    deletedCount += step6HardDeleteConfigOps.length;
    softDeletedCount += step6SoftDeleteConfigOps.length;
    console.log(`  ✓ Hard deleted ${step6HardDeleteConfigOps.length} agents + ${step6HardDeleteVersionIds.length} versions`);
    console.log(`  ✓ Soft deleted ${step6SoftDeleteConfigOps.length} agents + ${step6SoftDeleteVersionIds.length} versions`);

    // -------------------------------------------------------
    // STEP 8: Fix missing user_id from PG history or org owner
    // -------------------------------------------------------
    console.log("\n--- Step 8: Fixing missing user_id ---");

    const missingUserIdAgents = await configurations
      .find({
        user_id: { $exists: false }
      })
      .toArray();

    const step8UpdateOps = [];

    for (const agent of missingUserIdAgents) {
      const bridgeId = agent._id.toString();
      const orgId = agent.org_id;
      let userId = null;

      // Try oldest entry in user_bridge_config_history
      try {
        const rows = await sequelize.query(`SELECT user_id FROM user_bridge_config_history WHERE bridge_id = :bridge_id ORDER BY time ASC LIMIT 1`, {
          replacements: { bridge_id: bridgeId },
          type: QueryTypes.SELECT
        });
        if (rows.length > 0 && rows[0].user_id) {
          userId = rows[0].user_id.toString();
          console.log(`  Found user_id ${userId} from history for ${bridgeId}`);
        }
      } catch (e) {
        console.log(`  PG query failed for ${bridgeId}: ${e.message}`);
      }

      // Fallback: org owner from proxy
      if (!userId && orgId) {
        if (!orgOwnerCache[orgId]) {
          try {
            const response = await axios.get(`https://routes.msg91.com/api/${process.env.PUBLIC_REFERENCEID}/getCompanies?id=${orgId}`, {
              headers: { "Content-Type": "application/json", Authkey: process.env.ADMIN_API_KEY }
            });
            const orgData = response?.data?.data?.data?.[0];
            orgOwnerCache[orgId] = orgData?.created_by?.toString() || null;
            await new Promise((r) => setTimeout(r, 100));
          } catch (e) {
            console.log(`  Proxy call failed for org ${orgId}: ${e.message}`);
          }
        }
        userId = orgOwnerCache[orgId];
        if (userId) console.log(`  Found user_id ${userId} from org owner for ${bridgeId}`);
      }

      if (userId) {
        step8UpdateOps.push({ updateOne: { filter: { _id: agent._id }, update: { $set: { user_id: userId } } } });
      } else {
        skippedCount++;
      }
    }

    if (step8UpdateOps.length > 0) {
      const bulkResult = await configurations.bulkWrite(step8UpdateOps);
      migratedCount += bulkResult.modifiedCount;
      console.log(`  ✓ Updated user_id for ${bulkResult.modifiedCount} agents`);
    }
    console.log(`  ⏭ Skipped ${skippedCount} agents (could not resolve user_id)`);

    // -------------------------------------------------------
    // STEP 9: Handle orphaned versions (missing model → hard delete, missing prompt → soft/hard delete)
    // -------------------------------------------------------
    console.log("\n--- Step 9: Handling orphaned versions with missing model/prompt ---");

    const missingModelVersions = await versions
      .find({
        "configuration.model": { $exists: false },
        deletedAt: null
      })
      .toArray();

    if (missingModelVersions.length > 0) {
      await versions.deleteMany({ _id: { $in: missingModelVersions.map((v) => v._id) } });
    }
    console.log(`  ✓ Hard deleted ${missingModelVersions.length} versions (missing model)`);

    const missingPromptVersions = await versions
      .find({
        "configuration.prompt": { $exists: false },
        deletedAt: null
      })
      .toArray();

    const versionHardDeleteIds = [];
    const versionSoftDeleteIds = [];

    for (const ver of missingPromptVersions) {
      const hasEmptyOrg = !ver.org_id || ver.org_id === "";
      if (hasEmptyOrg) {
        versionHardDeleteIds.push(ver._id);
      } else {
        versionSoftDeleteIds.push(ver._id);
      }
    }

    await Promise.all([
      versionHardDeleteIds.length > 0 ? versions.deleteMany({ _id: { $in: versionHardDeleteIds } }) : null,
      versionSoftDeleteIds.length > 0 ? versions.updateMany({ _id: { $in: versionSoftDeleteIds } }, { $set: { deletedAt: TODAY } }) : null
    ]);

    console.log(`  ✓ Hard deleted ${versionHardDeleteIds.length} versions (missing prompt, no org)`);
    console.log(`  ✓ Soft deleted ${versionSoftDeleteIds.length} versions (missing prompt, has org)`);

    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  user_id fixed:      ${migratedCount}`);
    console.log(`  Hard deleted:       ${deletedCount}`);
    console.log(`  Soft deleted:       ${softDeletedCount}`);
    console.log(`  Skipped:            ${skippedCount}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    await sequelize.close();
    console.log("\nConnections closed");
  }
}

export { migrateConfigurations };
