import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "fund payment reminders",
  { hourUTC: 5, minuteUTC: 0 },
  internal.fund.sendDueReminders,
);

export default crons;
