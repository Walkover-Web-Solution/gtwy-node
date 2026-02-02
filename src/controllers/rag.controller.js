import { genrateToken } from '../utils/rag.utils.js';
import { generateAuthToken, generateIdentifier } from '../services/utils/utility.service.js';
import { createProxyToken, getOrganizationById, updateOrganizationData } from '../services/proxy.service.js';
import axios from 'axios';
import ragCollectionService from '../db_services/ragCollection.service.js';

export const ragEmbedUserLogin = async (req, res, next) => {
    const { name: embeduser_name, email: embeduser_email } = req.isGtwyUser ? {} : req.Embed;
    const Tokendata = {
        "user": {
            id: req.Embed.user_id,
            name: embeduser_name,
            email: embeduser_email,

        },
        "org": {
            id: req.Embed.org_id,
            name: req.Embed.org_name,

        },
        "extraDetails": {
            type: 'embed',
            folder_id: req?.Embed?.folder_id,
        }
    }
    const embedDetails = !req.isGtwyUser ?
        {
            user_id: req.Embed.user_id,
            company_id: req?.Embed?.org_id,
            company_name: req.Embed.org_name,
            tokenType: 'embed',
            embeduser_name, embeduser_email
        }
        : {
            company_id: req.company_id,
            company_name: req.company_name,
            user_id: req.user_id
        };
    await createProxyToken(embedDetails);
    const response = {
        ...(req?.Embed || {}),
        ...(req.Embed?.user_id ? { user_id: req.Embed.user_id } : {}),
        token: generateAuthToken(Tokendata.user, Tokendata.org, { "extraDetails": Tokendata.extraDetails }),
    };
    res.locals = { data: response, success: true };
    req.statusCode = 200;
    return next();
};


export const getKnowledgeBaseToken = async (req, res, next) => {
    const org_id = req.profile.org.id
    let auth_token = generateIdentifier(14);
    const data = await getOrganizationById(org_id)

    if (!data?.meta?.accessKey) {
        auth_token = await updateOrganizationData(org_id, {
            meta: {
                ...data?.meta,
                auth_token: auth_token,
            },
        },
        )
        auth_token = auth_token?.data?.company?.meta.auth_token
    }
    res.locals = {auth_token};
    req.statusCode = 200;
    return next();
};


export const getEmbedToken = async (req, res, next) => {
    const embed = req.Embed;
    const orgId = embed ? embed.org_id : req.profile.org.id;
    const token = await genrateToken(orgId);
    res.locals = {
        "success": true,
        "token": token
    }
    req.statusCode = 200;
    return next();
};

// Collection Management
export const createCollection = async (req, res, next) => {
    try {
        const { org } = req.profile || {};
        const { name, settings } = req.body;
        
        // Prepare data for Hippocampus API
        const hippocampusPayload = {
            name,
            settings: settings
        };
        
        // Call Hippocampus API to create collection
        const hippocampusApiKey = process.env.HIPPOCAMPUS_API_KEY;
        const hippocampusResponse = await axios.post(
            'http://hippocampus.gtwy.ai/collection',
            hippocampusPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': hippocampusApiKey
                }
            }
        );
        
        // Prepare data for MongoDB
        const collectionData = {
            name,
            org_id: org?.id,
            settings: hippocampusPayload.settings,
            collection_id: hippocampusResponse?.data?._id,
            created_at: new Date(),
            updated_at: new Date()
        };
        
        // Save to MongoDB
        const collection = await ragCollectionService.create(collectionData);
        
        res.locals = {
            "success": true,
            "message": "Collection created successfully",
            "data": {
                ...collection.toObject(),
                hippocampus_response: hippocampusResponse.data
            }
        };
        req.statusCode = 201;
        return next();
    } catch (error) {
        console.error('Error creating collection:', error);
        res.locals = {
            "success": false,
            "error": error.message,
            "details": error.response?.data || error.message
        };
        req.statusCode = error.response?.status || 500;
        return next();
    }
};

export const getAllCollections = async (req, res, next) => {
    try {
        const { org } = req.profile || {};
        const collections = await ragCollectionService.getAllByOrgId(org?.id);

        const formattedCollections = collections.map(col => {
            const obj = col.toObject ? col.toObject() : col;
            const { _id, ...rest } = obj;
            return rest;
        });

        res.locals = {
            "success": true,
            "data": formattedCollections
        };
        req.statusCode = 200;
        return next();
    } catch (error) {
        console.error('Error fetching collections:', error);
        res.locals = {
            "success": false,
            "error": error.message
        };
        req.statusCode = 500;
        return next();
    }
};

