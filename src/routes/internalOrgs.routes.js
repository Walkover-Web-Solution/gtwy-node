import express from "express";
import internalOrgsController from "../controllers/internalOrgs.controller.js";
import validate from "../middlewares/validate.middleware.js";
import internalOrgsValidation from "../validation/joi_validation/internalOrgs.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

// Internal credits dashboard. Everything here needs a GTWY token whose email is
// in INTERNAL_ALLOWED_EMAILS. Its own router so the /api/billing/admin/:org_id
// catch-all cannot swallow these paths.
const router = express.Router();

router.get("/access", middleware, InternalAuth, internalOrgsController.access);
router.get("/", middleware, InternalAuth, internalOrgsController.listInternalOrgs);
router.post("/", middleware, InternalAuth, validate(internalOrgsValidation.addOrg), internalOrgsController.addInternalOrg);
router.delete("/:org_id", middleware, InternalAuth, validate(internalOrgsValidation.orgParam), internalOrgsController.removeInternalOrg);
router.get("/:org_id/transactions", middleware, InternalAuth, validate(internalOrgsValidation.transactions), internalOrgsController.listTransactions);
router.post("/:org_id/credits", middleware, InternalAuth, validate(internalOrgsValidation.addCredits), internalOrgsController.addCredits);

export default router;
