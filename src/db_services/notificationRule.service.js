import NotificationRuleModel from "../mongoModel/NotificationRule.model.js";
import { deleteInCache, findInCache, storeInCache } from "../cache_service/index.js";
import { INTERNAL_ORG_ID } from "../configs/notificationEvents.js";

const RULES_CACHE_TTL = 300; // seconds; also cleared on every rule change
const rulesCacheKey = (org_id) => `notification_rules_${org_id}`;

async function getEnabledRules(org_id) {
  const cached = await findInCache(rulesCacheKey(org_id));
  if (cached) return JSON.parse(cached);
  const rules = await NotificationRuleModel.find({ org_id, enabled: true }).lean();
  await storeInCache(rulesCacheKey(org_id), rules, RULES_CACHE_TTL);
  return rules;
}

// Rules that can match an event from this org: the org's own plus GTWY's internal rules.
async function getRulesForOrg(org_id) {
  const [orgRules, internalRules] = await Promise.all([org_id ? getEnabledRules(org_id) : [], getEnabledRules(INTERNAL_ORG_ID)]);
  return [...orgRules, ...internalRules];
}

async function invalidateRules(org_id) {
  await deleteInCache(rulesCacheKey(org_id));
}

async function createRule(rule) {
  const created = await new NotificationRuleModel(rule).save();
  await invalidateRules(rule.org_id);
  return created;
}

async function listRules(org_id) {
  return await NotificationRuleModel.find({ org_id }).sort({ createdAt: -1 });
}

async function getRule(org_id, id) {
  return await NotificationRuleModel.findOne({ _id: id, org_id });
}

async function updateRule(org_id, id, updates) {
  const rule = await NotificationRuleModel.findOneAndUpdate({ _id: id, org_id }, { $set: updates }, { new: true, runValidators: true });
  await invalidateRules(org_id);
  return rule;
}

async function deleteRule(org_id, id) {
  const rule = await NotificationRuleModel.findOneAndDelete({ _id: id, org_id });
  await invalidateRules(org_id);
  return rule;
}

// A deleted channel must stop being referenced by the org's rules.
async function removeChannelFromRules(org_id, channel_id) {
  await NotificationRuleModel.updateMany({ org_id, channel_ids: channel_id }, { $pull: { channel_ids: channel_id } });
  await invalidateRules(org_id);
}

export default {
  getRulesForOrg,
  invalidateRules,
  createRule,
  listRules,
  getRule,
  updateRule,
  deleteRule,
  removeChannelFromRules
};
