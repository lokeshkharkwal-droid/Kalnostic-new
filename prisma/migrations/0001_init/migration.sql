-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'O_POS', 'O_NEG', 'AB_POS', 'AB_NEG', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SiteAdminRole" AS ENUM ('CONTENT_ADMIN', 'OPERATIONS_ADMIN', 'FULL_ADMIN', 'SUPER_OWNER');

-- CreateEnum
CREATE TYPE "BranchType" AS ENUM ('DIAGNOSTIC', 'CLINIC', 'HOSPITAL', 'PHARMACY', 'COLLECTION_CENTER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "custom_domain" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" JSONB,
    "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "subscription_plan_id" TEXT,
    "trial_ends_at" TIMESTAMP(3),
    "subscription_ends_at" TIMESTAMP(3),
    "grace_period_ends_at" TIMESTAMP(3),
    "settings" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mrn_counter" INTEGER NOT NULL DEFAULT 0,
    "mrn_prefix" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "platform_mrn" TEXT NOT NULL,
    "salutation" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "date_of_birth" DATE,
    "gender" "Gender",
    "blood_group" "BloodGroup",
    "phone" TEXT,
    "email" TEXT,
    "address" JSONB,
    "photo_url" TEXT,
    "id_type" TEXT,
    "id_number" TEXT,
    "owner_tenant_id" TEXT,
    "is_patient" BOOLEAN NOT NULL DEFAULT false,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_credentials" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "system_username" TEXT,
    "is_system_generated_username" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" TEXT NOT NULL,
    "is_temp_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "person_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siteadmin_users" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "SiteAdminRole" NOT NULL DEFAULT 'CONTENT_ADMIN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "siteadmin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "branch_id" TEXT,
    "profile_key" TEXT,
    "issued_to_ip" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_tenant_enrollments" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "tenant_mrn" TEXT,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrolled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "person_tenant_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch_type" "BranchType" NOT NULL,
    "code" TEXT,
    "address" JSONB,
    "phone" TEXT,
    "email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "profile_key" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_branch_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profile_permission_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "profile_key" TEXT NOT NULL,
    "permission_code" TEXT NOT NULL,
    "override" TEXT NOT NULL,
    "set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_profile_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receptionist_doctor_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "receptionist_person_id" TEXT NOT NULL,
    "doctor_person_id" TEXT NOT NULL,
    "assigned_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "receptionist_doctor_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_custom_domain_key" ON "tenants"("custom_domain");

-- CreateIndex
CREATE INDEX "tenants_deleted_at_idx" ON "tenants"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "persons_platform_mrn_key" ON "persons"("platform_mrn");

-- CreateIndex
CREATE UNIQUE INDEX "persons_phone_key" ON "persons"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "persons_email_key" ON "persons"("email");

-- CreateIndex
CREATE INDEX "persons_owner_tenant_id_idx" ON "persons"("owner_tenant_id");

-- CreateIndex
CREATE INDEX "persons_deleted_at_idx" ON "persons"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "person_credentials_person_id_key" ON "person_credentials"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_credentials_phone_key" ON "person_credentials"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "person_credentials_email_key" ON "person_credentials"("email");

-- CreateIndex
CREATE UNIQUE INDEX "person_credentials_system_username_key" ON "person_credentials"("system_username");

-- CreateIndex
CREATE UNIQUE INDEX "siteadmin_users_email_key" ON "siteadmin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_person_id_idx" ON "refresh_tokens"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_tenant_enrollments_person_id_tenant_id_key" ON "person_tenant_enrollments"("person_id", "tenant_id");

-- CreateIndex
CREATE INDEX "branches_tenant_id_idx" ON "branches"("tenant_id");

-- CreateIndex
CREATE INDEX "branches_deleted_at_idx" ON "branches"("deleted_at");

-- CreateIndex
CREATE INDEX "user_branch_profiles_tenant_id_idx" ON "user_branch_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "user_branch_profiles_person_id_idx" ON "user_branch_profiles"("person_id");

-- CreateIndex
CREATE INDEX "user_branch_profiles_branch_id_idx" ON "user_branch_profiles"("branch_id");

-- CreateIndex
CREATE INDEX "user_profile_permission_overrides_tenant_id_person_id_profi_idx" ON "user_profile_permission_overrides"("tenant_id", "person_id", "profile_key");

-- CreateIndex
CREATE INDEX "receptionist_doctor_mappings_tenant_id_branch_id_receptioni_idx" ON "receptionist_doctor_mappings"("tenant_id", "branch_id", "receptionist_person_id");

