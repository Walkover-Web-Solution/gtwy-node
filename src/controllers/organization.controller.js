import logger from "../logger.js";
import { createOrganization, organizationIdFrom } from "../services/proxy.service.js";
import { ensureOrgSubscribed } from "../services/lago.service.js";
import { unknown_error_handler_alert } from "../services/utils/utility.service.js";

// Create an org AND give it a wallet, in one request.
//
// The frontend used to POST straight to MSG91's createCompany. The org existed
// immediately but its Lago customer, subscription and wallet did not — those
// waited on the signup webhook, and when that did not fire the org ran with no
// wallet at all: every debit it produced was dropped and nothing was billed.
// Creating the org here means the wallet is in place before the org can make
// its first request.
const createOrgWithBilling = async (req, res, next) => {
  // The company belongs to the caller, so MSG91 is called with the caller's
  // own proxy token. `middleware` accepts a JWT too, which is why this is
  // checked explicitly rather than assumed.
  const proxyToken = req.headers.proxy_auth_token;
  if (!proxyToken) {
    req.statusCode = 400;
    res.locals = { success: false, message: "proxy_auth_token header is required to create an organisation" };
    return next();
  }

  // Step 1: MSG91. If this fails nothing was created, so the request fails too.
  let payload;
  try {
    payload = await createOrganization(req.body.company, proxyToken);
  } catch (err) {
    const status = err?.response?.status;
    logger.error(`[org] createCompany failed: ${status ?? "no status"} ${err.message}`);
    req.statusCode = status === 401 || status === 403 ? status : 502;
    res.locals = {
      success: false,
      message: status === 401 || status === 403 ? "not authorised to create an organisation" : "could not create the organisation"
    };
    return next();
  }

  const org_id = organizationIdFrom(payload);
  if (!org_id) {
    // The org may well exist; we simply cannot tell which one it is, so we
    // cannot provision it. Loud, with the shape logged so this is fixed once.
    logger.error(`[org] createCompany returned no recognisable org id: ${JSON.stringify(payload).slice(0, 500)}`);
    unknown_error_handler_alert("orgCreateNoIdInResponse", null, JSON.stringify(payload).slice(0, 500));
    req.statusCode = 502;
    res.locals = { success: false, message: "organisation created but its id could not be read; billing was not provisioned" };
    return next();
  }

  // Step 2: billing. The org now EXISTS, so a failure here must not fail the
  // request — that would leave the user with an org they were told they did not
  // get. It is reported instead, and POST /api/lago/provision/admin replays it.
  let billing = { provisioned: false };
  try {
    const result = await ensureOrgSubscribed(org_id);
    billing = {
      provisioned: true,
      plan: result.plan,
      wallet_created: Boolean(result.wallet) && !result.wallet.skipped,
      subscription_created: Boolean(result.subscription) && !result.subscription.skipped
    };
    logger.info(`[org] org ${org_id} created and provisioned on plan '${result.plan}'`);
  } catch (err) {
    logger.error(`[org] org ${org_id} created but provisioning failed: ${err.message}`);
    unknown_error_handler_alert("orgProvisioningFailed", null, `org ${org_id} created but has no wallet: ${err.message}`);
    billing = { provisioned: false, error: err.message };
  }

  res.locals = {
    success: true,
    message: billing.provisioned
      ? "organisation created and provisioned"
      : "organisation created, but billing provisioning failed — retry with /api/lago/provision/admin",
    data: { org_id, organization: payload?.data ?? payload, billing }
  };
  req.statusCode = 201;
  return next();
};

export default { createOrgWithBilling };
