import CompanyDocument from "../models/CompanyDocument.js";
import DocumentAcknowledgment from "../models/DocumentAcknowledgment.js";
import Employee from "../models/Employee.js";

// ADMIN: Create a new generic company policy document
export const createCompanyDocument = async (req, res) => {
  try {
    const { title, description, fileUrl, requiresSignature, version } = req.body;
    const document = await CompanyDocument.create({
      title,
      description,
      fileUrl,
      requiresSignature,
      version,
      createdBy: req.session.userId,
    });
    return res.status(201).json({ message: "Document created successfully", document });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// ADMIN: Get all company documents
export const getCompanyDocuments = async (req, res) => {
  try {
    const documents = await CompanyDocument.find({}).sort({ createdAt: -1 });
    return res.json(documents);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// ADMIN: Distribute a document for signature to all active employees
export const distributeDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await CompanyDocument.findById(id);
    if (!document || !document.requiresSignature) {
      return res.status(400).json({ error: "Document not found or does not require signature" });
    }

    const employees = await Employee.find({ isDeleted: false, employmentStatus: "ACTIVE" });
    const acknowledgments = [];

    for (const emp of employees) {
      // Check if they already have an acknowledgment to prevent duplicates
      const exists = await DocumentAcknowledgment.exists({ documentId: id, employeeId: emp._id });
      if (!exists) {
        acknowledgments.push({
          documentId: id,
          employeeId: emp._id,
        });
      }
    }

    if (acknowledgments.length > 0) {
      await DocumentAcknowledgment.insertMany(acknowledgments);
    }

    return res.json({ message: `Distributed to ${acknowledgments.length} employees.` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// ADMIN: Get signature status for a specific document
export const getDocumentSignatures = async (req, res) => {
  try {
    const { id } = req.params;
    const signatures = await DocumentAcknowledgment.find({ documentId: id })
      .populate("employeeId", "firstName lastName email department")
      .sort({ status: 1, createdAt: -1 });
    return res.json(signatures);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// EMPLOYEE: Get my documents (Pending and Signed)
export const getMyDocuments = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    let requiredDocs = await DocumentAcknowledgment.find({ employeeId: employee._id })
      .populate("documentId")
      .sort({ status: -1, createdAt: -1 }); // PENDING first, then SIGNED

    // Filter out inactive required documents if they are still PENDING
    requiredDocs = requiredDocs.filter(doc => {
      if (!doc.documentId) return false; // Edge case if document was hard deleted
      if (!doc.documentId.isActive && doc.status === 'PENDING') return false;
      return true;
    });

    // 2. Get all active company documents that DO NOT require a signature
    const generalDocs = await CompanyDocument.find({ isActive: true, requiresSignature: false });

    const formattedGeneralDocs = generalDocs.map(doc => ({
      _id: doc._id, // Use the document's own ID as the row key
      documentId: doc, // Mock the populated structure
      status: 'VIEW ONLY',
      signedAt: null,
    }));

    // Combine and return
    const allDocuments = [...requiredDocs, ...formattedGeneralDocs];

    return res.json(allDocuments);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// EMPLOYEE: Sign a document
export const signDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { signatureText } = req.body;

    if (!signatureText) {
      return res.status(400).json({ error: "Signature text is required" });
    }

    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const ack = await DocumentAcknowledgment.findOne({ _id: id, employeeId: employee._id });
    if (!ack) return res.status(404).json({ error: "Acknowledgment not found" });
    if (ack.status === "SIGNED") return res.status(400).json({ error: "Already signed" });

    ack.status = "SIGNED";
    ack.signatureText = signatureText;
    ack.signedAt = new Date();
    ack.ipAddress = req.ip || req.connection.remoteAddress;
    await ack.save();

    return res.json({ message: "Document signed successfully", data: ack });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// ADMIN: Archive / Restore a document
export const toggleDocumentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await CompanyDocument.findById(id);
    if (!document) return res.status(404).json({ error: "Document not found" });

    document.isActive = !document.isActive;
    await document.save();

    return res.json({ 
      message: `Document ${document.isActive ? 'restored' : 'archived'} successfully`, 
      document 
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
