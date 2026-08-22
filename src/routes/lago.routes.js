import express from "express";
import lagoController from "../controllers/lago.controller.js";
import validate from "../middlewares/validate.middleware.js";
import lagoValidation from "../validation/joi_validation/lago.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

const router = express.Router();

router.post("/provision", middleware, InternalAuth, validate(lagoValidation.provisionOrg), lagoController.provisionOrg);
router.get("/wallet/:org_id", middleware, validate(lagoValidation.getWalletBalance), lagoController.getWalletBalance);
router.post("/wallet/topup", middleware, InternalAuth, validate(lagoValidation.topupOrgWallet), lagoController.topupOrgWallet);
router.post("/wallet/:org_id/sync", middleware, InternalAuth, validate(lagoValidation.syncWalletBalance), lagoController.syncWalletBalance);

export default router;
