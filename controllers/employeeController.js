import Employee from "../models/Employee.js";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import moment from "moment-timezone";

const TZ = "Asia/Kolkata";

// Get employees
// GET /api/employees
export const getEmployees = async (req, res) => {
  try {
    const { department } = req.query;
    const where = {};
    if (department) where.department = department;

    let employees = await Employee.find(where)
      .select("-bankDetails -personalInfo -documents")
      .sort({ createdAt: -1 })
      .populate("userId", "email role")
      .populate("department", "name")
      .lean();

    // Filter out guards (SECURITY role)
    employees = employees.filter((emp) => emp.userId?.role !== "SECURITY");

    const todayStart = moment.tz(TZ).startOf("day").toDate();
    const todayEnd = moment.tz(TZ).endOf("day").toDate();

    const attendances = await Attendance.find({
      date: { $gte: todayStart, $lte: todayEnd },
    }).lean();

    const result = employees.map((emp) => {
      const empAttendance = attendances.find(
        (a) => a.employeeId.toString() === emp._id.toString(),
      );
      return {
        ...emp,
        id: emp._id.toString(),
        departmentName: emp.department?.name || "Unassigned",
        user: emp.userId
          ? { email: emp.userId.email, role: emp.userId.role }
          : null,
        todayAttendance: empAttendance || null,
      };
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch employees" });
  }
};

// Get single employee
// GET /api/employees/:id
export const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findById(id)
      .populate("userId", "email role")
      .populate("department", "name")
      .lean();

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const result = {
      ...employee,
      id: employee._id.toString(),
      departmentName: employee.department?.name || "Unassigned",
      user: employee.userId
        ? { email: employee.userId.email, role: employee.userId.role }
        : null,
    };
    return res.json(result);
  } catch (error) {
    console.error("Get employee by ID error:", error);
    return res.status(500).json({ error: "Failed to fetch employee details" });
  }
};

// Create employee
// POST /api/employees
export const createEmployee = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      department,
      basicSalary,
      allowances,
      deductions,
      joinDate,
      password,
      role,
      bio,
      shiftHours,
    } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      password: hashed,
      role: role || "EMPLOYEE",
    });

    const employee = await Employee.create({
      userId: user._id,
      firstName,
      lastName,
      email,
      phone,
      position,
      department: department,
      basicSalary: Number(basicSalary) || 0,
      allowances: Number(allowances) || 0,
      deductions: Number(deductions) || 0,
      joinDate: new Date(joinDate),
      bio: bio || "",
      shiftHours: Number(shiftHours) || 0,
    });

    return res.status(201).json({ success: true, employee });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Create employee error:", error);
    return res.status(500).json({ error: "Failed to create employee" });
  }
};

// Update employee
// PUT /api/employees/:id
export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findById(id);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const { password, role, email, ...employeeData } = req.body;

    // Update employee fields (including nested objects)
    Object.keys(employeeData).forEach((key) => {
      if (employeeData[key] !== undefined) {
        employee[key] = employeeData[key];
      }
    });

    await employee.save();

    // Update user record if email, role, or password is changed
    const userUpdate = {};
    if (email) {
      userUpdate.email = email;
      employee.email = email;
      await employee.save();
    }
    if (role) userUpdate.role = role;
    if (password && password.trim() !== "") {
      userUpdate.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(employee.userId, userUpdate);
    }

    return res.json({ success: true, message: "Updated successfully" });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Update employee error:", error);
    return res.status(500).json({ error: "Failed to update employee" });
  }
};

// Delete employee
// DELETE /api/employees/:id
export const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await Employee.findById(id);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    employee.isDeleted = true;
    employee.employmentStatus = "INACTIVE";
    await employee.save();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete employee" });
  }
};