export const getCollectionById = async (req, res, next) => {
    try {
        const { collectionId } = req.params;
        const collection = await ragCollectionService.getByCollectionId(collectionId);
        
        if (!collection) {
            res.locals = {
                "success": false,
                "message": "Collection not found"
            };
            req.statusCode = 404;
            return next();
        }
        
        res.locals = {
            "success": true,
            "data": collection
        };
        req.statusCode = 200;
        return next();
    } catch (error) {
        console.error('Error fetching collection:', error);
        res.locals = {
            "success": false,
            "error": error.message
        };
        req.statusCode = 500;
        return next();
    }
};

// Resource Management
export const createResourceInCollection = async (req, res, next) => {
  try {
    const { org } = req.profile || {};
    let { collection_details, title, content, url, settings, description } = req.body;
    let collectionId;
    const isEmbedUser = req.profile.IsEmbedUser;
    const folder_id = req.folder_id;
    const user_id = req.profile.user.id;
    const org_id = req.profile.org.id;
    let ownerId;
    // Use owner_id from body if provided, otherwise use current logic
    if (req.body.owner_id) {
      ownerId = req.body.owner_id;
    } else if (folder_id) {
      ownerId = org_id + "_" + folder_id + "_" + user_id;
    } else if (isEmbedUser) {
      ownerId = org_id + "_" + user_id;
    } else {
      ownerId = org_id;
    }
};

export const updateResourceInCollection = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, description, content, url } = req.body;
        
        const hippocampusUrl = 'http://hippocampus.gtwy.ai';
        const hippocampusApiKey = process.env.HIPPOCAMPUS_API_KEY;
        
        const response = await axios.put(`${hippocampusUrl}/resource/${id}`, {
            title,
            description,
            content,
            url
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': hippocampusApiKey
            }
        });
        
        res.locals = {
            "success": true,
            "message": "Resource updated successfully",
            "data": response.data
        };
        req.statusCode = 200;
        return next();
    } catch (error) {
        console.error('Error updating resource:', error);
        res.locals = {
            "success": false,
            "error": error.response?.data || error.message
        };
        req.statusCode = error.response?.status || 500;
        return next();
    }
};

