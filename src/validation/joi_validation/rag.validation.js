import Joi from "joi";

const createCollectionSchema = Joi.object({
    name: Joi.string().required().messages({
        'any.required': 'Collection name is required'
    }),
    settings: Joi.object({
        denseModel: Joi.string().optional(),
        sparseModel: Joi.string().optional(),
        chunkingType: Joi.string().optional(),
        chunkSize: Joi.number().integer().optional(),
        chunkOverlap: Joi.number().integer().optional(),
        rerankerModel: Joi.string().optional(),
        strategy: Joi.string().optional()
    }).optional()
}).unknown(true);

const createResourceSchema = Joi.object({
    collection_details: Joi.string().required().messages({
        'any.required': 'collectionId is required'
    }),
    title: Joi.string().required().messages({
        'any.required': 'title is required'
    }),
    ownerId: Joi.string().optional(),
    content: Joi.string().optional(),
    url: Joi.string().uri().optional(),
    description: Joi.string().required().messages({
        'any.required': 'description is required'
    }),
    settings: Joi.object({
        strategy: Joi.string().optional(),
        chunkingUrl: Joi.string().uri().optional(),
        chunkingType: Joi.string().optional(),
        chunkSize: Joi.number().integer().optional(),
        chunkOverlap: Joi.number().integer().optional()
    }).optional()
}).or('content', 'url').messages({
    'object.missing': 'At least one of content or url is required'
}).unknown(true);

const collectionIdSchema = Joi.object({
    collectionId: Joi.string().required().messages({
        'any.required': 'collectionId is required'
    })
}).unknown(true);

const resourceIdSchema = Joi.object({
    id: Joi.string().required().messages({
        'any.required': 'Resource id is required'
    })
}).unknown(true);

const updateResourceSchema = Joi.object({
    title: Joi.string().optional(),
    content: Joi.string().optional()
}).unknown(true);

export { createCollectionSchema, createResourceSchema, collectionIdSchema, resourceIdSchema, updateResourceSchema };
