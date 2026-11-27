import jwt from "jsonwebtoken";
import { UserRole } from "../constants/enums.js";

export const protect = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    const session = jwt.verify(token, process.env.JWT_SECRET);

    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.session = session;
    next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }
};

export const protectAdmin = (req, res, next) => {
  if (req?.session?.role !== UserRole.ADMIN) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

export default {
  protect,
  protectAdmin,
};
