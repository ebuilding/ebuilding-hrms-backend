import Config from "../models/Config.js";
import Employee from "../models/Employee.js";

// Get config
export const getConfig = async (req, res) => {
  try {
    const { key } = req.params;
    const config = await Config.findOne({ key });
    res.json({ success: true, data: config ? config.value : null });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch config" });
  }
};

// Set config
export const setConfig = async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const config = await Config.findOneAndUpdate(
      { key },
      { value },
      { upsert: true, new: true },
    );

    // If attendanceShiftConfig is updated, synchronize standard employees' shiftHours
    if (key === "attendanceShiftConfig" && value && value.shiftHours) {
      const newShiftHours = Number(value.shiftHours);
      if (!isNaN(newShiftHours) && newShiftHours > 0) {
        await Employee.updateMany(
          {
            $or: [
              { customShiftEnabled: { $ne: true } },
              { customShiftEnabled: { $exists: false } },
            ],
          },
          { shiftHours: newShiftHours },
        );
      }
    }

    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ error: "Failed to set config" });
  }
};
