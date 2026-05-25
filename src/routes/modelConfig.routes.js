import express from "express";
import { middleware } from "../middlewares/middleware.js";
import { saveUserModelConfiguration, deleteUserModelConfiguration } from "../controllers/modelConfig.controller.js";
import validate from "../middlewares/validate.middleware.js";
import {
  saveUserModelConfigurationBodySchema,
  deleteUserModelConfigurationQuerySchema
} from "../validation/joi_validation/modelConfig.validation.js";

const router = express.Router();

router.post("/", middleware, validate({ body: saveUserModelConfigurationBodySchema }), saveUserModelConfiguration);
router.delete("/", middleware, validate({ query: deleteUserModelConfigurationQuerySchema }), deleteUserModelConfiguration);

export default router;
