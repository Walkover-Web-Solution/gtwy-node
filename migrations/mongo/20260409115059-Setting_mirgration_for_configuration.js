/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const configurations = db.collection("configurations");
  const versions = db.collection("configuration_versions");

  const configStats = { scanned: 0, updated: 0, created: 0 };
  const versionStats = { scanned: 0, updated: 0, created: 0 };

  console.log("\n=== MIGRATING CONFIGURATIONS ===");
  const allConfigs = await configurations.find({}).toArray();
  configStats.scanned = allConfigs.length;
  const configOps = [];

  for (const doc of allConfigs) {
    const settings = {};
    let hasSettingsUpdate = false;

    if (doc.page_config?.allowedUsers) {
      settings.publicUsers = doc.page_config.allowedUsers;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.publicUsers) {
      settings.publicUsers = [];
      hasSettingsUpdate = true;
    }

    if (doc.users) {
      settings.editAccess = Array.isArray(doc.users) ? doc.users : [];
      hasSettingsUpdate = true;
    } else if (!doc.settings?.editAccess) {
      settings.editAccess = [];
      hasSettingsUpdate = true;
    }

    if (doc.configuration?.responseStyle) {
      settings.responseStyle = doc.configuration.responseStyle;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.responseStyle) {
      settings.responseStyle = "";
      hasSettingsUpdate = true;
    }

    if (doc.configuration?.tone) {
      settings.tone = doc.configuration.tone;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.tone) {
      settings.tone = "";
      hasSettingsUpdate = true;
    }

    if (doc.configuration?.response_format) {
      settings.response_format = doc.configuration.response_format;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.response_format) {
      settings.response_format = { type: "default", cred: {} };
      hasSettingsUpdate = true;
    }

    if (doc.guardrails) {
      settings.guardrails = doc.guardrails;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.guardrails) {
      settings.guardrails = {
        is_enabled: false,
        guardrails_configuration: {},
        guardrails_custom_prompt: ""
      };
      hasSettingsUpdate = true;
    }

    if (doc.fall_back) {
      settings.fall_back = doc.fall_back;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.fall_back) {
      settings.fall_back = {
        is_enable: false,
        service: "",
        model: ""
      };
      hasSettingsUpdate = true;
    }

    if (doc.tool_call_count !== undefined) {
      settings.maximum_iterations = doc.tool_call_count;
      hasSettingsUpdate = true;
    } else if (doc.settings?.maximum_iterations === undefined) {
      settings.maximum_iterations = 0;
      hasSettingsUpdate = true;
    }

    if (!hasSettingsUpdate) continue;

    const mergedSettings = doc.settings ? { ...doc.settings, ...settings } : settings;
    const unsetOp = {
      "page_config.allowedUsers": "",
      users: "",
      "configuration.responseStyle": "",
      "configuration.tone": "",
      "configuration.response_format": "",
      guardrails: "",
      fall_back: "",
      tool_call_count: ""
    };

    configOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: { settings: mergedSettings },
          $unset: unsetOp
        }
      }
    });

    if (doc.settings) {
      configStats.updated++;
    } else {
      configStats.created++;
    }
  }

  if (configOps.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < configOps.length; i += batchSize) {
      const batch = configOps.slice(i, i + batchSize);
      await configurations.bulkWrite(batch);
      console.log(`Processed config batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(configOps.length / batchSize)}`);
    }
  }

  console.log("\n=== MIGRATING VERSIONS ===");
  const allVersions = await versions.find({}).toArray();
  versionStats.scanned = allVersions.length;
  const versionOps = [];

  for (const doc of allVersions) {
    const settings = {};
    let hasSettingsUpdate = false;

    if (doc.configuration?.responseStyle) {
      settings.responseStyle = doc.configuration.responseStyle;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.responseStyle) {
      settings.responseStyle = "default";
      hasSettingsUpdate = true;
    }

    if (doc.configuration?.tone) {
      settings.tone = doc.configuration.tone;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.tone) {
      settings.tone = "";
      hasSettingsUpdate = true;
    }

    if (doc.configuration?.tonePrompt) {
      settings.tonePrompt = doc.configuration.tonePrompt;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.tonePrompt) {
      settings.tonePrompt = "";
      hasSettingsUpdate = true;
    }

    if (doc.configuration?.response_format) {
      settings.response_format = doc.configuration.response_format;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.response_format) {
      settings.response_format = { type: "default", cred: {} };
      hasSettingsUpdate = true;
    }

    if (doc.configuration?.responseStylePrompt) {
      settings.responseStylePrompt = doc.configuration.responseStylePrompt;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.responseStylePrompt) {
      settings.responseStylePrompt = "";
      hasSettingsUpdate = true;
    }

    if (doc.guardrails) {
      settings.guardrails = doc.guardrails;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.guardrails) {
      settings.guardrails = {
        is_enabled: false,
        guardrails_configuration: {},
        guardrails_custom_prompt: ""
      };
      hasSettingsUpdate = true;
    }

    if (doc.fall_back) {
      settings.fall_back = doc.fall_back;
      hasSettingsUpdate = true;
    } else if (!doc.settings?.fall_back) {
      settings.fall_back = {
        is_enable: false,
        service: "",
        model: ""
      };
      hasSettingsUpdate = true;
    }

    if (doc.tool_call_count !== undefined) {
      settings.maximum_iterations = doc.tool_call_count;
      hasSettingsUpdate = true;
    } else if (doc.settings?.maximum_iterations === undefined) {
      settings.maximum_iterations = 3;
      hasSettingsUpdate = true;
    }

    if (!hasSettingsUpdate) continue;

    const mergedSettings = doc.settings ? { ...doc.settings, ...settings } : settings;
    const unsetOp = {
      "configuration.responseStyle": "",
      "configuration.tone": "",
      "configuration.tonePrompt": "",
      "configuration.response_format": "",
      "configuration.responseStylePrompt": "",
      guardrails: "",
      fall_back: "",
      tool_call_count: ""
    };

    versionOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: { settings: mergedSettings },
          $unset: unsetOp
        }
      }
    });

    if (doc.settings) {
      versionStats.updated++;
    } else {
      versionStats.created++;
    }
  }

  if (versionOps.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < versionOps.length; i += batchSize) {
      const batch = versionOps.slice(i, i + batchSize);
      await versions.bulkWrite(batch);
      console.log(`Processed version batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(versionOps.length / batchSize)}`);
    }
  }

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
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const configurations = db.collection("configurations");
  const versions = db.collection("configuration_versions");

  const configDocs = await configurations.find({ settings: { $exists: true } }).toArray();
  const configOps = [];

  for (const doc of configDocs) {
    const setOp = {};
    const unsetOp = { settings: "" };

    if (doc.settings?.publicUsers !== undefined) setOp["page_config.allowedUsers"] = doc.settings.publicUsers;
    if (doc.settings?.editAccess !== undefined) setOp.users = doc.settings.editAccess;
    if (doc.settings?.responseStyle !== undefined) setOp["configuration.responseStyle"] = doc.settings.responseStyle;
    if (doc.settings?.tone !== undefined) setOp["configuration.tone"] = doc.settings.tone;
    if (doc.settings?.tonePrompt !== undefined) setOp["configuration.tonePrompt"] = doc.settings.tonePrompt;
    if (doc.settings?.response_format !== undefined) setOp["configuration.response_format"] = doc.settings.response_format;
    if (doc.settings?.responseStylePrompt !== undefined) setOp["configuration.responseStylePrompt"] = doc.settings.responseStylePrompt;
    if (doc.settings?.guardrails !== undefined) setOp.guardrails = doc.settings.guardrails;
    if (doc.settings?.fall_back !== undefined) setOp.fall_back = doc.settings.fall_back;
    if (doc.settings?.maximum_iterations !== undefined) setOp.tool_call_count = doc.settings.maximum_iterations;

    configOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: setOp,
          $unset: unsetOp
        }
      }
    });
  }

  if (configOps.length > 0) {
    await configurations.bulkWrite(configOps);
  }

  const versionDocs = await versions.find({ settings: { $exists: true } }).toArray();
  const versionOps = [];

  for (const doc of versionDocs) {
    const setOp = {};
    const unsetOp = { settings: "" };

    if (doc.settings?.responseStyle !== undefined) setOp["configuration.responseStyle"] = doc.settings.responseStyle;
    if (doc.settings?.tone !== undefined) setOp["configuration.tone"] = doc.settings.tone;
    if (doc.settings?.tonePrompt !== undefined) setOp["configuration.tonePrompt"] = doc.settings.tonePrompt;
    if (doc.settings?.response_format !== undefined) setOp["configuration.response_format"] = doc.settings.response_format;
    if (doc.settings?.responseStylePrompt !== undefined) setOp["configuration.responseStylePrompt"] = doc.settings.responseStylePrompt;
    if (doc.settings?.guardrails !== undefined) setOp.guardrails = doc.settings.guardrails;
    if (doc.settings?.fall_back !== undefined) setOp.fall_back = doc.settings.fall_back;
    if (doc.settings?.maximum_iterations !== undefined) setOp.tool_call_count = doc.settings.maximum_iterations;

    versionOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: setOp,
          $unset: unsetOp
        }
      }
    });
  }

  if (versionOps.length > 0) {
    await versions.bulkWrite(versionOps);
  }
};
