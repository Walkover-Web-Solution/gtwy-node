import models from "../../models/index.js";
import Sequelize from "sequelize";
import Thread from "../mongoModel/Thread.model.js";
import { findInCache, storeInCache } from "../cache_service/index.js";
import { getUsers } from "../services/proxy.service.js";

async function findMessage(org_id, thread_id, bridge_id, sub_thread_id, page, pageSize, user_feedback, version_id, isChatbot, error) {
  const offset = page && pageSize ? (page - 1) * pageSize : null;
  const limit = pageSize || null;

  // Build the WHERE clause for the SQL query
  let whereConditions = [`org_id = '${org_id}'`, `thread_id = '${thread_id}'`, `bridge_id = '${bridge_id}'`, `sub_thread_id = '${sub_thread_id}'`];

  if (version_id !== undefined && version_id) {
    whereConditions.push(`version_id = '${version_id}'`);
  }

  if (user_feedback === "all" || !user_feedback) {
    whereConditions.push(`(user_feedback IS NULL OR user_feedback IN (0, 1, 2))`);
  } else {
    whereConditions.push(`user_feedback = ${user_feedback}`);
  }

  // Add condition for error if error is true
  if (error) {
    whereConditions.push(`error IS NOT NULL AND error != ''`);
  }

  const whereClause = whereConditions.join(" AND ");

  let countResult = [{ total: 0 }];
  // Only execute count query if not chatbot
  if (!isChatbot) {
    const countQuery = `
      SELECT COUNT(*) as total
      FROM conversation_logs
      WHERE org_id = '${org_id}'
        AND thread_id = '${thread_id}'
        AND bridge_id = '${bridge_id}'
        AND sub_thread_id = '${sub_thread_id}'
        AND error IS NOT NULL AND error != ''
    `;
    countResult = await models.pg.sequelize.query(countQuery, { type: models.pg.sequelize.QueryTypes.SELECT });
  }

  // Main query from conversation_logs
  let query;
  if (isChatbot) {
    // Only select the required keys for chatbot
    query = `
      SELECT 
        id as "Id",
        COALESCE(user, llm_message, chatbot_message) as content,
        CASE 
          WHEN user IS NOT NULL AND user != '' THEN 'user'
          ELSE 'assistant'
        END as role,
        created_at as "createdAt",
        chatbot_message,
        tools_call_data,
        user_feedback,
        sub_thread_id,
        llm_urls as image_urls,
        user_urls as urls,
        message_id,
        fallback_model,
        error,
        "firstAttemptError"
      FROM conversation_logs
      WHERE ${whereClause}
      ORDER BY id DESC
    `;
  } else {
    query = `
      SELECT 
        COALESCE(user, llm_message, chatbot_message) as content,
        CASE 
          WHEN user IS NOT NULL AND user != '' THEN 'user'
          ELSE 'assistant'
        END as role,
        created_at as "createdAt",
        id as "Id",
        NULL as function,
        NULL as is_reset,
        chatbot_message,
        updated_llm_message as updated_message,
        tools_call_data,
        message_id,
        user_feedback,
        sub_thread_id,
        thread_id,
        version_id,
        llm_urls as image_urls,
        user_urls as urls,
        "AiConfig",
        NULL as annotations,
        fallback_model,
        error,
        "firstAttemptError",
        latency,
        service,
        status,
        model,
        tokens,
        finish_reason,
        variables
      FROM conversation_logs
      WHERE ${whereClause}
      ORDER BY id DESC
    `;
  }

  // Add pagination if needed
  if (limit !== null) {
    query += ` LIMIT ${limit}`;
  }

  if (offset !== null) {
    query += ` OFFSET ${offset}`;
  }

  // Execute main query
  const conversationsResult = await models.pg.sequelize.query(query, { type: models.pg.sequelize.QueryTypes.SELECT });

  // Get total entries from count query
  const totalEntries = parseInt(countResult?.[0]?.total || 0);

  // Sort the results in ascending order (since we queried in DESC but need to reverse)
  const conversations = conversationsResult.reverse();

  // Calculate pagination info only if not chatbot
  const totalPages = isChatbot ? 1 : limit ? Math.ceil(totalEntries / limit) : 1;

  return { conversations, totalPages, totalEntries: isChatbot ? conversations.length : totalEntries };
}

async function deleteLastThread(org_id, thread_id, bridge_id) {
  const recordsTodelete = await models.pg.conversation_logs.findOne({
    where: {
      org_id,
      thread_id,
      bridge_id,
      // Find records where tools_call_data is not null/empty (indicates tool_calls)
      tools_call_data: {
        [Sequelize.Op.ne]: null
      }
    },
    order: [["id", "DESC"]]
  });
  if (recordsTodelete) {
    await recordsTodelete.destroy();
    return {
      success: true
    };
  }
  return {
    success: false
  };
}

