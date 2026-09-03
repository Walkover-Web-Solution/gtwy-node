import models from "../../models/index.js";
import Sequelize from "sequelize";
import { buildConversationFilterSql } from "./conversationFilters.util.js";

/**
 * Get conversation logs with pagination and filtering
 * @param {string} org_id - Organization ID
 * @param {string} bridge_id - Bridge ID
 * @param {string} thread_id - Thread ID
 * @param {string} sub_thread_id - Sub Thread ID
 * @param {number} page - Page number (default: 1)
 * @param {number} limit - Items per page (default: 30)
 * @returns {Object} - Success status and data
 */
async function findBatchConversationLogsByAgentId(org_id, bridge_id, filter, page = 1, limit = 30, version_id = null) {
  try {
    const offset = (page - 1) * limit;

    // Build where conditions - all parameters are required
    const whereConditions = {
      org_id: org_id,
      bridge_id: bridge_id,
      batch_data: { [Sequelize.Op.ne]: null },
      "batch_data.status": filter ? filter : "completed"
    };

    if (version_id) {
      whereConditions.version_id = version_id;
    }

    // Get paginated data
    const logs = await models.pg.conversation_logs.findAll({
      where: whereConditions,
      order: [["created_at", "DESC"]],
      limit: limit,
      offset: offset
    });

    // Reverse the conversation logs array
    const reversedLogs = logs.reverse();

    return {
      success: true,
      data: reversedLogs
    };
  } catch (error) {
    console.error("Error fetching conversation logs:", error);
    return {
      success: false,
      message: "Failed to fetch conversation logs",
      error: error.message
    };
  }
}
async function findBatchConversationLogsCountByAgentId(org_id, bridge_id) {
  try {
    // Build where conditions - all parameters are required
    const whereConditions = {
      org_id: org_id,
      bridge_id: bridge_id,
      batch_data: { [Sequelize.Op.ne]: null },
      "batch_data.status": { [Sequelize.Op.in]: ["completed", "queued", "processing"] }
    };

    // Get count
    const batchStatusCounts = await models.pg.conversation_logs.findAll({
      attributes: [
        [Sequelize.fn("COUNT", Sequelize.literal("CASE WHEN batch_data->>'status' = 'queued' THEN 1 END")), "queued"],
        [Sequelize.fn("COUNT", Sequelize.literal("CASE WHEN batch_data->>'status' = 'processing' THEN 1 END")), "processing"],
        [Sequelize.fn("COUNT", Sequelize.literal("CASE WHEN batch_data->>'status' = 'completed' THEN 1 END")), "completed"]
      ],
      where: whereConditions
    });

    const statusCounts = batchStatusCounts[0]?.dataValues || {};

    return {
      success: true,
      data: {
        completed: parseInt(statusCounts.completed) || 0,
        queued: parseInt(statusCounts.queued) || 0,
        processing: parseInt(statusCounts.processing) || 0
      }
    };
  } catch (error) {
    console.error("Error fetching conversation logs count:", error);
    return {
      success: false,
      message: "Failed to fetch conversation logs count",
      error: error.message
    };
  }
}

async function findConversationLogsByIds(org_id, bridge_id, thread_id, sub_thread_id, page = 1, limit = 30, version_id = null, testcase_id = null) {
  try {
    const offset = (page - 1) * limit;

    // Build where conditions - all parameters are required
    const whereConditions = {
      org_id: org_id,
      bridge_id: bridge_id,
      thread_id: thread_id,
      sub_thread_id: sub_thread_id
    };

    if (version_id) {
      whereConditions.version_id = version_id;
    }

    if (testcase_id) {
      whereConditions.testcase_id = testcase_id;
    }

    const totalCount = await models.pg.conversation_logs.count({
      where: whereConditions
    });

    // Get paginated data
    const logs = await models.pg.conversation_logs.findAll({
      where: whereConditions,
      order: [["created_at", "DESC"]],
      limit: limit,
      offset: offset
    });

    // Reverse the conversation logs array
    const reversedLogs = logs.reverse();

    // Calculate pagination
    const totalPages = Math.ceil(totalCount / limit);

    return {
      success: true,
      data: reversedLogs,
      totalEntries: totalCount,
      totalPages: totalPages
    };
  } catch (error) {
    console.error("Error fetching conversation logs:", error);
    return {
      success: false,
      message: "Failed to fetch conversation logs",
      error: error.message
    };
  }
}

