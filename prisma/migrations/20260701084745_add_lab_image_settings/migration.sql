-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'LAB_TEST_SETTINGS';

-- CreateTable
CREATE TABLE "lab_image_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "display_position" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "alignment" TEXT NOT NULL,
    "image_size" TEXT NOT NULL,
    "aspect_ratio_1" TEXT,
    "aspect_ratio_2" TEXT,
    "aspect_ratio_3" TEXT,
    "aspect_ratio_4" TEXT,
    "page_break_control" TEXT NOT NULL,
    "header_retention" TEXT NOT NULL,
    "replacement_mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_image_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_pdf_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "pdf_mode" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "scale_mode" TEXT NOT NULL,
    "custom_scale_pct" INTEGER,
    "page_break_control" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_pdf_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_group_layout_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "name_alignment" TEXT NOT NULL,
    "column_layout" TEXT NOT NULL,
    "result_alignment" TEXT NOT NULL,
    "display_style" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_group_layout_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_icon_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "icon_count" INTEGER NOT NULL,
    "icons" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_icon_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_image_settings_tenant_id_idx" ON "lab_image_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_image_settings_branch_id_idx" ON "lab_image_settings"("branch_id");

-- CreateIndex
CREATE INDEX "lab_image_settings_deleted_at_idx" ON "lab_image_settings"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_pdf_settings_tenant_id_idx" ON "lab_pdf_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_pdf_settings_branch_id_idx" ON "lab_pdf_settings"("branch_id");

-- CreateIndex
CREATE INDEX "lab_pdf_settings_deleted_at_idx" ON "lab_pdf_settings"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_group_layout_settings_tenant_id_idx" ON "lab_group_layout_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_group_layout_settings_branch_id_idx" ON "lab_group_layout_settings"("branch_id");

-- CreateIndex
CREATE INDEX "lab_group_layout_settings_deleted_at_idx" ON "lab_group_layout_settings"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_icon_settings_tenant_id_idx" ON "lab_icon_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_icon_settings_branch_id_idx" ON "lab_icon_settings"("branch_id");

-- CreateIndex
CREATE INDEX "lab_icon_settings_deleted_at_idx" ON "lab_icon_settings"("deleted_at");
