import Joi from "joi";
import joiObjectId from "joi-objectid";

Joi.objectId = joiObjectId(Joi);

const getThreads = {
  params: Joi.object()
    .keys({
      thread_id: Joi.string().required(),
      bridge_id: Joi.string().required() // Can be slug or objectId
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      pageNo: Joi.number().integer(),
      limit: Joi.number().integer(),
      sub_thread_id: Joi.string()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      org_id: Joi.string()
    })
    .unknown(true)
};

const createEntry = {
  params: Joi.object()
    .keys({
      thread_id: Joi.string().required(),
      bridge_id: Joi.string().required(),
      sub_thread_id: Joi.string().optional()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      message: Joi.string().required()
    })
    .unknown(true)
};

const userFeedbackCount = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.objectId().required()
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      startDate: Joi.string(),
      endDate: Joi.string(),
      user_feedback: Joi.string()
    })
    .unknown(true)
};

const getMessageHistory = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.objectId().required()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      org_id: Joi.string()
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      pageNo: Joi.number().integer(),
      limit: Joi.number().integer(),
      keyword_search: Joi.string().allow("", null),
      startTime: Joi.string(),
      endTime: Joi.string(),
      version_id: Joi.objectId(),
      user_feedback: Joi.string(),
      error: Joi.string()
    })
    .unknown(true)
};

const getAllSubThreadsController = {
  params: Joi.object()
    .keys({
      thread_id: Joi.string().required()
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      bridge_id: Joi.objectId(),
      error: Joi.string(),
      version_id: Joi.objectId()
    })
    .unknown(true)
};

const deleteBridges = {
  params: Joi.object()
    .keys({
      agent_id: Joi.objectId().required()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      restore: Joi.boolean()
    })
    .unknown(true)
};

const getSystemPromptHistory = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.objectId().required(),
      timestamp: Joi.string().required()
    })
    .unknown(true)
};

const FineTuneData = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.objectId().required()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      thread_ids: Joi.array().items(Joi.string()).required(),
      user_feedback: Joi.string()
    })
    .unknown(true)
};

const updateThreadMessage = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.objectId().required()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      message: Joi.string().required(),
      id: Joi.number().required()
    })
    .unknown(true)
};

const updateMessageStatus = {
  params: Joi.object()
    .keys({
      status: Joi.string().required()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      message_id: Joi.string().required(),
      agent_id: Joi.objectId()
    })
    .unknown(true)
};

const getThreadMessages = {
  params: Joi.object()
    .keys({
      thread_id: Joi.string().required(),
      bridge_id: Joi.string().required()
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      pageNo: Joi.number().integer(),
      limit: Joi.number().integer(),
      sub_thread_id: Joi.string()
    })
    .unknown(true)
};

const bridgeArchive = {
  params: Joi.object()
    .keys({
      bridge_id: Joi.objectId().required()
    })
    .unknown(true),
  body: Joi.object()
    .keys({
      status: Joi.number().valid(0, 1).required()
    })
    .unknown(true)
};

const getAllUserUpdates = {
  params: Joi.object()
    .keys({
      version_id: Joi.objectId().required()
    })
    .unknown(true),
  query: Joi.object()
    .keys({
      page: Joi.number().integer(),
      limit: Joi.number().integer()
    })
    .unknown(true)
};

export default {
  getThreads,
  createEntry,
  userFeedbackCount,
  getMessageHistory,
  getAllSubThreadsController,
  deleteBridges,
  getSystemPromptHistory,
  FineTuneData,
  updateThreadMessage,
  updateMessageStatus,
  getThreadMessages,
  bridgeArchive,
  getAllUserUpdates
};