/**
 * Get recent threads by bridge_id, ordered by updated_at
 * @param {string} org_id - Organization ID
 * @param {string} bridge_id - Bridge ID
 * @param {Object} filters - Search filters
 * @param {string} filters.keyword - Keyword to search (optional)
 * @param {Object} filters.time_range - Time range filter (optional)
 * @param {string} user_feedback - Filter by user feedback
 * @param {string} error - Filter by error
 * @param {number} page - Page number (default: 1)
 * @param {number} limit - Items per page (default: 30)
 * @returns {Object} - Success status and data
 */
/**
 * findRecentThreadsByBridgeId — no-blob version, keyword search scoped to
 * FIVE fields: "user", "llm_message", "message_id", "thread_id", "batch_id".
 *
 * Requires (from the migration):
 *   - trgm GIN on "user" and "llm_message"            -> ILIKE '%kw%'
 *   - text_pattern_ops B-tree on message_id/thread_id -> prefix LIKE 'kw%'
 *   - trgm ((batch_data->>'batch_id'))                -> ILIKE '%kw%'
 *   - GIN (variables)                                  -> filter_by variables (key=value)
 *   - (org_id, bridge_id, updated_at DESC)            -> scope + ordering
 *
 * filter_by (explicit per-column search) still supports the full column
 * set — only the generic keyword search box is narrowed to 3 fields.
 */

// Generic keyword search: ONLY these fields.
const KEYWORD_TEXT_COLUMNS = ["user", "llm_message"]; // substring, trgm-indexed
const KEYWORD_ID_COLUMNS = ["message_id", "thread_id"]; // prefix, B-tree-indexed
const KEYWORD_SEARCH_BATCH_ID = true; // batch_data->>'batch_id', substring, expression-trgm-indexed

// filter_by (explicit column pick) keeps the wider set.
const FILTERBY_TEXT_COLUMNS = ["llm_message", "user", "chatbot_message", "updated_llm_message"];
const FILTERBY_ID_COLUMNS = ["message_id", "thread_id", "sub_thread_id"];

/** Escape LIKE wildcards so user input can't pattern-inject. */
const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => "\\" + c);

