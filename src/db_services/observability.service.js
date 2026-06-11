import Sequelize from "sequelize";
import models from "../../models/index.js";
import {
  buildKeySearchJsonpath,
  buildKeyOnlySearchJsonpath,
  buildValueOnlySearchJsonpath,
  buildKeyValueSearchJsonpath
} from "../utils/observabilitySearch.utils.js";

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

async function getLogsByLogIdPaginated({ log_id, search, page = 1, pageSize = 50 }) {
  const where = { log_id };

  if (search) {
    let jsonpath;
    if (typeof search === "object") {
      const [key, value] = Object.entries(search)[0];
      const hasKey = key.trim() !== "";
      const hasValue = value !== null && value !== undefined && String(value).trim() !== "";
      if (hasKey && hasValue) {
        jsonpath = buildKeyValueSearchJsonpath(key, String(value));
      } else if (hasKey) {
        jsonpath = buildKeyOnlySearchJsonpath(key);
      } else {
        jsonpath = buildValueOnlySearchJsonpath(String(value));
      }
    } else {
      jsonpath = buildKeySearchJsonpath(search);
    }
    where[Sequelize.Op.and] = Sequelize.where(
      Sequelize.fn("jsonb_path_exists", Sequelize.col("data"), Sequelize.cast(jsonpath, "jsonpath"), Sequelize.cast("{}", "jsonb"), true),
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

// Paginated listing. `search` does a case-insensitive substring match on log_id;
// `log_id` does an exact match. Newest first.
async function getLogs({ log_id, search, page = 1, pageSize = 50 }) {
  const where = {};
  if (log_id) where.log_id = log_id;
  if (search) where.log_id = { [Sequelize.Op.iLike]: `%${search}%` };
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
