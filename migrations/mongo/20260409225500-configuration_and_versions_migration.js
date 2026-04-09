import { ObjectId } from "mongodb";
import { Sequelize, QueryTypes } from "sequelize";
import axios from "axios";

const TODAY = new Date();

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  console.log("Starting configuration and versions migration...");

  const configurations = db.collection("configurations");
  const versions = db.collection("configuration_versions");

  // Initialize sequelize for user_id resolution
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
    await sequelize.authenticate();

    // STEP 1 + 9: Remove extra keys
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
            "configuration.vision": "",
            "configuration.is_rich_text": "",
            user_reference: ""
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
            "configuration.rtllayer": "",
            "configuration.is_rich_text": "",
            user_reference: ""
          }
        }
      )
    ]);
    console.log(`  ✓ Removed extra keys from ${step1.modifiedCount} configuration documents`);
    console.log(`  ✓ Removed extra keys from ${step9.modifiedCount} version documents`);

    // STEP 4: Rename fields
    console.log("\n--- Step 4: Renaming fields ---");
    const renameToolCallCount = await versions.updateMany(
      { tool_call_count: { $exists: true } },
      { $rename: { tool_call_count: "maximum_iterations" } }
    );
    console.log(`  ✓ Renamed tool_call_count to maximum_iterations: ${renameToolCallCount.modifiedCount} versions`);

    const renameChatbotAutoAnswersConfig = await configurations.updateMany(
      { chatbot_auto_answers: { $exists: true } },
      { $rename: { chatbot_auto_answers: "cache_response" } }
    );
    console.log(`  ✓ Renamed chatbot_auto_answers to cache_response: ${renameChatbotAutoAnswersConfig.modifiedCount} configurations`);

    const renameChatbotAutoAnswersVersion = await versions.updateMany(
      { chatbot_auto_answers: { $exists: true } },
      { $rename: { chatbot_auto_answers: "cache_response" } }
    );
    console.log(`  ✓ Renamed chatbot_auto_answers to cache_response: ${renameChatbotAutoAnswersVersion.modifiedCount} versions`);

    // Handle image_size → size migration
    const copyImageSizeToSizeConfig = await configurations.updateMany(
      { "configuration.image_size": { $exists: true }, "configuration.size": { $exists: false } },
      [{ $set: { "configuration.size": "$configuration.image_size" } }]
    );
    console.log(`  ✓ Copied image_size to size (where size missing): ${copyImageSizeToSizeConfig.modifiedCount} configurations`);

    const unsetImageSizeConfig = await configurations.updateMany(
      { "configuration.image_size": { $exists: true } },
      { $unset: { "configuration.image_size": "" } }
    );
    console.log(`  ✓ Removed image_size: ${unsetImageSizeConfig.modifiedCount} configurations`);

    const copyImageSizeToSizeVersion = await versions.updateMany(
      { "configuration.image_size": { $exists: true }, "configuration.size": { $exists: false } },
      [{ $set: { "configuration.size": "$configuration.image_size" } }]
    );
    console.log(`  ✓ Copied image_size to size (where size missing): ${copyImageSizeToSizeVersion.modifiedCount} versions`);

    const unsetImageSizeVersion = await versions.updateMany(
      { "configuration.image_size": { $exists: true } },
      { $unset: { "configuration.image_size": "" } }
    );
    console.log(`  ✓ Removed image_size: ${unsetImageSizeVersion.modifiedCount} versions`);

    const setDefaultSizeVersion = await versions.updateMany(
      { "configuration.image_size": { $exists: false }, "configuration.size": { $exists: false } },
      { $set: { "configuration.size": "" } }
    );
    console.log(`  ✓ Set default size (where both missing): ${setDefaultSizeVersion.modifiedCount} versions`);

    // STEP 2 + 3 + 10: Set safe defaults
    console.log("\n--- Step 2 + 3 + 10: Setting safe defaults ---");
    const rootDefaults = [
      [{ meta: { $exists: false } }, { $set: { meta: {} } }],
      [{ deletedAt: { $exists: false } }, { $set: { deletedAt: null } }],
      [{ last_used: { $exists: false } }, { $set: { last_used: null } }],
      [{ cache_response: { $exists: false } }, { $set: { cache_response: false } }],
      [{ pre_tools: { $exists: false } }, { $set: { pre_tools: [] } }],
      [{ agent_variables: { $exists: false } }, { $set: { agent_variables: {} } }],
      [{ actions: { $exists: false } }, { $set: { actions: [] } }],
      [{ IsstarterQuestionEnable: { $exists: false } }, { $set: { IsstarterQuestionEnable: false } }],
      [{ starterQuestion: { $exists: false } }, { $set: { starterQuestion: [] } }],
      [{ apikey_object_id: { $exists: false } }, { $set: { apikey_object_id: {} } }]
    ];

    const configDefaults = [
      [
        { "configuration.fine_tune_model": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.fine_tune_model": "" } }
      ],
      [
        { "configuration.parallel_tool_calls": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.parallel_tool_calls": false } }
      ],
      [{ "configuration.size": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.size": "" } }],
      [{ "configuration.style": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.style": "" } }],
      [
        { "configuration.auto_model_select": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.auto_model_select": false } }
      ],
      [
        { "configuration.response_type": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.response_type": "default" } }
      ],
      [{ "configuration.tool_choice": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.tool_choice": "default" } }]
    ];

    const versionRootDefaults = [
      [{ cache_response: { $exists: false } }, { $set: { cache_response: false } }],
      [{ published_version_id: { $exists: false } }, { $set: { published_version_id: null } }],
      [{ pre_tools: { $exists: false } }, { $set: { pre_tools: [] } }],
      [{ gtwy_web_search_filters: { $exists: false } }, { $set: { gtwy_web_search_filters: [] } }],
      [{ starterQuestion: { $exists: false } }, { $set: { starterQuestion: [] } }],
      [{ apikey_object_id: { $exists: false } }, { $set: { apikey_object_id: {} } }],
      [{ maximum_iterations: { $exists: false } }, { $set: { maximum_iterations: 0 } }],
      [{ folder_id: { $exists: false } }, { $set: { folder_id: null } }],
      [{ agent_variables: { $exists: false } }, { $set: { agent_variables: {} } }],
      [{ IsstarterQuestionEnable: { $exists: false } }, { $set: { IsstarterQuestionEnable: false } }]
    ];

    const versionConfigDefaults = [
      [
        { "configuration.response_type": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.response_type": "default" } }
      ],
      [{ "configuration.dimensions": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.dimensions": "" } }],
      [{ "configuration.style": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.style": "" } }],
      [
        { "configuration.fine_tune_model": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.fine_tune_model": "" } }
      ],
      [
        { "configuration.auto_model_select": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.auto_model_select": false } }
      ],
      [{ "configuration.size": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.size": "" } }],
      [{ "configuration.tool_choice": { $exists: false }, configuration: { $type: "object" } }, { $set: { "configuration.tool_choice": "default" } }],
      [
        { "configuration.parallel_tool_calls": { $exists: false }, configuration: { $type: "object" } },
        { $set: { "configuration.parallel_tool_calls": false } }
      ]
    ];

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

    // STEP 5: Hard delete agents with missing configuration.model
    console.log("\n--- Step 5: Deleting agents with missing configuration.model ---");
    const missingModelAgents = await configurations.find({ "configuration.model": { $exists: false } }).toArray();
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

    // STEP 6: Handle agents with missing configuration.prompt
    console.log("\n--- Step 6: Handling agents with missing configuration.prompt ---");
    const missingPromptAgents = await configurations.find({ "configuration.prompt": { $exists: false } }).toArray();
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

    // STEP 8: Fix missing user_id
    console.log("\n--- Step 8: Fixing missing user_id ---");
    const missingUserIdAgents = await configurations.find({ user_id: { $exists: false } }).toArray();
    const step8UpdateOps = [];

    for (const agent of missingUserIdAgents) {
      const bridgeId = agent._id.toString();
      const orgId = agent.org_id;
      let userId = null;

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

    // STEP 9: Handle orphaned versions
    console.log("\n--- Step 9: Handling orphaned versions with missing model/prompt ---");
    const missingModelVersions = await versions.find({ "configuration.model": { $exists: false }, deletedAt: null }).toArray();

    if (missingModelVersions.length > 0) {
      await versions.deleteMany({ _id: { $in: missingModelVersions.map((v) => v._id) } });
    }
    console.log(`  ✓ Hard deleted ${missingModelVersions.length} versions (missing model)`);

    const missingPromptVersions = await versions.find({ "configuration.prompt": { $exists: false }, deletedAt: null }).toArray();
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
  } finally {
    await sequelize.close();
  }
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  console.log("Rolling back configuration and versions migration...");
  console.log("⚠️  WARNING: This migration involves hard/soft deletes that cannot be fully reversed.");
  console.log("⚠️  Only field renames and defaults will be rolled back.");

  const configurations = db.collection("configurations");
  const versions = db.collection("configuration_versions");

  // Reverse field renames
  console.log("\n--- Reversing field renames ---");

  const reverseMaximumIterations = await versions.updateMany(
    { maximum_iterations: { $exists: true } },
    { $rename: { maximum_iterations: "tool_call_count" } }
  );
  console.log(`  ✓ Renamed maximum_iterations back to tool_call_count: ${reverseMaximumIterations.modifiedCount} versions`);

  const reverseCacheResponseConfig = await configurations.updateMany(
    { cache_response: { $exists: true } },
    { $rename: { cache_response: "chatbot_auto_answers" } }
  );
  console.log(`  ✓ Renamed cache_response back to chatbot_auto_answers: ${reverseCacheResponseConfig.modifiedCount} configurations`);

  const reverseCacheResponseVersion = await versions.updateMany(
    { cache_response: { $exists: true } },
    { $rename: { cache_response: "chatbot_auto_answers" } }
  );
  console.log(`  ✓ Renamed cache_response back to chatbot_auto_answers: ${reverseCacheResponseVersion.modifiedCount} versions`);

  // Reverse image_size migration (restore image_size from size)
  const restoreImageSizeConfig = await configurations.updateMany({ "configuration.size": { $exists: true } }, [
    { $set: { "configuration.image_size": "$configuration.size" } }
  ]);
  console.log(`  ✓ Restored image_size from size: ${restoreImageSizeConfig.modifiedCount} configurations`);

  const restoreImageSizeVersion = await versions.updateMany({ "configuration.size": { $exists: true } }, [
    { $set: { "configuration.image_size": "$configuration.size" } }
  ]);
  console.log(`  ✓ Restored image_size from size: ${restoreImageSizeVersion.modifiedCount} versions`);

  console.log("\n⚠️  Note: Deleted documents cannot be restored. Only reversible changes have been applied.");
};
