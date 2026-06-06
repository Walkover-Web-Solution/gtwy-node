import observabilityService from "../db_services/observability.service.js";
import logger from "../logger.js";

const createLog = async (req, res, next) => {
  try {
    const { log_id, data } = req.body;

    const result = await observabilityService.createLog({ log_id, data });

    res.locals = { success: true, unique_id: result.unique_id, log_id: result.log_id };
    req.statusCode = 201;
    return next();
  } catch (error) {
    logger.error(`Error creating observability log: ${error.message}`);
    res.locals = { success: false, error: error.message };
    req.statusCode = 500;
    return next();
  }
};

const getLogs = async (req, res, next) => {
  try {
    const { log_id } = req.params;

    const logs = await observabilityService.getLogsByLogId(log_id);

    res.locals = { success: true, log_id, count: logs.length, logs };
    req.statusCode = 200;
    return next();
  } catch (error) {
    logger.error(`Error fetching observability logs: ${error.message}`);
    res.locals = { success: false, error: error.message };
    req.statusCode = 500;
    return next();
  }
};

// GET / — returns all logs (paginated). Pass ?log_id=... to filter to one log id.
const listLogs = async (req, res, next) => {
  try {
    const { log_id, page, pageSize } = req.query;

    const { total, rows } = await observabilityService.getLogs({ log_id, page, pageSize });

    res.locals = {
      success: true,
      ...(log_id ? { log_id } : {}),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      count: rows.length,
      logs: rows
    };
    req.statusCode = 200;
    return next();
  } catch (error) {
    logger.error(`Error listing observability logs: ${error.message}`);
    res.locals = { success: false, error: error.message };
    req.statusCode = 500;
    return next();
  }
};

export default {
  createLog,
  getLogs,
  listLogs
};
