import { ensureOrgSubscribed } from "../services/lago.service.js";

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

export default { provisionOrg };
