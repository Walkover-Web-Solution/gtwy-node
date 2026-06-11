import Joi from "joi";
import joiObjectId from "joi-objectid";

Joi.objectId = joiObjectId(Joi);

const createFolder = {
  body: Joi.object().keys({
    name: Joi.string().required().messages({
      "string.empty": "name is required",
      "any.required": "name is required"
    }),
    config: Joi.object().optional().default({}),
    type: Joi.string().optional().default("agent")
  })
};

const updateFolder = {
  body: Joi.object().keys({
    folder_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        "string.pattern.base": "folder_id must be a valid MongoDB ObjectId",
        "any.required": "folder_id is required"
      }),
    name: Joi.string().optional(),
    config: Joi.object().optional(),
    type: Joi.string().optional()
  })
};

const deleteFolder = {
  params: Joi.object().keys({
    folder_id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        "string.pattern.base": "folder_id must be a valid MongoDB ObjectId",
        "any.required": "folder_id is required"
      })
  })
};

export default {
  createFolder,
  updateFolder,
  deleteFolder
};