async function findRecentThreadsByBridgeId(org_id, bridge_id, filters, error, page = 1, limit = 30, version_id = null, testcase_id = null) {
  try {
    const offset = (page - 1) * limit;

    // Named replacements for every raw literal — bound safely by Sequelize.
    const replacements = {};
    let paramSeq = 0;
    const addParam = (value) => {
      const name = `p${paramSeq++}`;
      replacements[name] = value;
      return `:${name}`;
    };

    // ---------------- Base scope ----------------
    const baseWhereConditions = { org_id, bridge_id };
    if (version_id) baseWhereConditions.version_id = version_id;
    if (testcase_id) baseWhereConditions.testcase_id = testcase_id;

    if (filters?.time_range) {
      const timeConditions = {};
      if (filters.time_range.start) {
        timeConditions[Sequelize.Op.gte] = new Date(filters.time_range.start);
      }
      if (filters.time_range.end) {
        timeConditions[Sequelize.Op.lte] = new Date(filters.time_range.end);
      }
      if (Object.getOwnPropertySymbols(timeConditions).length > 0) {
        baseWhereConditions.created_at = timeConditions;
      }
    }

    // ---------------- Thread-list conditions ----------------
    const whereConditions = { ...baseWhereConditions };

    if (error === "true" || error === true) {
      whereConditions.error = { [Sequelize.Op.ne]: null };
    }

    const filterBy = filters?.filter_by;
    const isFilterBySearch = filterBy && typeof filterBy === "object" && Object.keys(filterBy).length > 0;
    const isKeywordSearch = !isFilterBySearch && typeof filters?.keyword === "string" && filters.keyword.trim() !== "";

    if (isFilterBySearch) {
      const orConditions = [];

      for (const [col, keyword] of Object.entries(filterBy)) {
        if (col === "variables_absent") continue;

        if (col === "variables") {
          if (!keyword) continue;

          if (typeof keyword !== "object" || Object.keys(keyword).length === 0) continue;

          for (const [varName, varVal] of Object.entries(keyword)) {
            const key = String(varName).trim();
            if (!key) continue;
            const val = typeof varVal === "string" ? varVal.trim() : null;

            if (val) {
              // Exact key=value -> containment, uses idx_cl_variables_gin.
              const jsonParam = addParam(JSON.stringify({ [key]: val }));
              orConditions.push(Sequelize.literal(`"conversation_logs"."variables" @> ${jsonParam}::jsonb`));
            } else {
              const keyParam = addParam(key);
              orConditions.push(Sequelize.literal(`jsonb_exists(COALESCE("conversation_logs"."variables", '{}'::jsonb), ${keyParam})`));
            }
          }
        } else if (col === "batch_id") {
          if (!keyword || keyword === "") continue;
          const pat = addParam(`%${escapeLike(keyword)}%`);
          orConditions.push(Sequelize.literal(`"conversation_logs"."batch_data"->>'batch_id' ILIKE ${pat} ESCAPE '\\'`));
        } else if (FILTERBY_TEXT_COLUMNS.includes(col)) {
          if (!keyword || keyword === "") continue;
          const FREE_TEXT_MESSAGE_COLUMNS = ["llm_message", "updated_llm_message", "chatbot_message"];
          if (FREE_TEXT_MESSAGE_COLUMNS.includes(col)) {
            // Message columns store raw markdown; text pasted from the rendered UI has
            // markdown/whitespace stripped, so a single %blob% never matches. Match
            // every whitespace-delimited token (AND of ILIKE) so a full pasted response
            // or any snippet matches regardless of formatting differences.
            const tokens = String(keyword).split(/\s+/).map((t) => t.trim()).filter(Boolean);
            if (tokens.length) {
              orConditions.push({
                [Sequelize.Op.and]: tokens.map((t) => ({ [col]: { [Sequelize.Op.iLike]: `%${escapeLike(t)}%` } })),
              });
            }
          } else {
            orConditions.push({ [col]: { [Sequelize.Op.iLike]: `%${escapeLike(keyword)}%` } });
          }
        } else if (FILTERBY_ID_COLUMNS.includes(col)) {
          if (!keyword || keyword === "") continue;
          orConditions.push({ [col]: { [Sequelize.Op.like]: `${escapeLike(keyword)}%` } });
        }
      }

      if (orConditions.length > 0) {
        whereConditions[Sequelize.Op.and] = [{ [Sequelize.Op.or]: orConditions }];
      }
    } else if (isKeywordSearch) {
      // Keyword search across 5 fields, every branch index-backed so the
      // planner can BitmapOr them:
      //   user, llm_message          -> substring ILIKE '%kw%' (trgm GIN)
      //   message_id, thread_id      -> prefix LIKE 'kw%'      (B-tree)
      //   batch_data->>'batch_id'    -> substring ILIKE '%kw%' (expr trgm GIN)
      const kw = filters.keyword.trim();
      const orBranches = [
        ...KEYWORD_TEXT_COLUMNS.map((col) => ({
          [col]: { [Sequelize.Op.iLike]: `%${escapeLike(kw)}%` }
        })),
        ...KEYWORD_ID_COLUMNS.map((col) => ({
          [col]: { [Sequelize.Op.like]: `${escapeLike(kw)}%` }
        }))
      ];

      if (KEYWORD_SEARCH_BATCH_ID) {
        const batchPat = addParam(`%${escapeLike(kw)}%`);
        orBranches.push(Sequelize.literal(`"conversation_logs"."batch_data"->>'batch_id' ILIKE ${batchPat} ESCAPE '\\'`));
      }

      whereConditions[Sequelize.Op.and] = [{ [Sequelize.Op.or]: orBranches }];
    }

    // variables_absent: rows where NONE of the named keys exist.
    const absentRaw = filterBy?.variables_absent;
    const absent = (Array.isArray(absentRaw) ? absentRaw : absentRaw ? [absentRaw] : []).map((v) => String(v).trim()).filter(Boolean);

    if (absent.length) {
      const keyParams = absent.map((k) => addParam(k)).join(", ");
      whereConditions[Sequelize.Op.and] = [
        ...(whereConditions[Sequelize.Op.and] || []),
        Sequelize.literal(`NOT jsonb_exists_any(COALESCE("conversation_logs"."variables", '{}'::jsonb), ARRAY[${keyParams}]::text[])`)
      ];
    }

    // Multi-select facets via the shared builder.
    const facetExpr = buildConversationFilterSql({
      tool_id: filters?.tool_id,
      model: filters?.model,
      service: filters?.service,
      agent_id: filters?.agent_id,
      knowledgebase_id: filters?.knowledgebase_id,
      review_failed: filters?.review_failed
    });
    if (facetExpr) {
      whereConditions[Sequelize.Op.and] = [...(whereConditions[Sequelize.Op.and] || []), Sequelize.literal(facetExpr)];
    }
    const [threads] = await Promise.all([
      models.pg.conversation_logs.findAll({
        attributes: ["thread_id", [Sequelize.fn("MAX", Sequelize.col("id")), "id"], [Sequelize.fn("MAX", Sequelize.col("updated_at")), "updated_at"]],
        where: whereConditions,
        group: ["thread_id"],
        order: [[Sequelize.fn("MAX", Sequelize.col("updated_at")), "DESC"]],
        limit,
        offset,
        replacements
      })
    ]);

    const formattedThreads = threads.map((thread) => ({
      id: thread.dataValues.id,
      thread_id: thread.dataValues.thread_id,
      updated_at: thread.dataValues.updated_at
    }));

    // ---------------- Matching messages for found threads ----------------
    if ((isKeywordSearch || isFilterBySearch) && formattedThreads.length > 0) {
      const threadIds = formattedThreads.map((t) => t.thread_id);

      const matchedMessages = await models.pg.conversation_logs.findAll({
        attributes: [
          "message_id",
          "thread_id",
          "sub_thread_id",
          "display_name",
          "user",
          "llm_message",
          "chatbot_message",
          "updated_llm_message",
          "created_at"
        ],
        where: {
          ...whereConditions,
          thread_id: { [Sequelize.Op.in]: threadIds }
        },
        order: [["created_at", "DESC"]],
        limit: limit * 10, // hard cap — one noisy thread can't flood Node
        replacements
      });

      formattedThreads.forEach((thread) => {
        const threadMessages = matchedMessages.filter((m) => m.thread_id === thread.thread_id);

        thread.message = threadMessages.map((msg) => {
          let content = "";
          if (isKeywordSearch) {
            // Keyword search targets user / llm_message / message_id /
            // thread_id / batch_id, so the content picker mirrors that.
            const kw = filters.keyword.trim().toLowerCase();
            if (msg.user && msg.user.toLowerCase().includes(kw)) {
              content = msg.user;
            } else if ((msg.llm_message || "").toLowerCase().includes(kw)) {
              content = msg.llm_message;
            } else {
              // Matched on message_id / thread_id prefix or batch_id.
              content = msg.user || msg.llm_message || "Match found in ID or metadata";
            }
          } else {
            content = msg.user || msg.llm_message || msg.chatbot_message || msg.updated_llm_message || "Match found";
          }

          return {
            message_id: msg.message_id,
            message: content,
            created_at: msg.created_at
          };
        });

        const distinctSubThreads = [...new Set(threadMessages.map((m) => m.sub_thread_id).filter(Boolean))];
        if (distinctSubThreads.length > 0) {
          thread.sub_thread = distinctSubThreads.map((stId) => ({
            sub_thread_id: stId,
            display_name: threadMessages.find((m) => m.sub_thread_id === stId && m.display_name)?.display_name || stId,
            messages: threadMessages
              .filter((m) => m.sub_thread_id === stId)
              .map((msg) => ({
                message_id: msg.message_id,
                message: msg.user || msg.llm_message || "Match found"
              }))
          }));
        }
      });
    }

    return {
      success: true,
      data: formattedThreads
    };
  } catch (err) {
    console.error("Error fetching recent threads:", err);
    return {
      success: false,
      message: "Failed to fetch recent threads",
      error: err.message
    };
  }
}