async function storeSystemPrompt(promptText, orgId, bridgeId) {
  try {
    const result = await models.pg.system_prompt_versionings.create({
      system_prompt: promptText,
      org_id: orgId,
      bridge_id: bridgeId,
      created_at: new Date(),
      updated_at: new Date()
    });
    return result;
  } catch (error) {
    console.error("Error storing system prompt:", error);
    return null;
  }
}

async function findThreadsForFineTune(org_id, thread_id, bridge_id, user_feedback_array) {
  let whereClause = {
    org_id,
    thread_id,
    bridge_id,
    [Sequelize.Op.or]: [{ error: "" }, { error: { [Sequelize.Op.is]: null } }]
  };

  if (!user_feedback_array.includes(0)) {
    // If 0 is not included, filter by user_feedback
    whereClause.user_feedback = {
      [Sequelize.Op.in]: user_feedback_array
    };
  }

  let conversations = await models.pg.conversation_logs.findAll({
    attributes: [
      [Sequelize.literal(`COALESCE(user, llm_message, chatbot_message)`), "content"],
      [Sequelize.literal(`CASE WHEN user IS NOT NULL AND user != '' THEN 'user' ELSE 'assistant' END`), "role"],
      ["created_at", "createdAt"],
      "id",
      [Sequelize.literal("NULL"), "function"],
      ["updated_llm_message", "updated_message"],
      "error"
    ],
    where: whereClause,
    order: [["id", "DESC"]],
    raw: true
  });

  conversations = conversations.reverse();
  return conversations;
}

