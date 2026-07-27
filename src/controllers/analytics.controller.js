import mongoose from "mongoose";
import analyticsService from "../db_services/analytics.service.js";
import embedAnalyticsService from "../db_services/embedAnalytics.service.js";
import { findRecentThreadsByBridgeId } from "../db_services/history.service.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import folderService from "../db_services/folder.service.js";
import { getProxyDetails } from "../services/proxy.service.js";
import { findInCache, storeInCache } from "../cache_service/index.js";
import logger from "../logger.js";

// GET /api/analytics/agent/:bridge_id?range=7
// Returns the agent's sub-threads (from Postgres conversation_logs) in the
// response, and fires the heavy PG analytics aggregation in the background —
// that result (summary + two charts) is pushed over the RT layer to `channel`.
const getAgentAnalytics = async (req, res, next) => {
  try {
    const { bridge_id } = req.params;
    const org_id = req.profile?.org?.id;
    const {
      range,
      start_date,
      end_date,
      interval,
      tool_id,
      model,
      service,
      agent_id,
      knowledgebase_id,
      user_feedback,
      error,
      review_failed,
      version_id,
      testcase_id,
      keyword,
      message_id,
      filter_by
    } = req.query;
    // RT channel is always org_id + "_" + bridge_id.
    const channel = `${org_id}_${bridge_id}`;

    const window = analyticsService.computeWindow({ range, start_date, end_date, interval });

    // Normalize a multi-value query param to an array. Supports both comma-separated
    // (tool_id=a,b) and array brackets (tool_id[]=a&tool_id[]=b). Empty -> undefined.
    const toFilterArray = (v) => {
      if (v == null) return undefined;
      const arr = (Array.isArray(v) ? v : String(v).split(",")).map((s) => String(s).trim()).filter(Boolean);
      return arr.length ? arr : undefined;
    };

    // Optional filters: when omitted the API behaves exactly as before. Mirrors
    // the full threads-API filter set so the dashboard can slice the same way.
    // tool_id / model / service are multi-select (match ANY).
    // user_feedback: good->1 (thumbs up), bad->2 (thumbs down), all/undefined-> no filter.
    const feedbackMap = { good: 1, bad: 2 };
    const filters = {
      tool_id: toFilterArray(tool_id),
      model: toFilterArray(model),
      service: toFilterArray(service),
      agent_id: toFilterArray(agent_id),
      knowledgebase_id: toFilterArray(knowledgebase_id),
      user_feedback: feedbackMap[user_feedback],
      error: error || undefined,
      review_failed: review_failed || undefined,
      version_id: version_id || undefined,
      testcase_id: testcase_id || undefined,
      keyword: keyword || undefined,
      filter_by: filter_by && typeof filter_by === "object" ? filter_by : undefined
    };

    // Pagination: page 1 runs the full analytics + total count; page 2+ returns
    // only that page of threads (cheap navigation — no RT push, no count query).
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const page_size = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 20));

    // Analytics aggregations (summary + 2 charts over RT) run ONLY when explicitly
    // requested via `analytics=true`, and only on page 1. Orthogonal to the
    // response format below. Uses the same filters so the RT payload reflects them.
    const runAnalytics = req.query.analytics === true || req.query.analytics === "true";

    // The new threads-search response shape ({ data, total_user_feedback_count })
    // is used whenever ANY facet/search filter is present. The time window
    // (range/start/end/interval) does NOT count. With no filters we keep the
    // current { threads, pagination, ... } shape.
    const hasMessageId = typeof message_id === "string" && message_id.trim().length > 0;

    if (runAnalytics && page === 1) {
      analyticsService
        .runAndPush({ bridge_id, org_id, channel, window, filters })
        .catch((err) => logger.error(`analytics runAndPush failed for ${bridge_id}: ${err.message}`));
    }
    const baseFilterBy = filters.filter_by ? { ...filters.filter_by } : undefined;
    const mergedFilterBy = hasMessageId ? { ...(baseFilterBy || {}), message_id: message_id.trim() } : baseFilterBy;
    const searchFilters = {
      keyword: filters.keyword,
      filter_by: mergedFilterBy,
      time_range: start_date || end_date ? { start: start_date, end: end_date } : undefined,
      tool_id: filters.tool_id,
      model: filters.model,
      service: filters.service,
      agent_id: filters.agent_id,
      knowledgebase_id: filters.knowledgebase_id,
      review_failed: filters.review_failed
    };
    const ufForSearch = filters.user_feedback || "all";

    const result = await findRecentThreadsByBridgeId(
      org_id,
      bridge_id,
      searchFilters,
      ufForSearch,
      error || "false",
      page,
      page_size,
      version_id || null,
      testcase_id || null
    );

    res.locals = result.success
      ? {
          success: true,
          data: result.data,
          total_user_feedback_count: result.total_user_feedback_count,
          ...(runAnalytics ? { channel } : {})
        }
      : { success: false, message: result.message };
    req.statusCode = result.success ? 200 : 500;
    return next();
  } catch (error) {
    logger.error(`Error starting agent analytics: ${error.message}`);
    res.locals = { success: false, error: error.message };
    req.statusCode = 500;
    return next();
  }
};

