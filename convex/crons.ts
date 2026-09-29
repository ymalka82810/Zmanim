import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "fund payment reminders",
  { hourUTC: 5, minuteUTC: 0 },
  internal.fund.sendDueReminders,
);

crons.daily(
  "purge old schedule trash",
  { hourUTC: 2, minuteUTC: 0 },
  internal.schedules.purgeOldTrash,
);

export default crons;
