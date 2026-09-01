import express from "express";
import platformApiKeyController from "../controllers/platformApiKey.controller.js";
import validate from "../middlewares/validate.middleware.js";
import platformApiKeyValidation from "../validation/joi_validation/platformApiKey.validation.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";

const router = express.Router();

// Platform provider keys are money: every route is InternalAuth (admin) only,
// and keys are only ever returned masked.
router.put("/", middleware, InternalAuth, validate(platformApiKeyValidation.setPlatformApiKey), platformApiKeyController.setPlatformApiKey);
router.get("/", middleware, InternalAuth, platformApiKeyController.listPlatformApiKeys);
router.delete("/", middleware, InternalAuth, validate(platformApiKeyValidation.removePlatformApiKey), platformApiKeyController.removePlatformApiKey);

export default router;
