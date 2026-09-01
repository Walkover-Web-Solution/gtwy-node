import express from "express";
import userCreditLimitController from "../controllers/userCreditLimit.controller.js";
import validate from "../middlewares/validate.middleware.js";
import userCreditLimitValidation from "../validation/joi_validation/userCreditLimit.validation.js";
import { middleware } from "../middlewares/middleware.js";

const router = express.Router();

// Org admins manage per-user credit caps for their embed folders.
// Org scoping comes from the auth profile — never from the request body.
router.put("/", middleware, validate(userCreditLimitValidation.setUserLimit), userCreditLimitController.setUserLimit);
router.get("/", middleware, validate(userCreditLimitValidation.listUserLimits), userCreditLimitController.listUserLimits);
router.delete("/", middleware, validate(userCreditLimitValidation.removeUserLimit), userCreditLimitController.removeUserLimit);

export default router;