/**
 * Search conversation logs with flexible filters
 * @param {string} org_id - Organization ID
 * @param {string} bridge_id - Bridge ID (required)
 * @param {Object} filters - Search filters
 * @param {string} filters.keyword - Keyword to search across recommended columns (required)
 * @param {Object} filters.time_range - Time range filter (optional)
 * @param {string} filters.time_range.start - Start date (optional)
 * @param {string} filters.time_range.end - End date (optional)
 * @returns {Object} - Success status and nested data structure
 */
async function findConversationLogsByFilters(org_id, bridge_id, filters) {
  try {
    // Build where conditions
    const whereConditions = {
      org_id: org_id,
      bridge_id: bridge_id
    };

    // Add time range filter
    if (filters.time_range) {
      const timeConditions = {};
      if (filters.time_range.start) {
        timeConditions[Sequelize.Op.gte] = new Date(filters.time_range.start);
      }
      if (filters.time_range.end) {
        timeConditions[Sequelize.Op.lte] = new Date(filters.time_range.end);
      }
      if (Object.keys(timeConditions).length > 0) {
        whereConditions.created_at = timeConditions;
      }
    }

    // Add keyword search across recommended columns
    if (filters.keyword) {
      const keywordConditions = {
        [Sequelize.Op.or]: [
          {
            message_id: {
              [Sequelize.Op.iLike]: `%${filters.keyword}%`
            }
          },
          {
            thread_id: {
              [Sequelize.Op.iLike]: `%${filters.keyword}%`
            }
          },
          {
            sub_thread_id: {
              [Sequelize.Op.iLike]: `%${filters.keyword}%`
            }
          },
          {
            llm_message: {
              [Sequelize.Op.iLike]: `%${filters.keyword}%`
            }
          },
          {
            user: {
              [Sequelize.Op.iLike]: `%${filters.keyword}%`
            }
          },
          {
            chatbot_message: {
              [Sequelize.Op.iLike]: `%${filters.keyword}%`
            }
          },
          {
            updated_llm_message: {
              [Sequelize.Op.iLike]: `%${filters.keyword}%`
            }
          }
        ]
      };
      whereConditions[Sequelize.Op.and] = [keywordConditions];
    }

    // Get all matching logs
    const logs = await models.pg.conversation_logs.findAll({
      where: whereConditions,
      order: [["created_at", "ASC"]]
    });

    // Group data by thread_id and sub_thread_id
    const groupedData = {};

    logs.forEach((log) => {
      const threadId = log.thread_id;
      const subThreadId = log.sub_thread_id;

      // Initialize thread if not exists
      if (!groupedData[threadId]) {
        groupedData[threadId] = {
          thread_id: threadId,
          sub_thread: {}
        };
      }

      // Initialize sub_thread if not exists
      if (!groupedData[threadId].sub_thread[subThreadId]) {
        groupedData[threadId].sub_thread[subThreadId] = {
          sub_thread_id: subThreadId,
          messages: []
        };
      }

      // Add message to sub_thread
      const message = log.user || log.llm_message || log.chatbot_message || log.updated_llm_message || "";
      if (message) {
        groupedData[threadId].sub_thread[subThreadId].messages.push({
          message: message,
          message_id: log.message_id
        });
      }
    });

    // Convert grouped data to array format
    const result = Object.values(groupedData).map((thread) => ({
      ...thread,
      sub_thread: Object.values(thread.sub_thread)
    }));

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("Error searching conversation logs:", error);
    return {
      success: false,
      message: "Failed to search conversation logs",
      error: error.message
    };
  }
}