// GET /api/analytics/agent/:bridge_id/filters
// Returns the distinct tools (name -> id) and models (grouped by service) ever
// used by the bridge, so the frontend can populate the filter dropdowns.
const getAgentAnalyticsFilters = async (req, res, next) => {
  try {
    const { bridge_id } = req.params;
    const org_id = req.profile?.org?.id;

    const { tools_data, knowledgebase_data, agent_data, unique_model } = await analyticsService.getFilterOptions({ bridge_id, org_id });

    res.locals = {
      success: true,
      bridge_id,
      tools_data,
      knowledgebase_data,
      agent_data,
      unique_model
    };
    req.statusCode = 200;
    return next();
  } catch (error) {
    logger.error(`Error fetching agent analytics filters: ${error.message}`);
    res.locals = { success: false, error: error.message };
    req.statusCode = 500;
    return next();
  }
};

/** Normalize one proxy user row into our map entry. */
function toUserEntry(user) {
  if (user?.id == null) return null;
  return {
    id: user.id,
    name: user.name || null,
    email: user.email || null,
    meta: user.meta || null
  };
}

/**
 * Resolve org users for embed analytics.
 * 1) Page all company users (including embed guests — no exclude_role_ids)
 * 2) For any still-missing agent owner ids, fetch by user_id
 */
async function loadOrgUserMap(org_id, neededUserIds = []) {
  const needed = [...new Set((neededUserIds || []).map((id) => String(id)).filter(Boolean))];
  const cacheKey = `embed_analytics_users_v2_${org_id}`;
  let userMap = {};

  const cached = await findInCache(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object") userMap = parsed;
    } catch {
      // fall through
    }
  }

  const missingAfterCache = needed.filter((id) => !userMap[id]);
  if (Object.keys(userMap).length > 0 && missingAfterCache.length === 0) {
    return userMap;
  }

  // Full company listing without excluding the proxy/embed role
  let pageNo = 1;
  let hasMore = true;
  while (hasMore) {
    const response = await getProxyDetails({
      company_id: org_id,
      pageNo,
      itemsPerPage: 100
    });
    const page = response?.data;
    const batch = Array.isArray(page?.data) ? page.data : [];
    for (const user of batch) {
      const entry = toUserEntry(user);
      if (entry) userMap[String(entry.id)] = entry;
    }
    const total = Number(page?.totalEntityCount) || 0;
    hasMore = batch.length > 0 && Object.keys(userMap).length < total;
    pageNo += 1;
    if (pageNo > 100) break;
  }

  // Fetch any agent owners still missing (guest users often missing from default lists)
  const stillMissing = needed.filter((id) => !userMap[id]);
  if (stillMissing.length > 0) {
    const chunks = [];
    for (let i = 0; i < stillMissing.length; i += 10) {
      chunks.push(stillMissing.slice(i, i + 10));
    }
    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (userId) => {
          try {
            const response = await getProxyDetails({
              company_id: org_id,
              user_id: userId,
              pageNo: 1,
              itemsPerPage: 1
            });
            const batch = response?.data?.data;
            const user = Array.isArray(batch) ? batch[0] : batch;
            // Some responses return the matched user directly under data
            const entry = toUserEntry(user) || toUserEntry(response?.data);
            if (entry) {
              userMap[String(entry.id)] = entry;
              userMap[String(userId)] = entry;
            }
          } catch (err) {
            logger.warn(`embed analytics: failed to resolve user_id=${userId}: ${err.message}`);
          }
        })
      );
    }
  }

  await storeInCache(cacheKey, userMap, 86400);
  return userMap;
}

