import { startAnalyticsStream } from "../services/analytics/analyticsStream.service.js";

/**
 * POST /api/analytics/:agent_id
 *
 * Returns immediately (202) with the RTLayer channel, then streams the dashboard
 * data to that channel in small JSON chunks via a fire-and-forget background task.
 */
const getAgentAnalytics = async (req, res, next) => {
  const org_id = req.profile.org.id;
  const { agent_id } = req.params;
  const { time_range, start_date, end_date, tools, latency, model, service, variables, reviewer_failures, error_history, keyword } = req.body || {};

  // Deterministic channel per org+agent — the client subscribes to this same id.
  const channel = `${org_id}_${agent_id}`;

  const filters = { time_range, start_date, end_date, tools, latency, model, service, variables, reviewer_failures, error_history, keyword };

  // Fire-and-forget — do NOT await; the response goes out first.
  startAnalyticsStream({ org_id, agent_id, channel, filters });

  res.locals = { success: true, message: "Analytics generation started", channel };
  req.statusCode = 202;
  return next();
};

export default { getAgentAnalytics };
