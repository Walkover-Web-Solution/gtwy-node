import express from "express";
import apikeyController from "../controllers/apikey.controller.js";
import { middleware, checkAgentAccessMiddleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import apikeyValidation from "../validation/joi_validation/apikey.validation.js";

let router = express.Router();

router.post("/", middleware, checkAgentAccessMiddleware, validate(apikeyValidation.saveApikey), apikeyController.saveApikey);
router.get("/", middleware, apikeyController.getAllApikeys);
router.put("/:apikey_id", middleware, checkAgentAccessMiddleware, validate(apikeyValidation.updateApikey), apikeyController.updateApikey);
router.delete("/", middleware, checkAgentAccessMiddleware, validate(apikeyValidation.deleteApikey), apikeyController.deleteApikey);
export default router;