/**
 * Get thread history with formatted user/assistant messages
 * @param {string} org_id - Organization ID
 * @param {string} thread_id - Thread ID
 * @param {string} bridge_id - Bridge ID
 * @param {string} sub_thread_id - Sub Thread ID (optional, defaults to thread_id)
 * @param {number} page - Page number (default: 1)
 * @param {number} limit - Items per page (default: 30)
 * @returns {Object} - Success status, formatted data with pagination
 */
async function findThreadHistoryFormatted(org_id, thread_id, bridge_id, sub_thread_id, page = 1, limit = 30, version_id = null) {
  try {
    const offset = (page - 1) * limit;

    // Build where conditions
    const whereConditions = {
      org_id: org_id,
      thread_id: thread_id,
      bridge_id: bridge_id,
      sub_thread_id: sub_thread_id ? sub_thread_id : thread_id
    };

    if (version_id) {
      whereConditions.version_id = version_id;
    }

    // Get total count
    const totalCount = await models.pg.conversation_logs.count({
      where: whereConditions
    });

    // Get paginated data
    const logs = await models.pg.conversation_logs.findAll({
      where: whereConditions,
      order: [["created_at", "DESC"]],
      limit: limit,
      offset: offset
    });

    // Reverse to get chronological order
    const reversedLogs = logs.reverse();

    // Format data: split each entry into user and assistant messages
    const formattedData = [];

    reversedLogs.forEach((log) => {
      // Create user message entry
      if (log.user || log.user_urls) {
        formattedData.push({
          Id: log.id,
          content: log.user,
          role: "user",
          createdAt: log.created_at,
          chatbot_message: null,
          tools_call_data: null,
          user_feedback: null,
          sub_thread_id: log.sub_thread_id,
          image_urls: [],
          urls: log.user_urls || null,
          message_id: log.message_id,
          error: log.error || ""
        });
      }

      // Create assistant message entry
      const assistantContent = log.updated_llm_message || log.llm_message || log.chatbot_message || "";
      if (assistantContent || log.llm_urls) {
        formattedData.push({
          Id: log.id + "_llm",
          content: assistantContent,
          role: "assistant",
          createdAt: log.created_at,
          chatbot_message: log.chatbot_message || "",
          tools_call_data: log.tools_call_data || null,
          user_feedback: log.user_feedback || null,
          sub_thread_id: log.sub_thread_id,
          image_urls: log.llm_urls || null,
          urls: null,
          message_id: log.message_id + "_llm",
          fallback_model: typeof log.fallback_model === "object" ? JSON.stringify(log.fallback_model) : log.fallback_model || "",
          plans: log.plans || null,
          error: ""
        });
      }
    });

    // Calculate pagination
    const totalPages = Math.ceil(totalCount / limit);

    return {
      success: true,
      data: formattedData,
      totalPages: totalPages,
      totalEnteries: totalCount,
      starterQuestion: []
    };
  } catch (error) {
    console.error("Error fetching thread history:", error);
    return {
      success: false,
      message: "Failed to fetch thread history",
      error: error.message
    };
  }
}

