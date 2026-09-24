import express from "express";
import organizationController from "../controllers/organization.controller.js";
import validate from "../middlewares/validate.middleware.js";
import organizationValidation from "../validation/joi_validation/organization.validation.js";
import { middleware } from "../middlewares/middleware.js";

// Creating an organisation goes through us rather than straight to MSG91, so
// the org and its wallet are created together. See the controller for why.
const router = express.Router();

router.post("/", middleware, validate(organizationValidation.createOrganization), organizationController.createOrgWithBilling);

export default router;
