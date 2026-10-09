import TaskSheet, { TaskCompletion, DailyFocus } from "../models/TaskSheet.js";

// Helper function to assemble and return the fully populated frontend payload.
// This keeps the API completely backward-compatible with our client React components!
const getCompiledSheet = async (userId, month) => {
  let sheet = await TaskSheet.findOne({ userId, month });
  if (!sheet) {
    sheet = await TaskSheet.create({
      userId,
      month,
      tasks: [],
      approvalStatus: "PENDING",
    });
  }

  const completions = await TaskCompletion.find({ userId, month });
  const dailyFocusDocs = await DailyFocus.find({ userId, month });

  const dailyTodos = [];
  const eodReports = [];

  dailyFocusDocs.forEach((doc) => {
    (doc.todos || []).forEach((todo) => {
      dailyTodos.push({
        _id: todo._id,
        date: doc.date,
        name: todo.name,
        completed: todo.completed,
      });
    });

    if (doc.eodReportText) {
      eodReports.push({
        date: doc.date,
        reportText: doc.eodReportText,
        submittedAt: doc.submittedAt || doc.updatedAt,
      });
    }
  });

  return {
    _id: sheet._id,
    userId: sheet.userId,
    month: sheet.month,
    tasks: sheet.tasks || [],
    approvalStatus: sheet.approvalStatus || "PENDING",
    completions: completions.map((c) => ({ taskId: c.taskId, date: c.date })),
    dailyTodos,
    eodReports,
  };
};

export const getTaskSheet = async (req, res) => {
  try {
    const { month } = req.query; // YYYY-MM
    if (!month) return res.status(400).json({ error: "Month is required" });

    const compiled = await getCompiledSheet(req.session.userId, month);
    res.json(compiled);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const addTask = async (req, res) => {
  try {
    const { month, name, category } = req.body;

    await TaskSheet.findOneAndUpdate(
      { userId: req.session.userId, month },
      { $push: { tasks: { name, category } } },
      { new: true, upsert: true },
    );

    const compiled = await getCompiledSheet(req.session.userId, month);
    res.json(compiled);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const removeTask = async (req, res) => {
  try {
    const { month, taskId } = req.params;

    await TaskSheet.findOneAndUpdate(
      { userId: req.session.userId, month },
      { $pull: { tasks: { _id: taskId } } },
      { new: true },
    );

    // Delete related task completions
    await TaskCompletion.deleteMany({ userId: req.session.userId, taskId });

    const compiled = await getCompiledSheet(req.session.userId, month);
    res.json(compiled);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const toggleCompletion = async (req, res) => {
  try {
    const { month, taskId, date } = req.body;

    const existing = await TaskCompletion.findOne({
      userId: req.session.userId,
      taskId,
      date,
    });

    if (existing) {
      await TaskCompletion.deleteOne({ _id: existing._id });
    } else {
      await TaskCompletion.create({
        userId: req.session.userId,
        month,
        taskId,
        date,
      });
    }

    const compiled = await getCompiledSheet(req.session.userId, month);
    res.json(compiled);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Daily Todos APIs
export const addDailyTodo = async (req, res) => {
  try {
    const { month, date, name } = req.body; // date format: YYYY-MM-DD

    let focus = await DailyFocus.findOne({ userId: req.session.userId, date });
    if (!focus) {
      focus = new DailyFocus({
        userId: req.session.userId,
        month,
        date,
        todos: [],
      });
    }

    focus.todos.push({ name, completed: false });
    await focus.save();

    const compiled = await getCompiledSheet(req.session.userId, month);
    res.json(compiled);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const toggleDailyTodo = async (req, res) => {
  try {
    const { month, todoId } = req.body;

    const focus = await DailyFocus.findOne({
      userId: req.session.userId,
      "todos._id": todoId,
    });

    if (!focus) return res.status(404).json({ error: "Todo item not found" });

    const todo = focus.todos.id(todoId);
    if (!todo) return res.status(404).json({ error: "Todo not found" });

    todo.completed = !todo.completed;
    await focus.save();

    const compiled = await getCompiledSheet(req.session.userId, month);
    res.json(compiled);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const removeDailyTodo = async (req, res) => {
  try {
    const { month, todoId } = req.params;

    const focus = await DailyFocus.findOne({
      userId: req.session.userId,
      "todos._id": todoId,
    });

    if (focus) {
      focus.todos.pull({ _id: todoId });
      await focus.save();
    }

    const compiled = await getCompiledSheet(req.session.userId, month);
    res.json(compiled);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// EOD Report APIs
export const submitEodReport = async (req, res) => {
  try {
    const { month, date, reportText } = req.body;

    let focus = await DailyFocus.findOne({ userId: req.session.userId, date });
    if (!focus) {
      focus = new DailyFocus({
        userId: req.session.userId,
        month,
        date,
        todos: [],
      });
    }

    focus.eodReportText = reportText;
    focus.submittedAt = new Date();
    await focus.save();

    const compiled = await getCompiledSheet(req.session.userId, month);
    res.json(compiled);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
