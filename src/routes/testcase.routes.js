import express from "express";
import { middleware } from "../middlewares/middleware.js";
import testcaseController from "../controllers/testcase.controller.js";
import validate from "../middlewares/validate.middleware.js";
import {
  createTestcaseSchema,
  testcaseIdSchema,
  bridgeIdSchema,
  testcaseUpdateSchema,
  getAllTestcasesQuerySchema,
  bulkDeleteTestcaseSchema
} from "../validation/joi_validation/testcase.validation.js";

const router = express.Router();

// Create a new testcase
router.post("/create", middleware, validate({ body: createTestcaseSchema }), testcaseController.createTestcase);

// Bulk delete testcases by ids array (body)
router.delete("/", middleware, validate({ body: bulkDeleteTestcaseSchema }), testcaseController.deleteTestcase);

// Delete a single testcase by _id (param)
router.delete("/:testcase_id", middleware, validate({ params: testcaseIdSchema }), testcaseController.deleteTestcase);

// Get all testcases by bridge_id
router.get("/:bridge_id", middleware, validate({ params: bridgeIdSchema, query: getAllTestcasesQuerySchema }), testcaseController.getAllTestcases);

// Update a testcase by _id
router.put("/:testcase_id", middleware, validate({ params: testcaseIdSchema, body: testcaseUpdateSchema }), testcaseController.updateTestcases);

export default router;
