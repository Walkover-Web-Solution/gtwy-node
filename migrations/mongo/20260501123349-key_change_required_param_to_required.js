/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const collection = db.collection("apicalls");
  const documents = await collection.find({}).toArray();
  const operations = [];

  for (const document of documents) {
    const { value: updatedDocument, changed } = renameKeyDeep(document, "required_params", "required");

    if (changed) {
      operations.push({
        replaceOne: {
          filter: { _id: document._id },
          replacement: updatedDocument
        }
      });
    }
  }

  if (operations.length > 0) {
    await collection.bulkWrite(operations);
    console.log(`Updated ${operations.length} documents in 'apicalls' collection.`);
  }
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const collection = db.collection("apicalls");
  const documents = await collection.find({}).toArray();
  const operations = [];

  for (const document of documents) {
    const { value: updatedDocument, changed } = renameKeyDeep(document, "required", "required_params");

    if (changed) {
      operations.push({
        replaceOne: {
          filter: { _id: document._id },
          replacement: updatedDocument
        }
      });
    }
  }

  if (operations.length > 0) {
    await collection.bulkWrite(operations);
  }
};

function renameKeyDeep(value, fromKey, toKey) {
  if (Array.isArray(value)) {
    let changed = false;
    const nextValue = value.map((item) => {
      const transformedItem = renameKeyDeep(item, fromKey, toKey);
      if (transformedItem.changed) {
        changed = true;
      }
      return transformedItem.value;
    });

    return { value: nextValue, changed };
  }

  if (!value || typeof value !== "object" || value.constructor !== Object) {
    return { value, changed: false };
  }

  const nextValue = {};
  let changed = false;

  for (const [key, nestedValue] of Object.entries(value)) {
    const transformedNestedValue = renameKeyDeep(nestedValue, fromKey, toKey);

    if (transformedNestedValue.changed) {
      changed = true;
    }

    if (key === fromKey) {
      changed = true;
      nextValue[toKey] = transformedNestedValue.value;
      continue;
    }

    nextValue[key] = transformedNestedValue.value;
  }

  return { value: nextValue, changed };
}
