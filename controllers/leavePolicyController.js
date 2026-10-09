import Employee from "../models/Employee.js";
import LeavePolicy from "../models/LeavePolicy.js";
import { recordOpeningBalances } from "../utils/paidLeave.js";

const isValidInteger = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;

export const getLeavePolicy = async (_req, res) => {
  try {
    const policy = await LeavePolicy.findOne({ scope: "COMPANY" }).lean();
    return res.json({ success: true, data: policy });
  } catch {
    return res.status(500).json({ error: "Failed to fetch paid leave policy" });
  }
};

export const saveLeavePolicy = async (req, res) => {
  try {
    const {
      annualPaidDays,
      yearStartMonth,
      yearStartDay,
      grantFrequency,
      newHireCutoffDay,
      carryForwardEnabled,
    } = req.body;

    if (!Number.isFinite(annualPaidDays) || annualPaidDays <= 0) {
      return res
        .status(400)
        .json({ error: "Annual paid leave must be greater than zero" });
    }
    if (!isValidInteger(yearStartMonth, 1, 12)) {
      return res.status(400).json({ error: "Invalid leave-year start month" });
    }
    if (!isValidInteger(yearStartDay, 1, 31)) {
      return res.status(400).json({ error: "Invalid leave-year start day" });
    }
    if (!isValidInteger(newHireCutoffDay, 1, 31)) {
      return res.status(400).json({ error: "Invalid new-hire cutoff day" });
    }
    if (!["MONTHLY", "QUARTERLY", "ANNUAL"].includes(grantFrequency)) {
      return res.status(400).json({ error: "Invalid grant frequency" });
    }

    const existingPolicy = await LeavePolicy.findOne({ scope: "COMPANY" });
    const values = {
      annualPaidDays,
      yearStartMonth,
      yearStartDay,
      grantFrequency,
      newHireCutoffDay,
      carryForwardEnabled: Boolean(carryForwardEnabled),
      updatedBy: req.session.email,
    };

    let policy;
    if (existingPolicy) {
      Object.assign(existingPolicy, values);
      policy = await existingPolicy.save();
    } else {
      policy = await LeavePolicy.create({
        scope: "COMPANY",
        ...values,
        activatedAt: new Date(),
      });
      const employees = await Employee.find({ isDeleted: false }).lean();
      await recordOpeningBalances(policy, employees);
    }

    return res.json({ success: true, data: policy });
  } catch (error) {
    console.error("Save paid leave policy error:", error);
    return res.status(500).json({ error: "Failed to save paid leave policy" });
  }
};
