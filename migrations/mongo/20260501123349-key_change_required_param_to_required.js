const isObj = (value) => value && typeof value === "object" && !Array.isArray(value);

const renameKey = (obj, fromKey, toKey) => {
  if (!isObj(obj) || !(fromKey in obj)) return;
  if (!(toKey in obj)) obj[toKey] = obj[fromKey];
  delete obj[fromKey];
};

const changeParameterKeyInFields = (fields, isUp) => {
  if (!isObj(fields)) return fields;

  const fromKey = isUp ? "parameter" : "properties";
  const toKey = isUp ? "properties" : "parameter";
  const next = {};

  for (const [fieldName, field] of Object.entries(fields)) {
    if (!isObj(field)) {
      next[fieldName] = field;
      continue;
    }

    const updated = { ...field };
    renameKey(updated, fromKey, toKey);

    if (isObj(updated[toKey])) {
      updated[toKey] = changeParameterKeyInFields(updated[toKey], isUp);
    }

    next[fieldName] = updated;
  }

  return next;
};

const changeRequiredKeyInFields = (fields, isUp) => {
  if (!isObj(fields)) return fields;

  const fromKey = isUp ? "required_params" : "required";
  const toKey = isUp ? "required" : "required_params";
  const next = {};

  for (const [fieldName, field] of Object.entries(fields)) {
    if (!isObj(field)) {
      next[fieldName] = field;
      continue;
    }

    const updated = { ...field };
    renameKey(updated, fromKey, toKey);

    if (isObj(updated.properties)) {
      updated.properties = changeRequiredKeyInFields(updated.properties, isUp);
    }
    if (isObj(updated.parameter)) {
      updated.parameter = changeRequiredKeyInFields(updated.parameter, isUp);
    }

    next[fieldName] = updated;
  }

  return next;
};

const changeParameterKeyInTool = (tool, isUp) => {
  if (!isObj(tool)) return tool;

  const next = { ...tool };
  if (isObj(next.fields)) next.fields = changeParameterKeyInFields(next.fields, isUp);
  if (isObj(next.old_fields)) next.old_fields = changeParameterKeyInFields(next.old_fields, isUp);

  return next;
};

const changeRequiredKeyInTool = (tool, isUp) => {
  if (!isObj(tool)) return tool;

  const fromKey = isUp ? "required_params" : "required";
  const toKey = isUp ? "required" : "required_params";
  const next = { ...tool };

  renameKey(next, fromKey, toKey);
  if (isObj(next.config)) renameKey(next.config, fromKey, toKey);
  if (isObj(next.fields)) next.fields = changeRequiredKeyInFields(next.fields, isUp);
  if (isObj(next.old_fields)) next.old_fields = changeRequiredKeyInFields(next.old_fields, isUp);

  return next;
};

const changeConfigTools = (doc, changeTool, isUp) => {
  const next = { ...doc };

  if (Array.isArray(next.pre_tools)) {
    next.pre_tools = next.pre_tools.map((tool) => changeTool(tool, isUp));
  }

  if (isObj(next.apiCalls)) {
    next.apiCalls = Object.fromEntries(Object.entries(next.apiCalls).map(([key, tool]) => [key, changeTool(tool, isUp)]));
  }

  if (isObj(next.connected_agent_details)) {
    const details = { ...next.connected_agent_details };

    for (const [key, value] of Object.entries(details)) {
      if (key === "agent_variables") {
        details[key] = changeTool(value, isUp);
      } else if (isObj(value?.agent_variables)) {
        details[key] = { ...value, agent_variables: changeTool(value.agent_variables, isUp) };
      }
    }

    next.connected_agent_details = details;
  }

  return next;
};

const migrateCollection = async (collection, changeDoc, isUp) => {
  const docs = await collection.find({}).toArray();
  const ops = [];

  for (const doc of docs) {
    const next = changeDoc(doc, isUp);
    if (JSON.stringify(next) === JSON.stringify(doc)) continue;

    ops.push({
      replaceOne: {
        filter: { _id: doc._id },
        replacement: next
      }
    });
  }

  if (ops.length) await collection.bulkWrite(ops, { ordered: false });
};

const migrateParameterToProperties = async (db, isUp) => {
  await migrateCollection(db.collection("apicalls"), changeParameterKeyInTool, isUp);

  for (const name of ["configurations", "configuration_versions"]) {
    await migrateCollection(db.collection(name), (doc) => changeConfigTools(doc, changeParameterKeyInTool, isUp), isUp);
  }
};

const migrateRequiredParamsToRequired = async (db, isUp) => {
  await migrateCollection(db.collection("apicalls"), changeRequiredKeyInTool, isUp);

  for (const name of ["configurations", "configuration_versions"]) {
    await migrateCollection(db.collection(name), (doc) => changeConfigTools(doc, changeRequiredKeyInTool, isUp), isUp);
  }
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  await migrateParameterToProperties(db, true);
  await migrateRequiredParamsToRequired(db, true);
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await migrateRequiredParamsToRequired(db, false);
  await migrateParameterToProperties(db, false);
};
