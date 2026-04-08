import {
  findConversationLogsByIds,
  findRecentThreadsByBridgeId,
  findHistoryByMessageId,
  findChatbotThreadHistory
} from "../db_services/history.service.js";
import configurationService from "../db_services/configuration.service.js";

/**
 * GET /conversation-logs/:bridge_id/:thread_id/:sub_thread_id
 * Get conversation logs with pagination
 */
const getConversationLogs = async (req, res, next) => {
  const org_id = req.profile.org.id; // From middleware
  const { agent_id, thread_id, sub_thread_id } = req.params;
  const pageNum = req.query.page || 1;
  const limitNum = req.query.limit || 30;

  // Get conversation logs
  const result = await findConversationLogsByIds(org_id, agent_id, thread_id, sub_thread_id, pageNum, limitNum);

  if (result.success) {
    res.locals = {
      data: result.data,
      success: true
    };
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      message: result.message,
      success: false
    };
    req.statusCode = 500;
    return next();
  }
};

/**
 * GET /threads/:agent_id
 * Get recent threads by agent_id with pagination and search functionality
 */
const getRecentThreads = async (req, res, next) => {
  const org_id = req.profile.org.id; // From middleware
  const { agent_id } = req.params;

  // Extract query parameters
  const pageNum = parseInt(req.query.page) || 1;
  const limitNum = parseInt(req.query.limit) || 30;
  const user_feedback = req.query.user_feedback || "all";
  const error = req.query.error || "false";
  const version_id = req.query.version_id;
  const type = req.query.type;

  // Extract search filters (supports both search and regular listing)
  const filters = {
    keyword: req.query.keyword,
    filter_by: req.query.filter_by,
    time_range:
      req.query.start_date || req.query.end_date
        ? {
            start: req.query.start_date,
            end: req.query.end_date
          }
        : undefined
  };

  // Get recent threads with search functionality built-in
  const result = await findRecentThreadsByBridgeId(org_id, agent_id, filters, user_feedback, error, pageNum, limitNum, version_id, type);

  if (result.success) {
    res.locals = {
      data: result.data,
      total_user_feedback_count: result.total_user_feedback_count,
      success: true
    };
    req.statusCode = 200;
    return next();
  } else {
    res.locals = {
      message: result.message,
      success: false
    };
    req.statusCode = 500;
    return next();
  }
};

const getRecursiveAgentHistory = async (req, res, next) => {
  try {
    const org_id = req.profile.org.id;
    const { agent_id, thread_id, message_id } = req.params;

    if (!message_id) {
      res.locals = { success: false, message: "Message ID is required" };
      req.statusCode = 400;
      return next();
    }

    const resolveMessage = async (msgId) => {
      if (!msgId) return null;

      const messageRecord = await findHistoryByMessageId(msgId);
      if (!messageRecord) return null;

      const message = messageRecord?.toJSON ? messageRecord.toJSON() : messageRecord;

      if (!Array.isArray(message.tools_call_data)) {
        return message;
      }

      for (let i = 0; i < message.tools_call_data.length; i++) {
        const toolGroup = message.tools_call_data[i];

        for (const key of Object.keys(toolGroup)) {
          const tool = toolGroup[key];
          const metadata = tool?.data?.metadata;

          if (metadata?.type === "agent" && metadata?.message_id) {
            const fullChildMessage = await resolveMessage(metadata.message_id);

            if (fullChildMessage) {
              fullChildMessage.name = tool?.name || null;
              toolGroup[key] = fullChildMessage;
            }
          }
        }
      }

      return message;
    };

    const rootMessage = await findHistoryByMessageId(message_id);

    if (!rootMessage) {
      res.locals = { success: false, message: "Message not found" };
      req.statusCode = 404;
      return next();
    }

    if (rootMessage.org_id !== org_id || rootMessage.bridge_id !== agent_id) {
      res.locals = { success: false, message: "Unauthorized access" };
      req.statusCode = 403;
      return next();
    }

    if (rootMessage.thread_id !== thread_id) {
      res.locals = {
        success: false,
        message: "Message does not belong to the specified thread"
      };
      req.statusCode = 400;
      return next();
    }

    const finalHistory = await resolveMessage(message_id);

    res.locals = {
      success: true,
      data: finalHistory
    };
    req.statusCode = 200;
    return next();
  } catch (error) {
    console.error("Recursive history error:", error);
    res.locals = {
      success: false,
      message: "Failed to fetch recursive history",
      error: error.message
    };
    req.statusCode = 500;
    return next();
  }
};

const getChatbotThreadHistory = async (req, res, next) => {
  const page = parseInt(req.query.pageNo) || 1;
  const pageSize = parseInt(req.query.limit) || 30;
  const { thread_id, bridge_slugName } = req.params;
  const { sub_thread_id = thread_id } = req.query;
  let org_id = req?.profile?.org?.id || req?.profile?.org_id;

  const bridge = req.chatBot?.ispublic
    ? await configurationService.getAgentByUrlSlugname(bridge_slugName)
    : await configurationService.getAgentIdBySlugname(org_id, bridge_slugName);

  const bridge_id = bridge?._id?.toString();
  const starterQuestion = !bridge?.IsstarterQuestionEnable ? [] : bridge?.starterQuestion;
  org_id = req.chatBot?.ispublic ? bridge?.org_id : org_id;

  const result = await findChatbotThreadHistory(org_id, thread_id, bridge_id, sub_thread_id, page, pageSize);

  if (result.success) {
    res.locals = {
      ...result,
      starterQuestion
    };
    req.statusCode = 200;
    return next();
  } else {
    res.locals = result;
    req.statusCode = 500;
    return next();
  }
};

export default {
  getConversationLogs,
  getRecentThreads,
  getRecursiveAgentHistory,
  getChatbotThreadHistory
};
