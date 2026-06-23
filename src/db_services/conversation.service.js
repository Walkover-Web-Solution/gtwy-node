import models from "../../models/index.js";
import Sequelize from "sequelize";
import { findInCache, storeInCache } from "../cache_service/index.js";
import { getUsers } from "../services/proxy.service.js";
import { buildConversationFilterSql } from "./conversationFilters.util.js";

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

/**
 * Single-query sub-thread listing: distinct sub-threads of a thread with their
 * display name (COALESCE over conversation_logs.display_name, falling back to
 * sub_thread_id) ordered by latest activity. Replaces the old Mongo `threads`
 * lookup + separate PG activity-sort queries.
 */
async function getSubThreadsWithActivity(org_id, thread_id, bridge_id, { version_id, isError } = {}) {
  try {
    const whereClause = { org_id, thread_id, bridge_id };

    if (version_id) {
      whereClause.version_id = version_id;
    }

    if (isError) {
      whereClause.error = {
        [models.pg.Sequelize.Op.and]: [{ [models.pg.Sequelize.Op.ne]: "" }, { [models.pg.Sequelize.Op.ne]: null }]
      };
    }

    const result = await models.pg.conversation_logs.findAll({
      attributes: [
        "thread_id",
        "sub_thread_id",
        [
          models.pg.Sequelize.fn(
            "COALESCE",
            models.pg.Sequelize.fn("MAX", models.pg.Sequelize.col("display_name")),
            models.pg.Sequelize.col("sub_thread_id")
          ),
          "display_name"
        ],
        [models.pg.Sequelize.fn("MAX", models.pg.Sequelize.col("created_at")), "updated_at"]
      ],
      where: whereClause,
      group: ["thread_id", "sub_thread_id"],
      order: [[models.pg.Sequelize.fn("MAX", models.pg.Sequelize.col("created_at")), "DESC"]],
      raw: true
    });

    return result;
  } catch (error) {
    console.error("getSubThreadsWithActivity error =>", error);
    return [];
  }
}

/**
 * Bridge-wide sibling of getSubThreadsWithActivity: all distinct (thread_id,
 * sub_thread_id) pairs for a bridge with their display name and latest activity,
 * ordered most-recently-active first. Single PG query — threads now live in
 * conversation_logs, so no Mongo lookup is needed.
 */
async function getBridgeSubThreadsWithActivity(org_id, bridge_id, filters = {}, { limit, offset } = {}) {
  try {
    const whereClause = { org_id, bridge_id };

    // All optional filters (model / feedback / tool / error / version / testcase /
    // keyword / filter_by incl. variables present + absent) are built by the
    // shared SQL-expression builder so analytics threads and aggregations stay
    // in lock-step. When nothing applies, behaviour is unchanged.
    const expr = buildConversationFilterSql(filters);
    if (expr) {
      whereClause[models.pg.Sequelize.Op.and] = [models.pg.Sequelize.literal(expr)];
    }

    const result = await models.pg.conversation_logs.findAll({
      attributes: [
        "thread_id",
        "sub_thread_id",
        [
          models.pg.Sequelize.fn(
            "COALESCE",
            models.pg.Sequelize.fn("MAX", models.pg.Sequelize.col("display_name")),
            models.pg.Sequelize.col("sub_thread_id")
          ),
          "display_name"
        ],
        [models.pg.Sequelize.fn("MAX", models.pg.Sequelize.col("created_at")), "updated_at"]
      ],
      where: whereClause,
      group: ["thread_id", "sub_thread_id"],
      order: [[models.pg.Sequelize.fn("MAX", models.pg.Sequelize.col("created_at")), "DESC"]],
      // LIMIT/OFFSET apply after the GROUP BY, i.e. to the distinct sub-thread rows.
      ...(limit != null ? { limit } : {}),
      ...(offset != null ? { offset } : {}),
      raw: true
    });

    return result;
  } catch (error) {
    console.error("getBridgeSubThreadsWithActivity error =>", error);
    return [];
  }
}

/**
 * Total number of distinct (thread_id, sub_thread_id) groups for a bridge, with
 * the SAME filters as getBridgeSubThreadsWithActivity. Used for pagination
 * metadata. Raw SQL because Sequelize count() is unreliable with GROUP BY.
 */
