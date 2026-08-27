-- Notification tracking columns (auto-notifications Batch 2)
-- `appointments.reminder_sent_at`: stamped once when the ~24h appointment
--   reminder has been dispatched, so the reminder cron fires exactly once.
-- `orders.completion_notified_at`: stamped once when the "order completed"
--   notification (all report-bearing items published) has been sent.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "reminder_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "completion_notified_at" TIMESTAMP(3);