async function system_prompt_data(org_id, bridge_id) {
  const system_prompt = await models.pg.system_prompt_versionings.findOne({
    where: {
      org_id,
      bridge_id
    },
    order: [["updated_at", "DESC"]],
    raw: true,
    limit: 1
  });

  return system_prompt;
}
async function updateMessage({ org_id, bridge_id, message, id }) {
  try {
    const [affectedCount, affectedRows] = await models.pg.conversation_logs.update(
      { updated_llm_message: message },
      {
        where: {
          org_id,
          bridge_id,
          id
        },
        returning: true
      }
    );

    if (affectedCount === 0) {
      return { success: false, message: "No matching record found to update." };
    }
    const result = affectedRows.map((row) => ({
      id: row.id,
      org_id: row.org_id,
      thread_id: row.thread_id,
      model_name: row.model,
      bridge_id: row.bridge_id,
      content: row.llm_message || row.user || row.chatbot_message,
      role: row.user ? "user" : "assistant",
      function: null,
      updated_message: row.updated_llm_message,
      type: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return { success: true, result: result };
  } catch (error) {
    console.error("Error updating message:", error);
    return { success: false, message: "Error updating message" };
  }
}

async function updateStatus({ status, message_id }) {
  try {
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
  } catch (error) {
    console.error("Error updating message:", error);
    return { success: false, message: "Error updating message" };
  }
}

async function create(payload) {
  return await models.pg.conversation_logs.create(payload);
}

const findMessageByMessageId = async (bridge_id, org_id, thread_id, message_id) =>
  await models.pg.conversation_logs.findOne({
    where: {
      org_id,
      bridge_id,
      thread_id,
      message_id,
      // Find assistant messages (where llm_message or chatbot_message exists and user is null/empty)
      [Sequelize.Op.or]: [{ llm_message: { [Sequelize.Op.ne]: null } }, { chatbot_message: { [Sequelize.Op.ne]: null } }]
    },
    raw: true,
    limit: 1
  });
const addThreadId = async (message_id, thread_id, type) => {
  // In conversation_logs, we don't have external_reference or message_by
  // We'll add external_reference as a variable in the variables JSONB field
  return await models.pg.conversation_logs.update(
    {
      variables: Sequelize.fn("jsonb_set", Sequelize.col("variables"), "{external_reference}", Sequelize.literal(`'"${thread_id}"'::jsonb`), true)
    },
    {
      where: {
        message_id,
        // type was 'user' or 'assistant', map to appropriate conditions
        ...(type === "user" ? { user: { [Sequelize.Op.ne]: null } } : {})
      },
      returning: true
    }
  );
};

async function findThreadMessage(org_id, thread_id, bridge_id, sub_thread_id, page, pageSize) {
  const offset = page && pageSize ? (page - 1) * pageSize : null;
  const limit = pageSize || null;
  const whereClause = {
    org_id: org_id,
    thread_id: thread_id,
    bridge_id: bridge_id,
    sub_thread_id: sub_thread_id
  };

  let conversations = await models.pg.conversation_logs.findAll({
    attributes: [
      [
        Sequelize.literal(
          `CASE WHEN user IS NOT NULL AND user != '' THEN user WHEN llm_message IS NOT NULL AND llm_message != '' THEN llm_message ELSE chatbot_message END`
        ),
        "content"
      ],
      [Sequelize.literal(`CASE WHEN user IS NOT NULL AND user != '' THEN 'user' ELSE 'assistant' END`), "role"],
      ["created_at", "createdAt"],
      "id",
      [Sequelize.literal("NULL"), "is_reset"],
      "tools_call_data",
      ["llm_urls", "image_urls"]
    ],
    where: whereClause,
    order: [["id", "DESC"]],
    offset: offset,
    limit: limit,
    raw: true
  });
  conversations = conversations.reverse();
  return { conversations };
}

const getSubThreads = async (org_id, thread_id, bridge_id) => {
  return await Thread.find({ org_id, thread_id, bridge_id }).lean();
};

async function sortThreadsByHits(threads) {
  const subThreadIds = [...new Set(threads.map((t) => t.sub_thread_id).filter(Boolean))];

  const latestEntries = await models.pg.conversation_logs.findAll({
    attributes: ["sub_thread_id", [models.pg.sequelize.fn("MAX", models.pg.sequelize.col("created_at")), "latestCreatedAt"]],
    where: { sub_thread_id: subThreadIds },
    group: ["sub_thread_id"],
    raw: true
  });

  const latestSubThreadMap = new Map(latestEntries.map((entry) => [entry.sub_thread_id, new Date(entry.latestCreatedAt)]));

  threads.sort((a, b) => {
    const dateA = latestSubThreadMap.get(a.sub_thread_id) || new Date(0);
    const dateB = latestSubThreadMap.get(b.sub_thread_id) || new Date(0);
    return dateB - dateA;
  });

  return threads;
}

async function getUserUpdates(org_id, version_id, page = 1, pageSize = 10, users = [], filters = {}) {
  try {
    const offset = (page - 1) * pageSize;
    let pageNo = 1;
    let userData = await findInCache(`user_data_${org_id}`);

    // Parse cached data if it exists, otherwise fetch fresh data
    if (userData) {
      try {
        userData = JSON.parse(userData);
        // If parsed data is not an array or is empty, fetch fresh data
        if (!Array.isArray(userData) || userData.length === 0) {
          userData = null;
        }
      } catch {
        // If JSON parsing fails, treat as no cached data
        userData = null;
      }
    }

    if (!userData) {
      let allUserData = [];
      let hasMoreData = true;

      while (hasMoreData) {
        const response = await getUsers(org_id, pageNo, (pageSize = 50));
        if (response && Array.isArray(response.data)) {
          allUserData = [...allUserData, ...response.data];
          hasMoreData = response?.totalEntityCount > allUserData.length;
        } else {
          hasMoreData = false;
        }
        pageNo++;
      }
      await storeInCache(`user_data_${org_id}`, allUserData, 86400); // Cache for 1 day
      userData = allUserData;
    }
    if (version_id) {
      // Build where conditions for filtering
      let whereConditions = {
        org_id: org_id,
        version_id: version_id
      };

      // Apply filters if provided
      if (filters.user_ids && filters.user_ids.length > 0) {
        whereConditions.user_id = { [Sequelize.Op.in]: filters.user_ids };
      }

      if (filters.types && filters.types.length > 0) {
        whereConditions.type = { [Sequelize.Op.in]: filters.types };
      }

      const timeCondition = {};
      if (filters.date_from) {
        const from = new Date(filters.date_from);
        if (!isNaN(from.getTime())) {
          timeCondition[Sequelize.Op.gte] = from;
        }
      }
      if (filters.date_to) {
        const to = new Date(filters.date_to);
        if (!isNaN(to.getTime())) {
          timeCondition[Sequelize.Op.lte] = to;
        }
      }
      if (Object.keys(timeCondition).length > 0) {
        whereConditions.time = timeCondition;
      }

      const { count: total, rows: history } = await models.pg.user_bridge_config_history.findAndCountAll({
        where: whereConditions,
        attributes: ["id", "user_id", "org_id", "bridge_id", "type", "time", "version_id"],
        order: [["time", "DESC"]],
        offset: offset,
        limit: pageSize
      });

      if (history.length === 0) {
        return { success: false, message: "No updates found" };
      }

      const updatedHistory = history?.map((entry) => {
        const user = Array.isArray(userData) ? userData.find((user) => user?.id === entry?.dataValues?.user_id) : null;
        return {
          ...entry?.dataValues,
          user_name: user ? user?.name : "Unknown"
        };
      });

      return {
        success: true,
        updates: updatedHistory,
        total,
        users: Array.isArray(userData)
          ? userData
              .filter((user) => user?.meta?.type !== "embed")
              .map((user) => ({
                id: user.id,
                name: user.name
              }))
          : []
      };
    } else {
      let filteredUsers = [];

      if (Array.isArray(users) && users.length > 0 && Array.isArray(userData)) {
        const userIdSet = new Set(users);
        filteredUsers = userData.filter((user) => user && userIdSet.has(user.id));
      } else {
        filteredUsers = Array.isArray(userData) ? userData : [];
      }

      const mappedUsers = filteredUsers.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email
      }));

      return { success: true, users: mappedUsers };
    }
  } catch (error) {
    console.error("Error fetching user updates:", error);
    return { success: false, message: "Error fetching updates" };
  }
}

