import RagCollectionModel from "../mongoModel/RagCollection.model.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import versionModel from "../mongoModel/BridgeVersion.model.js";

/**
 * Create a new RAG collection
 */
const create = async (collectionData) => {
  try {
    const collection = await RagCollectionModel.create(collectionData);
    return collection;
  } catch (error) {
    console.error("Error creating RAG collection:", error);
    throw error;
  }
};

/**
 * Get collection by collection_id
 */
const getByCollectionId = async (collectionId) => {
  try {
    const collection = await RagCollectionModel.findOne({ collection_id: collectionId });
    return collection;
  } catch (error) {
    console.error("Error fetching RAG collection:", error);
    throw error;
  }
};

/**
 * Get all collections for an organization
 */
const getAllByOrgId = async (orgId) => {
  try {
    const collections = await RagCollectionModel.find({ org_id: orgId });
    return collections;
  } catch (error) {
    console.error("Error fetching RAG collections:", error);
    throw error;
  }
};

/**
 * Add resource ID to collection
 */
const addResourceId = async (collectionId, resourceId) => {
  try {
    const collection = await RagCollectionModel.findOneAndUpdate(
      { collection_id: collectionId },
      {
        $addToSet: { resource_ids: resourceId },
        $set: { updated_at: new Date() }
      },
      { new: true }
    );
    return collection;
  } catch (error) {
    console.error("Error adding resource ID to collection:", error);
    throw error;
  }
};

/**
 * Remove resource ID from collection
 */
const removeResourceId = async (collectionId, resourceId) => {
  try {
    const collection = await RagCollectionModel.findOneAndUpdate(
      { collection_id: collectionId },
      {
        $pull: { resource_ids: resourceId },
        $set: { updated_at: new Date() }
      },
      { new: true }
    );
    return collection;
  } catch (error) {
    console.error("Error removing resource ID from collection:", error);
    throw error;
  }
};

/**
 * Delete a collection
 */
const deleteByCollectionId = async (collectionId) => {
  try {
    const collection = await RagCollectionModel.findOneAndDelete({ collection_id: collectionId });
    return collection;
  } catch (error) {
    console.error("Error deleting RAG collection:", error);
    throw error;
  }
};

/**
 * Find collection that contains a specific resource ID
 */
const getCollectionByResourceId = async (resourceId) => {
  try {
    const collection = await RagCollectionModel.findOne({ resource_ids: resourceId });
    return collection;
  } catch (error) {
    console.error("Error finding collection by resource ID:", error);
    throw error;
  }
};

/**
 * Check if a resource is being used in any agent or version.
 *
 * Returns a `usage` object keyed by agent (bridge) name. Each value holds the
 * bridge_id and the list of version ids of that bridge which reference the
 * resource:
 *   {
 *     "My Agent": { bridge_id: "<configuration _id>", versions: ["<version _id>", ...] },
 *     ...
 *   }
 *
 * Matching is done on the exact `resource_id`, so even if multiple bots have a
 * doc with the same title, only the bots/versions referencing this specific
 * resource are returned.
 */
const checkResourceUsage = async (resourceId, org_id) => {
  try {
    const query = {
      org_id: org_id,
      "doc_ids.resource_id": resourceId,
      deletedAt: null
    };

    const [agentsUsingResource, versionsUsingResource] = await Promise.all([
      configurationModel.find(query, { _id: 1, name: 1 }).lean(),
      versionModel.find(query, { _id: 1, parent_id: 1 }).lean()
    ]);

    // Resolve parent bridge names for the versions referencing the resource.
    const parentIds = [...new Set(versionsUsingResource.map((v) => v.parent_id).filter(Boolean))];
    const parentBridges = parentIds.length ? await configurationModel.find({ _id: { $in: parentIds } }, { _id: 1, name: 1 }).lean() : [];
    const parentNameById = new Map(parentBridges.map((b) => [String(b._id), b.name]));

    const usage = {};

    const ensureEntry = (name, bridgeId) => {
      if (!usage[name]) {
        usage[name] = { versions: [], bridge_id: bridgeId ? String(bridgeId) : null };
      } else if (!usage[name].bridge_id && bridgeId) {
        usage[name].bridge_id = String(bridgeId);
      }
      return usage[name];
    };

    // Bridges that reference the resource on the published/base configuration.
    agentsUsingResource.forEach((agent) => {
      ensureEntry(agent.name || String(agent._id), agent._id);
    });

    // Versions that reference the resource, grouped under their parent bridge.
    versionsUsingResource.forEach((version) => {
      const bridgeName = parentNameById.get(String(version.parent_id)) || String(version.parent_id);
      const entry = ensureEntry(bridgeName, version.parent_id);
      entry.versions.push(String(version._id));
    });

    return {
      success: true,
      isInUse: Object.keys(usage).length > 0,
      usage
    };
  } catch (error) {
    console.error("Error checking resource usage:", error);
    return {
      success: false,
      error: error.message
    };
  }
};

export default {
  create,
  getByCollectionId,
  getAllByOrgId,
  addResourceId,
  removeResourceId,
  deleteByCollectionId,
  getCollectionByResourceId,
  checkResourceUsage
};
