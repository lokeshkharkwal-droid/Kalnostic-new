-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('SMS', 'EMAIL', 'WHATSAPP', 'CONSENT_FORM', 'REPORT_TEMPLATE');

-- CreateEnum
CREATE TYPE "WhatsappTemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "TriggerEvent" AS ENUM ('REPORT_READY', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_REMINDER', 'SAMPLE_COLLECTED', 'SAMPLE_RECEIVED', 'CRITICAL_ALERT', 'INVOICE_GENERATED', 'PAYMENT_RECEIVED', 'OTP', 'REGISTRATION', 'PASSWORD_RESET', 'PRE_PROCEDURE', 'AT_REGISTRATION', 'ON_DEMAND', 'RECURRING', 'AT_DISCHARGE', 'CUSTOM');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'TEMPLATE';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "template_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "type" "TemplateType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "trigger_event" "TriggerEvent" NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1.0',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "body" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "header_block" JSONB,
    "footer_block" JSONB,
    "attachment" JSONB,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "templates_tenant_id_idx" ON "templates"("tenant_id");

-- CreateIndex
CREATE INDEX "templates_branch_id_idx" ON "templates"("branch_id");

-- CreateIndex
CREATE INDEX "templates_type_idx" ON "templates"("type");

-- CreateIndex
CREATE INDEX "templates_deleted_at_idx" ON "templates"("deleted_at");