const findHistoryByMessageId = async (message_id, agent_id) => {
  const whereConditions = { message_id };
  if (agent_id) {
    whereConditions.bridge_id = agent_id;
  }
  const result = await models.pg.conversation_logs.findOne({
    where: whereConditions
  });
  return result;
};

async function updateStatus({ status, message_id }) {
  const [affectedCount, affectedRows] = await models.pg.conversation_logs.update(
    { user_feedback: status },
    {
      where: {
        message_id
      },
      returning: true
    }
  );
  if (affectedCount === 0) {
    return { success: true, message: "No matching record found to update." };
  }

  return { success: true, result: affectedRows };
}

/**
 * Create a new conversation log entry
 * @param {Object} payload - The conversation log data
 * @returns {Object} - The created conversation log
 */
async function createConversationLog(payload) {
  try {
    // Transform the payload from old format to new format if needed
    const transformedPayload = {
      org_id: payload.org_id,
      llm_message: payload.message || null,
      thread_id: payload.thread_id,
      sub_thread_id: payload.sub_thread_id || payload.thread_id,
      display_name: payload.display_name || null,
      bridge_id: payload.bridge_id,
      version_id: payload.version_id || null,
      message_id: payload.message_id,
      model: payload.model_name || null,
      status: payload.status || false,
      user_feedback: payload.user_feedback || 0,
      tools_call_data: payload.tools_call_data || [],
      user_urls: payload.user_urls || [],
      llm_urls: payload.llm_urls || [],
      AiConfig: payload.AiConfig || null,
      fallback_model: payload.fallback_model || null,
      tokens: payload.tokens || null,
      variables: payload.variables || null,
      latency: payload.latency || null,
      error: payload.error || null,
      firstAttemptError: payload.firstAttemptError || null,
      finish_reason: payload.finish_reason || null,
      parent_id: payload.parent_id || null,
      child_id: payload.child_id || null
    };

    transformedPayload.prompt = payload.prompt || null;
    transformedPayload.service = payload.service || null;
    transformedPayload.plans = payload.plans || null;

    const result = await models.pg.conversation_logs.create(transformedPayload);
    return result;
  } catch (error) {
    console.error("Error creating conversation log:", error);
    throw error;
  }
}

