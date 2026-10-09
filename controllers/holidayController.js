import Holiday from "../models/Holiday.js";

const normalizeDate = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

// Get all holidays for a year
export const getHolidays = async (req, res) => {
  try {
    const { year } = req.query;
    let query = {};
    if (year) {
      query.year = parseInt(year);
    } else {
      query.date = { $gte: new Date() };
    }
    const holidays = await Holiday.find(query).sort({
      date: 1,
    });
    res.json({ success: true, data: holidays });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch holidays" });
  }
};

// Add holiday
export const addHoliday = async (req, res) => {
  try {
    const { date, name, year } = req.body;
    const holiday = await Holiday.create({
      date: normalizeDate(date),
      name,
      year,
    });
    res.json({ success: true, data: holiday });
  } catch (error) {
    res.status(500).json({ error: "Failed to add holiday" });
  }
};

// Update holiday
export const updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    if (updates.date) {
      updates.date = normalizeDate(updates.date);
    }
    const holiday = await Holiday.findByIdAndUpdate(id, updates, { new: true });
    res.json({ success: true, data: holiday });
  } catch (error) {
    res.status(500).json({ error: "Failed to update holiday" });
  }
};

// Delete holiday
export const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    await Holiday.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete holiday" });
  }
};
