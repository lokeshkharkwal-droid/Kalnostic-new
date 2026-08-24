-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('PATIENT', 'DOCTOR', 'STAFF', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('MESSAGE', 'ALERT');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'COMMUNICATION';

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "channel" "MessagingChannel" NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'PENDING',
    "feature" TEXT,
    "template_id" TEXT,
    "recipient_type" "RecipientType" NOT NULL,
    "recipient_id" TEXT,
    "recipient_name" TEXT,
    "to_address" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "campaign" TEXT,
    "retry" INTEGER NOT NULL DEFAULT 0,
    "max_retry" INTEGER NOT NULL DEFAULT 3,
    "status_message" TEXT,
    "exchange_id" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "user_timezone" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "verb" TEXT NOT NULL,
    "context_id" TEXT,
    "context_type" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_actors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "notification_actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_targets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "name" TEXT,

    CONSTRAINT "notification_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communication_logs_tenant_id_idx" ON "communication_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "communication_logs_branch_id_idx" ON "communication_logs"("branch_id");

-- CreateIndex
CREATE INDEX "communication_logs_status_idx" ON "communication_logs"("status");

-- CreateIndex
CREATE INDEX "communication_logs_channel_idx" ON "communication_logs"("channel");

-- CreateIndex
CREATE INDEX "communication_logs_scheduled_at_idx" ON "communication_logs"("scheduled_at");

-- CreateIndex
CREATE INDEX "communication_logs_deleted_at_idx" ON "communication_logs"("deleted_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_idx" ON "notifications"("tenant_id");

-- CreateIndex
CREATE INDEX "notifications_branch_id_idx" ON "notifications"("branch_id");

-- CreateIndex
CREATE INDEX "notifications_kind_idx" ON "notifications"("kind");

-- CreateIndex
CREATE INDEX "notifications_context_id_idx" ON "notifications"("context_id");

-- CreateIndex
CREATE INDEX "notifications_deleted_at_idx" ON "notifications"("deleted_at");

-- CreateIndex
CREATE INDEX "notification_actors_tenant_id_idx" ON "notification_actors"("tenant_id");

-- CreateIndex
CREATE INDEX "notification_actors_notification_id_idx" ON "notification_actors"("notification_id");

-- CreateIndex
CREATE INDEX "notification_targets_tenant_id_idx" ON "notification_targets"("tenant_id");

-- CreateIndex
CREATE INDEX "notification_targets_notification_id_idx" ON "notification_targets"("notification_id");

-- CreateIndex
CREATE INDEX "notification_targets_entity_id_idx" ON "notification_targets"("entity_id");

-- CreateIndex
CREATE INDEX "notification_targets_is_read_idx" ON "notification_targets"("is_read");

-- AddForeignKey
ALTER TABLE "notification_actors" ADD CONSTRAINT "notification_actors_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_targets" ADD CONSTRAINT "notification_targets_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
