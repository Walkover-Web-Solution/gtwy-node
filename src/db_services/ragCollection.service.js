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
 * Check if a resource is being used in any agent or version
 */
const checkResourceUsage = async (resourceId, org_id) => {
  try {
    const query = {
      org_id: org_id,
      "doc_ids.resource_id": resourceId,
      deletedAt: null
    };

    const [agentsUsingResource, versionsUsingResource] = await Promise.all([
      configurationModel.find(query, { _id: 1, name: 1, slugName: 1 }).limit(1).lean(),
      versionModel.find(query, { _id: 1, parent_id: 1 }).limit(1).lean()
    ]);

    const usageDetails = {
      isInUse: agentsUsingResource.length > 0 || versionsUsingResource.length > 0,
      agents: agentsUsingResource.map((agent) => ({
        id: agent._id,
        name: agent.name,
        slugName: agent.slugName
      })),
      versions: versionsUsingResource.map((version) => ({
        id: version._id,
        parent_id: version.parent_id
      }))
    };

    return {
      success: true,
      ...usageDetails
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
