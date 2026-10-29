import RagCollectionModel from "../mongoModel/RagCollection.model.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import versionModel from "../mongoModel/BridgeVersion.model.js";
import { deleteInCache } from "../cache_service/index.js";
import { redis_keys } from "../configs/constant.js";

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

/**
 * Propagate an edited KB resource description into every agent that references it.
 *
 * A KB resource's `description` is stored as a denormalized copy inside each
 * bridge/version's `doc_ids` array (each entry is `{ resource_id, collection_id,
 * description }`), and gtwy-ai builds the system prompt from that stored copy.
 * Editing the resource in the hippocampus store therefore does NOT change what
 * agents show unless we also update these embedded copies. This mirrors the way
 * `checkResourceUsage` matches on `doc_ids.resource_id` across both the bridge
 * (configuration) and version collections, updates the matched array element's
 * description, and clears the cached bridge/version data so the next query
 * rebuilds the prompt with the new text.
 */
const propagateResourceDescription = async (resourceId, org_id, description) => {
  try {
    const query = {
      org_id: org_id,
      "doc_ids.resource_id": resourceId
    };

    // Collect the bridges/versions referencing this resource so we can clear their cache.
    const [bridges, versions] = await Promise.all([
      configurationModel.find(query, { _id: 1 }).lean(),
      versionModel.find(query, { _id: 1, parent_id: 1 }).lean()
    ]);

    if (bridges.length === 0 && versions.length === 0) {
      return { success: true, bridges: 0, versions: 0 };
    }

    // Update the denormalized description on every matching doc_ids element.
    const update = { $set: { "doc_ids.$[elem].description": description } };
    const options = { arrayFilters: [{ "elem.resource_id": resourceId }] };

    await Promise.all([configurationModel.updateMany(query, update, options), versionModel.updateMany(query, update, options)]);

    // Invalidate cache for the affected bridges and versions (and each version's
    // parent bridge) so the rebuilt system prompt reflects the new description.
    const cacheKeys = new Set();
    bridges.forEach((bridge) => {
      cacheKeys.add(`${redis_keys.get_bridge_data_}${org_id}_${bridge._id}`);
      cacheKeys.add(`${redis_keys.bridge_data_with_tools_}${org_id}_bridge_${bridge._id}`);
    });
    versions.forEach((version) => {
      cacheKeys.add(`${redis_keys.get_bridge_data_}${org_id}_${version._id}`);
      cacheKeys.add(`${redis_keys.bridge_data_with_tools_}${org_id}_version_${version._id}`);
      if (version.parent_id) {
        cacheKeys.add(`${redis_keys.get_bridge_data_}${org_id}_${version.parent_id}`);
        cacheKeys.add(`${redis_keys.bridge_data_with_tools_}${org_id}_bridge_${version.parent_id}`);
      }
    });

    if (cacheKeys.size > 0) {
      await deleteInCache(Array.from(cacheKeys));
    }

    return { success: true, bridges: bridges.length, versions: versions.length };
  } catch (error) {
    console.error("Error propagating resource description:", error);
    return { success: false, error: error.message };
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
  checkResourceUsage,
  propagateResourceDescription
};
