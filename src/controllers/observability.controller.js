import observabilityService from "../db_services/observability.service.js";
import { findMatchedKeyPaths } from "../utils/observabilitySearch.utils.js";
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

// GET /:log_id — all logs for a log id. Optional ?search= matches JSON key names
// (any depth, case-insensitive substring) and adds matched_paths to each hit.
// Supplying any of search/page/pageSize opts into pagination; a bare call keeps
// the legacy unpaginated response shape.
const getLogs = async (req, res, next) => {
  try {
    const { log_id } = req.params;
    const { search, page: rawPage, pageSize: rawPageSize } = req.query;
    const paginated = search !== undefined || rawPage !== undefined || rawPageSize !== undefined;

    if (!paginated) {
      const logs = await observabilityService.getLogsByLogId(log_id);

      res.locals = { success: true, log_id, count: logs.length, logs };
      req.statusCode = 200;
      return next();
    }

    const page = rawPage ?? 1;
    const pageSize = rawPageSize ?? 50;
    const { total, rows } = await observabilityService.getLogsByLogIdPaginated({ log_id, search, page, pageSize });

    let logs = rows;
    if (search) {
      const termLower = search.toLowerCase();
      logs = rows.map((row) => ({ ...row, matched_paths: findMatchedKeyPaths(row.data, termLower) }));
    }

    res.locals = {
      success: true,
      log_id,
      ...(search ? { search } : {}),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      count: logs.length,
      logs
    };
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
