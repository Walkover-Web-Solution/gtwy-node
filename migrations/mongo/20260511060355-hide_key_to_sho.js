/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
const hideToShowMap = {
  hideHomeButton: "showHomeButton",
  hideAdvancedParameters: "showAdvancedParameters",
  hideCreateManuallyButton: "showCreateManuallyButton",
  hideAdvancedConfigurations: "showAdvancedConfigurations",
  hidePreTool: "showPreTool",
  hideFullScreenButton: "showFullScreenButton",
  hideCloseButton: "showCloseButton",
  hideHeader: "showHeader",
  hidePromptHelper: "showPromptHelper"
};

const showToHideMap = Object.fromEntries(Object.entries(hideToShowMap).map(([hideKey, showKey]) => [showKey, hideKey]));

const migrateConfigKeys = async (db, keyMap) => {
  const collection = db.collection("folders");
  const docs = await collection.find({ config: { $exists: true } }, { projection: { config: 1 } }).toArray();
  const operations = [];

  for (const doc of docs) {
    const config = doc.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) continue;

    const setData = {};
    const unsetData = {};

    // Traverse config keys and convert only known hide/show pairs.
    for (const [fromKey, toKey] of Object.entries(keyMap)) {
      if (!(fromKey in config)) continue;

      const oldValue = config[fromKey];
      setData[`config.${toKey}`] = typeof oldValue === "boolean" ? !oldValue : oldValue;
      unsetData[`config.${fromKey}`] = "";
    }

    if (!Object.keys(setData).length) continue;

    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: setData,
          $unset: unsetData
        }
      }
    });
  }

  if (operations.length) {
    await collection.bulkWrite(operations, { ordered: false });
  }
  console.log(`Migrated ${operations.length} documents out of ${docs.length} checked.`);
};

export const up = async (db) => {
  await migrateConfigKeys(db, hideToShowMap);
  return;
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await migrateConfigKeys(db, showToHideMap);
  return;
};
