import express from "express";
import { createRichUiTemplate, getRichUiTemplates, updateRichUiTemplate, deleteRichUiTemplate } from "../controllers/richUiTemplate.controller.js";
import { middleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import { createRichUiTemplateSchema, updateRichUiTemplateSchema, templateIdSchema } from "../validation/joi_validation/richUiTemplate.validation.js";

const router = express.Router();

// Create a new rich UI template
router.post("/", middleware, validate({ body: createRichUiTemplateSchema }), createRichUiTemplate);

// Get all templates for an organization (with optional filtering)
router.get("/", middleware, getRichUiTemplates);

// Update a template
router.put("/:template_id", middleware, validate({ params: templateIdSchema, body: updateRichUiTemplateSchema }), updateRichUiTemplate);

// Delete a template (soft delete)
router.delete("/:template_id", middleware, validate({ params: templateIdSchema }), deleteRichUiTemplate);

export default router;
