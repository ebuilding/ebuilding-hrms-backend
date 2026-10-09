import moment from "moment-timezone";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import LeaveLedger from "../models/LeaveLedger.js";
import LeavePolicy from "../models/LeavePolicy.js";

const TIMEZONE = "Asia/Kolkata";
const GRANT_PERIOD_MONTHS = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

const roundDays = (value) => Math.round(value * 100) / 100;

const getLeaveYearStart = (date, policy) => {
  const localDate = moment(date).tz(TIMEZONE);
  const month = policy.yearStartMonth - 1;
  const makeStart = (year) => {
    const firstOfMonth = moment.tz([year, month, 1], TIMEZONE);
    return firstOfMonth
      .date(Math.min(policy.yearStartDay, firstOfMonth.daysInMonth()))
      .startOf("day");
  };

  let start = makeStart(localDate.year());
  if (localDate.isBefore(start)) start = makeStart(localDate.year() - 1);
  return start;
};

const getPeriodGrantEvents = (employee, policy, yearStart, throughDate) => {
  const events = [];
  const periodLength = GRANT_PERIOD_MONTHS[policy.grantFrequency];
  const monthlyAmount = policy.annualPaidDays / 12;
  const activation = moment(policy.activatedAt).tz(TIMEZONE).startOf("day");
  const hireDate = moment(employee.joinDate).tz(TIMEZONE).startOf("day");

  for (let monthOffset = 0; monthOffset < 12; monthOffset += periodLength) {
    const periodStart = yearStart.clone().add(monthOffset, "months");
    const periodEnd = periodStart
      .clone()
      .add(periodLength, "months")
      .subtract(1, "day")
      .endOf("day");
    if (hireDate.isAfter(periodEnd) || periodEnd.isBefore(activation)) continue;

    // Only skip if the period ended before the policy was activated.
    // periodEnd.isBefore(activation) already handles this above.

    let eligibleMonths = 0;
    let firstEligibleMonth = null;
    for (let offset = 0; offset < periodLength; offset += 1) {
      const monthStart = periodStart.clone().add(offset, "months");
      if (monthStart.isBefore(hireDate, "month")) continue;
      if (
        monthStart.isSame(hireDate, "month") &&
        hireDate.date() > policy.newHireCutoffDay
      ) {
        continue;
      }
      eligibleMonths += 1;
      if (!firstEligibleMonth) firstEligibleMonth = monthStart;
    }

    if (eligibleMonths === 0) continue;
    let grantDate = periodStart.clone();
    // If the computed grant date is before the policy was even activated, 
    // the effective grant date becomes the activation date.
    if (grantDate.isBefore(activation)) {
      grantDate = activation.clone();
    }
    
    if (grantDate.isAfter(throughDate)) continue;

    const periodKey = periodStart.format("YYYY-MM-DD");
    events.push({
      grantDate: grantDate.toDate(),
      amount: roundDays(monthlyAmount * eligibleMonths),
      periodKey,
      idempotencyKey: `grant:${policy._id}:${employee._id}:${periodKey}:${grantDate.format("YYYY-MM-DD")}`,
    });
  }

  return events;
};

const getGrantEvents = (employee, policy, throughDate, afterDate = null) => {
  const activation = moment(policy.activatedAt).tz(TIMEZONE).startOf("day");
  const lastYearStart = getLeaveYearStart(throughDate, policy);
  let yearStart = getLeaveYearStart(activation, policy);
  const events = [];

  while (yearStart.isSameOrBefore(lastYearStart, "day")) {
    events.push(
      ...getPeriodGrantEvents(employee, policy, yearStart, throughDate),
    );
    yearStart.add(1, "year");
  }

  return events
    .filter((event) => !afterDate || moment(event.grantDate).isAfter(afterDate))
    .sort((left, right) => left.grantDate - right.grantDate);
};