async function getBridgeSubThreadsCount(org_id, bridge_id, filters = {}) {
  try {
    const expr = buildConversationFilterSql(filters);
    const filterClause = expr ? ` AND (${expr})` : "";
    const rows = await models.pg.sequelize.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT 1 FROM conversation_logs
         WHERE org_id = :org_id AND bridge_id = :bridge_id ${filterClause}
         GROUP BY thread_id, sub_thread_id
       ) s`,
      { type: models.pg.Sequelize.QueryTypes.SELECT, replacements: { org_id, bridge_id } }
    );
    return rows[0]?.total || 0;
  } catch (error) {
    console.error("getBridgeSubThreadsCount error =>", error);
    return 0;
  }
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
        attributes: ["id", "user_id", "org_id", "bridge_id", "type", "time", "version_id", "previous_value", "current_value"],
        order: [["time", "DESC"]],
        offset: offset,
        limit: pageSize
      });

      if (history.length === 0) {
        return { success: false, message: "No updates found" };
      }

      const updatedHistory = history?.map((entry) => {
        const user = Array.isArray(userData) ? userData.find((user) => user?.id === entry?.dataValues?.user_id) : null;
        const dataValues = { ...entry?.dataValues, user_name: user ? user?.name : "Unknown" };

        if (dataValues.type === "Version published" && dataValues.current_value?.snapshot) {
          const snapshot = { ...dataValues.current_value.snapshot };
          for (const key of Object.keys(snapshot)) {
            const snapshotEntry = snapshot[key];
            if (!snapshotEntry?.user_id) continue;
            const snapshotUser = Array.isArray(userData) ? userData.find((item) => item?.id === snapshotEntry.user_id) : null;
            snapshot[key] = {
              ...snapshotEntry,
              user_name: snapshotUser ? snapshotUser.name : "Unknown"
            };
          }
          dataValues.current_value = {
            ...dataValues.current_value,
            snapshot
          };
        }

        return dataValues;
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

async function getLatestHistoryEntriesByTypes(org_id, version_id, types = []) {
  try {
    if (!org_id || !version_id || !Array.isArray(types) || types.length === 0) {
      return [];
    }

    const rows = await models.pg.sequelize.query(
      `
        SELECT DISTINCT ON (type)
          id,
          user_id,
          type,
          time,
          previous_value,
          current_value
        FROM user_bridge_config_history
        WHERE org_id = :org_id
          AND version_id = :version_id
          AND type IN (:types)
        ORDER BY type, time DESC
      `,
      {
        replacements: { org_id, version_id, types },
        type: models.pg.sequelize.QueryTypes.SELECT
      }
    );

    return rows;
  } catch (error) {
    console.error("Error fetching latest history entries by types:", error);
    return [];
  }
}

async function getDraftHistoryForPublish(org_id, bridge_id, version_id) {
  try {
    if (!org_id || !bridge_id || !version_id) return [];

    const lastPublish = await models.pg.user_bridge_config_history.findOne({
      where: { org_id, bridge_id, type: "Version published" },
      order: [["time", "DESC"]],
      attributes: ["time"],
      raw: true
    });

    const replacements = { org_id, version_id };
    let timeClause = "";
    if (lastPublish?.time) {
      timeClause = "AND time > :afterTime";
      replacements.afterTime = lastPublish.time;
    }

    return await models.pg.sequelize.query(
      `
        SELECT DISTINCT ON (type)
          id,
          user_id,
          type,
          time,
          previous_value,
          current_value
        FROM user_bridge_config_history
        WHERE org_id = :org_id
          AND version_id = :version_id
          AND type NOT IN ('Version published', 'Version created', 'Agent created', 'configuration', 'agent_update')
          ${timeClause}
        ORDER BY type, time DESC
      `,
      {
        replacements,
        type: models.pg.sequelize.QueryTypes.SELECT
      }
    );
  } catch (error) {
    console.error("Error fetching draft history for publish:", error);
    return [];
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
  getSubThreadsWithActivity,
  getBridgeSubThreadsWithActivity,
  getBridgeSubThreadsCount,
  getUserUpdates,
  addBulkUserEntries,
  getLatestHistoryEntriesByTypes,
  getDraftHistoryForPublish
};
