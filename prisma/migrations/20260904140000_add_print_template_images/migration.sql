-- CreateTable
CREATE TABLE "print_template_images" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "token" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "print_template_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "print_template_images_tenant_id_idx" ON "print_template_images"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "print_template_images_tenant_id_token_key" ON "print_template_images"("tenant_id", "token");
