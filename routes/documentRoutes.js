import express from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  createCompanyDocument,
  getCompanyDocuments,
  distributeDocument,
  getDocumentSignatures,
  getMyDocuments,
  signDocument,
  toggleDocumentStatus,
} from "../controllers/documentController.js";

const router = express.Router();

// Both roles need to hit this router, so we apply protect to all
router.use(protect);

// Admin routes
router.post("/company", protectAdmin, createCompanyDocument);
router.get("/company", protectAdmin, getCompanyDocuments);
router.post("/company/:id/distribute", protectAdmin, distributeDocument);
router.get("/company/:id/signatures", protectAdmin, getDocumentSignatures);
router.patch("/company/:id/status", protectAdmin, toggleDocumentStatus);

// Employee routes
router.get("/my-documents", getMyDocuments);
router.post("/acknowledge/:id", signDocument);

export default router;
