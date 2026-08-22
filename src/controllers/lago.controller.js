import { ensureOrgSubscribed, getWallet, syncWalletBalanceToRedis, topupWallet } from "../services/lago.service.js";

const provisionOrg = async (req, res, next) => {
  const org_id = req.body.org_id;

  const result = await ensureOrgSubscribed(String(org_id));

  res.locals = {
    success: true,
    message: "Customer and subscription created successfully",
    data: result
  };
  req.statusCode = 200;
  return next();
};

// Read an org's wallet balance for the settings UI.
const getWalletBalance = async (req, res, next) => {
  const org_id = req.params.org_id;
  const wallet = await getWallet(String(org_id));
  res.locals = {
    success: true,
    message: wallet ? "wallet found" : "no wallet provisioned yet",
    data: wallet
  };
  req.statusCode = 200;
  return next();
};

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

export default { provisionOrg, getWalletBalance, topupOrgWallet, syncWalletBalance };
