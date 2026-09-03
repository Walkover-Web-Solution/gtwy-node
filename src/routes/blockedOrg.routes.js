import express from "express";
import blockedOrgController from "../controllers/blockedOrg.controller.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import blockedOrgValidation from "../validation/joi_validation/blockedOrg.validation.js";

const router = express.Router();

router.post("/", middleware, InternalAuth, validate(blockedOrgValidation.blockOrg), blockedOrgController.blockOrg);
router.delete("/:org_id", middleware, InternalAuth, validate(blockedOrgValidation.unblockOrg), blockedOrgController.unblockOrg);
router.get("/", middleware, blockedOrgController.listBlockedOrgs);

export default router;
