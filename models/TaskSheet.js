import mongoose from "mongoose";

const taskSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, default: "General" },
});

const taskSheetSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    month: {
      type: String, // Format: YYYY-MM
      required: true,
    },
    tasks: [taskSchema],
    approvalStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

taskSheetSchema.index({ userId: 1, month: 1 }, { unique: true });

// Individual Task Completions Collection Schema (Extremely lightweight)
const taskCompletionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    month: {
      type: String, // Format: YYYY-MM
      required: true,
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    date: {
      type: String, // Format: YYYY-MM-DD
      required: true,
    },
  },
  { timestamps: true },
);

taskCompletionSchema.index({ userId: 1, taskId: 1, date: 1 }, { unique: true });

// Daily Focus Planner & EOD Reports Collection Schema (One lightweight doc per day)
const dailyFocusTodoSchema = new mongoose.Schema({
  name: { type: String, required: true },
  completed: { type: Boolean, default: false },
});

const dailyFocusSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    month: {
      type: String, // Format: YYYY-MM
      required: true,
    },
    date: {
      type: String, // Format: YYYY-MM-DD
      required: true,
    },
    todos: [dailyFocusTodoSchema],
    eodReportText: {
      type: String,
      default: "",
    },
    submittedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

dailyFocusSchema.index({ userId: 1, date: 1 }, { unique: true });

const TaskSheet = mongoose.model("TaskSheet", taskSheetSchema);
const TaskCompletion = mongoose.model("TaskCompletion", taskCompletionSchema);
const DailyFocus = mongoose.model("DailyFocus", dailyFocusSchema);

export { TaskCompletion, DailyFocus };
export default TaskSheet;
