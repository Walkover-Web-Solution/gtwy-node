import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;

if (!MONGODB_URI) {
  console.error("Error: MONGODB_CONNECTION_URI environment variable is not set.");
  process.exit(1);
}

async function migrateSettingsField() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();

    const configurations = db.collection("configurations");
    const versions = db.collection("configuration_versions");

    let configStats = { scanned: 0, updated: 0, created: 0 };
    let versionStats = { scanned: 0, updated: 0, created: 0 };

    // --- Migrate Configurations ---
    console.log("\n=== MIGRATING CONFIGURATIONS ===");

    // Get all configurations
    const allConfigs = await configurations.find({}).toArray();
    configStats.scanned = allConfigs.length;

    const configOps = [];

    for (const doc of allConfigs) {
      const settings = {};
      let hasSettingsUpdate = false;

      // 1. Handle publicUsers (rename from page_config.allowedUsers)
      if (doc.page_config?.allowedUsers) {
        settings.publicUsers = doc.page_config.allowedUsers;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving page_config.allowedUsers to settings.publicUsers`);
      } else if (!doc.settings?.publicUsers) {
        settings.publicUsers = [];
        hasSettingsUpdate = true;
      }

      // 2. Handle editAccess (rename from root users)
      if (doc.users) {
        settings.editAccess = Array.isArray(doc.users) ? doc.users : [];
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving root users to settings.editAccess`);
      } else if (!doc.settings?.editAccess) {
        settings.editAccess = [];
        hasSettingsUpdate = true;
      }

      // 3. Handle responseStyle (move from configuration)
      if (doc.configuration?.responseStyle) {
        settings.responseStyle = doc.configuration.responseStyle;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving configuration.responseStyle to settings.responseStyle`);
      } else if (!doc.settings?.responseStyle) {
        settings.responseStyle = "default";
        hasSettingsUpdate = true;
      }

      // 4. Handle tone (move from configuration)
      if (doc.configuration?.tone) {
        settings.tone = doc.configuration.tone;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving configuration.tone to settings.tone`);
      } else if (!doc.settings?.tone) {
        settings.tone = "";
        hasSettingsUpdate = true;
      }

      // 5. Handle tonePrompt (move from configuration)
      if (doc.configuration?.tonePrompt) {
        settings.tonePrompt = doc.configuration.tonePrompt;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving configuration.tonePrompt to settings.tonePrompt`);
      } else if (!doc.settings?.tonePrompt) {
        settings.tonePrompt = "";
        hasSettingsUpdate = true;
      }

      // 6. Handle response_format (move from configuration)
      if (doc.configuration?.response_format) {
        settings.response_format = doc.configuration.response_format;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving configuration.response_format to settings.response_format`);
      } else if (!doc.settings?.response_format) {
        settings.response_format = { type: "default", cred: {} };
        hasSettingsUpdate = true;
      }

      // 7. Handle responseStylePrompt (move from configuration)
      if (doc.configuration?.responseStylePrompt) {
        settings.responseStylePrompt = doc.configuration.responseStylePrompt;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving configuration.responseStylePrompt to settings.responseStylePrompt`);
      } else if (!doc.settings?.responseStylePrompt) {
        settings.responseStylePrompt = "";
        hasSettingsUpdate = true;
      }

      // 8. Handle guardrails (move from root)
      if (doc.guardrails) {
        settings.guardrails = doc.guardrails;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving root guardrails to settings.guardrails`);
      } else if (!doc.settings?.guardrails) {
        settings.guardrails = {
          is_enabled: false,
          guardrails_configuration: {},
          guardrails_custom_prompt: ""
        };
        hasSettingsUpdate = true;
      }

      // 9. Handle fall_back (move from root)
      if (doc.fall_back) {
        settings.fall_back = doc.fall_back;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving root fall_back to settings.fall_back`);
      } else if (!doc.settings?.fall_back) {
        settings.fall_back = {
          is_enable: false,
          service: "",
          model: ""
        };
        hasSettingsUpdate = true;
      }

      // 10. Handle maximum_iterations (move from root)
      if (doc.tool_call_count !== undefined) {
        settings.maximum_iterations = doc.tool_call_count;
        hasSettingsUpdate = true;
        console.log(`  Config ${doc._id}: Moving root tool_call_count to settings.maximum_iterations`);
      } else if (doc.settings?.maximum_iterations === undefined) {
        settings.maximum_iterations = 0;
        hasSettingsUpdate = true;
      }

      // Prepare update operation
      if (hasSettingsUpdate) {
        // const updateOp = { $set: { settings: settings } };
        const unsetOp = {
          $unset: {
            "page_config.allowedUsers": "",
            users: "",
            "configuration.responseStyle": "",
            "configuration.tone": "",
            "configuration.tonePrompt": "",
            "configuration.response_format": "",
            "configuration.responseStylePrompt": "",
            guardrails: "",
            fall_back: "",
            tool_call_count: ""
          }
        };

        if (doc.settings) {
          // Merge with existing settings
          Object.assign(doc.settings, settings);
          configOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: { settings: doc.settings },
                ...unsetOp
              }
            }
          });
          configStats.updated++;
        } else {
          // Create new settings
          configOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: { settings: settings },
                ...unsetOp
              }
            }
          });
          configStats.created++;
        }
      }
    }

    // Execute configuration operations in batches
    if (configOps.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < configOps.length; i += batchSize) {
        const batch = configOps.slice(i, i + batchSize);
        await configurations.bulkWrite(batch);
        console.log(`  Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(configOps.length / batchSize)} for configurations`);
      }
    }

    // --- Migrate Versions ---
    console.log("\n=== MIGRATING VERSIONS ===");

    // Get all versions
    const allVersions = await versions.find({}).toArray();
    versionStats.scanned = allVersions.length;

    const versionOps = [];

    for (const doc of allVersions) {
      const settings = {};
      let hasSettingsUpdate = false;

      // For versions, we don't include publicUsers and editAccess
      // Only migrate the configuration and root fields

      // 1. Handle responseStyle (move from configuration)
      if (doc.configuration?.responseStyle) {
        settings.responseStyle = doc.configuration.responseStyle;
        hasSettingsUpdate = true;
        console.log(`  Version ${doc._id}: Moving configuration.responseStyle to settings.responseStyle`);
      } else if (!doc.settings?.responseStyle) {
        settings.responseStyle = "default";
        hasSettingsUpdate = true;
      }

      // 2. Handle tone (move from configuration)
      if (doc.configuration?.tone) {
        settings.tone = doc.configuration.tone;
        hasSettingsUpdate = true;
        console.log(`  Version ${doc._id}: Moving configuration.tone to settings.tone`);
      } else if (!doc.settings?.tone) {
        settings.tone = "";
        hasSettingsUpdate = true;
      }

      // 3. Handle tonePrompt (move from configuration)
      if (doc.configuration?.tonePrompt) {
        settings.tonePrompt = doc.configuration.tonePrompt;
        hasSettingsUpdate = true;
        console.log(`  Version ${doc._id}: Moving configuration.tonePrompt to settings.tonePrompt`);
      } else if (!doc.settings?.tonePrompt) {
        settings.tonePrompt = "";
        hasSettingsUpdate = true;
      }

      // 4. Handle response_format (move from configuration)
      if (doc.configuration?.response_format) {
        settings.response_format = doc.configuration.response_format;
        hasSettingsUpdate = true;
        console.log(`  Version ${doc._id}: Moving configuration.response_format to settings.response_format`);
      } else if (!doc.settings?.response_format) {
        settings.response_format = { type: "default", cred: {} };
        hasSettingsUpdate = true;
      }

      // 5. Handle responseStylePrompt (move from configuration)
      if (doc.configuration?.responseStylePrompt) {
        settings.responseStylePrompt = doc.configuration.responseStylePrompt;
        hasSettingsUpdate = true;
        console.log(`  Version ${doc._id}: Moving configuration.responseStylePrompt to settings.responseStylePrompt`);
      } else if (!doc.settings?.responseStylePrompt) {
        settings.responseStylePrompt = "";
        hasSettingsUpdate = true;
      }

      // 6. Handle guardrails (move from root)
      if (doc.guardrails) {
        settings.guardrails = doc.guardrails;
        hasSettingsUpdate = true;
        console.log(`  Version ${doc._id}: Moving root guardrails to settings.guardrails`);
      } else if (!doc.settings?.guardrails) {
        settings.guardrails = {
          is_enabled: false,
          guardrails_configuration: {},
          guardrails_custom_prompt: ""
        };
        hasSettingsUpdate = true;
      }

      // 7. Handle fall_back (move from root)
      if (doc.fall_back) {
        settings.fall_back = doc.fall_back;
        hasSettingsUpdate = true;
        console.log(`  Version ${doc._id}: Moving root fall_back to settings.fall_back`);
      } else if (!doc.settings?.fall_back) {
        settings.fall_back = {
          is_enable: false,
          service: "",
          model: ""
        };
        hasSettingsUpdate = true;
      }

      // 8. Handle maximum_iterations (move from root)
      if (doc.tool_call_count !== undefined) {
        settings.maximum_iterations = doc.tool_call_count;
        hasSettingsUpdate = true;
        console.log(`  Version ${doc._id}: Moving root tool_call_count to settings.maximum_iterations`);
      } else if (doc.settings?.maximum_iterations === undefined) {
        settings.maximum_iterations = 3;
        hasSettingsUpdate = true;
      }

      // Prepare update operation
      if (hasSettingsUpdate) {
        const unsetOp = {
          $unset: {
            "configuration.responseStyle": "",
            "configuration.tone": "",
            "configuration.tonePrompt": "",
            "configuration.response_format": "",
            "configuration.responseStylePrompt": "",
            guardrails: "",
            fall_back: "",
            tool_call_count: ""
          }
        };

        if (doc.settings) {
          // Merge with existing settings
          Object.assign(doc.settings, settings);
          versionOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: { settings: settings },
                ...unsetOp
              }
            }
          });
          versionStats.updated++;
        } else {
          // Create new settings
          versionOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: { settings: settings },
                ...unsetOp
              }
            }
          });
          versionStats.created++;
        }
      }
    }

    // Execute version operations in batches
    if (versionOps.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < versionOps.length; i += batchSize) {
        const batch = versionOps.slice(i, i + batchSize);
        await versions.bulkWrite(batch);
        console.log(`  Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(versionOps.length / batchSize)} for versions`);
      }
    }

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("MIGRATION SUMMARY");
    console.log("=".repeat(60));
    console.log("CONFIGURATIONS:");
    console.log(`  Scanned: ${configStats.scanned}`);
    console.log(`  Updated existing settings: ${configStats.updated}`);
    console.log(`  Created new settings: ${configStats.created}`);
    console.log("\nVERSIONS:");
    console.log(`  Scanned: ${versionStats.scanned}`);
    console.log(`  Updated existing settings: ${versionStats.updated}`);
    console.log(`  Created new settings: ${versionStats.created}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nMongoDB connection closed");
  }
}

// Run the migration
migrateSettingsField()
  .then(() => {
    console.log("\n✓ Settings field migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Settings field migration failed:", error);
    process.exit(1);
  });
