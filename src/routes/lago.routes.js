import express from "express";
import lagoController from "../controllers/lago.controller.js";

const router = express.Router();

// POST /api/lago/provision
// Body: { org_id: string }
// Creates a Lago customer and assigns a subscription for the given org
router.post("/provision", lagoController.provisionOrg);

export default router;
