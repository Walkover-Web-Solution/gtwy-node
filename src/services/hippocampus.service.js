import axios from "axios";

const HIPPOCAMPUS_BASE_URL = process.env.HIPPOCAMPUS_BASE_URL || "http://hippocampus.gtwy.ai";
const HIPPOCAMPUS_API_KEY = process.env.HIPPOCAMPUS_API_KEY;

/**
 * Create a collection in Hippocampus
 * @param {Object} collectionData - Collection data including name and settings
 * @returns {Promise<Object>} - Collection response from Hippocampus
 */
export const createCollection = async (collectionData) => {
  try {
    const response = await axios({
      method: "POST",
      url: `${HIPPOCAMPUS_BASE_URL}/collection`,
      headers: {
        "x-api-key": HIPPOCAMPUS_API_KEY,
        "Content-Type": "application/json"
      },
      data: {
        ...collectionData,
        apikey: HIPPOCAMPUS_API_KEY
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error creating collection in Hippocampus:", error.response?.data || error.message);
    throw error;
  }
};

/**
 * Create a resource in a collection
 * @param {Object} resourceData - Resource data including collectionId, title, content, etc.
 * @returns {Promise<Object>} - Resource response from Hippocampus
 */
export const createResource = async (resourceData) => {
  try {
    const response = await axios({
      method: "POST",
      url: `${HIPPOCAMPUS_BASE_URL}/resource`,
      headers: {
        "x-api-key": HIPPOCAMPUS_API_KEY,
        "Content-Type": "application/json"
      },
      data: resourceData
    });
    return response.data;
  } catch (error) {
    console.error("Error creating resource in Hippocampus:", error.response?.data || error.message);
    throw error;
  }
};

/**
 * Delete a resource from Hippocampus
 * @param {String} resourceId - Resource ID to delete
 * @returns {Promise<Object>} - Delete response from Hippocampus
 */
export const deleteResource = async (resourceId) => {
  try {
    const response = await axios({
      method: "DELETE",
      url: `${HIPPOCAMPUS_BASE_URL}/resource/${resourceId}`,
      headers: {
        "x-api-key": HIPPOCAMPUS_API_KEY,
        "Content-Type": "application/json"
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error deleting resource from Hippocampus:", error.response?.data || error.message);
    throw error;
  }
};

/**
 * Delete all resources for an owner within a collection
 * @param {String} collectionId
 * @param {String} ownerId
 */
export const deleteResourcesByOwner = async (collectionId, ownerId) => {
  try {
    let deleteUrl = `${HIPPOCAMPUS_BASE_URL}/collection/${collectionId}/resources`;
    if (ownerId) {
      deleteUrl += `?ownerId=${ownerId}`;
    }
    const response = await axios({
      method: "DELETE",
      url: deleteUrl,
      headers: {
        "x-api-key": HIPPOCAMPUS_API_KEY,
        "Content-Type": "application/json"
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error deleting resources by owner from Hippocampus:", error.response?.data || error.message);
    throw error;
  }
};

/**
 * Update a resource in Hippocampus
 * @param {String} resourceId - Resource ID to update
 * @param {Object} updateData - Data to update (title, description, content, url)
 * @returns {Promise<Object>} - Update response from Hippocampus
 */
export const updateResource = async (resourceId, updateData) => {
  try {
    const response = await axios({
      method: "PUT",
      url: `${HIPPOCAMPUS_BASE_URL}/resource/${resourceId}`,
      headers: {
        "x-api-key": HIPPOCAMPUS_API_KEY,
        "Content-Type": "application/json"
      },
      data: updateData
    });
    return response.data;
  } catch (error) {
    console.error("Error updating resource in Hippocampus:", error.response?.data || error.message);
    throw error;
  }
};

/**
 * Get chunks for a resource from Hippocampus
 * @param {String} resourceId - Resource ID to get chunks for
 * @returns {Promise<Object>} - Chunks response from Hippocampus
 */
export const getResourceChunks = async (resourceId) => {
  try {
    const response = await axios({
      method: "GET",
      url: `${HIPPOCAMPUS_BASE_URL}/resource/${resourceId}/chunks`,
      headers: {
        "x-api-key": HIPPOCAMPUS_API_KEY
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error getting resource chunks from Hippocampus:", error.response?.data || error.message);
    throw error;
  }
};
