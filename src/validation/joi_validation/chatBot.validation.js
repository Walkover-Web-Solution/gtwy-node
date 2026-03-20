import Joi from "joi";
import joiObjectId from "joi-objectid";
Joi.objectId = joiObjectId(Joi);

const subscribe = {
  body: Joi.object({
    slugName: Joi.string().required().messages({
      "string.empty": "slugName is required",
      "any.required": "slugName is required"
    }),
    versionId: Joi.string().optional().allow(""),
    helloId: Joi.string().optional().allow("")
  }).unknown(true)
};

const updateChatBotConfig = {
  params: Joi.object()
    .keys({
      botId: Joi.string().required().messages({
        "string.base": "botId must be a string",
        "any.required": "botId is mandatory"
      })
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      config: Joi.object().required().messages({
        "object.base": "config must be an object",
        "any.required": "config is mandatory"
      })
    })
    .unknown(true)
};

// Legacy schema for backward compatibility (used in configServices.js)
const chatbotHistoryValidationSchema = Joi.object({
  org_id: Joi.string().required(),
  thread_id: Joi.string().required(),
  bridge_id: Joi.objectId().required()
}).unknown(true);
const getOneChatBot = {
  params: Joi.object()
    .keys({
      botId: Joi.objectId().required().messages({
        "string.base": "botId must be a valid ObjectId",
        "any.required": "botId is mandatory"
      })
    })
    .unknown(true)
};

const loginUser = {
  body: Joi.object()
    .keys({
      // Add required fields for login
    })
    .unknown(true)
};

const addOrRemoveBridgeInChatBot = {
  body: Joi.object()
    .keys({
      botId: Joi.objectId().required().messages({
        "string.base": "botId must be a valid ObjectId",
        "any.required": "botId is mandatory"
      }),
      agentId: Joi.objectId().required().messages({
        "string.base": "agentId must be a valid ObjectId",
        "any.required": "agentId is mandatory"
      }),
      action: Joi.string().valid("add", "remove").required().messages({
        "string.base": "action must be a string",
        "any.only": 'action must be either "add" or "remove"',
        "any.required": "action is mandatory"
      })
    })
    .unknown(true)
};

const createOrRemoveAction = {
  params: Joi.object()
    .keys({
      agentId: Joi.objectId().required().messages({
        "string.base": "agentId must be a valid ObjectId",
        "any.required": "agentId is mandatory"
      })
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      type: Joi.string().valid("add", "remove").optional().messages({
        "string.base": "type must be a string",
        "any.only": 'type must be either "add" or "remove"'
      })
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      type: Joi.string().valid("sendDataToFrontend", "reply").optional().messages({
        "string.base": "type must be a string",
        "any.only": 'type must be either "sendDataToFrontend" or "reply"'
      }),
      actionJson: Joi.object().required().messages({
        "object.base": "actionJson must be an object",
        "any.required": "actionJson is mandatory"
      }),
      version_id: Joi.objectId().required().messages({
        "string.base": "version_id must be a valid ObjectId",
        "any.required": "version_id is mandatory"
      }),
      actionId: Joi.string().optional().messages({
        "string.base": "actionId must be a string"
      })
    })
    .unknown(true)
};

export default {
  subscribe,
  getOneChatBot,
  loginUser,
  updateChatBotConfig,
  addOrRemoveBridgeInChatBot,
  createOrRemoveAction
};

// Named export for backward compatibility
export { chatbotHistoryValidationSchema };
