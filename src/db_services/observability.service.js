import Sequelize from "sequelize";
import models from "../../models/index.js";
import { buildKeySearchJsonpath } from "../utils/observabilitySearch.utils.js";

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

// Paginated variant of getLogsByLogId. When `search` is provided, only rows whose
// JSON contains a key name (at any depth) matching it as a case-insensitive
// substring are returned — values are not searched.
async function getLogsByLogIdPaginated({ log_id, search, page = 1, pageSize = 50 }) {
  const where = { log_id };

  if (search) {
    where[Sequelize.Op.and] = Sequelize.where(
      Sequelize.fn(
        "jsonb_path_exists",
        Sequelize.col("data"),
        Sequelize.cast(buildKeySearchJsonpath(search), "jsonpath"),
        Sequelize.cast("{}", "jsonb"),
        true // silent: malformed structures evaluate to false instead of throwing
      ),
      Sequelize.Op.eq,
      true
    );
  }

  const { count, rows } = await models.pg.observability_logs.findAndCountAll({
    where,
    order: [["created_at", "ASC"]],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    raw: true
  });

  return { total: count, rows };
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
  getLogsByLogIdPaginated,
  getLogs
};
