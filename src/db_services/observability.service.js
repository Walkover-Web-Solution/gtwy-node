import models from "../../models/index.js";

async function createLog({ log_id, data }) {
  return await models.pg.observability_logs.create({ log_id, data });
}

async function getLogsByLogId(log_id) {
  return await models.pg.observability_logs.findAll({
    where: { log_id },
    order: [["created_at", "ASC"]],
    raw: true
  });
}

// Paginated listing. When `log_id` is provided, results are filtered to that id;
// otherwise all logs are returned. Newest first.
async function getLogs({ log_id, page = 1, pageSize = 50 }) {
  const where = log_id ? { log_id } : undefined;
  const offset = (page - 1) * pageSize;

  const { count, rows } = await models.pg.observability_logs.findAndCountAll({
    where,
    order: [["created_at", "DESC"]],
    limit: pageSize,
    offset,
    raw: true
  });

  return { total: count, rows };
}

export default {
  createLog,
  getLogsByLogId,
  getLogs
};
