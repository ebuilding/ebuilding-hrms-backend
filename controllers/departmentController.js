import Department from "../models/Department.js";
import Employee from "../models/Employee.js";

// Get all departments
export const getDepartments = async (req, res) => {
  try {
    const departments = await Department.find().sort({ name: 1 });

    // Dynamically calculate employee count for each department
    const departmentsWithCounts = await Promise.all(
      departments.map(async (dept) => {
        const count = await Employee.countDocuments({
          department: dept._id,
          isDeleted: { $ne: true },
        });
        return { ...dept.toObject(), employeeCount: count };
      }),
    );

    res.json({ data: departmentsWithCounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create a department
export const createDepartment = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name)
      return res.status(400).json({ error: "Department name is required" });

    const existing = await Department.findOne({ name });
    if (existing)
      return res.status(400).json({ error: "Department already exists" });

    const department = await Department.create({ name, description });
    res.status(201).json({ data: department });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update a department
export const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const department = await Department.findById(id);
    if (!department)
      return res.status(404).json({ error: "Department not found" });

    if (name) {
      const existing = await Department.findOne({ name, _id: { $ne: id } });
      if (existing)
        return res
          .status(400)
          .json({ error: "Department name already exists" });
      department.name = name;
    }

    if (description !== undefined) department.description = description;
    await department.save();

    res.json({ data: department });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a department
export const deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const department = await Department.findById(id);
    if (!department)
      return res.status(404).json({ error: "Department not found" });

    // Check if employees are assigned to this department
    const employeeCount = await Employee.countDocuments({
      department: id,
      isDeleted: { $ne: true },
    });
    if (employeeCount > 0) {
      return res.status(400).json({
        error: "Cannot delete department with active employees",
      });
    }

    await Department.findByIdAndDelete(id);
    res.json({ message: "Department deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
