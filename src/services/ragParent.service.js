const RagParentData = require("../mongoModel/RagParentData.model.js");

// Cache keys

class ResourceService {
  static async createResource(resourceData) {
    try {
      const resource = new RagParentData(resourceData);
      await resource.save();
      return resource;
    } catch (error) {
      throw new Error(`Failed to create resource: ${error.message}`);
    }
  }

  static async deleteResource(id) {
    try {
      const deletedResource = await RagParentData.findByIdAndDelete(id);
      if (!deletedResource) {
        throw new Error(`RagParentData with ID ${id} not found.`);
      }
      return deletedResource;
    } catch (error) {
      throw new Error(`Failed to delete resource: ${error.message}`);
    }
  }

  static async updateResource(id, updateData) {
    try {
      const updatedResource = await RagParentData.findByIdAndUpdate(id, updateData, { new: true });
      if (!updatedResource) {
        throw new Error(`RagParentData with ID ${id} not found.`);
      }
      return updatedResource;
    } catch (error) {
      throw new Error(`Failed to update resource: ${error.message}`, 404);
    }
  }

  static async getResourceById(id) {
    try {
      const resource = await RagParentData.findById(id);
      if (!resource) throw new Error(`RagParentData with ID ${id} not found.`);
      return resource;
    } catch (error) {
      throw new Error(`Failed to retrieve resource: ${error.message}`, 404);
    }
  }

  static async getResourcesByAgent(agentId) {
    try {
      const resources = await RagParentData.find({ agentId });
      return resources;
    } catch (error) {
      throw new Error(`Failed to retrieve resources for agent: ${error.message}`);
    }
  }

  static async updateMetadata(id, metadata) {
    try {
      const updatedResource = await RagParentData.findByIdAndUpdate(id, { $set: { metadata } }, { new: true });
      if (!updatedResource) throw new Error(`RagParentData with ID ${id} not found.`);
      return updatedResource;
    } catch (error) {
      throw new Error(`Failed to update resource metadata: ${error.message}`, 404);
    }
  }

  static async getAllGoogleDocs() {
    try {
      return await RagParentData.find({ url: { $regex: "^https://docs\\.google\\.com", $options: "i" } });
    } catch (error) {
      throw new Error(`Failed to retrieve resources: ${error.message}`);
    }
  }
}

module.exports = ResourceService;