/**
 * Get chatbot thread history with pagination (raw data without formatting)
 * @param {string} org_id - Organization ID
 * @param {string} thread_id - Thread ID
 * @param {string} bridge_id - Bridge ID
 * @param {string} sub_thread_id - Sub Thread ID
 * @param {number} page - Page number (default: 1)
 * @param {number} limit - Items per page (default: 30)
 * @returns {Object} - Success status, raw data with pagination
 */
async function findChatbotThreadHistory(org_id, thread_id, bridge_id, sub_thread_id, page = 1, limit = 30) {
  const offset = (page - 1) * limit;
  const whereConditions = {
    org_id: org_id,
    thread_id: thread_id,
    bridge_id: bridge_id,
    sub_thread_id: sub_thread_id
  };
  const logs = await models.pg.conversation_logs.findAll({
    where: whereConditions,
    attributes: [
      "id",
      "llm_message",
      "user",
      "chatbot_message",
      "error",
      "user_feedback",
      "message_id",
      "sub_thread_id",
      "thread_id",
      "version_id",
      "bridge_id",
      "user_urls",
      "llm_urls",
      "plans",
      "created_at",
      "updated_at"
    ],
    order: [["created_at", "DESC"]],
    limit: limit,
    offset: offset
  });

  const reversedLogs = logs.reverse();

  return {
    success: true,
    data: reversedLogs
  };
}

export {
  findConversationLogsByIds,
  updateStatus,
  findRecentThreadsByBridgeId,
  findConversationLogsByFilters,
  findThreadHistoryFormatted,
  findHistoryByMessageId,
  findHistoryByMessageId as getHistoryByMessageId,
  createConversationLog,
  findChatbotThreadHistory,
  findBatchConversationLogsByAgentId,
  findBatchConversationLogsCountByAgentId
};
