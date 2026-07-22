import { ensureOrgSubscribed, getWallet } from "../services/lago.service.js";
import { processTopup, verifyWebhookSignature } from "../services/walletTopup.service.js";

const SUPPORTED_EVENTS = ["create_company", "register_company_and_user"];

const provisionOrg = async (req, res, next) => {
  const { event, data } = req.body;

  if (!SUPPORTED_EVENTS.includes(event)) {
    req.statusCode = 400;
    res.locals = { success: false, message: "org_id not found" };
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
    message: "Customer and subscription created successfully",
    data: result
  };
  req.statusCode = 200;
  return next();
};

// Read an org's wallet balance for the settings UI.
const getWalletBalance = async (req, res, next) => {
  const org_id = req.params.org_id;
  if (!org_id) {
    req.statusCode = 400;
    res.locals = { success: false, message: "org_id required" };
    return next();
  }
  const wallet = await getWallet(String(org_id));
  res.locals = {
    success: true,
    message: wallet ? "wallet found" : "no wallet provisioned yet",
    data: wallet
  };
  req.statusCode = 200;
  return next();
};

// Payment-gateway webhook -> wallet top-up (doc §6). Signature verification is
// mandatory and fails closed (doc §7.8).
const walletTopupWebhook = async (req, res, next) => {
  const signature = req.headers["x-payment-signature"] || req.headers["stripe-signature"] || req.headers["x-razorpay-signature"];

  let verified;
  try {
    verified = verifyWebhookSignature(req.rawBody, signature);
  } catch (err) {
    // Secret not configured — refuse to trust anything.
    req.statusCode = 500;
    res.locals = { success: false, message: err.message };
    return next();
  }
  if (!verified) {
    req.statusCode = 401;
    res.locals = { success: false, message: "invalid webhook signature" };
    return next();
  }

  // Provider-specific payload shape. Adjust the extraction to the real gateway
  // before go-live; org_id must be carried in the payment metadata at checkout.
  const { org_id, gateway_event_id, gross_amount_usd } = extractTopupFields(req.body);
  if (!org_id || !gateway_event_id || gross_amount_usd == null) {
    req.statusCode = 400;
    res.locals = { success: false, message: "missing org_id / gateway_event_id / amount in webhook" };
    return next();
  }

  const result = await processTopup({ org_id, gateway_event_id, gross_amount_usd });

  res.locals = {
    success: true,
    message: result.deduped ? "top-up already processed (deduped)" : "wallet credited",
    data: { deduped: result.deduped, status: result.topup?.status }
  };
  req.statusCode = 200;
  return next();
};

// Extract the fields we need from the gateway payload. This is intentionally
// generic; wire it to the real provider's event schema (e.g. Stripe
// checkout.session.completed -> data.object.metadata.org_id, id, amount_total).
const extractTopupFields = (body) => {
  const org_id = body?.org_id ?? body?.data?.object?.metadata?.org_id ?? body?.metadata?.org_id;
  const gateway_event_id = body?.id ?? body?.event_id ?? body?.gateway_event_id;
  const rawAmount =
    body?.gross_amount_usd ?? body?.amount ?? (body?.data?.object?.amount_total != null ? body.data.object.amount_total / 100 : undefined);
  return { org_id: org_id && String(org_id), gateway_event_id, gross_amount_usd: rawAmount };
};

export default { provisionOrg, walletTopupWebhook, getWalletBalance };
