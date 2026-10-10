import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "fund payment reminders",
  { hourUTC: 5, minuteUTC: 0 },
  internal.fund.sendDueReminders,
);

crons.daily(
  "yahrzeit reminders",
  { hourUTC: 5, minuteUTC: 10 },
  internal.yahrzeits.sendReminders,
);

crons.daily(
  "purge old schedule trash",
  { hourUTC: 2, minuteUTC: 0 },
  internal.schedules.purgeOldTrash,
);

crons.daily(
  "silver price for machatzit hashekel",
  { hourUTC: 9, minuteUTC: 30 },
  internal.silverPrice.refresh,
);

export default crons;
