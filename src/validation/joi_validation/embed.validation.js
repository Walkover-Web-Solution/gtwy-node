import Joi from "joi";
import joiObjectId from "joi-objectid";
import { EMBED_AGENT_LIST_FIELDS } from "../../configs/constant.js";

Joi.objectId = joiObjectId(Joi);

const embedLogin = {
  // No validation needed - uses GtwyEmbeddecodeToken middleware
};

const createEmbed = {
  body: Joi.object()
    .keys({
      name: Joi.string().required().messages({
        "string.empty": "name is required",
        "any.required": "name is required"
      }),
      config: Joi.object().optional().default({}),
      apikey_object_id: Joi.object()
        .pattern(Joi.string(), Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
        .optional()
        .default({}),
      folder_limit: Joi.number().min(0).optional().default(0),
      folder_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional(),
      folder_limit_start_date: Joi.date().optional(),
      type: Joi.string().valid("embed", "rag_embed").optional().default("embed")
    })
    .unknown(true)
};

const getAllEmbed = {
  // No validation needed
};

const updateEmbed = {
  body: Joi.object()
    .keys({
      folder_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
          "string.pattern.base": "folder_id must be a valid MongoDB ObjectId",
          "any.required": "folder_id is required"
        }),
      config: Joi.object().optional(),
      apikey_object_id: Joi.object()
        .pattern(Joi.string(), Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
        .optional(),
      folder_limit: Joi.number().min(0).optional(),
      folder_usage: Joi.number().min(0).optional(),
      folder_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional(),
      folder_limit_start_date: Joi.date().optional()
    })
    .unknown(true)
};

const META_SUBFIELD_PATTERN = /^meta\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
// One key of an object prompt, e.g. "configuration.prompt.company_name"
const PROMPT_SUBFIELD_PATTERN = /^configuration\.prompt\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

// Turns "id,name, createdAt" or ["id","name"] into a de-duplicated list, with "id" mapped to "_id".
const normalizeEmbedAgentFields = (value, helpers) => {
  const raw = Array.isArray(value) ? value : String(value).split(",");
  const fields = [
    ...new Set(
      raw
        .map((f) => String(f).trim())
        .filter(Boolean)
        .map((f) => (f === "id" ? "_id" : f))
    )
  ];
  const invalid = fields.filter((f) => !EMBED_AGENT_LIST_FIELDS.includes(f) && !META_SUBFIELD_PATTERN.test(f) && !PROMPT_SUBFIELD_PATTERN.test(f));
  if (invalid.length) {
    return helpers.message(
      `fields has unsupported value(s): ${invalid.join(", ")}. Allowed: id, ${EMBED_AGENT_LIST_FIELDS.join(", ")}, meta.<key>, configuration.prompt.<key>`
    );
  }
  return fields;
};

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_AGENT_IDS = 200;

// Turns "id1,id2" or ["id1","id2"] into a de-duplicated list of ObjectId strings.
const normalizeAgentIds = (value, helpers) => {
  const raw = Array.isArray(value) ? value : String(value).split(",");
  const ids = [...new Set(raw.map((id) => String(id).trim()).filter(Boolean))];
  const invalid = ids.filter((id) => !OBJECT_ID_PATTERN.test(id));
  if (invalid.length) {
    return helpers.message(`agent_ids has invalid ObjectId(s): ${invalid.join(", ")}`);
  }
  if (ids.length > MAX_AGENT_IDS) {
    return helpers.message(`agent_ids accepts at most ${MAX_AGENT_IDS} ids`);
  }
  return ids;
};

const genrateToken = {
  // No validation needed
};

const getEmbedDataByUserId = {
  query: Joi.object()
    .keys({
      agent_id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .optional()
        .messages({
          "string.pattern.base": "agent_id must be a valid MongoDB ObjectId"
        }),
      agent_ids: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional().custom(normalizeAgentIds),
      status: Joi.string().trim().lowercase().valid("live", "draft").optional().messages({
        "any.only": "status must be one of live, draft"
      }),
      fields: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional().custom(normalizeEmbedAgentFields)
    })
    .unknown(true)
};

const updateAgentMetadata = {
  body: Joi.object()
    .keys({
      name: Joi.string().optional(),
      meta: Joi.object().optional()
    })
    .or("name", "meta")
    .unknown(false)
    .messages({
      "object.missing": "At least one of name or meta is required"
    })
};

export default {
  embedLogin,
  createEmbed,
  getAllEmbed,
  updateEmbed,
  genrateToken,
  getEmbedDataByUserId,
  updateAgentMetadata
};
