import {
  changeOrgPlan,
  ensureOrgSubscribed,
  getOrgPlanSlug,
  getWalletCached,
  reconcileOrgPlan,
  syncWalletBalanceToRedis,
  topupWallet
} from "../services/lago.service.js";
import billingPlanService from "../db_services/billingPlan.service.js";
import { replayFailedDebits } from "../services/logQueue/billingDebit.service.js";

const SUPPORTED_EVENTS = ["create_company", "register_company_and_user"];

// MSG91 signup webhook: provisions Lago for every new org.
const provisionWebhook = async (req, res, next) => {
  const expectedToken = process.env.LAGO_PROVISION_WEBHOOK_TOKEN;
  if (expectedToken && req.get("x-webhook-token") !== expectedToken) {
    req.statusCode = 403;
    res.locals = { success: false, message: "invalid webhook token" };
    return next();
  }

  const { event, data } = req.body;

  if (!SUPPORTED_EVENTS.includes(event)) {
    req.statusCode = 400;
    res.locals = { success: false, message: "unsupported event" };
    return next();
  }

  const org_id = data?.company?.id;

  if (!org_id) {
    req.statusCode = 400;
    res.locals = { success: false, message: "org_id not found" };
    return next();
  }

  const result = await ensureOrgSubscribed(String(org_id));

  res.locals = {
    success: true,
    message: "Customer, subscription and wallet provisioned",
    data: result
  };
  req.statusCode = 200;
  return next();
};

// Admin/manual provisioning of one org.
const provisionOrg = async (req, res, next) => {
  const org_id = req.body.org_id;

  const result = await ensureOrgSubscribed(String(org_id));

  res.locals = {
    success: true,
    message: "Customer, subscription and wallet provisioned",
    data: result
  };
  req.statusCode = 200;
  return next();
};

// The caller's own wallet balance, served from Redis and fetched from Lago only on a miss.
const getWalletBalance = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  if (!org_id) {
    req.statusCode = 403;
    res.locals = { success: false, message: "org not resolved from token" };
    return next();
  }
  const wallet = await getWalletCached(String(org_id));
  res.locals = {
    success: true,
    message: wallet ? "wallet found" : "no wallet provisioned yet",
    data: wallet
  };
  req.statusCode = 200;
  return next();
};

// Credit a paid top-up to an org's wallet.
const topupOrgWallet = async (req, res, next) => {
  const { org_id, credits, reference_id, metadata } = req.body;

  const result = await topupWallet(String(org_id), credits, { reference_id, metadata });

  res.locals = {
    success: true,
    message: result.duplicate ? "top-up already applied for this reference_id" : "wallet topped up successfully",
    data: {
      org_id: String(org_id),
      credits_added: result.duplicate ? "0" : String(credits),
      credits_balance: result.credits_balance,
      duplicate: result.duplicate,
      transaction: result.transaction ?? null
    }
  };
  req.statusCode = 200;
  return next();
};

// Refresh the org's shadow balance in Redis from Lago.
const syncWalletBalance = async (req, res, next) => {
  const org_id = req.params.org_id;
  const balance = await syncWalletBalanceToRedis(String(org_id));

  res.locals = {
    success: true,
    message: balance === null ? "no wallet provisioned yet" : "balance synced to redis",
    data: { org_id: String(org_id), credits_balance: balance }
  };
  req.statusCode = 200;
  return next();
};

// Re-post debits that failed against Lago.
const replayDebits = async (req, res, next) => {
  const result = await replayFailedDebits(req.body?.limit ?? 100);
  res.locals = { success: true, message: "replay finished", data: result };
  req.statusCode = 200;
  return next();
};

// Move an org between plans.
const setOrgPlan = async (req, res, next) => {
  const { org_id, plan, reason } = req.body;
  const result = await changeOrgPlan(String(org_id), plan, {
    actor: req.profile?.user?.email || "",
    reason: reason || ""
  });

  res.locals = {
    success: true,
    message: result.changed ? `org moved to '${result.plan}'` : `org already on '${result.plan}'`,
    data: { org_id: String(org_id), ...result }
  };
  req.statusCode = 200;
  return next();
};

// Drift check between the org's Lago plan and the Redis cache.
const getOrgPlan = async (req, res, next) => {
  const report = await reconcileOrgPlan(String(req.params.org_id));
  res.locals = {
    success: true,
    message: report.drift ? "PLAN DRIFT — Lago and Redis disagree" : "in sync",
    data: report
  };
  req.statusCode = 200;
  return next();
};

// The caller's own plan and its display name, for the UI.
const getMyPlan = async (req, res, next) => {
  const org_id = String(req.profile?.org?.id || req.org_id || "");
  const slug = await getOrgPlanSlug(org_id);
  const definition = await billingPlanService.getPlan(slug);

  res.locals = {
    success: true,
    data: { plan: slug, label: definition?.display_name || slug }
  };
  req.statusCode = 200;
  return next();
};

export default {
  provisionWebhook,
  provisionOrg,
  getWalletBalance,
  topupOrgWallet,
  syncWalletBalance,
  replayDebits,
  setOrgPlan,
  getOrgPlan,
  getMyPlan
};