const createLedgerEntry = async (entry) => {
  try {
    await LeaveLedger.create(entry);
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
};

const applyBalanceChange = async (employeeId, amount) => {
  if (!amount) return;
  await Employee.updateOne(
    { _id: employeeId },
    { $inc: { "leaveBalance.paid": amount } },
    { runValidators: false },
  );
};

const snapshotOpeningBalance = async (employee, policy) => {
  const amount = Math.max(0, employee.leaveBalance?.paid || 0);
  await createLedgerEntry({
    employeeId: employee._id,
    policyId: policy._id,
    type: "OPENING",
    amount,
    balanceChange: 0,
    effectiveAt: policy.activatedAt,
    idempotencyKey: `opening:${policy._id}:${employee._id}`,
    note: "Paid leave balance carried into the configurable policy",
  });
};

const expireBalanceAtYearStart = async (employeeId, policy, yearStart) => {
  const yearKey = yearStart.format("YYYY-MM-DD");
  const idempotencyKey = `year-start:${policy._id}:${employeeId}:${yearKey}`;
  const alreadyProcessed = await LeaveLedger.exists({ idempotencyKey });
  if (alreadyProcessed) return;

  const employee = await Employee.findById(employeeId).lean();
  if (!employee) return;
  const balance = Math.max(0, employee.leaveBalance?.paid || 0);
  const balanceChange = policy.carryForwardEnabled ? 0 : -balance;

  const inserted = await createLedgerEntry({
    employeeId,
    policyId: policy._id,
    type: policy.carryForwardEnabled ? "CARRY_FORWARD" : "EXPIRE",
    amount: balance,
    balanceChange,
    effectiveAt: yearStart.toDate(),
    periodKey: yearKey,
    idempotencyKey,
    note: policy.carryForwardEnabled
      ? "Unused balance carried into the new leave year"
      : "Unused balance expired at the leave-year boundary",
  });

  if (inserted && balanceChange) {
    await Employee.updateOne(
      { _id: employeeId },
      { $set: { "leaveBalance.paid": 0 } },
      { runValidators: false },
    );
  }
};

const fulfillFutureReservations = async (employeeId, grantEvent, policyId) => {
  const reservations = await LeaveApplication.find({
    employeeId,
    type: "PAID",
    status: { $in: ["PENDING", "APPROVED"] },
    paidReservationActive: true,
    paidReservedFuture: { $gt: 0 },
    startDate: { $gte: grantEvent.grantDate },
  }).sort({ startDate: 1, createdAt: 1 });

  for (const leave of reservations) {
    const employee = await Employee.findById(employeeId).lean();
    const available = Math.max(0, employee?.leaveBalance?.paid || 0);
    const amount = roundDays(Math.min(available, leave.paidReservedFuture));
    if (amount <= 0) continue;

    const updated = await Employee.updateOne(
      { _id: employeeId, "leaveBalance.paid": { $gte: amount } },
      { $inc: { "leaveBalance.paid": -amount } },
      { runValidators: false },
    );
    if (updated.modifiedCount === 0) continue;

    const idempotencyKey = `future-reserve:${leave._id}:${grantEvent.periodKey}:v${leave.paidReservationVersion || 1}`;
    const inserted = await createLedgerEntry({
      employeeId,
      policyId,
      leaveApplicationId: leave._id,
      type: "RESERVE",
      amount,
      balanceChange: -amount,
      effectiveAt: grantEvent.grantDate,
      periodKey: grantEvent.periodKey,
      idempotencyKey,
      note: "Scheduled grant reserved for approved or pending future leave",
    });
    if (!inserted) {
      await applyBalanceChange(employeeId, amount);
      continue;
    }

    leave.paidReservedNow = roundDays(leave.paidReservedNow + amount);
    leave.paidReservedFuture = roundDays(leave.paidReservedFuture - amount);
    await leave.save();
  }
};

export const getPaidLeavePolicy = () =>
  LeavePolicy.findOne({ scope: "COMPANY" }).lean();

export const getForecastPaidGrants = async (employee, policy, throughDate) => {
  if (!policy || !employee) return [];
  const now = moment.tz(TIMEZONE).startOf("day");
  const through = moment(throughDate).tz(TIMEZONE).endOf("day");
  if (through.isBefore(now)) return [];

  const alreadyGranted = await LeaveLedger.find({
    employeeId: employee._id,
    policyId: policy._id,
    type: "GRANT",
  })
    .select("idempotencyKey")
    .lean();
  const grantedKeys = new Set(
    alreadyGranted.map((entry) => entry.idempotencyKey),
  );

  return getGrantEvents(
    employee,
    policy,
    through.toDate(),
    now.toDate(),
  ).filter((event) => !grantedKeys.has(event.idempotencyKey));
};

export const getFuturePaidReservations = async (employeeId, throughDate) => {
  const reservations = await LeaveApplication.find({
    employeeId,
    type: "PAID",
    status: { $in: ["PENDING", "APPROVED"] },
    paidReservationActive: true,
    paidReservedFuture: { $gt: 0 },
    startDate: { $lte: throughDate },
  })
    .select("paidReservedFuture")
    .lean();

  return roundDays(
    reservations.reduce((sum, leave) => sum + leave.paidReservedFuture, 0),
  );
};

export const processPaidLeaveGrants = async (
  employeeId,
  throughDate = new Date(),
) => {
  const [employee, policy] = await Promise.all([
    Employee.findById(employeeId),
    getPaidLeavePolicy(),
  ]);
  if (!employee || !policy) return { configured: Boolean(policy), grants: 0 };

  await snapshotOpeningBalance(employee, policy);

  const activation = moment(policy.activatedAt).tz(TIMEZONE).startOf("day");
  const through = moment(throughDate).tz(TIMEZONE).endOf("day");
  const firstYearStart = getLeaveYearStart(activation, policy).add(1, "year");
  const currentYearStart = getLeaveYearStart(through, policy);

  for (
    let yearStart = firstYearStart.clone();
    yearStart.isSameOrBefore(currentYearStart, "day");
    yearStart.add(1, "year")
  ) {
    await expireBalanceAtYearStart(employeeId, policy, yearStart);
  }

  const events = getGrantEvents(
    employee,
    policy,
    through.toDate(),
    activation.clone().subtract(1, "millisecond").toDate(),
  );
  let grants = 0;

  for (const event of events) {
    const inserted = await createLedgerEntry({
      employeeId,
      policyId: policy._id,
      type: "GRANT",
      amount: event.amount,
      balanceChange: event.amount,
      effectiveAt: event.grantDate,
      periodKey: event.periodKey,
      idempotencyKey: event.idempotencyKey,
      note: `Paid leave grant for ${policy.grantFrequency.toLowerCase()} period`,
    });
    if (!inserted) continue;

    await applyBalanceChange(employeeId, event.amount);
    grants += event.amount;
    await fulfillFutureReservations(employeeId, event, policy._id);
  }

  return { configured: true, grants: roundDays(grants) };
};

export const reservePaidLeave = async (leave, employee, workingDates) => {
  const policy = await getPaidLeavePolicy();
  if (!policy) throw new Error("The admin has not configured paid leave yet");

  await processPaidLeaveGrants(employee._id);
  const currentEmployee = await Employee.findById(employee._id).lean();
  const requestedDays = leave.chargedDays;
  const currentAvailable = Math.max(
    0,
    currentEmployee?.leaveBalance?.paid || 0,
  );
  const firstWorkday = workingDates[0];
  const forecastGrants = await getForecastPaidGrants(
    currentEmployee,
    policy,
    firstWorkday,
  );
  const futureGrantTotal = roundDays(
    forecastGrants.reduce((sum, grant) => sum + grant.amount, 0),
  );
  const existingFutureReservations = await getFuturePaidReservations(
    employee._id,
    firstWorkday,
  );
  const forecastAvailable = roundDays(
    currentAvailable + futureGrantTotal - existingFutureReservations,
  );

  if (forecastAvailable < requestedDays) {
    throw new Error(
      `Insufficient paid leave. ${forecastAvailable} day(s) are available by the requested leave date.`,
    );
  }

  const reservedNow = roundDays(Math.min(currentAvailable, requestedDays));
  const reservedFuture = roundDays(requestedDays - reservedNow);
  const reservationVersion = (leave.paidReservationVersion || 0) + 1;
  if (reservedNow > 0) {
    const updated = await Employee.updateOne(
      { _id: employee._id, "leaveBalance.paid": { $gte: reservedNow } },
      { $inc: { "leaveBalance.paid": -reservedNow } },
      { runValidators: false },
    );
    if (updated.modifiedCount === 0) {
      throw new Error("Paid leave balance changed. Please try again.");
    }
  }

  try {
    await createLedgerEntry({
      employeeId: employee._id,
      policyId: policy._id,
      leaveApplicationId: leave._id,
      type: "RESERVE",
      amount: reservedNow,
      balanceChange: -reservedNow,
      effectiveAt: new Date(),
      idempotencyKey: `reserve:${leave._id}:v${reservationVersion}`,
      note: "Paid leave reserved when the employee applied",
    });
    if (reservedFuture > 0) {
      await createLedgerEntry({
        employeeId: employee._id,
        policyId: policy._id,
        leaveApplicationId: leave._id,
        type: "RESERVE",
        amount: reservedFuture,
        balanceChange: 0,
        effectiveAt: new Date(),
        idempotencyKey: `reserve-future-planned:${leave._id}:v${reservationVersion}`,
        note: "Paid leave reserved against grants due before the leave date",
      });
    }

    leave.paidPolicyId = policy._id;
    leave.paidReservedNow = reservedNow;
    leave.paidReservedFuture = reservedFuture;
    leave.paidReservationActive = true;
    leave.paidReservationVersion = reservationVersion;
    await leave.save();
  } catch (error) {
    if (reservedNow > 0) await applyBalanceChange(employee._id, reservedNow);
    throw error;
  }
};

export const settlePaidLeaveApproval = async (leave, actor) => {
  if (!leave.paidReservationActive || !leave.paidPolicyId) return;
  await createLedgerEntry({
    employeeId: leave.employeeId,
    policyId: leave.paidPolicyId,
    leaveApplicationId: leave._id,
    type: "USE",
    amount: leave.chargedDays || 0,
    balanceChange: 0,
    effectiveAt: new Date(),
    idempotencyKey: `use:${leave._id}:v${leave.paidReservationVersion}`,
    createdBy: actor || "System",
    note: "Reserved paid leave approved",
  });
};

export const releasePaidLeaveReservation = async (leave, actor) => {
  if (!leave.paidReservationActive || !leave.paidPolicyId) return;
  const refund = roundDays(leave.paidReservedNow || 0);

  if (refund > 0) {
    const inserted = await createLedgerEntry({
      employeeId: leave.employeeId,
      policyId: leave.paidPolicyId,
      leaveApplicationId: leave._id,
      type: "RELEASE",
      amount: refund,
      balanceChange: refund,
      effectiveAt: new Date(),
      idempotencyKey: `release:${leave._id}:v${leave.paidReservationVersion}`,
      createdBy: actor || "System",
      note: "Paid leave reservation returned after rejection or cancellation",
    });
    if (inserted) await applyBalanceChange(leave.employeeId, refund);
  }

  leave.paidReservationActive = false;
  leave.paidReservedFuture = 0;
  await leave.save();
};

export const recordOpeningBalances = async (policy, employees) => {
  for (const employee of employees) {
    await snapshotOpeningBalance(employee, policy);
  }
};