// GET /api/analytics/embed/:folder_id
// Embed (folder) analytics: agents in folder → conversation_logs by bridge_id →
// roll up by Configuration.user_id → enrich via proxy users.
const getEmbedAnalytics = async (req, res, next) => {
  try {
    const { folder_id } = req.params;
    const org_id = req.profile?.org?.id;
    const { range, start_date, end_date, interval, user_id: filterUserId } = req.query;

    const folder = await folderService.getFolderData(folder_id);
    if (!folder || String(folder.org_id) !== String(org_id)) {
      res.locals = { success: false, message: "Embed folder not found" };
      req.statusCode = 404;
      return next();
    }
    if (folder.type && folder.type !== "embed" && folder.type !== "rag_embed") {
      res.locals = { success: false, message: "Folder is not an embed integration" };
      req.statusCode = 400;
      return next();
    }

    const window = analyticsService.computeWindow({ range, start_date, end_date, interval });

    const folderIdStr = String(folder_id);
    const folderIdVariants = [folderIdStr];
    if (mongoose.Types.ObjectId.isValid(folderIdStr)) {
      folderIdVariants.push(new mongoose.Types.ObjectId(folderIdStr));
    }

    const orgVariants = [...new Set([String(org_id), org_id].filter((v) => v != null && v !== ""))];
    const orgAsNum = Number(org_id);
    if (!Number.isNaN(orgAsNum) && String(orgAsNum) === String(org_id).trim()) {
      orgVariants.push(orgAsNum);
    }

    const agentQuery = {
      org_id: { $in: orgVariants },
      folder_id: { $in: folderIdVariants }
    };
    if (filterUserId) {
      agentQuery.user_id = String(filterUserId);
    }

    const agentDocs = await configurationModel
      .find(agentQuery)
      .select({
        _id: 1,
        name: 1,
        user_id: 1,
        service: 1,
        versions: 1,
        published_version_id: 1,
        "configuration.model": 1,
        deletedAt: 1
      })
      .lean();

    const agents = (agentDocs || [])
      .filter((a) => !a.deletedAt)
      .map((a) => {
        const version_ids = [];
        if (Array.isArray(a.versions)) {
          for (const v of a.versions) {
            if (v != null) version_ids.push(String(v));
          }
        }
        if (a.published_version_id) version_ids.push(String(a.published_version_id));
        return {
          bridge_id: a._id.toString(),
          name: a.name || "Untitled",
          user_id: a.user_id != null ? String(a.user_id) : null,
          service: a.service || null,
          model: a.configuration?.model || null,
          version_ids: [...new Set(version_ids)]
        };
      });

    logger.info(
      `embed analytics folder=${folderIdStr} org=${org_id} agents=${agents.length} versions=${agents.reduce((n, a) => n + (a.version_ids?.length || 0), 0)} range=${range || "30d"} start=${window.start?.toISOString?.()} end=${window.end?.toISOString?.()}`
    );

    const neededUserIds = agents.map((a) => a.user_id).filter(Boolean);
    const userMap = await loadOrgUserMap(org_id, neededUserIds);

    const result = await embedAnalyticsService.getEmbedAnalytics({
      org_id: String(org_id),
      window,
      agents,
      userMap
    });

    logger.info(
      `embed analytics result folder=${folderIdStr} range_req=${result?.summary?.total_requests} lifetime_req=${result?.meta?.lifetime_requests} cost=${result?.summary?.est_cost} users=${result?.users?.length}`
    );

    res.locals = {
      success: true,
      folder_id,
      range_start: window.start,
      range_end: window.end,
      ...result
    };
    req.statusCode = 200;
    return next();
  } catch (error) {
    logger.error(`Error fetching embed analytics: ${error.message}`);
    res.locals = { success: false, error: error.message };
    req.statusCode = 500;
    return next();
  }
};

export default {
  getAgentAnalytics,
  getAgentAnalyticsFilters,
  getEmbedAnalytics
};
