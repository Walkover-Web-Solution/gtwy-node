import express from "express";
import blockedOrgController from "../controllers/blockedOrg.controller.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import blockedOrgValidation from "../validation/joi_validation/blockedOrg.validation.js";

const router = express.Router();

router.post("/", middleware, InternalAuth, validate(blockedOrgValidation.blockOrg), blockedOrgController.blockOrg);
router.delete("/:org_id", middleware, InternalAuth, validate(blockedOrgValidation.unblockOrg), blockedOrgController.unblockOrg);
router.get("/", middleware, blockedOrgController.listBlockedOrgs);

// The org comes from the caller's auth (pauthkey, proxy token or JWT); internal
// staff may pass org_id (body for POST, query for DELETE/GET) to act on any org
router.post("/user", middleware, validate(blockedOrgValidation.blockUser), blockedOrgController.blockUser);
router.delete("/user/:user_id", middleware, validate(blockedOrgValidation.unblockUser), blockedOrgController.unblockUser);
router.get("/user", middleware, validate(blockedOrgValidation.listBlockedUsers), blockedOrgController.listBlockedUsers);

export default router;
