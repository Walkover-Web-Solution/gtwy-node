import express from "express";
import { middleware } from "../middlewares/middleware.js";
import { saveUserModelConfiguration, deleteUserModelConfiguration, updateUserModelConfiguration } from "../controllers/modelConfig.controller.js";
import validate from "../middlewares/validate.middleware.js";
import {
  saveUserModelConfigurationBodySchema,
  deleteUserModelConfigurationQuerySchema,
  updateUserModelConfigurationQuerySchema,
  updateUserModelConfigurationBodySchema
} from "../validation/joi_validation/modelConfig.validation.js";

const router = express.Router();

router.post("/", middleware, validate({ body: saveUserModelConfigurationBodySchema }), saveUserModelConfiguration);
router.put(
  "/",
  middleware,
  validate({ query: updateUserModelConfigurationQuerySchema, body: updateUserModelConfigurationBodySchema }),
  updateUserModelConfiguration
);
router.delete("/", middleware, validate({ query: deleteUserModelConfigurationQuerySchema }), deleteUserModelConfiguration);

export default router;