async function getSubThreadsByError(org_id, thread_id, bridge_id, version_id, isError) {
  try {
    let whereClause = {
      org_id,
      thread_id,
      bridge_id
    };

    // Apply version_id filter
    if (version_id) {
      whereClause.version_id = version_id;
    }

    if (isError) {
      whereClause.error = {
        [models.pg.Sequelize.Op.and]: [{ [models.pg.Sequelize.Op.ne]: "" }, { [models.pg.Sequelize.Op.ne]: null }]
      };
    }

    const result = await models.pg.conversation_logs.findAll({
      attributes: ["sub_thread_id", "version_id", [models.pg.Sequelize.fn("MAX", models.pg.Sequelize.col("created_at")), "latest_error"]],
      where: whereClause,
      group: ["sub_thread_id", "version_id"],
      order: [[models.pg.Sequelize.literal("latest_error"), "DESC"]],
      raw: true
    });

    return result.map((item) => item.sub_thread_id);
  } catch (error) {
    console.error("getSubThreadsByError error =>", error);
    return [];
  }
}

async function sortThreadsByLatestActivity(threads, org_id, bridge_id) {
  try {
    if (!threads || threads.length === 0) {
      return threads;
    }

    // Extract thread_id and sub_thread_id from threads
    const threadIds = threads.map((thread) => ({
      thread_id: thread.thread_id,
      sub_thread_id: thread.sub_thread_id
    }));

    // Query PostgreSQL to get latest conversation activity for each thread
    const conversationActivity = await models.pg.conversation_logs.findAll({
      attributes: ["thread_id", "sub_thread_id", [models.pg.Sequelize.fn("MAX", models.pg.Sequelize.col("created_at")), "latest_activity"]],
      where: {
        org_id,
        bridge_id,
        [models.pg.Sequelize.Op.or]: threadIds.map(({ thread_id, sub_thread_id }) => ({
          thread_id,
          sub_thread_id
        }))
      },
      group: ["thread_id", "sub_thread_id"],
      order: [[models.pg.Sequelize.literal("latest_activity"), "DESC"]],
      raw: true
    });

    // Create a map for quick lookup of latest activity
    const activityMap = new Map();
    conversationActivity.forEach((item) => {
      const key = `${item.thread_id}_${item.sub_thread_id}`;
      activityMap.set(key, new Date(item.latest_activity));
    });

    // Sort threads based on latest activity (DESC - most recent first)
    const sortedThreads = threads.sort((a, b) => {
      const keyA = `${a.thread_id}_${a.sub_thread_id}`;
      const keyB = `${b.thread_id}_${b.sub_thread_id}`;

      const activityA = activityMap.get(keyA) || new Date(0); // Default to epoch if not found
      const activityB = activityMap.get(keyB) || new Date(0);

      return activityB - activityA; // DESC order
    });

    return sortedThreads;
  } catch (error) {
    console.error("sortThreadsByLatestActivity error =>", error);
    return threads; // Return original threads if sorting fails
  }
}

async function addBulkUserEntries(entries) {
  try {
    if (!entries || entries.length === 0) return { success: true, message: "No entries to add" };

    // Map entries to match the database schema if necessary
    // Assuming user_bridge_config_history model exists in models.pg
    const result = await models.pg.user_bridge_config_history.bulkCreate(entries);

    return { success: true, result };
  } catch (error) {
    console.error("Error adding bulk user entries:", error);
    return { success: false, message: "Error adding bulk user entries" };
  }
}

export default {
  findMessageByMessageId,
  deleteLastThread,
  storeSystemPrompt,
  findMessage,
  findThreadsForFineTune,
  system_prompt_data,
  updateMessage,
  updateStatus,
  create,
  addThreadId,
  findThreadMessage,
  getSubThreads,
  getUserUpdates,
  sortThreadsByHits,
  getSubThreadsByError,
  sortThreadsByLatestActivity,
  addBulkUserEntries
};
