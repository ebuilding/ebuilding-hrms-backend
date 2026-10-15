import Employee from "../models/Employee.js";
import User from "../models/User.js";
import { UserRole } from "../constants/enums.js";
import { updateProfileSchema } from "../validators/employeeValidator.js";

// Get profile
// GET /api/profile
export const getProfile = async (req, res) => {
  try {
    const session = req.session;
    const employee = await Employee.findOne({
      userId: session.userId,
    })
      .populate("userId", "email role")
      .populate("department", "name")
      .lean();

    if (!employee) {
      const user = await User.findById(session.userId).lean();
      if (!user) return res.status(404).json({ error: "User not found" });

      const role = user.role || session.role || UserRole.ADMIN;
      return res.json({
        firstName: role === UserRole.ADMIN ? "Admin" : "",
        lastName: "",
        email: user.email,
        role: role,
        user: { email: user.email, role: role },
      });
    }

    const role = employee.userId?.role || session.role || UserRole.EMPLOYEE;
    const result = {
      ...employee,
      id: employee._id.toString(),
      departmentName: employee.department?.name || "Unassigned",
      role: role,
      user: employee.userId
        ? { email: employee.userId.email, role: employee.userId.role }
        : { email: employee.email, role: role },
    };

    return res.json(result);
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// Update profile
// PUT /api/profile or POST /api/profile
export const updateProfile = async (req, res) => {
  try {
    const session = req.session;
    const employee = await Employee.findOne({ userId: session.userId });

    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }

    if (employee.isDeleted) {
      return res.status(403).json({
        error: "Your account is deactivated. You cannot update your profile.",
      });
    }

    // Zod validation - all fields optional
    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError =
        parseResult.error.issues?.[0]?.message ||
        parseResult.error.errors?.[0]?.message ||
        "Validation failed";
      return res.status(400).json({
        error: firstError,
        details: parseResult.error.flatten?.().fieldErrors || {},
      });
    }

    const validatedData = parseResult.data;

    // Only update fields that were actually provided (if sent, save; if not sent, keep existing)
    const updateOps = {};
    for (const [key, value] of Object.entries(validatedData)) {
      if (value === undefined) continue;

      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        // Flatten nested object keys so partial updates don't overwrite sibling fields
        for (const [subKey, subVal] of Object.entries(value)) {
          if (subVal === undefined) continue;
          if (
            subVal &&
            typeof subVal === "object" &&
            !Array.isArray(subVal) &&
            !(subVal instanceof Date)
          ) {
            for (const [deepKey, deepVal] of Object.entries(subVal)) {
              if (deepVal !== undefined) {
                updateOps[`${key}.${subKey}.${deepKey}`] = deepVal;
              }
            }
          } else {
            updateOps[`${key}.${subKey}`] = subVal;
          }
        }
      } else {
        updateOps[key] = value;
      }
    }

    const updated = await Employee.findByIdAndUpdate(
      employee._id,
      { $set: updateOps },
      { new: true, runValidators: true },
    ).populate("department", "name");

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Failed to update profile:", error);
    return res.status(500).json({ error: "Failed to update profile" });
  }
};