export const deleteResourceFromCollection = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const hippocampusUrl = 'http://hippocampus.gtwy.ai';
        const hippocampusApiKey = process.env.HIPPOCAMPUS_API_KEY;
        
        const response = await axios.delete(`${hippocampusUrl}/resource/${id}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': hippocampusApiKey
            }
        });
        
        res.locals = {
            "success": true,
            "message": "Resource deleted successfully",
            "data": response.data
        };
        req.statusCode = 200;
        return next();
    } catch (error) {
        console.error('Error deleting resource:', error);
        res.locals = {
            "success": false,
            "error": error.response?.data || error.message
        };
        req.statusCode = error.response?.status || 500;
        return next();
    }
};

export const getResourceChunks = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const hippocampusUrl = 'http://hippocampus.gtwy.ai';
        const hippocampusApiKey = process.env.HIPPOCAMPUS_API_KEY;
        
        const response = await axios.get(`${hippocampusUrl}/resource/${id}/chunks`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': hippocampusApiKey
            }
        });
        
        res.locals = {
            "success": true,
            "data": response.data
        };
        req.statusCode = 200;
        return next();
    } catch (error) {
        console.error('Error fetching resource chunks:', error);
        res.locals = {
            "success": false,
            "error": error.response?.data || error.message
        };
        req.statusCode = error.response?.status || 500;
        return next();
    }
};

export const getAllResourcesByCollectionId = async (req, res, next) => {
    try {
        const { collectionId } = req.params;

    // Fetch collection resources via Hippocampus API
    const hippocampusUrl = "http://hippocampus.gtwy.ai";
    const hippocampusApiKey = process.env.HIPPOCAMPUS_API_KEY;
    const isEmbedUser = req.profile.IsEmbedUser;
    const folder_id = req.folder_id;
    const user_id = req.profile.user.id;
    const org_id = req.profile.org.id;
    let ownerId;
    // Use owner_id from body if provided, otherwise use current logic
    if (req.body.owner_id) {
      ownerId = req.body.owner_id;
    } else if (folder_id) {
      ownerId = org_id + "_" + folder_id + "_" + user_id;
    } else if (isEmbedUser) {
      ownerId = org_id + "_" + user_id;
    } else {
      ownerId = org_id;
    }
};

export const getOrCreateDefaultCollections = async (req, res, next) => {
    try {
        const org_id = req.profile?.org?.id;
        const ownerId = req.ownerId;
        // Define the three default collections with their settings
        const defaultCollections = [
            {
                name: "high_accuracy",
                settings: {
                    denseModel: "BAAI/bge-large-en-v1.5",
                    sparseModel: "Qdrant/bm25",
                    rerankerModel: "colbert-ir/colbertv2.0"
                }
            },
            {
                name: "moderate",
                settings: {
                    denseModel: "BAAI/bge-large-en-v1.5"
                }
            },
            {
                name: "fastest",
                settings: {
                    denseModel: "BAAI/bge-small-en-v1.5"
                }
            }
        ];

        // Fetch existing collections for this org
        const existingCollections = await ragCollectionService.getAllByOrgId(org_id);
        
        // Helper function to check if a collection with specific name and settings exists
        const findCollectionByNameAndSettings = (targetName, targetSettings) => {
            return existingCollections.find(col => {
                const colObj = col.toObject ? col.toObject() : col;
                const colSettings = colObj.settings || {};
                
                // First check if the name matches
                if(colObj.name !== targetName) {
                    return false;
                }
                
                // Then check if all required models match based on collection type
                if(targetName === 'high_accuracy'){
                    return colSettings.denseModel === targetSettings.denseModel && 
                           colSettings.sparseModel === targetSettings.sparseModel && 
                           colSettings.rerankerModel === targetSettings.rerankerModel;
                }
                else if(targetName === 'moderate'){
                    return colSettings.denseModel === targetSettings.denseModel;
                }
                else if(targetName === 'fastest'){
                    return colSettings.denseModel === targetSettings.denseModel;
                }
                
                return false;
            });
        };

        const hippocampusApiKey = process.env.HIPPOCAMPUS_API_KEY;
        const hippocampusUrl = 'http://hippocampus.gtwy.ai';

        // Create missing collections
        const createdCollections = [];
        const allCollectionResults = [];
        
        for (const defaultCol of defaultCollections) {
            const existingCol = findCollectionByNameAndSettings(defaultCol.name, defaultCol.settings);
            
            if (existingCol) {
                // Collection with these settings already exists
                const colObj = existingCol.toObject ? existingCol.toObject() : existingCol;
                const { _id, ...rest } = colObj;
                allCollectionResults.push(rest);
            } else {
                // Create new collection with these settings
                try {
                    // Call Hippocampus API to create collection
                    const hippocampusResponse = await axios.post(
                        `${hippocampusUrl}/collection`,
                        {
                            name: defaultCol.name,
                            settings: defaultCol.settings
                        },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'x-api-key': hippocampusApiKey
                            }
                        }
                    );

                    // Save to MongoDB
                    const collectionData = {
                        name: defaultCol.name,
                        org_id: org_id,
                        settings: defaultCol.settings,
                        collection_id: hippocampusResponse?.data?._id,
                        created_at: new Date(),
                        updated_at: new Date()
                    };

                    const newCollection = await ragCollectionService.create(collectionData);
                    const newColObj = newCollection.toObject();
                    createdCollections.push(newColObj);
                    const { _id, ...rest } = newColObj;
                    allCollectionResults.push(rest);
                } catch (error) {
                    console.error(`Error creating collection ${defaultCol.name}:`, error);
                    // Continue with other collections even if one fails
                }
            }
        }

        // Fetch resources for each collection
        const allResources = [];
        
        for (const collection of allCollectionResults) {
            try {
                // Fetch resources for this collection via Hippocampus API
                const resourcesResponse = await axios.get(
                    `${hippocampusUrl}/collection/${collection.collection_id}/resources?content=true&ownerId=${ownerId}`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': hippocampusApiKey
                        }
                    }
                );
                
                // Add collection info to each resource and flatten into allResources
                const resourcesWithCollection = (resourcesResponse.data?.resources || []).map(resource => ({
                    ...resource,
                    }
                ));
                allResources.push(...resourcesWithCollection);
            } catch (error) {
                console.error(`Error fetching resources for collection ${collection.collection_id}:`, error);
                // Continue with other collections even if one fails
            }
        }

        res.locals = {
            "success": true,
            "message": createdCollections.length > 0 
                ? `${createdCollections.length} collection(s) created successfully` 
                : "All collections already exist",
            "data": {
                resources: allResources,
                created: createdCollections.length
            }
        };
        req.statusCode = 200;
        return next();
    } catch (error) {
        console.error('Error in getOrCreateDefaultCollections:', error);
        res.locals = {
            "success": false,
            "error": error.message
        };
        req.statusCode = 500;
        return next();
    }
};
