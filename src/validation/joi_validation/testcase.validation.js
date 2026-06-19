import Joi from "joi";

const createTestcaseSchema = Joi.object({
  bridge_id: Joi.string().required().messages({
    "any.required": "bridge_id is required"
  }),
  name: Joi.string().allow("").optional(),
  conversation: Joi.array().required().messages({
    "any.required": "conversation is required"
  }),
  type: Joi.string().required().messages({
    "any.required": "type is required"
  }),
  expected: Joi.object().required().messages({
    "any.required": "expected is required"
  }),
  matching_type: Joi.string().required().messages({
    "any.required": "matching_type is required"
  })
}).unknown(true);

const testcaseIdSchema = Joi.object({
  testcase_id: Joi.string().required().messages({
    "any.required": "testcase_id is required"
  })
}).unknown(true);

const bridgeIdSchema = Joi.object({
  bridge_id: Joi.string().required().messages({
    "any.required": "bridge_id is required"
  })
}).unknown(true);

const getAllTestcasesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1).messages({
    "number.base": "page must be a number",
    "number.integer": "page must be an integer",
    "number.min": "page must be at least 1"
  }),
  limit: Joi.number().integer().min(1).max(100).optional().default(30).messages({
    "number.base": "limit must be a number",
    "number.integer": "limit must be an integer",
    "number.min": "limit must be at least 1",
    "number.max": "limit must be at most 100"
  }),
  keyword: Joi.string().allow("").optional().messages({
    "string.base": "keyword must be a string"
  })
}).unknown(true);

const testcaseUpdateSchema = Joi.object({
  name: Joi.string().allow("").optional(),
  conversation: Joi.array().required().messages({
    "any.required": "conversation is required"
  }),
  type: Joi.string().required().messages({
    "any.required": "type is required"
  }),
  expected: Joi.object().required().messages({
    "any.required": "expected is required"
  }),
  matching_type: Joi.string().required().messages({
    "any.required": "matching_type is required"
  })
}).unknown(true);

const bulkDeleteTestcaseSchema = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "ids array must contain at least one testcase id",
    "any.required": "ids array is required"
  })
}).unknown(true);

export { createTestcaseSchema, testcaseIdSchema, bridgeIdSchema, testcaseUpdateSchema, getAllTestcasesQuerySchema, bulkDeleteTestcaseSchema };
