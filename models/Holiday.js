import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    name: { type: String, required: true },
    year: { type: Number, required: true },
  },
  { timestamps: true },
);

holidaySchema.index({ date: 1, year: 1 }, { unique: true });

const Holiday =
  mongoose.models.Holiday || mongoose.model("Holiday", holidaySchema);

export default Holiday;
