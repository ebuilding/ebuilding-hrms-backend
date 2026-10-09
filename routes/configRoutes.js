import express from "express";
import { getConfig, setConfig } from "../controllers/configController.js";

const router = express.Router();

// GET /api/config/:key
router.get("/:key", getConfig);

// POST /api/config/:key
router.post("/:key", setConfig);

export default router;
