import express from "express";
import {
  createAuthToken,
  verifyAuthTokenController,
  saveAuthTokenInDbController,
  getAuthTokenInDbController,
  getClientInfoController,
  generateLocalToken
} from "../controllers/auth.controller.js";
import { middleware, blockEmbedUsers } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import authValidation from "../validation/joi_validation/auth.validation.js";
const router = express.Router();

router.get("/auth_token", middleware, blockEmbedUsers, createAuthToken);
router.post("/", middleware, blockEmbedUsers, validate(authValidation.saveAuthTokenInDb), saveAuthTokenInDbController);
router.get("/", middleware, blockEmbedUsers, getAuthTokenInDbController);
router.post("/verify", middleware, blockEmbedUsers, validate(authValidation.verifyAuthToken), verifyAuthTokenController);
router.get("/client_info", middleware, blockEmbedUsers, validate(authValidation.getClientInfo), getClientInfoController);
router.post("/generate-token", generateLocalToken);

export default router;
