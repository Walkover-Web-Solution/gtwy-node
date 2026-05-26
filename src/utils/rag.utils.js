import jwt from "jsonwebtoken";
import axios from "axios";
import ragCollectionService from "../db_services/ragCollection.service.js";

export const genrateToken = async (orgId) => {
  const token = await jwt.sign(
    { org_id: process.env.RAG_EMBED_ORG_ID, project_id: process.env.RAG_EMBED_PROJECT_ID, user_id: orgId },
    process.env.RAG_EMBED_SECRET_KEY
  );
  return token;
};

export const copyResourceToOrgUtil = async ({
  collection_id,
  resource_id,
  org_id,
  folder_id = null,
  user_id = null,
  isEmbedUser = false,
  extra = {}
}) => {
  const hippocampusUrl = "http://hippocampus.gtwy.ai";
  const hippocampusApiKey = process.env.HIPPOCAMPUS_API_KEY;
  const headers = { "Content-Type": "application/json", "x-api-key": hippocampusApiKey };

  // Create embed-style ownerId for hippocampus
  let ownerId = org_id;
  if (user_id && isEmbedUser && folder_id) {
    ownerId = `${org_id}_${folder_id}_${user_id}`;
  }

  // Add authorization token for embed users (only if env vars are available)
  if (isEmbedUser && folder_id && process.env.RAG_EMBED_SECRET_KEY) {
    try {
      const auth_token = await genrateToken(ownerId);
      headers.Authorization = auth_token;
    } catch (e) {
      console.error("Failed to generate auth token for hippocampus:", e.message);
    }
  }

  const [collectionResponse, resourceResponse] = await Promise.all([
    axios.get(`${hippocampusUrl}/collection/${collection_id}`, { headers }),
    axios.get(`${hippocampusUrl}/resource/${resource_id}?content=true`, { headers })
  ]);
  const collectionData = collectionResponse.data;
  const collectionName = collectionData.name;
  const sourceResource = resourceResponse.data;

  const orgCollections = await ragCollectionService.getAllByOrgId(org_id);
  let orgCollection = orgCollections.find((col) => col.name === collectionName);

  if (!orgCollection) {
    const newCollectionResponse = await axios.post(
      `${hippocampusUrl}/collection`,
      { name: collectionName, settings: { ...(collectionData.settings || {}), keepDuplicate: true } },
      { headers }
    );
    orgCollection = await ragCollectionService.create({
      name: collectionName,
      org_id,
      settings: newCollectionResponse.data.settings || collectionData.settings,
      collection_id: newCollectionResponse.data._id,
      created_at: new Date(),
      updated_at: new Date()
    });
  }

  const targetCollectionId = orgCollection.collection_id;

  const createResponse = await axios.post(
    `${hippocampusUrl}/resource`,
    {
      collectionId: targetCollectionId,
      title: sourceResource.title,
      content: sourceResource.content,
      url: sourceResource.url,
      description: sourceResource.description,
      ownerId: ownerId,
      settings: sourceResource.settings
    },
    { headers }
  );

  if (createResponse.data?._id) {
    await ragCollectionService.addResourceId(targetCollectionId, createResponse.data._id);
  }

  return {
    collection_id: targetCollectionId,
    resource_id: createResponse.data._id,
    folder_id: folder_id || "",
    ...extra
  };
};
