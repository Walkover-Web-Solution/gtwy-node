import { get_latency_report_data } from "../db_services/report.service.js";
import { getallOrgs } from "../utils/proxy.utils.js";
import { getHistoryByMessageId } from "../db_services/history.service.js";

async function getMonthlyreports(req, res, next) {
  const orgResp = await getallOrgs();
  let orgIds = [];
  if (Array.isArray(orgResp?.data?.data)) {
    orgIds = orgResp.data.data.map((org) => String(org.id));
  }
  const data = await get_latency_report_data(orgIds, "monthly");
  if (res) {
    res.locals = { data, success: true };
    req.statusCode = 200;
    return next();
  }
  return data;
}

async function getWeeklyreports(req, res, next) {
  const orgResp = await getallOrgs();
  let orgIds = [];
  if (Array.isArray(orgResp?.data?.data)) {
    orgIds = orgResp.data.data.map((org) => String(org.id));
  }
  const data = await get_latency_report_data(orgIds, "weekly");
  if (res) {
    res.locals = { data, success: true };
    req.statusCode = 200;
    return next();
  }
  return data;
}

async function getMessageData(req, res, next) {
  const { message_id } = req.body;

  const data = await getHistoryByMessageId(message_id);
  res.locals = { data, success: true };
  req.statusCode = 200;
  return next();
}

export { getWeeklyreports, getMonthlyreports, getMessageData };
