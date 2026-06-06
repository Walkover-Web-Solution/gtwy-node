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

export default {
  createLog,
  getLogsByLogId
};
