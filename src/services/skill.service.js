import axios from "axios";

import logger from "../logger.js";
import ApiError from "../utils/ApiError.js";
import Helper from "./utils/helper.utils.js";
import ConfigurationServices from "../db_services/configuration.service.js";
import { deleteInCache } from "../cache_service/index.js";
import { redis_keys } from "../configs/constant.js";

// Skills are stored upstream; we only keep a reference in connected_tools.
const SKILL_API_URL = process.env.SKILL_API_URL || "https://mcp.viasocket.com/api/skill";

// axios has no default timeout, so a hung upstream would hang the request forever.
const SKILL_API_TIMEOUT_MS = Number(process.env.SKILL_API_TIMEOUT_MS || 10000);

// The only place a skill service token is signed.
const createToken = ({ userId, orgId }) => {
  if (!process.env.MCP_JWT_SECRET) {
    logger.error("MCP_JWT_SECRET is not configured; cannot sign a skill service token");
    throw new ApiError(500, "Skills are not configured on this server");
  }
  return Helper.generate_token({ userId, orgId }, process.env.MCP_JWT_SECRET);
};

const requestOptions = (auth) => ({
  headers: {
    Authorization: `Bearer ${createToken(auth)}`,
    "Content-Type": "application/json"
  },
  timeout: SKILL_API_TIMEOUT_MS
});

// Upstream uses the same {success, message, data} envelope we do - flatten it so we don't nest two.
const unwrapData = (body) => (body && typeof body === "object" && !Array.isArray(body) && "data" in body ? body.data : body);

// Turn an upstream failure into an ApiError that keeps the real status code.
const callSkillApi = async (action, fn) => {
  try {
    const response = await fn();
    return unwrapData(response?.data);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const status = error?.response?.status;
    const body = error?.response?.data;
    logger.error(`skill api ${action} failed: status=${status || "none"} body=${JSON.stringify(body || error.message)}`);
    throw new ApiError(status || 502, `Skill service ${action} failed: ${body?.message || body?.error || error.message}`);
  }
};

// Upstream accepts only name/description/content, so drop the org_id and created_by the UI sends.
const pickSkillFields = ({ name, description, content }) => {
  const payload = {};
  if (name !== undefined) payload.name = name;
  if (description !== undefined) payload.description = description;
  if (content !== undefined) payload.content = content;
  return payload;
};

// gtwy-ai caches the org's skill list and each skill's content and cannot know when
// one changes, so clear both here. Otherwise edits wait out the TTL.
const clearSkillCache = async (orgId, skillId) => {
  const keys = [`${redis_keys.org_skills_}${orgId}`];
  if (skillId) keys.push(`${redis_keys.skill_content_}${skillId}`);
  await deleteInCache(keys);
};

export const listSkills = async (auth) => callSkillApi("list", () => axios.get(SKILL_API_URL, requestOptions(auth)));

export const getSkill = async (skillId, auth) => callSkillApi("get", () => axios.get(`${SKILL_API_URL}/${skillId}`, requestOptions(auth)));

export const createSkill = async (body, auth) => {
  const skill = await callSkillApi("create", () => axios.post(SKILL_API_URL, pickSkillFields(body), requestOptions(auth)));
  await clearSkillCache(auth.orgId);
  return skill;
};

export const updateSkill = async (skillId, body, auth) => {
  const skill = await callSkillApi("update", () => axios.put(`${SKILL_API_URL}/${skillId}`, pickSkillFields(body), requestOptions(auth)));
  await clearSkillCache(auth.orgId, skillId);
  return skill;
};

// Upstream only unlinks from MCP servers, so detach from our agents too.
// Refuse to delete a skill any agent still uses, so nobody silently loses a
// capability an agent depends on. Detaching is done on the agent's Connectors tab.
const assertSkillUnused = async (skillId, orgId) => {
  const agents = await ConfigurationServices.findAgentsUsingSkill(orgId, skillId);
  if (!agents.length) return;

  const shown = agents.slice(0, 5).map((agent) => agent.name);
  const rest = agents.length - shown.length;
  const names = rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
  const error = new ApiError(
    409,
    `This skill is still used by ${agents.length} agent${agents.length > 1 ? "s" : ""} (${names}). Detach it from ${agents.length > 1 ? "each" : "that agent"} before deleting.`
  );
  error.data = { agents };
  throw error;
};

export const deleteSkill = async (skillId, auth) => {
  //check for - is this skill is attached in any agent if yes then show alert to user for detaching it there first
  await assertSkillUnused(skillId, auth.orgId);

  const result = await callSkillApi("delete", () => axios.delete(`${SKILL_API_URL}/${skillId}`, requestOptions(auth)));

  await clearSkillCache(auth.orgId, skillId);
  logger.info(`skill ${skillId} deleted for org ${auth.orgId}`);

  return result;
};

export default { listSkills, getSkill, createSkill, updateSkill, deleteSkill };
