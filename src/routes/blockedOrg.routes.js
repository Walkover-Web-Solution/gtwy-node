import express from "express";
import blockedOrgController from "../controllers/blockedOrg.controller.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

const router = express.Router();

router.post("/", middleware, InternalAuth, blockedOrgController.blockOrg);
router.delete("/:org_id", middleware, InternalAuth, blockedOrgController.unblockOrg);
router.get("/", middleware, InternalAuth, blockedOrgController.listBlockedOrgs);

export default router;
