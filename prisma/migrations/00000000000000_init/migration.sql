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
CREATE TYPE "UserType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BranchType" AS ENUM ('DIAGNOSTIC', 'RADIOLOGY', 'OPD', 'IPD', 'PHARMACY', 'INVENTORY', 'BLOOD_BANK', 'FRANCHISE', 'COMBINED', 'ASSISTANT', 'ACCESSION', 'TECHNICIAN', 'COLLECTION_CENTER');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "ConsultationMode" AS ENUM ('IN_PERSON', 'VIDEO', 'PHONE');

-- CreateEnum
CREATE TYPE "ScheduleSlotType" AS ENUM ('NEW_CONSULTATION', 'FOLLOW_UP', 'OTHER');

-- CreateEnum
CREATE TYPE "DoctorScheduleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "RecurrencePattern" AS ENUM ('DAILY', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('AVAILABLE', 'BOOKED', 'FULL');

-- CreateEnum
CREATE TYPE "PhlebotomistScheduleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PhleboServiceType" AS ENUM ('HOME_COLLECTION', 'IN_CENTER');

-- CreateEnum
CREATE TYPE "SupportTenantType" AS ENUM ('BUSINESS', 'BRANCH');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DepartmentPosition" AS ENUM ('HOD', 'SPECIALIST', 'CONSULTANT', 'MANAGER', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INDEPENDENT', 'UNDER_DEPARTMENT');

-- CreateEnum
CREATE TYPE "CategoryPosition" AS ENUM ('HOD', 'SPECIALIST', 'CONSULTANT', 'MANAGER', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "SubCategoryType" AS ENUM ('INDEPENDENT', 'UNDER_DEPARTMENT', 'UNDER_CATEGORY');

-- CreateEnum
CREATE TYPE "SubCategoryPosition" AS ENUM ('HOD', 'SPECIALIST', 'CONSULTANT', 'MANAGER', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "PersonMappingType" AS ENUM ('USER', 'CONSULTANT_DOCTOR', 'REPORTING_DOCTOR', 'EXTERNAL_REFERRAL');

-- CreateEnum
CREATE TYPE "ShiftName" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'NIGHT');

-- CreateEnum
CREATE TYPE "AuditModule" AS ENUM ('USER', 'BRANCH', 'SCHEDULE', 'TENANT', 'DEPARTMENT', 'CATEGORY', 'SUB_CATEGORY', 'MASTER_DATA', 'LAB_TEST', 'LAB_PANEL', 'OUTSOURCE_CENTER', 'DOCTOR', 'REFERRAL_PANEL', 'REFERRAL_PANEL_SETTINGS', 'REFERRAL_DOCTOR', 'EXTERNAL_REFERRAL', 'INTERNAL_REFERRAL', 'MACHINE', 'DOCUMENT', 'TEMPLATE', 'PDF_REPORT_TEMPLATE', 'PATIENT', 'MEDICAL_HISTORY', 'ORDER', 'RADIOLOGIST', 'PHLEBOTOMIST', 'RADIOLOGY_TECHNICIAN', 'PAYMENT_DETAILS', 'APPOINTMENT', 'DOCTOR_SCHEDULE', 'PHLEBOTOMIST_SCHEDULE', 'SERVICE_ZONE', 'AUTH', 'SITEADMIN', 'LAB_TEST_SETTINGS', 'BILLING_SETTINGS', 'ACCESSION', 'PATIENT_SETTINGS', 'CONSOLE_SETTINGS', 'REPORT_SETTINGS', 'PHLEBOTOMIST_SETTINGS', 'LAB_REPORT', 'RE_RUN_REQUEST', 'CRITICAL_ALERT', 'OUT_OF_RANGE_FLAG', 'DELTA_CHECK', 'SCHEDULED_TEST', 'INVENTORY_USAGE', 'MULTI_STEP_PROCESS', 'LAB_ADAPTER', 'SALES_LEAD', 'SALES_TRIP', 'SALES_FOLLOW_UP', 'SALES_TERRITORY', 'SALES_SETTINGS');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('SOP', 'POLICY', 'FORM', 'CERTIFICATE', 'ACCREDITATION', 'QC_DOCUMENT', 'WORK_INSTRUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OutsourceContactRole" AS ENUM ('DIRECTOR', 'ACCESSION_PERSON', 'REGISTRATION_PERSON', 'LOGISTICS_PERSON', 'ACCOUNTS_PERSON');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('EMAIL', 'SMS', 'IAM', 'IAA', 'PBN', 'WHATSAPP', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('OTP', 'TRANSACTIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "SmsType" AS ENUM ('TRANSACTIONAL', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "WhatsappMessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "WhatsappTemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "ApplicableBranchType" AS ENUM ('LAB', 'CLINIC', 'HOSPITAL', 'BLOOD_BANK', 'RADIOLOGY');

-- CreateEnum
CREATE TYPE "MessagingLevel" AS ENUM ('ADMIN', 'BUSINESS');

-- CreateEnum
CREATE TYPE "ApplicationScope" AS ENUM ('KALNOSTIC');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('TENANT', 'SITE_ADMIN');

-- CreateEnum
CREATE TYPE "ProcessMethod" AS ENUM ('SINGLE_STEP', 'MULTI_STEP');

-- CreateEnum
CREATE TYPE "SamplePriority" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateEnum
CREATE TYPE "TatUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');

-- CreateEnum
CREATE TYPE "RepeatIntervalUnit" AS ENUM ('HOURS', 'DAYS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('ALL', 'ADULT', 'PEDIATRIC', 'SENIOR');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('COMBINED', 'SEPARATE');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('QUANTITATIVE', 'QUALITATIVE', 'CALCULATED');

-- CreateEnum
CREATE TYPE "ParameterType" AS ENUM ('MEASURED', 'CALCULATED');

-- CreateEnum
CREATE TYPE "ResultEntryMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "ResultRounding" AS ENUM ('NO_ROUNDING', 'ONE_DECIMAL', 'TWO_DECIMAL', 'THREE_DECIMAL', 'WHOLE_NUMBER');

-- CreateEnum
CREATE TYPE "ReferenceGender" AS ENUM ('ALL', 'MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "AgeUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "AbnormalFlag" AS ENUM ('BOLD_AND_RED', 'BOLD_ONLY', 'ITALIC', 'UNDERLINE', 'COLOUR_HIGHLIGHT');

-- CreateEnum
CREATE TYPE "ContainerType" AS ENUM ('EDTA_TUBE_PURPLE_TOP', 'PLAIN_TUBE_RED_TOP', 'FLUORIDE_TUBE_GREY_TOP', 'URINE_CONTAINER', 'STERILE_CONTAINER');

-- CreateEnum
CREATE TYPE "DoctorType" AS ENUM ('REPORTING', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "Salutation" AS ENUM ('DR', 'MR', 'MRS', 'MS', 'PROF');

-- CreateEnum
CREATE TYPE "PatientCategory" AS ENUM ('GENERAL', 'VIP', 'SENIOR_CITIZEN', 'PEDIATRIC', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'OTHER');

-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('DRAFT', 'CREATED');

-- CreateEnum
CREATE TYPE "AgeType" AS ENUM ('YEARS', 'MONTHS', 'DAYS');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('SELF', 'SPOUSE', 'SON', 'DAUGHTER', 'FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'SIBLING', 'GUARDIAN', 'FRIEND', 'OTHER');

-- CreateEnum
CREATE TYPE "DoctorPaymentMode" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReferralDoctorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ExternalReferralStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InternalReferralStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CommissionMode" AS ENUM ('INCLUDED_IN_SALARY', 'SEPARATE_PAYOUT');

-- CreateEnum
CREATE TYPE "ReferralClientType" AS ENUM ('CASH', 'PREPAID', 'POSTPAID');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'SLAB_BASED', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "FixedCommissionCycle" AS ENUM ('ORDER_WISE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "PaymentCycle" AS ENUM ('NA', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "ReferralPaymentMode" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "ReferralPanelSettingsStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReferralBonusType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "PgCommissionType" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('ONLINE', 'OFFLINE', 'MAINTENANCE', 'ERROR');

-- CreateEnum
CREATE TYPE "AdapterLogType" AS ENUM ('ERROR', 'INFO', 'WARNING');

-- CreateEnum
CREATE TYPE "PaymentRuleType" AS ENUM ('CITRUS_COMMISSION', 'PAYU_COMMISSION', 'PINELAB_COMMISSION', 'EZ_COMMISSION', 'PHARMACY_TAXES');

-- CreateEnum
CREATE TYPE "PaymentCalculationType" AS ENUM ('FIXED', 'PERCENT', 'RULE');

-- CreateEnum
CREATE TYPE "BillingInvoiceResetCycle" AS ENUM ('NEVER', 'YEARLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "GstMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE', 'EXEMPT');

-- CreateEnum
CREATE TYPE "RefundApprovalLevel" AS ENUM ('COUNTER', 'MANAGER_ONLY', 'FINANCE_ONLY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'QUOTE', 'APPOINTMENT', 'ORDER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'CONVERTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('WALK_IN', 'APP', 'WEBSITE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_PAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('CASH_CLIENT', 'INSURANCE', 'CORPORATE', 'GOVERNMENT_SCHEME', 'TPA');

-- CreateEnum
CREATE TYPE "SampleSource" AS ENUM ('IN_HOUSE', 'SUPPLIED');

-- CreateEnum
CREATE TYPE "ConsultantType" AS ENUM ('INITIAL', 'FIRST', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "OpdVisitType" AS ENUM ('WALK_IN', 'TELECONSULTATION', 'HOME_VISIT');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CREDIT', 'UPI', 'CARD', 'WALLET', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "B2bClientType" AS ENUM ('CASH', 'CREDIT', 'WALLET');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('DIAGNOSTIC', 'OPD', 'RADIOLOGY');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('NEW', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'PATIENT_INFORMED', 'STARTED_FROM_CENTER', 'REACHED_PATIENT_LOCATION', 'SAMPLE_COLLECTED', 'COLLECTION_VERIFIED', 'IN_TRANSIT', 'RECEIVED_AT_LAB', 'ACCEPTED_BY_LAB', 'COMPLETED', 'RESCHEDULED', 'CANCELLED', 'ON_HOLD', 'PATIENT_NOT_AVAILABLE', 'SAMPLE_NOT_COLLECTED', 'PARTIAL_COLLECTION', 'SAMPLE_REJECTED', 'PAYMENT_PENDING');

-- CreateEnum
CREATE TYPE "CollectionPriority" AS ENUM ('NORMAL', 'URGENT', 'HIGH');

-- CreateEnum
CREATE TYPE "TatBand" AS ENUM ('WITHIN', 'WARNING', 'CRITICAL', 'BREACHED');

-- CreateEnum
CREATE TYPE "LabReportStatus" AS ENUM ('PENDING', 'PARTIAL_PENDING', 'SAVED', 'VALIDATION_PENDING', 'RESULT_DONE', 'APPROVED', 'PUBLISHED', 'ERROR_REPORTED', 'RESULT_REJECTED');

-- CreateEnum
CREATE TYPE "ResultValueSource" AS ENUM ('MANUAL', 'ADAPTER');

-- CreateEnum
CREATE TYPE "LabReportNoteCategory" AS ENUM ('ORDER', 'SAMPLE', 'TECH', 'LOCK', 'DELTA', 'CRITICAL_ALERT', 'OUT_OF_RANGE', 'RE_RUN', 'SCHEDULE', 'ERROR_REPORTED', 'RESULT_REJECTED', 'UPDATE_STATUS', 'MULTI_STEP');

-- CreateEnum
CREATE TYPE "WorklistStatus" AS ENUM ('NEW', 'PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ActionWorklistStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DeltaCheckStatus" AS ENUM ('NEW', 'REVIEWED', 'RE_RUN', 'ACCEPTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WorklistTrigger" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "MultiStepProcessType" AS ENUM ('HISTOPATHOLOGY_ROUTINE', 'BONE_MARROW_WORKUP', 'CYTOLOGY_WORKFLOW', 'IMMUNOHISTOCHEMISTRY_PANEL');

-- CreateEnum
CREATE TYPE "MultiStepStage" AS ENUM ('GROSSING', 'SECTIONING', 'STAINING', 'REPORTING');

-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('NEW', 'COLLECTED', 'ACCEPTED', 'ACQUIRED', 'HALT', 'ERROR', 'HOLD', 'REPEAT', 'SENT_INTERNAL', 'FORWARD_EXTERNAL', 'STORED', 'DISCARDED', 'RETURNED', 'CANCELLED', 'OUTSOURCED');

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('INTERNAL', 'EXTERNAL', 'OUTSOURCE');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'PICKED_UP', 'RECEIVED', 'ACCEPTED', 'REPEAT', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW_LEAD', 'SCHEDULED', 'CONFIRMED', 'STARTED', 'REACHED', 'MEETING_IN_PROGRESS', 'MEETING_COMPLETED', 'PROPOSAL_SHARED', 'QUOTATION_SHARED', 'NEGOTIATION', 'AGREEMENT_PENDING', 'CONVERTED', 'CLIENT_ONBOARDING', 'ACTIVE_CLIENT', 'FOLLOW_UP_REQUIRED', 'RESCHEDULED', 'CANCELLED', 'NO_RESPONSE', 'NOT_INTERESTED', 'LOST', 'ON_HOLD', 'DUPLICATE_LEAD');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('PROSPECTING', 'QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL_QUOTATION', 'NEGOTIATION', 'AGREEMENT', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('PHYSICAL_VISIT', 'ONLINE_MEETING', 'PHONE_CALL', 'DEMO', 'PRESENTATION', 'QUOTATION_DISCUSSION', 'AGREEMENT_DISCUSSION', 'TECHNICAL_DISCUSSION', 'FINANCE_DISCUSSION');

-- CreateEnum
CREATE TYPE "SalesDocumentStatus" AS ENUM ('NOT_STARTED', 'REQUIRED', 'SHARED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('NOT_STARTED', 'IN_DISCUSSION', 'SENT', 'SIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingOutcome" AS ENUM ('FOLLOW_UP_REQUIRED', 'PROPOSAL_REQUIRED', 'PROPOSAL_SHARED', 'QUOTATION_REQUIRED', 'QUOTATION_SHARED', 'NEGOTIATION', 'CONVERTED', 'NOT_INTERESTED', 'LOST', 'RESCHEDULED', 'PENDING_MANAGEMENT_APPROVAL', 'PENDING_TECHNICAL_DISCUSSION', 'PENDING_FINANCE_DISCUSSION', 'NEED_PRODUCT_DEMO', 'NEED_RATE_APPROVAL', 'NEED_AGREEMENT_REVIEW');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripVisitStatus" AS ENUM ('PLANNED', 'COMPLETED', 'PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpType" AS ENUM ('PHONE_CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'ONLINE');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'PENDING', 'COMPLETED', 'CONVERTED', 'CANCELLED', 'RESCHEDULED', 'NO_RESPONSE');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "custom_domain" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "short_name" TEXT,
    "address" JSONB,
    "address_line" TEXT,
    "pincode" TEXT,
    "country_id" TEXT,
    "state_id" TEXT,
    "city_id" TEXT,
    "area_id" TEXT,
    "logo_url" TEXT,
    "photo_url" TEXT,
    "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "subscription_plan_id" TEXT,
    "trial_ends_at" TIMESTAMP(3),
    "subscription_ends_at" TIMESTAMP(3),
    "grace_period_ends_at" TIMESTAMP(3),
    "settings" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mrn_counter" INTEGER NOT NULL DEFAULT 0,
    "mrn_prefix" TEXT,
    "branch_counter" INTEGER NOT NULL DEFAULT 0,
    "staff_counter" INTEGER NOT NULL DEFAULT 0,
    "department_counter" INTEGER NOT NULL DEFAULT 0,
    "category_counter" INTEGER NOT NULL DEFAULT 0,
    "sub_category_counter" INTEGER NOT NULL DEFAULT 0,
    "outsource_center_counter" INTEGER NOT NULL DEFAULT 0,
    "referral_panel_counter" INTEGER NOT NULL DEFAULT 0,
    "order_counter" INTEGER NOT NULL DEFAULT 0,
    "appointment_counter" INTEGER NOT NULL DEFAULT 0,
    "diagnostic_bill_counter" INTEGER NOT NULL DEFAULT 0,
    "accession_counter" INTEGER NOT NULL DEFAULT 0,
    "lead_counter" INTEGER NOT NULL DEFAULT 0,
    "trip_counter" INTEGER NOT NULL DEFAULT 0,
    "follow_up_counter" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_configurations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_admin_url" TEXT,
    "site_title" TEXT,
    "logo_path" TEXT,
    "logo_link" TEXT,
    "template" TEXT,
    "theme" "Theme" NOT NULL DEFAULT 'LIGHT',
    "patient_order_url" TEXT,
    "max_orders_per_day_per_branch" INTEGER,
    "max_users_allowed" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "is_external_doctor_out_referral_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_external_doctor_in_referral_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_external_hospital_out_referral_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_external_hospital_in_referral_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_patient_order_payment_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_cms_order_bill_generation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "referral_pg_commission_type" "PgCommissionType" NOT NULL DEFAULT 'EXCLUSIVE',
    "patient_pg_commission_type" "PgCommissionType" NOT NULL DEFAULT 'EXCLUSIVE',
    "franchise_branch_pg_commission_type" "PgCommissionType" NOT NULL DEFAULT 'EXCLUSIVE',
    "can_patient_wallet_go_negative" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siteadmin_counters" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "department_counter" INTEGER NOT NULL DEFAULT 0,
    "category_counter" INTEGER NOT NULL DEFAULT 0,
    "sub_category_counter" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "siteadmin_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "platform_mrn" TEXT NOT NULL,
    "salutation" TEXT,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
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
    "nationality" TEXT DEFAULT 'Indian',
    "father_name" TEXT,
    "mother_name" TEXT,
    "aadhaar_number" TEXT,
    "pan_number" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_number" TEXT,
    "designation" TEXT,
    "qualification" TEXT,
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
    "auth_role_id" TEXT,
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
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "states" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pin_code" TEXT NOT NULL,
    "state_id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "state_id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch_type" "BranchType" NOT NULL,
    "code" TEXT NOT NULL,
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "established_date" TIMESTAMP(3),
    "address_line" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "manager_name" TEXT,
    "manager_phone" TEXT,
    "lab_director" TEXT,
    "opening_time" TEXT,
    "closing_time" TEXT,
    "daily_capacity" INTEGER,
    "operational_days" "DayOfWeek"[],
    "timezone" TEXT,
    "gst_no" TEXT,
    "license_no" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "is_nabl_tat_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowed_branch_types" "BranchType"[],
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "auth_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "auth_role_id" TEXT NOT NULL,
    "branch_status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "default_module_id" TEXT,
    "enabled_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
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
    "auth_role_id" TEXT NOT NULL,
    "permission_code" TEXT NOT NULL,
    "override" TEXT NOT NULL,
    "set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_profile_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_staff_memberships" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "user_type" "UserType" NOT NULL DEFAULT 'INTERNAL',
    "auth_role_id" TEXT,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenant_staff_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_modules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_center_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "collection_center_id" TEXT NOT NULL,
    "receiving_branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "collection_center_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_permissions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_branch_permissions_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "tenant_main_branch" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_main_branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "shifts" JSONB NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "cloned_from_id" TEXT,
    "preference" "MessagingChannel" NOT NULL,
    "feature" TEXT NOT NULL,
    "display_title" TEXT,
    "message_type" "MessageType",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "specific_application" "ApplicationScope",
    "applicable_branch_type" "ApplicableBranchType",
    "level" "MessagingLevel" NOT NULL DEFAULT 'BUSINESS',
    "entity_id" TEXT,
    "entity_type" TEXT,
    "sms_template_id" TEXT,
    "sms_sender_id" TEXT,
    "sms_type" "SmsType",
    "template" TEXT NOT NULL,
    "template_type" "WhatsappMessageType",
    "template_category" "WhatsappTemplateCategory",
    "file_name" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_report_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "cloned_from_id" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "doc" JSONB,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pdf_report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_template_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "slot_key" TEXT NOT NULL,
    "template_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pdf_template_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "cloned_from_id" TEXT,
    "short_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "module_mapping" "BranchType"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_person_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "type" "PersonMappingType" NOT NULL DEFAULT 'USER',
    "branch_id" TEXT,
    "position" "DepartmentPosition" NOT NULL,
    "is_signatory" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "department_person_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "cloned_from_id" TEXT,
    "short_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "category_type" "CategoryType" NOT NULL,
    "department_id" TEXT,
    "module_mapping" "BranchType"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "document_number" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "category_id" TEXT,
    "department_id" TEXT,
    "author_id" TEXT,
    "approved_by_id" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" TEXT NOT NULL,
    "effective_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "review_date" TIMESTAMP(3),
    "file_name" TEXT,
    "file_url" TEXT,
    "description" TEXT,
    "latest_version_no" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "document_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "category_id" TEXT,
    "department_id" TEXT,
    "author_id" TEXT,
    "approved_by_id" TEXT,
    "status" "DocumentStatus" NOT NULL,
    "effective_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "review_date" TIMESTAMP(3),
    "file_name" TEXT,
    "file_url" TEXT,
    "description" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_person_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "type" "PersonMappingType" NOT NULL DEFAULT 'USER',
    "branch_id" TEXT,
    "position" "CategoryPosition" NOT NULL,
    "is_signatory" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "category_person_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "cloned_from_id" TEXT,
    "short_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sub_category_type" "SubCategoryType" NOT NULL,
    "department_id" TEXT,
    "category_id" TEXT,
    "module_mapping" "BranchType"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sub_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_category_person_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sub_category_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "type" "PersonMappingType" NOT NULL DEFAULT 'USER',
    "branch_id" TEXT,
    "position" "SubCategoryPosition" NOT NULL,
    "is_signatory" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sub_category_person_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "module" "AuditModule" NOT NULL,
    "action" "AuditAction" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "actor_person_id" TEXT NOT NULL,
    "actor_role_key" TEXT,
    "actor_role_label" TEXT,
    "ip_address" TEXT,
    "resource_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_data" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "master_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "test_name" TEXT NOT NULL,
    "test_display_name" TEXT,
    "test_code" TEXT NOT NULL,
    "aka" TEXT,
    "department_id" TEXT,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "process_method" "ProcessMethod" NOT NULL DEFAULT 'SINGLE_STEP',
    "icd_code" TEXT,
    "loinc_code" TEXT,
    "clinical_tags" TEXT[],
    "report_template_id" TEXT,
    "sample_priority_type" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "pdf_settings_id" TEXT,
    "image_settings_id" TEXT,
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "approval_workflow_id" TEXT,
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "emergency_price" INTEGER NOT NULL DEFAULT 0,
    "commission_price" INTEGER,
    "discount_cap_pct" INTEGER NOT NULL DEFAULT 0,
    "is_allow_price_override" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_discounts" BOOLEAN NOT NULL DEFAULT true,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit",
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit",
    "schedule_days" "DayOfWeek"[],
    "schedule_from" TEXT,
    "schedule_to" TEXT,
    "processing_time_from" TEXT,
    "processing_time_to" TEXT,
    "proc_time_min_value" INTEGER,
    "proc_time_min_unit" "TatUnit",
    "proc_time_max_value" INTEGER,
    "proc_time_max_unit" "TatUnit",
    "approval_time_from" TEXT,
    "approval_time_to" TEXT,
    "is_hide_in_order_screen" BOOLEAN NOT NULL DEFAULT false,
    "is_preference_test" BOOLEAN NOT NULL DEFAULT false,
    "is_mandatory_test" BOOLEAN NOT NULL DEFAULT false,
    "mandatory_dept_id" TEXT,
    "mandatory_cat_id" TEXT,
    "mandatory_subcat_id" TEXT,
    "is_repeat_interval_restriction" BOOLEAN NOT NULL DEFAULT false,
    "repeat_interval_value" INTEGER,
    "repeat_interval_unit" "RepeatIntervalUnit",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "useful_for" TEXT,
    "interpretation_of_results" TEXT,
    "limitations" TEXT,
    "remarks" TEXT,
    "references" TEXT,
    "version_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_samples" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "lab_test_id" TEXT NOT NULL,
    "sample_name_id" TEXT,
    "sample_type" TEXT,
    "container_type" "ContainerType",
    "sample_size" TEXT,
    "collection_method" TEXT,
    "number_of_samples" INTEGER NOT NULL DEFAULT 1,
    "stability" TEXT,
    "transport_temperature" TEXT,
    "preservative" TEXT,
    "sample_handling_instructions" TEXT,
    "is_fasting_required" BOOLEAN NOT NULL DEFAULT false,
    "is_light_protection" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_result_params" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "lab_test_id" TEXT NOT NULL,
    "group_name" TEXT,
    "group_layout_id" TEXT,
    "group_settings_id" TEXT,
    "parameter_name" TEXT NOT NULL,
    "parameter_code" TEXT NOT NULL,
    "method" TEXT,
    "attach_file_url" TEXT,
    "icon_settings_id" TEXT,
    "reporting_unit" TEXT,
    "result_type" "ResultType" NOT NULL,
    "parameter_type" "ParameterType" NOT NULL DEFAULT 'MEASURED',
    "result_entry_mode" "ResultEntryMode" NOT NULL DEFAULT 'MANUAL',
    "calculation_formula" TEXT,
    "result_rounding_type" "ResultRounding" NOT NULL DEFAULT 'TWO_DECIMAL',
    "allowable_units" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "critical_min" DECIMAL(10,4),
    "critical_max" DECIMAL(10,4),
    "reflex_tests" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "is_nabl" BOOLEAN NOT NULL DEFAULT false,
    "is_cap" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_result_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_reference_ranges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "lab_test_id" TEXT NOT NULL,
    "param_id" TEXT NOT NULL,
    "method" TEXT,
    "gender" "ReferenceGender" NOT NULL DEFAULT 'ALL',
    "age_from" INTEGER NOT NULL DEFAULT 0,
    "age_from_unit" "AgeUnit" NOT NULL DEFAULT 'YEARS',
    "age_to" INTEGER NOT NULL DEFAULT 999,
    "age_to_unit" "AgeUnit" NOT NULL DEFAULT 'YEARS',
    "lower_limit" DECIMAL(10,4),
    "upper_limit" DECIMAL(10,4),
    "critical_min" DECIMAL(10,4),
    "critical_max" DECIMAL(10,4),
    "display_of_reference_range" TEXT,
    "abnormal_flag_logic" "AbnormalFlag" NOT NULL DEFAULT 'BOLD_AND_RED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_reference_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_reference_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "lab_test_id" TEXT NOT NULL,
    "param_id" TEXT NOT NULL,
    "method" TEXT,
    "gender" "ReferenceGender" NOT NULL DEFAULT 'ALL',
    "age_from" INTEGER NOT NULL DEFAULT 0,
    "age_from_unit" "AgeUnit" NOT NULL DEFAULT 'YEARS',
    "age_to" INTEGER NOT NULL DEFAULT 999,
    "age_to_unit" "AgeUnit" NOT NULL DEFAULT 'YEARS',
    "normal_value_text" TEXT NOT NULL,
    "display_of_reference_range" TEXT,
    "abnormal_flag_logic" "AbnormalFlag" NOT NULL DEFAULT 'BOLD_AND_RED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_reference_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "banner_image" TEXT,
    "panel_name" TEXT NOT NULL,
    "panel_code" TEXT NOT NULL,
    "category_id" TEXT,
    "department_id" TEXT,
    "applicable_gender" "ReferenceGender" NOT NULL DEFAULT 'ALL',
    "applicable_age_group" "AgeGroup" NOT NULL DEFAULT 'ALL',
    "report_type" "ReportType" NOT NULL DEFAULT 'COMBINED',
    "turnaround_priority" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "commission_price" INTEGER,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit" DEFAULT 'HOURS',
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit" DEFAULT 'HOURS',
    "panel_instructions" TEXT,
    "is_disable_discount" BOOLEAN NOT NULL DEFAULT false,
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "is_preference" BOOLEAN NOT NULL DEFAULT false,
    "is_fasting_required" BOOLEAN NOT NULL DEFAULT false,
    "is_show_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "is_home_collection" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_partial_billing" BOOLEAN NOT NULL DEFAULT false,
    "max_tests_removable" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "lab_panel_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_lab_test_id" TEXT,
    "source_master_data_id" TEXT,
    "test_name" TEXT NOT NULL,
    "test_display_name" TEXT,
    "test_code" TEXT NOT NULL,
    "aka" TEXT,
    "department_id" TEXT,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "process_method" "ProcessMethod" NOT NULL DEFAULT 'SINGLE_STEP',
    "icd_code" TEXT,
    "loinc_code" TEXT,
    "clinical_tags" TEXT[],
    "report_template_id" TEXT,
    "sample_priority_type" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "pdf_settings_id" TEXT,
    "image_settings_id" TEXT,
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "approval_workflow_id" TEXT,
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "emergency_price" INTEGER NOT NULL DEFAULT 0,
    "commission_price" INTEGER,
    "discount_cap_pct" INTEGER NOT NULL DEFAULT 0,
    "is_allow_price_override" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_discounts" BOOLEAN NOT NULL DEFAULT true,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit",
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit",
    "schedule_days" "DayOfWeek"[],
    "schedule_from" TEXT,
    "schedule_to" TEXT,
    "processing_time_from" TEXT,
    "processing_time_to" TEXT,
    "proc_time_min_value" INTEGER,
    "proc_time_min_unit" "TatUnit",
    "proc_time_max_value" INTEGER,
    "proc_time_max_unit" "TatUnit",
    "approval_time_from" TEXT,
    "approval_time_to" TEXT,
    "is_hide_in_order_screen" BOOLEAN NOT NULL DEFAULT false,
    "is_preference_test" BOOLEAN NOT NULL DEFAULT false,
    "is_mandatory_test" BOOLEAN NOT NULL DEFAULT false,
    "mandatory_dept_id" TEXT,
    "mandatory_cat_id" TEXT,
    "mandatory_subcat_id" TEXT,
    "is_repeat_interval_restriction" BOOLEAN NOT NULL DEFAULT false,
    "repeat_interval_value" INTEGER,
    "repeat_interval_unit" "RepeatIntervalUnit",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "useful_for" TEXT,
    "interpretation_of_results" TEXT,
    "limitations" TEXT,
    "remarks" TEXT,
    "references" TEXT,
    "config_snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_lab_panel_id" TEXT,
    "source_master_data_id" TEXT,
    "banner_image" TEXT,
    "panel_name" TEXT NOT NULL,
    "panel_code" TEXT NOT NULL,
    "category_id" TEXT,
    "department_id" TEXT,
    "applicable_gender" "ReferenceGender" NOT NULL DEFAULT 'ALL',
    "applicable_age_group" "AgeGroup" NOT NULL DEFAULT 'ALL',
    "report_type" "ReportType" NOT NULL DEFAULT 'COMBINED',
    "turnaround_priority" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "commission_price" INTEGER,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit" DEFAULT 'HOURS',
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit" DEFAULT 'HOURS',
    "panel_instructions" TEXT,
    "is_disable_discount" BOOLEAN NOT NULL DEFAULT false,
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "is_preference" BOOLEAN NOT NULL DEFAULT false,
    "is_fasting_required" BOOLEAN NOT NULL DEFAULT false,
    "is_show_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "is_home_collection" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_partial_billing" BOOLEAN NOT NULL DEFAULT false,
    "max_tests_removable" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_lab_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "branch_lab_panel_id" TEXT NOT NULL,
    "branch_lab_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_lab_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_groups" (
    "id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "test_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_group_mappings" (
    "id" TEXT NOT NULL,
    "test_group_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "test_group_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "setup_document" TEXT,
    "labconfig_document" TEXT,
    "adopter_document" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_lab_tests" (
    "id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "equipment_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_adapters" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_adapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_adapter_branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_adapter_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_adapter_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_adapter_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_adapter_id" TEXT NOT NULL,
    "branch_lab_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_adapter_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outsource_centers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "outsource_center_name" TEXT NOT NULL,
    "short_name" TEXT,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "pincode" TEXT,
    "gst_number" TEXT,
    "pan_number" TEXT,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "ifsc_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_nabl_accredited" BOOLEAN NOT NULL DEFAULT false,
    "lab_test_id" TEXT,
    "lab_panel_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outsource_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outsource_center_contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "outsource_center_id" TEXT NOT NULL,
    "role" "OutsourceContactRole" NOT NULL,
    "name" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outsource_center_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_panel_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "setting_name" TEXT NOT NULL,
    "client_type" "ReferralClientType" NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReferralPanelSettingsStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_send_bills_to_patient" BOOLEAN NOT NULL DEFAULT false,
    "is_send_bills_to_b2b" BOOLEAN NOT NULL DEFAULT false,
    "is_send_bills_to_doctor" BOOLEAN NOT NULL DEFAULT false,
    "is_send_reports_to_patient" BOOLEAN NOT NULL DEFAULT false,
    "is_send_reports_to_b2b" BOOLEAN NOT NULL DEFAULT false,
    "is_send_reports_to_doctor" BOOLEAN NOT NULL DEFAULT false,
    "credit_limit_amount" DECIMAL(12,2),
    "is_restrict_order_credit_limit" BOOLEAN NOT NULL DEFAULT false,
    "is_restrict_report_credit_limit" BOOLEAN NOT NULL DEFAULT false,
    "credit_allowed_days" INTEGER,
    "is_restrict_order_credit_days" BOOLEAN NOT NULL DEFAULT false,
    "is_restrict_report_credit_days" BOOLEAN NOT NULL DEFAULT false,
    "days_after_invoice" INTEGER,
    "is_restrict_order_post_invoice" BOOLEAN NOT NULL DEFAULT false,
    "is_restrict_report_post_invoice" BOOLEAN NOT NULL DEFAULT false,
    "is_auto_invoice" BOOLEAN NOT NULL DEFAULT false,
    "is_raise_invoice_on_credit_limit" BOOLEAN NOT NULL DEFAULT false,
    "invoice_frequency_days" INTEGER,
    "is_overlap_month_end_close" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_manual_invoice" BOOLEAN NOT NULL DEFAULT false,
    "invoice_email_trigger_hours" INTEGER,
    "min_wallet_advance" DECIMAL(12,2),
    "min_advance_for_bonus" DECIMAL(12,2),
    "min_wallet_balance" DECIMAL(12,2),
    "is_restrict_order_at_min_balance" BOOLEAN NOT NULL DEFAULT false,
    "is_reminder_at_75_percent" BOOLEAN NOT NULL DEFAULT false,
    "is_reminder_at_min_balance" BOOLEAN NOT NULL DEFAULT false,
    "bonus_type" "ReferralBonusType",
    "bonus_percentage" DECIMAL(5,2),
    "bonus_fixed_amount" DECIMAL(12,2),
    "bonus_extra_amount" DECIMAL(12,2),
    "is_allow_negative_balance" BOOLEAN NOT NULL DEFAULT false,
    "max_negative_balance" DECIMAL(12,2),
    "is_restrict_order_negative" BOOLEAN NOT NULL DEFAULT false,
    "is_restrict_report_negative" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_other_payment_modes" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_panel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT NOT NULL,
    "referral_panel_name" TEXT NOT NULL,
    "short_name" TEXT,
    "panel_code" TEXT,
    "client_type" "ReferralClientType" NOT NULL,
    "referral_panel_settings_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gst_number" TEXT,
    "pan_number" TEXT,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "director_name" TEXT,
    "director_mobile" TEXT,
    "director_email" TEXT,
    "accession_person_name" TEXT,
    "accession_person_mobile" TEXT,
    "accession_person_email" TEXT,
    "registration_person_name" TEXT,
    "registration_person_mobile" TEXT,
    "registration_person_email" TEXT,
    "logistics_person_name" TEXT,
    "logistics_person_mobile" TEXT,
    "logistics_person_email" TEXT,
    "accounts_person_name" TEXT,
    "accounts_person_mobile" TEXT,
    "accounts_person_email" TEXT,
    "is_commission_applicable" BOOLEAN NOT NULL DEFAULT false,
    "commission_type" "CommissionType",
    "commission_pct_lab_test" DECIMAL(5,2),
    "commission_pct_lab_panel" DECIMAL(5,2),
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "fixed_commission_cycle" "FixedCommissionCycle",
    "fixed_amount" DECIMAL(10,2),
    "is_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "tds" INTEGER,
    "payment_cycle" "PaymentCycle" NOT NULL DEFAULT 'NA',
    "payment_mode" "ReferralPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "monthly_target_amount" INTEGER NOT NULL DEFAULT 0,
    "is_incentive_bonus_applicable" BOOLEAN NOT NULL DEFAULT false,
    "bonus_slabs" JSONB NOT NULL DEFAULT '[]',
    "file_name" TEXT,
    "file_url" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_panel_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_panel_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_panel_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_panel_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_panel_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_panel_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_type" "DoctorType" NOT NULL,
    "branch_id" TEXT,
    "salutation" "Salutation",
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "gender" "Gender",
    "phone" TEXT NOT NULL,
    "alternate_phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "registration_no" TEXT NOT NULL,
    "registration_council" TEXT,
    "registration_expiry" DATE,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "department_id" TEXT,
    "is_nabl_authorized" BOOLEAN NOT NULL DEFAULT false,
    "is_cap_certified" BOOLEAN NOT NULL DEFAULT false,
    "is_iso_certified" BOOLEAN NOT NULL DEFAULT false,
    "is_report_signatory" BOOLEAN NOT NULL DEFAULT false,
    "signatory_name" TEXT,
    "signatory_designation" TEXT,
    "signature_image_path" TEXT,
    "signatory_department_ids" JSONB,
    "signatory_category_ids" JSONB,
    "signatory_sub_category_ids" JSONB,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "payment_mode" "DoctorPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "follow_up_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_allow_discount" BOOLEAN NOT NULL DEFAULT false,
    "status" "DoctorStatus" NOT NULL DEFAULT 'ACTIVE',
    "joining_date" DATE,
    "remarks" TEXT,
    "rating" DECIMAL(2,1),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_qualifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "degree" TEXT,
    "institution" TEXT,
    "year_of_passing" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_experience" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "organisation" TEXT,
    "role_position" TEXT,
    "from_date" DATE,
    "to_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "doctor_id" TEXT NOT NULL,
    "consultation_mode" "ConsultationMode"[],
    "slot_type" "ScheduleSlotType" NOT NULL,
    "status" "DoctorScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "break_start" TEXT,
    "break_end" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "slot_interval_minutes" INTEGER NOT NULL,
    "max_patients_per_slot" INTEGER NOT NULL,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "recurrence_pattern" "RecurrencePattern" NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedule_days" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_schedule_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedule_holidays" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "holiday_date" DATE NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_schedule_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedule_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "override_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_schedule_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_slots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "doctor_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "slot_date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "max_patients" INTEGER NOT NULL,
    "booked_patients" INTEGER NOT NULL DEFAULT 0,
    "status" "SlotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_zones" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "service_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomist_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "phlebotomist_id" TEXT NOT NULL,
    "service_type" "PhleboServiceType" NOT NULL,
    "status" "PhlebotomistScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "interval_minutes" INTEGER NOT NULL,
    "travel_buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "max_visits_per_day" INTEGER NOT NULL,
    "slot_capacity" INTEGER NOT NULL,
    "recurrence_pattern" "RecurrencePattern" NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomist_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomist_schedule_days" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomist_schedule_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomist_schedule_zones" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomist_schedule_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomist_schedule_holidays" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "holiday_date" DATE NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomist_schedule_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomist_schedule_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "override_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomist_schedule_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomist_slots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "phlebotomist_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "slot_date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "slot_capacity" INTEGER NOT NULL,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "status" "SlotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomist_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomist_day_loads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "phlebotomist_id" TEXT NOT NULL,
    "load_date" DATE NOT NULL,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomist_day_loads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT,
    "gender" "Gender" NOT NULL DEFAULT 'MALE',
    "date_of_birth" DATE,
    "mobile_number" TEXT NOT NULL,
    "email" TEXT,
    "aadhaar_number" TEXT,
    "pan_number" TEXT,
    "hospital_name" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "department_id" TEXT,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "medical_license_number" TEXT,
    "registration_council" TEXT,
    "registration_valid_till" DATE,
    "referral_panel_settings_id" TEXT,
    "is_commission_applicable" BOOLEAN NOT NULL DEFAULT false,
    "commission_type" "CommissionType",
    "commission_pct_lab_test" DECIMAL(5,2),
    "commission_pct_lab_panel" DECIMAL(5,2),
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "fixed_commission_cycle" "FixedCommissionCycle",
    "fixed_amount" DECIMAL(10,2),
    "is_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "tds" INTEGER,
    "payment_cycle" "PaymentCycle" NOT NULL DEFAULT 'NA',
    "payment_mode" "ReferralPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "monthly_target_amount" INTEGER NOT NULL DEFAULT 0,
    "is_incentive_bonus_applicable" BOOLEAN NOT NULL DEFAULT false,
    "bonus_slabs" JSONB NOT NULL DEFAULT '[]',
    "file_name" TEXT,
    "file_url" TEXT,
    "remarks" TEXT,
    "status" "ReferralDoctorStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctor_qualifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_doctor_id" TEXT NOT NULL,
    "qualification_type" TEXT,
    "degree_name" TEXT,
    "institution_name" TEXT,
    "year_of_completion" INTEGER,
    "percentage_grade" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctor_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctor_experience" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_doctor_id" TEXT NOT NULL,
    "position" TEXT,
    "organisation" TEXT,
    "from_date" DATE,
    "to_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctor_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctor_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_doctor_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctor_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctor_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_doctor_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctor_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_referrals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "organisation_name" TEXT,
    "referral_code" TEXT,
    "status" "ExternalReferralStatus" NOT NULL DEFAULT 'ACTIVE',
    "mobile_number" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pin_code" TEXT,
    "pan_number" TEXT,
    "aadhaar_number" TEXT,
    "gst_number" TEXT,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "referral_panel_settings_id" TEXT,
    "is_commission_applicable" BOOLEAN NOT NULL DEFAULT false,
    "commission_type" "CommissionType",
    "commission_pct_lab_test" DECIMAL(5,2),
    "commission_pct_lab_panel" DECIMAL(5,2),
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "fixed_commission_cycle" "FixedCommissionCycle",
    "fixed_amount" DECIMAL(10,2),
    "is_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "tds" INTEGER,
    "payment_cycle" "PaymentCycle" NOT NULL DEFAULT 'NA',
    "payment_mode" "ReferralPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "monthly_target_amount" INTEGER NOT NULL DEFAULT 0,
    "is_incentive_bonus_applicable" BOOLEAN NOT NULL DEFAULT false,
    "bonus_slabs" JSONB NOT NULL DEFAULT '[]',
    "file_name" TEXT,
    "file_url" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_referral_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_referral_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_referral_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_referral_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_referral_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_referral_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_referrals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "employee_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "full_name" TEXT,
    "department" TEXT,
    "designation" TEXT,
    "joining_date" DATE,
    "mobile_number" TEXT,
    "email" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "referral_panel_settings_id" TEXT,
    "is_commission_applicable" BOOLEAN NOT NULL DEFAULT false,
    "commission_type" "CommissionType",
    "commission_pct_lab_test" DECIMAL(5,2),
    "commission_pct_lab_panel" DECIMAL(5,2),
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "fixed_commission_cycle" "FixedCommissionCycle",
    "fixed_amount" DECIMAL(10,2),
    "is_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "tds" INTEGER,
    "is_included_in_payroll" BOOLEAN NOT NULL DEFAULT false,
    "payment_cycle" "PaymentCycle" NOT NULL DEFAULT 'MONTHLY',
    "payment_mode" "ReferralPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "commission_mode" "CommissionMode" NOT NULL DEFAULT 'INCLUDED_IN_SALARY',
    "monthly_target_amount" INTEGER NOT NULL DEFAULT 0,
    "is_incentive_bonus_applicable" BOOLEAN NOT NULL DEFAULT false,
    "bonus_slabs" JSONB NOT NULL DEFAULT '[]',
    "file_name" TEXT,
    "file_url" TEXT,
    "remarks" TEXT,
    "status" "InternalReferralStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "internal_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_referral_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "internal_referral_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "internal_referral_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_referral_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "internal_referral_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "internal_referral_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "code" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_no" TEXT,
    "department_id" TEXT,
    "status" "MachineStatus" NOT NULL DEFAULT 'OFFLINE',
    "last_calibration_date" TIMESTAMP(3),
    "last_maintenance_date" TIMESTAMP(3),
    "next_calibration_date" TIMESTAMP(3),
    "next_maintenance_due" TIMESTAMP(3),
    "analyser_image" TEXT,
    "machine_notes" TEXT,
    "interface_type" TEXT,
    "token_number" TEXT,
    "connection_type" TEXT,
    "host_pc_ip_address" TEXT,
    "analyser_ip_address" TEXT,
    "port" INTEGER,
    "is_adapter_server" BOOLEAN,
    "adapter_supports" TEXT[],
    "reference_images" TEXT[],
    "interface_note" TEXT,
    "is_bidirectional_interface" BOOLEAN NOT NULL DEFAULT false,
    "is_auto_validate_results" BOOLEAN NOT NULL DEFAULT false,
    "is_auto_flag_critical" BOOLEAN NOT NULL DEFAULT false,
    "interface_configuration_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_reagent_kits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "reagent_kit_name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machine_reagent_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_test_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "lis_code" TEXT NOT NULL,
    "lis_test_name" TEXT NOT NULL,
    "analyzer_code" TEXT NOT NULL,
    "analyzer_name" TEXT NOT NULL,
    "unit" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machine_test_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_adapter_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "sr_no" INTEGER,
    "logged_at" TIMESTAMP(3),
    "log_type" "AdapterLogType",
    "status" TEXT,
    "source_ip" TEXT,
    "is_viewed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machine_adapter_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machine_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_rules" (
    "id" TEXT NOT NULL,
    "rule_type" "PaymentRuleType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "tenant_id" INTEGER,
    "branch_id" INTEGER,
    "rank" INTEGER NOT NULL,
    "context_type" INTEGER,
    "context_id" INTEGER,
    "class_1" TEXT,
    "class_2" TEXT,
    "calculation_type" "PaymentCalculationType" NOT NULL,
    "calculation_value" TEXT NOT NULL,
    "tax_type" TEXT,
    "tax_percentage" INTEGER,
    "effective_period_start_date" TIMESTAMP(3),
    "effective_period_end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV-',
    "next_invoice_number" INTEGER NOT NULL DEFAULT 1,
    "invoice_reset_cycle" "BillingInvoiceResetCycle" NOT NULL DEFAULT 'YEARLY',
    "receipt_footer" TEXT,
    "gst_mode" "GstMode" NOT NULL DEFAULT 'INCLUSIVE',
    "default_gst_percent" INTEGER NOT NULL DEFAULT 18,
    "counter_discount_max" INTEGER NOT NULL DEFAULT 10,
    "manager_discount_max" INTEGER NOT NULL DEFAULT 25,
    "is_approval_required_above_counter_limit" BOOLEAN NOT NULL DEFAULT true,
    "is_line_item_discount_allowed" BOOLEAN NOT NULL DEFAULT true,
    "is_cash_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_card_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_upi_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_wallet_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_bank_transfer_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_credit_b2b_enabled" BOOLEAN NOT NULL DEFAULT true,
    "refund_approval_level" "RefundApprovalLevel" NOT NULL DEFAULT 'MANAGER_ONLY',
    "refund_window_days" INTEGER NOT NULL DEFAULT 7,
    "is_credit_note_auto_generated_on_refund" BOOLEAN NOT NULL DEFAULT true,
    "is_refund_blocked_after_report_dispatch" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id_format" TEXT NOT NULL DEFAULT 'PT-{YY}{AUTO}',
    "next_patient_number" INTEGER NOT NULL DEFAULT 1,
    "duplicate_check_strategy" TEXT NOT NULL DEFAULT 'Mobile + DOB',
    "default_title" TEXT NOT NULL DEFAULT '—',
    "is_mobile_number_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "is_email_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "is_dob_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "is_gender_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "is_address_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "is_id_proof_number_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "is_digital_consent_capture_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_mobile_masking_in_printouts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_whatsapp_report_sharing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "data_retention_period" TEXT NOT NULL DEFAULT '5 years',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "console_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "default_order_mode" TEXT NOT NULL DEFAULT 'Walk-in',
    "default_priority" TEXT NOT NULL DEFAULT 'Routine',
    "is_edit_tests_after_collection_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_barcode_required_before_acceptance" BOOLEAN NOT NULL DEFAULT true,
    "routine_warning_hours" INTEGER NOT NULL DEFAULT 4,
    "routine_breach_hours" INTEGER NOT NULL DEFAULT 8,
    "urgent_warning_hours" INTEGER NOT NULL DEFAULT 2,
    "urgent_breach_hours" INTEGER NOT NULL DEFAULT 4,
    "stat_warning_hours" INTEGER NOT NULL DEFAULT 1,
    "stat_breach_hours" INTEGER NOT NULL DEFAULT 2,
    "is_audio_chime_on_new_order_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_auto_print_labels_on_save_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_outsource_station_in_queue_visible" BOOLEAN NOT NULL DEFAULT true,
    "is_breached_tat_highlight_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "console_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_name_on_header" TEXT NOT NULL DEFAULT 'Kalnostic Diagnostics',
    "tag_line" TEXT NOT NULL DEFAULT 'Accuracy. Trust. Care.',
    "logo_position" TEXT NOT NULL DEFAULT 'Left',
    "page_size" TEXT NOT NULL DEFAULT 'A4',
    "pathologist_name" TEXT NOT NULL DEFAULT 'Dr. Priya Sharma',
    "pathologist_reg_number" TEXT NOT NULL DEFAULT 'MCI/12345',
    "lab_incharge_name" TEXT NOT NULL DEFAULT 'Dr. Amit Patel',
    "is_digital_signature_image_printed" BOOLEAN NOT NULL DEFAULT true,
    "is_auto_publish_after_second_validation_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_email_pdf_on_publish_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_whatsapp_link_on_publish_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_referring_doctor_notify_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pdf_watermark" TEXT NOT NULL DEFAULT 'None',
    "report_footer_note" TEXT NOT NULL DEFAULT 'Reports correlate clinically.',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_settings_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "support_infos" (
    "id" TEXT NOT NULL,
    "meta_type" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "tenant_type" "SupportTenantType" NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'ACTIVE',
    "request_url" TEXT,
    "help_content" TEXT NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "support_infos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "salutation" "Salutation",
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT,
    "gender" "Gender",
    "blood_group" "BloodGroup",
    "relationship" "Relationship",
    "date_of_birth" DATE,
    "age" INTEGER,
    "age_type" "AgeType",
    "mobile" TEXT NOT NULL,
    "whatsapp_number" TEXT,
    "email" TEXT,
    "alternate_email" TEXT,
    "alternate_mobile_number" TEXT,
    "country" TEXT,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "area" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "has_privilege_card" BOOLEAN NOT NULL DEFAULT false,
    "privilege_number" TEXT,
    "patient_category" "PatientCategory",
    "marital_status" "MaritalStatus",
    "um_id" TEXT,
    "aadhaar_number" TEXT,
    "pan_number" TEXT,
    "passport_number" TEXT,
    "guardian_name" TEXT,
    "guardian_relationship" "Relationship",
    "guardian_email" TEXT,
    "guardian_mobile_number" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_mobile_number" TEXT,
    "status" "PatientStatus" NOT NULL DEFAULT 'CREATED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_family_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "relationship" "Relationship" NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patient_family_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_histories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "is_current_smoker" BOOLEAN NOT NULL DEFAULT false,
    "is_former_smoker" BOOLEAN NOT NULL DEFAULT false,
    "is_current_alcoholic" BOOLEAN NOT NULL DEFAULT false,
    "is_former_alcoholic" BOOLEAN NOT NULL DEFAULT false,
    "has_cough" BOOLEAN NOT NULL DEFAULT false,
    "has_fever" BOOLEAN NOT NULL DEFAULT false,
    "has_shortness_of_breath" BOOLEAN NOT NULL DEFAULT false,
    "has_chest_pain" BOOLEAN NOT NULL DEFAULT false,
    "has_abdominal_pain" BOOLEAN NOT NULL DEFAULT false,
    "has_headache" BOOLEAN NOT NULL DEFAULT false,
    "has_vomiting" BOOLEAN NOT NULL DEFAULT false,
    "has_diarrhea" BOOLEAN NOT NULL DEFAULT false,
    "has_fatigue" BOOLEAN NOT NULL DEFAULT false,
    "has_weight_loss" BOOLEAN NOT NULL DEFAULT false,
    "has_body_pains" BOOLEAN NOT NULL DEFAULT false,
    "has_dizziness" BOOLEAN NOT NULL DEFAULT false,
    "has_diabetes" BOOLEAN NOT NULL DEFAULT false,
    "has_hypertension" BOOLEAN NOT NULL DEFAULT false,
    "has_cardiac_disease" BOOLEAN NOT NULL DEFAULT false,
    "has_thyroid_disease" BOOLEAN NOT NULL DEFAULT false,
    "has_kidney_disease" BOOLEAN NOT NULL DEFAULT false,
    "has_anti_diabetic_drugs" BOOLEAN NOT NULL DEFAULT false,
    "has_anti_hypertension_drugs" BOOLEAN NOT NULL DEFAULT false,
    "has_blood_thinners" BOOLEAN NOT NULL DEFAULT false,
    "has_vitamin_supplements" BOOLEAN NOT NULL DEFAULT false,
    "other_medications" TEXT,
    "has_latex_allergy" BOOLEAN NOT NULL DEFAULT false,
    "has_food_allergy" BOOLEAN NOT NULL DEFAULT false,
    "has_drug_allergy" BOOLEAN NOT NULL DEFAULT false,
    "surgical_history" TEXT,
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "medical_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_code" TEXT NOT NULL,
    "bill_id" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "order_type" "OrderType" NOT NULL,
    "billing_type" "BillingType" NOT NULL,
    "is_urgent_bill" BOOLEAN NOT NULL DEFAULT false,
    "is_bill_generated" BOOLEAN NOT NULL DEFAULT false,
    "order_notes" TEXT,
    "order_time" TEXT,
    "billing_details" JSONB,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'NOT_PAID',
    "quotation_status" "QuotationStatus",
    "quotation_valid_till" DATE,
    "patient_id" TEXT NOT NULL,
    "appointment_at" TIMESTAMP(3),
    "appointment_type" "AppointmentType",
    "appointment_id" TEXT,
    "referred_by_doctor_id" TEXT,
    "referral_panel_id" TEXT,
    "b2b_client" "B2bClientType",
    "internal_referral_id" TEXT,
    "external_referral_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "branch_lab_test_id" TEXT,
    "branch_lab_panel_id" TEXT,
    "direct" TEXT,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "collected_at" TIMESTAMP(3),
    "collected_by" TEXT,
    "outsource_center_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_item_id" TEXT NOT NULL,
    "lab_test_id" TEXT,
    "status" "LabReportStatus" NOT NULL DEFAULT 'PENDING',
    "saved_at" TIMESTAMP(3),
    "saved_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "validated_at" TIMESTAMP(3),
    "validated_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by" TEXT,
    "tat_start_at" TIMESTAMP(3),
    "tat_net_minutes" INTEGER,
    "tat_max_minutes" INTEGER,
    "tat_band" "TatBand",
    "is_nabl_tat" BOOLEAN NOT NULL DEFAULT false,
    "tat_is_running" BOOLEAN NOT NULL DEFAULT false,
    "tat_last_tick_at" TIMESTAMP(3),
    "tat_end_at" TIMESTAMP(3),
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lock_notes" TEXT,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "is_outsourced" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_result_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "result_param_id" TEXT NOT NULL,
    "observed_1" TEXT,
    "observed_2" TEXT,
    "unit" TEXT,
    "methodology" TEXT,
    "reference_range_id" TEXT,
    "reference_display" TEXT,
    "source" "ResultValueSource" NOT NULL DEFAULT 'MANUAL',
    "entered_at" TIMESTAMP(3),
    "entered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_report_result_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "category" "LabReportNoteCategory" NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "notes" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "fromStatus" "LabReportStatus",
    "toStatus" "LabReportStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "re_run_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "ActionWorklistStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT NOT NULL,
    "request_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "re_run_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "WorklistStatus" NOT NULL DEFAULT 'NEW',
    "trigger" "WorklistTrigger" NOT NULL DEFAULT 'MANUAL',
    "report_status_at_trigger" "LabReportStatus" NOT NULL,
    "result_param_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "critical_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "out_of_range_flags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "WorklistStatus" NOT NULL DEFAULT 'NEW',
    "trigger" "WorklistTrigger" NOT NULL DEFAULT 'MANUAL',
    "report_status_at_trigger" "LabReportStatus" NOT NULL,
    "result_param_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "out_of_range_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delta_checks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "DeltaCheckStatus" NOT NULL DEFAULT 'NEW',
    "trigger" "WorklistTrigger" NOT NULL DEFAULT 'MANUAL',
    "previous_result_value_id" TEXT,
    "result_param_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "delta_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "ActionWorklistStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "dispatch_at" TIMESTAMP(3),
    "assigned_to_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "scheduled_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multi_step_test_processes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "process_type" "MultiStepProcessType" NOT NULL,
    "current_stage" "MultiStepStage" NOT NULL DEFAULT 'GROSSING',
    "stage_history" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "multi_step_test_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_inventory_usage" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "batch_number" TEXT,
    "expiry_date" DATE,
    "allocated_pu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "allocated_bu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "re_run_pu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "re_run_bu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "wastage_pu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "wastage_bu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_report_inventory_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_diagnostics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "prescription_url" TEXT,
    "diagnostic_panel_id" TEXT,
    "sample_source" "SampleSource" NOT NULL DEFAULT 'IN_HOUSE',
    "sample_collection_charges" INTEGER NOT NULL DEFAULT 0,
    "logistics_supplied_by" TEXT,
    "is_fasting" BOOLEAN NOT NULL DEFAULT false,
    "is_home_visit" BOOLEAN NOT NULL DEFAULT false,
    "collection_address" TEXT,
    "phlebotomist_id" TEXT,
    "visit_charges" INTEGER NOT NULL DEFAULT 0,
    "collection_at" TIMESTAMP(3),
    "appointment_at" TIMESTAMP(3),
    "geo_location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_diagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_opd" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "department_id" TEXT,
    "category_id" TEXT,
    "doctor_id" TEXT NOT NULL,
    "consultant_type" "ConsultantType",
    "visit_type" "OpdVisitType",
    "consultation_at" TIMESTAMP(3),
    "appointment_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_opd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_radiology" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "radiologist_id" TEXT NOT NULL,
    "radiologist_department_id" TEXT,
    "radiologist_category_id" TEXT,
    "radiology_technician_id" TEXT,
    "appointment_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_radiology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_field_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_field_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_details" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "order_discount" INTEGER NOT NULL DEFAULT 0,
    "visiting_charges" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "deduct_from_wallet" INTEGER NOT NULL DEFAULT 0,
    "deduct_from_points" INTEGER NOT NULL DEFAULT 0,
    "has_cleared_previous_dues" BOOLEAN NOT NULL DEFAULT false,
    "tds_deduction" INTEGER NOT NULL DEFAULT 0,
    "payable_amount" INTEGER NOT NULL DEFAULT 0,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "remaining_balance" INTEGER NOT NULL DEFAULT 0,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "payment_date" TIMESTAMP(3),
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT NOT NULL,
    "appointment_type" "AppointmentType" NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'NEW',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "appointment_id" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL,
    "notes" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_visit_collections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "phlebotomist_id" TEXT,
    "status" "CollectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "previous_status" "CollectionStatus",
    "scheduled_collection_at" TIMESTAMP(3),
    "collection_address" TEXT,
    "geo_location" TEXT,
    "priority" "CollectionPriority" NOT NULL DEFAULT 'NORMAL',
    "sample_condition_at_collection" TEXT,
    "reason_for_delay" TEXT,
    "reason_for_cancellation" TEXT,
    "distance_km" DOUBLE PRECISION,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "home_visit_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_visit_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "collection_id" TEXT NOT NULL,
    "status" "CollectionStatus" NOT NULL,
    "from_status" "CollectionStatus",
    "notes" TEXT,
    "attachment_url" TEXT,
    "gps_location" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "home_visit_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accession_samples" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "accession_no" TEXT NOT NULL,
    "barcode" TEXT,
    "sample_type" TEXT,
    "container_type" "ContainerType",
    "sample_group_label" TEXT,
    "status" "SampleStatus" NOT NULL DEFAULT 'NEW',
    "previous_status" "SampleStatus",
    "priority" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "report_status" TEXT,
    "collected_at" TIMESTAMP(3),
    "collected_by" TEXT,
    "tube_type" TEXT,
    "received_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "sample_condition" TEXT,
    "store_location" TEXT,
    "logistics_type" TEXT,
    "logistics_person" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "origin_branch_id" TEXT,
    "processing_branch_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accession_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accession_sample_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "sample_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "test_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accession_sample_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accession_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "sample_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "to_status" "SampleStatus" NOT NULL,
    "from_status" "SampleStatus",
    "reason" TEXT,
    "notes" TEXT,
    "attachment_url" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accession_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "sample_id" TEXT NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "transfer_status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "origin_branch_id" TEXT,
    "destination_branch_id" TEXT,
    "outsource_center_id" TEXT,
    "external_partner_ref" TEXT,
    "external_partner_name" TEXT,
    "send_date" TIMESTAMP(3),
    "send_time" TEXT,
    "sample_form" TEXT,
    "logistics_type" TEXT,
    "logistics_person" TEXT,
    "picked_up_by" TEXT,
    "picked_up_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "receive_condition" TEXT,
    "accepted_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "repeat_reason" TEXT,
    "outsource_status" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sample_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accession_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accession_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "appointment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomist_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomist_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_territories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sales_territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lead_code" TEXT NOT NULL,
    "lead_at" TIMESTAMP(3),
    "lead_owner_id" TEXT,
    "assigned_salesperson_id" TEXT,
    "department" TEXT,
    "territory_id" TEXT,
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW_LEAD',
    "category" TEXT NOT NULL,
    "estimated_deal_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expected_closure_date" TIMESTAMP(3),
    "probability_percent" INTEGER NOT NULL DEFAULT 0,
    "pipeline_stage" "PipelineStage" NOT NULL DEFAULT 'PROSPECTING',
    "organization_name" TEXT NOT NULL,
    "organization_type" TEXT NOT NULL,
    "registration_number" TEXT,
    "gst_number" TEXT,
    "pan" TEXT,
    "website" TEXT,
    "organization_size" TEXT,
    "number_of_branches" INTEGER NOT NULL DEFAULT 0,
    "annual_patient_volume" INTEGER NOT NULL DEFAULT 0,
    "monthly_referral_potential" INTEGER NOT NULL DEFAULT 0,
    "existing_diagnostic_partner" TEXT,
    "competitor_name" TEXT,
    "primary_contact_name" TEXT NOT NULL,
    "designation" TEXT,
    "contact_department" TEXT,
    "mobile" TEXT NOT NULL,
    "alternate_mobile" TEXT,
    "whatsapp" TEXT,
    "landline" TEXT,
    "email" TEXT,
    "preferred_contact" TEXT,
    "is_decision_maker" BOOLEAN NOT NULL DEFAULT false,
    "is_influencer" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT DEFAULT 'India',
    "state" TEXT,
    "district" TEXT,
    "city" TEXT,
    "area" TEXT,
    "address_line" TEXT,
    "pincode" TEXT,
    "landmark" TEXT,
    "geo_location" TEXT,
    "distance_from_branch" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "source_person_name" TEXT,
    "source_contact_number" TEXT,
    "source_remarks" TEXT,
    "service_interested_in" TEXT,
    "test_menu_required" TEXT,
    "package_required" TEXT,
    "expected_monthly_volume" INTEGER NOT NULL DEFAULT 0,
    "expected_monthly_revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expected_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "is_credit_required" BOOLEAN NOT NULL DEFAULT false,
    "credit_days_required" INTEGER NOT NULL DEFAULT 0,
    "billing_type" TEXT,
    "required_integrations" TEXT[],
    "required_documents" TEXT[],
    "meeting_type" "MeetingType",
    "meeting_date" TIMESTAMP(3),
    "meeting_time" TEXT,
    "meeting_location" TEXT,
    "meeting_agenda" TEXT,
    "expected_attendees" TEXT,
    "is_reminder_required" BOOLEAN NOT NULL DEFAULT false,
    "reminder_at" TIMESTAMP(3),
    "mrp_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "offered_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "is_special_rate_card_required" BOOLEAN NOT NULL DEFAULT false,
    "is_commission_required" BOOLEAN NOT NULL DEFAULT false,
    "referral_commission_percent" INTEGER NOT NULL DEFAULT 0,
    "revenue_share_percent" INTEGER NOT NULL DEFAULT 0,
    "expected_margin" INTEGER NOT NULL DEFAULT 0,
    "payment_terms" TEXT,
    "is_security_deposit_required" BOOLEAN NOT NULL DEFAULT false,
    "is_agreement_required" BOOLEAN NOT NULL DEFAULT false,
    "is_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "is_gst_applicable" BOOLEAN NOT NULL DEFAULT true,
    "is_nda_required" BOOLEAN NOT NULL DEFAULT false,
    "agreement_status" "AgreementStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "agreement_start_date" TIMESTAMP(3),
    "agreement_end_date" TIMESTAMP(3),
    "document_verification_status" TEXT,
    "license_verification_status" TEXT,
    "is_nabl_required" BOOLEAN NOT NULL DEFAULT false,
    "data_privacy_requirement" TEXT,
    "has_report_sharing_consent" BOOLEAN NOT NULL DEFAULT false,
    "authorized_signatory_name" TEXT,
    "authorized_signatory_contact" TEXT,
    "internal_notes" TEXT,
    "client_notes" TEXT,
    "visit_notes" TEXT,
    "objections_raised" TEXT,
    "proposal_file_url" TEXT,
    "quotation_file_url" TEXT,
    "agreement_file_url" TEXT,
    "attachments" TEXT[],
    "other_documents" TEXT[],
    "next_follow_up_date" TIMESTAMP(3),
    "proposal_status" "SalesDocumentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "quotation_status" "SalesDocumentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "converted_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_histories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "LeadStatus",
    "to_status" "LeadStatus",
    "by_person_id" TEXT,
    "gps" TEXT,
    "remarks" TEXT,
    "attachment_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_meetings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lead_id" TEXT NOT NULL,
    "type" "MeetingType",
    "scheduled_at" TIMESTAMP(3),
    "location" TEXT,
    "agenda" TEXT,
    "attendees" TEXT,
    "outcome" "MeetingOutcome",
    "summary" TEXT,
    "requirement" TEXT,
    "objections" TEXT,
    "competitor" TEXT,
    "expected_monthly_business" INTEGER,
    "gps" TEXT,
    "attachment_url" TEXT,
    "by_person_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lead_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "follow_up_code" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "type" "FollowUpType" NOT NULL,
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "due_at" TIMESTAMP(3),
    "requirement" TEXT,
    "last_discussion" TEXT,
    "next_action" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
    "assigned_salesperson_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_status_histories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "follow_up_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "FollowUpStatus",
    "to_status" "FollowUpStatus",
    "by_person_id" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "trip_code" TEXT NOT NULL,
    "lead_id" TEXT,
    "trip_date" TIMESTAMP(3),
    "salesperson_id" TEXT,
    "starting_location" TEXT,
    "starting_gps" TEXT,
    "starting_time" TEXT,
    "ending_location" TEXT,
    "ending_gps" TEXT,
    "ending_time" TEXT,
    "km_travelled" INTEGER NOT NULL DEFAULT 0,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_visits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "lead_id" TEXT,
    "label" TEXT,
    "gps" TEXT,
    "planned_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "status" "TripVisitStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "trip_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_custom_domain_key" ON "tenants"("custom_domain");

-- CreateIndex
CREATE INDEX "tenants_country_id_idx" ON "tenants"("country_id");

-- CreateIndex
CREATE INDEX "tenants_state_id_idx" ON "tenants"("state_id");

-- CreateIndex
CREATE INDEX "tenants_city_id_idx" ON "tenants"("city_id");

-- CreateIndex
CREATE INDEX "tenants_area_id_idx" ON "tenants"("area_id");

-- CreateIndex
CREATE INDEX "tenants_deleted_at_idx" ON "tenants"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_configurations_tenant_id_key" ON "tenant_configurations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

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
CREATE INDEX "refresh_tokens_auth_role_id_idx" ON "refresh_tokens"("auth_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_tenant_enrollments_person_id_tenant_id_key" ON "person_tenant_enrollments"("person_id", "tenant_id");

-- CreateIndex
CREATE INDEX "countries_deleted_at_idx" ON "countries"("deleted_at");

-- CreateIndex
CREATE INDEX "states_country_id_idx" ON "states"("country_id");

-- CreateIndex
CREATE INDEX "states_deleted_at_idx" ON "states"("deleted_at");

-- CreateIndex
CREATE INDEX "cities_state_id_idx" ON "cities"("state_id");

-- CreateIndex
CREATE INDEX "cities_country_id_idx" ON "cities"("country_id");

-- CreateIndex
CREATE INDEX "cities_deleted_at_idx" ON "cities"("deleted_at");

-- CreateIndex
CREATE INDEX "areas_city_id_idx" ON "areas"("city_id");

-- CreateIndex
CREATE INDEX "areas_state_id_idx" ON "areas"("state_id");

-- CreateIndex
CREATE INDEX "areas_country_id_idx" ON "areas"("country_id");

-- CreateIndex
CREATE INDEX "areas_deleted_at_idx" ON "areas"("deleted_at");

-- CreateIndex
CREATE INDEX "branches_tenant_id_idx" ON "branches"("tenant_id");

-- CreateIndex
CREATE INDEX "branches_deleted_at_idx" ON "branches"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "branch_settings_branch_id_key" ON "branch_settings"("branch_id");

-- CreateIndex
CREATE INDEX "branch_settings_tenant_id_idx" ON "branch_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "auth_roles_tenant_id_idx" ON "auth_roles"("tenant_id");

-- CreateIndex
CREATE INDEX "auth_roles_deleted_at_idx" ON "auth_roles"("deleted_at");

-- CreateIndex
CREATE INDEX "user_branch_profiles_tenant_id_idx" ON "user_branch_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "user_branch_profiles_person_id_idx" ON "user_branch_profiles"("person_id");

-- CreateIndex
CREATE INDEX "user_branch_profiles_branch_id_idx" ON "user_branch_profiles"("branch_id");

-- CreateIndex
CREATE INDEX "user_branch_profiles_auth_role_id_idx" ON "user_branch_profiles"("auth_role_id");

-- CreateIndex
CREATE INDEX "user_profile_permission_overrides_tenant_id_person_id_auth__idx" ON "user_profile_permission_overrides"("tenant_id", "person_id", "auth_role_id");

-- CreateIndex
CREATE INDEX "tenant_staff_memberships_tenant_id_idx" ON "tenant_staff_memberships"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_staff_memberships_person_id_idx" ON "tenant_staff_memberships"("person_id");

-- CreateIndex
CREATE INDEX "tenant_staff_memberships_auth_role_id_idx" ON "tenant_staff_memberships"("auth_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_staff_memberships_tenant_id_person_id_key" ON "tenant_staff_memberships"("tenant_id", "person_id");

-- CreateIndex
CREATE INDEX "branch_modules_tenant_id_idx" ON "branch_modules"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_modules_branch_id_idx" ON "branch_modules"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_modules_branch_id_module_key_key" ON "branch_modules"("branch_id", "module_key");

-- CreateIndex
CREATE INDEX "collection_center_mappings_tenant_id_idx" ON "collection_center_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "collection_center_mappings_collection_center_id_idx" ON "collection_center_mappings"("collection_center_id");

-- CreateIndex
CREATE INDEX "collection_center_mappings_receiving_branch_id_idx" ON "collection_center_mappings"("receiving_branch_id");

-- CreateIndex
CREATE INDEX "collection_center_mappings_deleted_at_idx" ON "collection_center_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "user_branch_permissions_tenant_id_person_id_idx" ON "user_branch_permissions"("tenant_id", "person_id");

-- CreateIndex
CREATE INDEX "user_branch_permissions_branch_id_idx" ON "user_branch_permissions"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_permissions_tenant_id_person_id_branch_id_permi_key" ON "user_branch_permissions"("tenant_id", "person_id", "branch_id", "permission_key");

-- CreateIndex
CREATE INDEX "receptionist_doctor_mappings_tenant_id_branch_id_receptioni_idx" ON "receptionist_doctor_mappings"("tenant_id", "branch_id", "receptionist_person_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_main_branch_tenant_id_key" ON "tenant_main_branch"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_main_branch_branch_id_idx" ON "tenant_main_branch"("branch_id");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_idx" ON "schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "schedules_branch_id_idx" ON "schedules"("branch_id");

-- CreateIndex
CREATE INDEX "schedules_deleted_at_idx" ON "schedules"("deleted_at");

-- CreateIndex
CREATE INDEX "templates_tenant_id_idx" ON "templates"("tenant_id");

-- CreateIndex
CREATE INDEX "templates_branch_id_idx" ON "templates"("branch_id");

-- CreateIndex
CREATE INDEX "templates_preference_idx" ON "templates"("preference");

-- CreateIndex
CREATE INDEX "templates_feature_idx" ON "templates"("feature");

-- CreateIndex
CREATE INDEX "templates_cloned_from_id_idx" ON "templates"("cloned_from_id");

-- CreateIndex
CREATE INDEX "templates_deleted_at_idx" ON "templates"("deleted_at");

-- CreateIndex
CREATE INDEX "pdf_report_templates_tenant_id_idx" ON "pdf_report_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "pdf_report_templates_branch_id_idx" ON "pdf_report_templates"("branch_id");

-- CreateIndex
CREATE INDEX "pdf_report_templates_type_idx" ON "pdf_report_templates"("type");

-- CreateIndex
CREATE INDEX "pdf_report_templates_cloned_from_id_idx" ON "pdf_report_templates"("cloned_from_id");

-- CreateIndex
CREATE INDEX "pdf_report_templates_deleted_at_idx" ON "pdf_report_templates"("deleted_at");

-- CreateIndex
CREATE INDEX "pdf_template_configs_tenant_id_idx" ON "pdf_template_configs"("tenant_id");

-- CreateIndex
CREATE INDEX "pdf_template_configs_branch_id_idx" ON "pdf_template_configs"("branch_id");

-- CreateIndex
CREATE INDEX "pdf_template_configs_deleted_at_idx" ON "pdf_template_configs"("deleted_at");

-- CreateIndex
CREATE INDEX "departments_tenant_id_idx" ON "departments"("tenant_id");

-- CreateIndex
CREATE INDEX "departments_short_name_idx" ON "departments"("short_name");

-- CreateIndex
CREATE INDEX "departments_source_idx" ON "departments"("source");

-- CreateIndex
CREATE INDEX "departments_cloned_from_id_idx" ON "departments"("cloned_from_id");

-- CreateIndex
CREATE INDEX "departments_deleted_at_idx" ON "departments"("deleted_at");

-- CreateIndex
CREATE INDEX "department_person_mappings_tenant_id_idx" ON "department_person_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "department_person_mappings_department_id_idx" ON "department_person_mappings"("department_id");

-- CreateIndex
CREATE INDEX "department_person_mappings_person_id_idx" ON "department_person_mappings"("person_id");

-- CreateIndex
CREATE INDEX "department_person_mappings_branch_id_idx" ON "department_person_mappings"("branch_id");

-- CreateIndex
CREATE INDEX "department_person_mappings_deleted_at_idx" ON "department_person_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "categories_tenant_id_idx" ON "categories"("tenant_id");

-- CreateIndex
CREATE INDEX "categories_department_id_idx" ON "categories"("department_id");

-- CreateIndex
CREATE INDEX "categories_short_name_idx" ON "categories"("short_name");

-- CreateIndex
CREATE INDEX "categories_source_idx" ON "categories"("source");

-- CreateIndex
CREATE INDEX "categories_cloned_from_id_idx" ON "categories"("cloned_from_id");

-- CreateIndex
CREATE INDEX "categories_deleted_at_idx" ON "categories"("deleted_at");

-- CreateIndex
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");

-- CreateIndex
CREATE INDEX "documents_branch_id_idx" ON "documents"("branch_id");

-- CreateIndex
CREATE INDEX "documents_category_id_idx" ON "documents"("category_id");

-- CreateIndex
CREATE INDEX "documents_department_id_idx" ON "documents"("department_id");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_deleted_at_idx" ON "documents"("deleted_at");

-- CreateIndex
CREATE INDEX "document_versions_tenant_id_idx" ON "document_versions"("tenant_id");

-- CreateIndex
CREATE INDEX "document_versions_document_id_idx" ON "document_versions"("document_id");

-- CreateIndex
CREATE INDEX "document_versions_version_no_idx" ON "document_versions"("version_no");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");

-- CreateIndex
CREATE INDEX "category_person_mappings_tenant_id_idx" ON "category_person_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "category_person_mappings_category_id_idx" ON "category_person_mappings"("category_id");

-- CreateIndex
CREATE INDEX "category_person_mappings_person_id_idx" ON "category_person_mappings"("person_id");

-- CreateIndex
CREATE INDEX "category_person_mappings_branch_id_idx" ON "category_person_mappings"("branch_id");

-- CreateIndex
CREATE INDEX "category_person_mappings_deleted_at_idx" ON "category_person_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "sub_categories_tenant_id_idx" ON "sub_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "sub_categories_department_id_idx" ON "sub_categories"("department_id");

-- CreateIndex
CREATE INDEX "sub_categories_category_id_idx" ON "sub_categories"("category_id");

-- CreateIndex
CREATE INDEX "sub_categories_short_name_idx" ON "sub_categories"("short_name");

-- CreateIndex
CREATE INDEX "sub_categories_source_idx" ON "sub_categories"("source");

-- CreateIndex
CREATE INDEX "sub_categories_cloned_from_id_idx" ON "sub_categories"("cloned_from_id");

-- CreateIndex
CREATE INDEX "sub_categories_deleted_at_idx" ON "sub_categories"("deleted_at");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_tenant_id_idx" ON "sub_category_person_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_sub_category_id_idx" ON "sub_category_person_mappings"("sub_category_id");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_person_id_idx" ON "sub_category_person_mappings"("person_id");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_branch_id_idx" ON "sub_category_person_mappings"("branch_id");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_deleted_at_idx" ON "sub_category_person_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_branch_id_idx" ON "audit_logs"("branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_module_idx" ON "audit_logs"("module");

-- CreateIndex
CREATE INDEX "audit_logs_actor_person_id_idx" ON "audit_logs"("actor_person_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_deleted_at_idx" ON "audit_logs"("deleted_at");

-- CreateIndex
CREATE INDEX "master_data_tenant_id_idx" ON "master_data"("tenant_id");

-- CreateIndex
CREATE INDEX "master_data_branch_id_idx" ON "master_data"("branch_id");

-- CreateIndex
CREATE INDEX "master_data_deleted_at_idx" ON "master_data"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_tenant_id_idx" ON "lab_test"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_branch_id_idx" ON "lab_test"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_master_data_id_idx" ON "lab_test"("master_data_id");

-- CreateIndex
CREATE INDEX "lab_test_department_id_idx" ON "lab_test"("department_id");

-- CreateIndex
CREATE INDEX "lab_test_category_id_idx" ON "lab_test"("category_id");

-- CreateIndex
CREATE INDEX "lab_test_sub_category_id_idx" ON "lab_test"("sub_category_id");

-- CreateIndex
CREATE INDEX "lab_test_mandatory_dept_id_idx" ON "lab_test"("mandatory_dept_id");

-- CreateIndex
CREATE INDEX "lab_test_mandatory_cat_id_idx" ON "lab_test"("mandatory_cat_id");

-- CreateIndex
CREATE INDEX "lab_test_mandatory_subcat_id_idx" ON "lab_test"("mandatory_subcat_id");

-- CreateIndex
CREATE INDEX "lab_test_is_active_idx" ON "lab_test"("is_active");

-- CreateIndex
CREATE INDEX "lab_test_source_idx" ON "lab_test"("source");

-- CreateIndex
CREATE INDEX "lab_test_deleted_at_idx" ON "lab_test"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_samples_tenant_id_idx" ON "lab_test_samples"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_samples_branch_id_idx" ON "lab_test_samples"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_samples_lab_test_id_idx" ON "lab_test_samples"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_test_samples_deleted_at_idx" ON "lab_test_samples"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_result_params_tenant_id_idx" ON "lab_test_result_params"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_result_params_branch_id_idx" ON "lab_test_result_params"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_result_params_lab_test_id_idx" ON "lab_test_result_params"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_test_result_params_lab_test_id_sort_order_idx" ON "lab_test_result_params"("lab_test_id", "sort_order");

-- CreateIndex
CREATE INDEX "lab_test_result_params_deleted_at_idx" ON "lab_test_result_params"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_tenant_id_idx" ON "lab_test_reference_ranges"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_branch_id_idx" ON "lab_test_reference_ranges"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_lab_test_id_idx" ON "lab_test_reference_ranges"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_param_id_idx" ON "lab_test_reference_ranges"("param_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_deleted_at_idx" ON "lab_test_reference_ranges"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_tenant_id_idx" ON "lab_test_reference_values"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_branch_id_idx" ON "lab_test_reference_values"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_lab_test_id_idx" ON "lab_test_reference_values"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_param_id_idx" ON "lab_test_reference_values"("param_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_deleted_at_idx" ON "lab_test_reference_values"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_panels_tenant_id_idx" ON "lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_panels_branch_id_idx" ON "lab_panels"("branch_id");

-- CreateIndex
CREATE INDEX "lab_panels_master_data_id_idx" ON "lab_panels"("master_data_id");

-- CreateIndex
CREATE INDEX "lab_panels_department_id_idx" ON "lab_panels"("department_id");

-- CreateIndex
CREATE INDEX "lab_panels_category_id_idx" ON "lab_panels"("category_id");

-- CreateIndex
CREATE INDEX "lab_panels_is_active_idx" ON "lab_panels"("is_active");

-- CreateIndex
CREATE INDEX "lab_panels_source_idx" ON "lab_panels"("source");

-- CreateIndex
CREATE INDEX "lab_panels_deleted_at_idx" ON "lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_panel_tests_tenant_id_idx" ON "lab_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_panel_tests_branch_id_idx" ON "lab_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "lab_panel_tests_lab_panel_id_idx" ON "lab_panel_tests"("lab_panel_id");

-- CreateIndex
CREATE INDEX "lab_panel_tests_lab_panel_id_sort_order_idx" ON "lab_panel_tests"("lab_panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "lab_panel_tests_lab_test_id_idx" ON "lab_panel_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_panel_tests_deleted_at_idx" ON "lab_panel_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_lab_tests_tenant_id_idx" ON "branch_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_lab_tests_branch_id_idx" ON "branch_lab_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_lab_tests_source_lab_test_id_idx" ON "branch_lab_tests"("source_lab_test_id");

-- CreateIndex
CREATE INDEX "branch_lab_tests_is_active_idx" ON "branch_lab_tests"("is_active");

-- CreateIndex
CREATE INDEX "branch_lab_tests_is_default_idx" ON "branch_lab_tests"("is_default");

-- CreateIndex
CREATE INDEX "branch_lab_tests_deleted_at_idx" ON "branch_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_lab_panels_tenant_id_idx" ON "branch_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_lab_panels_branch_id_idx" ON "branch_lab_panels"("branch_id");

-- CreateIndex
CREATE INDEX "branch_lab_panels_source_lab_panel_id_idx" ON "branch_lab_panels"("source_lab_panel_id");

-- CreateIndex
CREATE INDEX "branch_lab_panels_is_active_idx" ON "branch_lab_panels"("is_active");

-- CreateIndex
CREATE INDEX "branch_lab_panels_is_default_idx" ON "branch_lab_panels"("is_default");

-- CreateIndex
CREATE INDEX "branch_lab_panels_deleted_at_idx" ON "branch_lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_tenant_id_idx" ON "branch_lab_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_branch_id_idx" ON "branch_lab_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_branch_lab_panel_id_idx" ON "branch_lab_panel_tests"("branch_lab_panel_id");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_branch_lab_panel_id_sort_order_idx" ON "branch_lab_panel_tests"("branch_lab_panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_branch_lab_test_id_idx" ON "branch_lab_panel_tests"("branch_lab_test_id");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_deleted_at_idx" ON "branch_lab_panel_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "test_groups_deleted_at_idx" ON "test_groups"("deleted_at");

-- CreateIndex
CREATE INDEX "test_group_mappings_test_group_id_idx" ON "test_group_mappings"("test_group_id");

-- CreateIndex
CREATE INDEX "test_group_mappings_lab_test_id_idx" ON "test_group_mappings"("lab_test_id");

-- CreateIndex
CREATE INDEX "test_group_mappings_deleted_at_idx" ON "test_group_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "equipment_deleted_at_idx" ON "equipment"("deleted_at");

-- CreateIndex
CREATE INDEX "equipment_lab_tests_equipment_id_idx" ON "equipment_lab_tests"("equipment_id");

-- CreateIndex
CREATE INDEX "equipment_lab_tests_lab_test_id_idx" ON "equipment_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "equipment_lab_tests_deleted_at_idx" ON "equipment_lab_tests"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "lab_adapters_token_key" ON "lab_adapters"("token");

-- CreateIndex
CREATE INDEX "lab_adapters_tenant_id_idx" ON "lab_adapters"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_adapters_equipment_id_idx" ON "lab_adapters"("equipment_id");

-- CreateIndex
CREATE INDEX "lab_adapters_deleted_at_idx" ON "lab_adapters"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_adapter_branches_tenant_id_idx" ON "lab_adapter_branches"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_adapter_branches_lab_adapter_id_idx" ON "lab_adapter_branches"("lab_adapter_id");

-- CreateIndex
CREATE INDEX "lab_adapter_branches_branch_id_idx" ON "lab_adapter_branches"("branch_id");

-- CreateIndex
CREATE INDEX "lab_adapter_branches_deleted_at_idx" ON "lab_adapter_branches"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_adapter_tests_tenant_id_idx" ON "lab_adapter_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_adapter_tests_lab_adapter_id_idx" ON "lab_adapter_tests"("lab_adapter_id");

-- CreateIndex
CREATE INDEX "lab_adapter_tests_branch_lab_test_id_idx" ON "lab_adapter_tests"("branch_lab_test_id");

-- CreateIndex
CREATE INDEX "lab_adapter_tests_deleted_at_idx" ON "lab_adapter_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "outsource_centers_tenant_id_idx" ON "outsource_centers"("tenant_id");

-- CreateIndex
CREATE INDEX "outsource_centers_lab_test_id_idx" ON "outsource_centers"("lab_test_id");

-- CreateIndex
CREATE INDEX "outsource_centers_lab_panel_id_idx" ON "outsource_centers"("lab_panel_id");

-- CreateIndex
CREATE INDEX "outsource_centers_deleted_at_idx" ON "outsource_centers"("deleted_at");

-- CreateIndex
CREATE INDEX "outsource_center_contacts_tenant_id_idx" ON "outsource_center_contacts"("tenant_id");

-- CreateIndex
CREATE INDEX "outsource_center_contacts_outsource_center_id_idx" ON "outsource_center_contacts"("outsource_center_id");

-- CreateIndex
CREATE INDEX "outsource_center_contacts_deleted_at_idx" ON "outsource_center_contacts"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_panel_settings_tenant_id_idx" ON "referral_panel_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_panel_settings_branch_id_idx" ON "referral_panel_settings"("branch_id");

-- CreateIndex
CREATE INDEX "referral_panel_settings_client_type_idx" ON "referral_panel_settings"("client_type");

-- CreateIndex
CREATE INDEX "referral_panel_settings_deleted_at_idx" ON "referral_panel_settings"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_panels_tenant_id_idx" ON "referral_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_panels_branch_id_idx" ON "referral_panels"("branch_id");

-- CreateIndex
CREATE INDEX "referral_panels_referral_panel_settings_id_idx" ON "referral_panels"("referral_panel_settings_id");

-- CreateIndex
CREATE INDEX "referral_panels_deleted_at_idx" ON "referral_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_panel_lab_tests_tenant_id_idx" ON "referral_panel_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_tests_referral_panel_id_idx" ON "referral_panel_lab_tests"("referral_panel_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_tests_lab_test_id_idx" ON "referral_panel_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_tests_deleted_at_idx" ON "referral_panel_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_panel_lab_panels_tenant_id_idx" ON "referral_panel_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_panels_referral_panel_id_idx" ON "referral_panel_lab_panels"("referral_panel_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_panels_lab_panel_id_idx" ON "referral_panel_lab_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_panels_deleted_at_idx" ON "referral_panel_lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "doctors_tenant_id_idx" ON "doctors"("tenant_id");

-- CreateIndex
CREATE INDEX "doctors_branch_id_idx" ON "doctors"("branch_id");

-- CreateIndex
CREATE INDEX "doctors_category_id_idx" ON "doctors"("category_id");

-- CreateIndex
CREATE INDEX "doctors_sub_category_id_idx" ON "doctors"("sub_category_id");

-- CreateIndex
CREATE INDEX "doctors_department_id_idx" ON "doctors"("department_id");

-- CreateIndex
CREATE INDEX "doctors_status_idx" ON "doctors"("status");

-- CreateIndex
CREATE INDEX "doctors_deleted_at_idx" ON "doctors"("deleted_at");

-- CreateIndex
CREATE INDEX "doctor_qualifications_tenant_id_idx" ON "doctor_qualifications"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_qualifications_doctor_id_idx" ON "doctor_qualifications"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_qualifications_deleted_at_idx" ON "doctor_qualifications"("deleted_at");

-- CreateIndex
CREATE INDEX "doctor_experience_tenant_id_idx" ON "doctor_experience"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_experience_doctor_id_idx" ON "doctor_experience"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_experience_deleted_at_idx" ON "doctor_experience"("deleted_at");

-- CreateIndex
CREATE INDEX "doctor_schedules_tenant_id_idx" ON "doctor_schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_schedules_branch_id_idx" ON "doctor_schedules"("branch_id");

-- CreateIndex
CREATE INDEX "doctor_schedules_doctor_id_idx" ON "doctor_schedules"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_schedules_status_idx" ON "doctor_schedules"("status");

-- CreateIndex
CREATE INDEX "doctor_schedules_deleted_at_idx" ON "doctor_schedules"("deleted_at");

-- CreateIndex
CREATE INDEX "doctor_schedule_days_tenant_id_idx" ON "doctor_schedule_days"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_schedule_days_schedule_id_idx" ON "doctor_schedule_days"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_schedule_days_schedule_id_day_of_week_key" ON "doctor_schedule_days"("schedule_id", "day_of_week");

-- CreateIndex
CREATE INDEX "doctor_schedule_holidays_tenant_id_idx" ON "doctor_schedule_holidays"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_schedule_holidays_schedule_id_idx" ON "doctor_schedule_holidays"("schedule_id");

-- CreateIndex
CREATE INDEX "doctor_schedule_overrides_tenant_id_idx" ON "doctor_schedule_overrides"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_schedule_overrides_schedule_id_idx" ON "doctor_schedule_overrides"("schedule_id");

-- CreateIndex
CREATE INDEX "doctor_slots_tenant_id_idx" ON "doctor_slots"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_slots_branch_id_idx" ON "doctor_slots"("branch_id");

-- CreateIndex
CREATE INDEX "doctor_slots_doctor_id_slot_date_idx" ON "doctor_slots"("doctor_id", "slot_date");

-- CreateIndex
CREATE INDEX "doctor_slots_schedule_id_idx" ON "doctor_slots"("schedule_id");

-- CreateIndex
CREATE INDEX "doctor_slots_deleted_at_idx" ON "doctor_slots"("deleted_at");

-- CreateIndex
CREATE INDEX "service_zones_tenant_id_idx" ON "service_zones"("tenant_id");

-- CreateIndex
CREATE INDEX "service_zones_branch_id_idx" ON "service_zones"("branch_id");

-- CreateIndex
CREATE INDEX "service_zones_is_active_idx" ON "service_zones"("is_active");

-- CreateIndex
CREATE INDEX "service_zones_deleted_at_idx" ON "service_zones"("deleted_at");

-- CreateIndex
CREATE INDEX "phlebotomist_schedules_tenant_id_idx" ON "phlebotomist_schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedules_branch_id_idx" ON "phlebotomist_schedules"("branch_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedules_phlebotomist_id_idx" ON "phlebotomist_schedules"("phlebotomist_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedules_status_idx" ON "phlebotomist_schedules"("status");

-- CreateIndex
CREATE INDEX "phlebotomist_schedules_deleted_at_idx" ON "phlebotomist_schedules"("deleted_at");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_days_tenant_id_idx" ON "phlebotomist_schedule_days"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_days_schedule_id_idx" ON "phlebotomist_schedule_days"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "phlebotomist_schedule_days_schedule_id_day_of_week_key" ON "phlebotomist_schedule_days"("schedule_id", "day_of_week");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_zones_tenant_id_idx" ON "phlebotomist_schedule_zones"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_zones_schedule_id_idx" ON "phlebotomist_schedule_zones"("schedule_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_zones_zone_id_idx" ON "phlebotomist_schedule_zones"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "phlebotomist_schedule_zones_schedule_id_zone_id_key" ON "phlebotomist_schedule_zones"("schedule_id", "zone_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_holidays_tenant_id_idx" ON "phlebotomist_schedule_holidays"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_holidays_schedule_id_idx" ON "phlebotomist_schedule_holidays"("schedule_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_overrides_tenant_id_idx" ON "phlebotomist_schedule_overrides"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomist_schedule_overrides_schedule_id_idx" ON "phlebotomist_schedule_overrides"("schedule_id");

-- CreateIndex
CREATE INDEX "phlebotomist_slots_tenant_id_idx" ON "phlebotomist_slots"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomist_slots_branch_id_idx" ON "phlebotomist_slots"("branch_id");

-- CreateIndex
CREATE INDEX "phlebotomist_slots_phlebotomist_id_slot_date_idx" ON "phlebotomist_slots"("phlebotomist_id", "slot_date");

-- CreateIndex
CREATE INDEX "phlebotomist_slots_schedule_id_idx" ON "phlebotomist_slots"("schedule_id");

-- CreateIndex
CREATE INDEX "phlebotomist_slots_deleted_at_idx" ON "phlebotomist_slots"("deleted_at");

-- CreateIndex
CREATE INDEX "phlebotomist_day_loads_tenant_id_idx" ON "phlebotomist_day_loads"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomist_day_loads_branch_id_idx" ON "phlebotomist_day_loads"("branch_id");

-- CreateIndex
CREATE INDEX "phlebotomist_day_loads_phlebotomist_id_load_date_idx" ON "phlebotomist_day_loads"("phlebotomist_id", "load_date");

-- CreateIndex
CREATE UNIQUE INDEX "phlebotomist_day_loads_tenant_id_phlebotomist_id_branch_id__key" ON "phlebotomist_day_loads"("tenant_id", "phlebotomist_id", "branch_id", "load_date");

-- CreateIndex
CREATE INDEX "referral_doctors_tenant_id_idx" ON "referral_doctors"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctors_branch_id_idx" ON "referral_doctors"("branch_id");

-- CreateIndex
CREATE INDEX "referral_doctors_department_id_idx" ON "referral_doctors"("department_id");

-- CreateIndex
CREATE INDEX "referral_doctors_category_id_idx" ON "referral_doctors"("category_id");

-- CreateIndex
CREATE INDEX "referral_doctors_sub_category_id_idx" ON "referral_doctors"("sub_category_id");

-- CreateIndex
CREATE INDEX "referral_doctors_referral_panel_settings_id_idx" ON "referral_doctors"("referral_panel_settings_id");

-- CreateIndex
CREATE INDEX "referral_doctors_status_idx" ON "referral_doctors"("status");

-- CreateIndex
CREATE INDEX "referral_doctors_deleted_at_idx" ON "referral_doctors"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctor_qualifications_tenant_id_idx" ON "referral_doctor_qualifications"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctor_qualifications_referral_doctor_id_idx" ON "referral_doctor_qualifications"("referral_doctor_id");

-- CreateIndex
CREATE INDEX "referral_doctor_qualifications_deleted_at_idx" ON "referral_doctor_qualifications"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctor_experience_tenant_id_idx" ON "referral_doctor_experience"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctor_experience_referral_doctor_id_idx" ON "referral_doctor_experience"("referral_doctor_id");

-- CreateIndex
CREATE INDEX "referral_doctor_experience_deleted_at_idx" ON "referral_doctor_experience"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_tests_tenant_id_idx" ON "referral_doctor_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_tests_referral_doctor_id_idx" ON "referral_doctor_lab_tests"("referral_doctor_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_tests_lab_test_id_idx" ON "referral_doctor_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_tests_deleted_at_idx" ON "referral_doctor_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_panels_tenant_id_idx" ON "referral_doctor_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_panels_referral_doctor_id_idx" ON "referral_doctor_lab_panels"("referral_doctor_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_panels_lab_panel_id_idx" ON "referral_doctor_lab_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_panels_deleted_at_idx" ON "referral_doctor_lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "external_referrals_tenant_id_idx" ON "external_referrals"("tenant_id");

-- CreateIndex
CREATE INDEX "external_referrals_branch_id_idx" ON "external_referrals"("branch_id");

-- CreateIndex
CREATE INDEX "external_referrals_referral_panel_settings_id_idx" ON "external_referrals"("referral_panel_settings_id");

-- CreateIndex
CREATE INDEX "external_referrals_status_idx" ON "external_referrals"("status");

-- CreateIndex
CREATE INDEX "external_referrals_deleted_at_idx" ON "external_referrals"("deleted_at");

-- CreateIndex
CREATE INDEX "external_referral_lab_tests_tenant_id_idx" ON "external_referral_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_tests_external_referral_id_idx" ON "external_referral_lab_tests"("external_referral_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_tests_lab_test_id_idx" ON "external_referral_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_tests_deleted_at_idx" ON "external_referral_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "external_referral_lab_panels_tenant_id_idx" ON "external_referral_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_panels_external_referral_id_idx" ON "external_referral_lab_panels"("external_referral_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_panels_lab_panel_id_idx" ON "external_referral_lab_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_panels_deleted_at_idx" ON "external_referral_lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "internal_referrals_tenant_id_idx" ON "internal_referrals"("tenant_id");

-- CreateIndex
CREATE INDEX "internal_referrals_branch_id_idx" ON "internal_referrals"("branch_id");

-- CreateIndex
CREATE INDEX "internal_referrals_employee_id_idx" ON "internal_referrals"("employee_id");

-- CreateIndex
CREATE INDEX "internal_referrals_referral_panel_settings_id_idx" ON "internal_referrals"("referral_panel_settings_id");

-- CreateIndex
CREATE INDEX "internal_referrals_status_idx" ON "internal_referrals"("status");

-- CreateIndex
CREATE INDEX "internal_referrals_deleted_at_idx" ON "internal_referrals"("deleted_at");

-- CreateIndex
CREATE INDEX "internal_referral_lab_tests_tenant_id_idx" ON "internal_referral_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_tests_internal_referral_id_idx" ON "internal_referral_lab_tests"("internal_referral_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_tests_lab_test_id_idx" ON "internal_referral_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_tests_deleted_at_idx" ON "internal_referral_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "internal_referral_lab_panels_tenant_id_idx" ON "internal_referral_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_panels_internal_referral_id_idx" ON "internal_referral_lab_panels"("internal_referral_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_panels_lab_panel_id_idx" ON "internal_referral_lab_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_panels_deleted_at_idx" ON "internal_referral_lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "machines_tenant_id_idx" ON "machines"("tenant_id");

-- CreateIndex
CREATE INDEX "machines_department_id_idx" ON "machines"("department_id");

-- CreateIndex
CREATE INDEX "machines_deleted_at_idx" ON "machines"("deleted_at");

-- CreateIndex
CREATE INDEX "machine_reagent_kits_tenant_id_idx" ON "machine_reagent_kits"("tenant_id");

-- CreateIndex
CREATE INDEX "machine_reagent_kits_machine_id_idx" ON "machine_reagent_kits"("machine_id");

-- CreateIndex
CREATE INDEX "machine_reagent_kits_deleted_at_idx" ON "machine_reagent_kits"("deleted_at");

-- CreateIndex
CREATE INDEX "machine_test_mappings_tenant_id_idx" ON "machine_test_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "machine_test_mappings_machine_id_idx" ON "machine_test_mappings"("machine_id");

-- CreateIndex
CREATE INDEX "machine_test_mappings_deleted_at_idx" ON "machine_test_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "machine_adapter_logs_tenant_id_idx" ON "machine_adapter_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "machine_adapter_logs_machine_id_idx" ON "machine_adapter_logs"("machine_id");

-- CreateIndex
CREATE INDEX "machine_adapter_logs_deleted_at_idx" ON "machine_adapter_logs"("deleted_at");

-- CreateIndex
CREATE INDEX "machine_branches_tenant_id_idx" ON "machine_branches"("tenant_id");

-- CreateIndex
CREATE INDEX "machine_branches_machine_id_idx" ON "machine_branches"("machine_id");

-- CreateIndex
CREATE INDEX "machine_branches_branch_id_idx" ON "machine_branches"("branch_id");

-- CreateIndex
CREATE INDEX "payment_rules_rule_type_idx" ON "payment_rules"("rule_type");

-- CreateIndex
CREATE INDEX "payment_rules_tenant_id_idx" ON "payment_rules"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_rules_code_idx" ON "payment_rules"("code");

-- CreateIndex
CREATE INDEX "payment_rules_deleted_at_idx" ON "payment_rules"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_settings_tenant_id_key" ON "billing_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "billing_settings_tenant_id_idx" ON "billing_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_settings_tenant_id_key" ON "patient_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_settings_tenant_id_idx" ON "patient_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "console_settings_tenant_id_key" ON "console_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "console_settings_tenant_id_idx" ON "console_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_settings_tenant_id_key" ON "report_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "report_settings_tenant_id_idx" ON "report_settings"("tenant_id");

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

-- CreateIndex
CREATE INDEX "support_infos_meta_type_idx" ON "support_infos"("meta_type");

-- CreateIndex
CREATE INDEX "support_infos_code_idx" ON "support_infos"("code");

-- CreateIndex
CREATE INDEX "support_infos_status_idx" ON "support_infos"("status");

-- CreateIndex
CREATE INDEX "support_infos_deleted_at_idx" ON "support_infos"("deleted_at");

-- CreateIndex
CREATE INDEX "contact_submissions_created_at_idx" ON "contact_submissions"("created_at");

-- CreateIndex
CREATE INDEX "contact_submissions_deleted_at_idx" ON "contact_submissions"("deleted_at");

-- CreateIndex
CREATE INDEX "patients_tenant_id_idx" ON "patients"("tenant_id");

-- CreateIndex
CREATE INDEX "patients_branch_id_idx" ON "patients"("branch_id");

-- CreateIndex
CREATE INDEX "patients_is_active_idx" ON "patients"("is_active");

-- CreateIndex
CREATE INDEX "patients_deleted_at_idx" ON "patients"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_family_links_tenant_id_idx" ON "patient_family_links"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_family_links_branch_id_idx" ON "patient_family_links"("branch_id");

-- CreateIndex
CREATE INDEX "patient_family_links_patient_id_idx" ON "patient_family_links"("patient_id");

-- CreateIndex
CREATE INDEX "patient_family_links_member_id_idx" ON "patient_family_links"("member_id");

-- CreateIndex
CREATE INDEX "medical_histories_tenant_id_idx" ON "medical_histories"("tenant_id");

-- CreateIndex
CREATE INDEX "medical_histories_patient_id_idx" ON "medical_histories"("patient_id");

-- CreateIndex
CREATE INDEX "medical_histories_branch_id_idx" ON "medical_histories"("branch_id");

-- CreateIndex
CREATE INDEX "medical_histories_deleted_at_idx" ON "medical_histories"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_appointment_id_key" ON "orders"("appointment_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");

-- CreateIndex
CREATE INDEX "orders_branch_id_idx" ON "orders"("branch_id");

-- CreateIndex
CREATE INDEX "orders_patient_id_idx" ON "orders"("patient_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_quotation_status_idx" ON "orders"("quotation_status");

-- CreateIndex
CREATE INDEX "orders_referred_by_doctor_id_idx" ON "orders"("referred_by_doctor_id");

-- CreateIndex
CREATE INDEX "orders_referral_panel_id_idx" ON "orders"("referral_panel_id");

-- CreateIndex
CREATE INDEX "orders_internal_referral_id_idx" ON "orders"("internal_referral_id");

-- CreateIndex
CREATE INDEX "orders_external_referral_id_idx" ON "orders"("external_referral_id");

-- CreateIndex
CREATE INDEX "orders_appointment_id_idx" ON "orders"("appointment_id");

-- CreateIndex
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");

-- CreateIndex
CREATE INDEX "orders_bill_id_idx" ON "orders"("bill_id");

-- CreateIndex
CREATE INDEX "orders_deleted_at_idx" ON "orders"("deleted_at");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_idx" ON "order_items"("tenant_id");

-- CreateIndex
CREATE INDEX "order_items_branch_id_idx" ON "order_items"("branch_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_branch_lab_test_id_idx" ON "order_items"("branch_lab_test_id");

-- CreateIndex
CREATE INDEX "order_items_branch_lab_panel_id_idx" ON "order_items"("branch_lab_panel_id");

-- CreateIndex
CREATE INDEX "order_items_outsource_center_id_idx" ON "order_items"("outsource_center_id");

-- CreateIndex
CREATE INDEX "order_items_deleted_at_idx" ON "order_items"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reports_order_item_id_key" ON "lab_reports"("order_item_id");

-- CreateIndex
CREATE INDEX "lab_reports_tenant_id_idx" ON "lab_reports"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_reports_branch_id_idx" ON "lab_reports"("branch_id");

-- CreateIndex
CREATE INDEX "lab_reports_status_idx" ON "lab_reports"("status");

-- CreateIndex
CREATE INDEX "lab_reports_lab_test_id_idx" ON "lab_reports"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_reports_is_outsourced_idx" ON "lab_reports"("is_outsourced");

-- CreateIndex
CREATE INDEX "lab_reports_tat_band_idx" ON "lab_reports"("tat_band");

-- CreateIndex
CREATE INDEX "lab_reports_deleted_at_idx" ON "lab_reports"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_report_result_values_tenant_id_idx" ON "lab_report_result_values"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_result_values_lab_report_id_idx" ON "lab_report_result_values"("lab_report_id");

-- CreateIndex
CREATE INDEX "lab_report_result_values_result_param_id_idx" ON "lab_report_result_values"("result_param_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_report_result_values_lab_report_id_result_param_id_key" ON "lab_report_result_values"("lab_report_id", "result_param_id");

-- CreateIndex
CREATE INDEX "lab_report_notes_tenant_id_idx" ON "lab_report_notes"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_notes_lab_report_id_idx" ON "lab_report_notes"("lab_report_id");

-- CreateIndex
CREATE INDEX "lab_report_notes_category_idx" ON "lab_report_notes"("category");

-- CreateIndex
CREATE INDEX "lab_report_attachments_tenant_id_idx" ON "lab_report_attachments"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_attachments_lab_report_id_idx" ON "lab_report_attachments"("lab_report_id");

-- CreateIndex
CREATE INDEX "lab_report_history_tenant_id_idx" ON "lab_report_history"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_history_lab_report_id_idx" ON "lab_report_history"("lab_report_id");

-- CreateIndex
CREATE INDEX "re_run_requests_tenant_id_idx" ON "re_run_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "re_run_requests_branch_id_idx" ON "re_run_requests"("branch_id");

-- CreateIndex
CREATE INDEX "re_run_requests_lab_report_id_idx" ON "re_run_requests"("lab_report_id");

-- CreateIndex
CREATE INDEX "re_run_requests_status_idx" ON "re_run_requests"("status");

-- CreateIndex
CREATE INDEX "critical_alerts_tenant_id_idx" ON "critical_alerts"("tenant_id");

-- CreateIndex
CREATE INDEX "critical_alerts_branch_id_idx" ON "critical_alerts"("branch_id");

-- CreateIndex
CREATE INDEX "critical_alerts_lab_report_id_idx" ON "critical_alerts"("lab_report_id");

-- CreateIndex
CREATE INDEX "critical_alerts_status_idx" ON "critical_alerts"("status");

-- CreateIndex
CREATE INDEX "out_of_range_flags_tenant_id_idx" ON "out_of_range_flags"("tenant_id");

-- CreateIndex
CREATE INDEX "out_of_range_flags_branch_id_idx" ON "out_of_range_flags"("branch_id");

-- CreateIndex
CREATE INDEX "out_of_range_flags_lab_report_id_idx" ON "out_of_range_flags"("lab_report_id");

-- CreateIndex
CREATE INDEX "out_of_range_flags_status_idx" ON "out_of_range_flags"("status");

-- CreateIndex
CREATE INDEX "delta_checks_tenant_id_idx" ON "delta_checks"("tenant_id");

-- CreateIndex
CREATE INDEX "delta_checks_branch_id_idx" ON "delta_checks"("branch_id");

-- CreateIndex
CREATE INDEX "delta_checks_lab_report_id_idx" ON "delta_checks"("lab_report_id");

-- CreateIndex
CREATE INDEX "delta_checks_status_idx" ON "delta_checks"("status");

-- CreateIndex
CREATE INDEX "scheduled_tests_tenant_id_idx" ON "scheduled_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "scheduled_tests_branch_id_idx" ON "scheduled_tests"("branch_id");

-- CreateIndex
CREATE INDEX "scheduled_tests_lab_report_id_idx" ON "scheduled_tests"("lab_report_id");

-- CreateIndex
CREATE INDEX "scheduled_tests_status_idx" ON "scheduled_tests"("status");

-- CreateIndex
CREATE INDEX "scheduled_tests_assigned_to_id_idx" ON "scheduled_tests"("assigned_to_id");

-- CreateIndex
CREATE UNIQUE INDEX "multi_step_test_processes_lab_report_id_key" ON "multi_step_test_processes"("lab_report_id");

-- CreateIndex
CREATE INDEX "multi_step_test_processes_tenant_id_idx" ON "multi_step_test_processes"("tenant_id");

-- CreateIndex
CREATE INDEX "multi_step_test_processes_branch_id_idx" ON "multi_step_test_processes"("branch_id");

-- CreateIndex
CREATE INDEX "lab_report_inventory_usage_tenant_id_idx" ON "lab_report_inventory_usage"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_inventory_usage_lab_report_id_idx" ON "lab_report_inventory_usage"("lab_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_diagnostics_order_id_key" ON "order_diagnostics"("order_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_tenant_id_idx" ON "order_diagnostics"("tenant_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_branch_id_idx" ON "order_diagnostics"("branch_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_diagnostic_panel_id_idx" ON "order_diagnostics"("diagnostic_panel_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_phlebotomist_id_idx" ON "order_diagnostics"("phlebotomist_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_deleted_at_idx" ON "order_diagnostics"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_opd_order_id_key" ON "order_opd"("order_id");

-- CreateIndex
CREATE INDEX "order_opd_tenant_id_idx" ON "order_opd"("tenant_id");

-- CreateIndex
CREATE INDEX "order_opd_branch_id_idx" ON "order_opd"("branch_id");

-- CreateIndex
CREATE INDEX "order_opd_department_id_idx" ON "order_opd"("department_id");

-- CreateIndex
CREATE INDEX "order_opd_category_id_idx" ON "order_opd"("category_id");

-- CreateIndex
CREATE INDEX "order_opd_doctor_id_idx" ON "order_opd"("doctor_id");

-- CreateIndex
CREATE INDEX "order_opd_deleted_at_idx" ON "order_opd"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_radiology_order_id_key" ON "order_radiology"("order_id");

-- CreateIndex
CREATE INDEX "order_radiology_tenant_id_idx" ON "order_radiology"("tenant_id");

-- CreateIndex
CREATE INDEX "order_radiology_branch_id_idx" ON "order_radiology"("branch_id");

-- CreateIndex
CREATE INDEX "order_radiology_radiologist_id_idx" ON "order_radiology"("radiologist_id");

-- CreateIndex
CREATE INDEX "order_radiology_radiologist_department_id_idx" ON "order_radiology"("radiologist_department_id");

-- CreateIndex
CREATE INDEX "order_radiology_radiologist_category_id_idx" ON "order_radiology"("radiologist_category_id");

-- CreateIndex
CREATE INDEX "order_radiology_radiology_technician_id_idx" ON "order_radiology"("radiology_technician_id");

-- CreateIndex
CREATE INDEX "order_radiology_deleted_at_idx" ON "order_radiology"("deleted_at");

-- CreateIndex
CREATE INDEX "order_field_configs_tenant_id_idx" ON "order_field_configs"("tenant_id");

-- CreateIndex
CREATE INDEX "order_field_configs_branch_id_idx" ON "order_field_configs"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_field_configs_tenant_id_branch_id_key" ON "order_field_configs"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "payment_details_tenant_id_idx" ON "payment_details"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_details_branch_id_idx" ON "payment_details"("branch_id");

-- CreateIndex
CREATE INDEX "payment_details_order_id_idx" ON "payment_details"("order_id");

-- CreateIndex
CREATE INDEX "payment_details_deleted_at_idx" ON "payment_details"("deleted_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_idx" ON "appointments"("tenant_id");

-- CreateIndex
CREATE INDEX "appointments_branch_id_idx" ON "appointments"("branch_id");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

-- CreateIndex
CREATE INDEX "appointments_appointment_type_idx" ON "appointments"("appointment_type");

-- CreateIndex
CREATE INDEX "appointments_deleted_at_idx" ON "appointments"("deleted_at");

-- CreateIndex
CREATE INDEX "appointment_status_history_tenant_id_idx" ON "appointment_status_history"("tenant_id");

-- CreateIndex
CREATE INDEX "appointment_status_history_branch_id_idx" ON "appointment_status_history"("branch_id");

-- CreateIndex
CREATE INDEX "appointment_status_history_appointment_id_idx" ON "appointment_status_history"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_status_history_created_at_idx" ON "appointment_status_history"("created_at");

-- CreateIndex
CREATE INDEX "appointment_status_history_deleted_at_idx" ON "appointment_status_history"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "home_visit_collections_order_id_key" ON "home_visit_collections"("order_id");

-- CreateIndex
CREATE INDEX "home_visit_collections_tenant_id_idx" ON "home_visit_collections"("tenant_id");

-- CreateIndex
CREATE INDEX "home_visit_collections_branch_id_idx" ON "home_visit_collections"("branch_id");

-- CreateIndex
CREATE INDEX "home_visit_collections_phlebotomist_id_idx" ON "home_visit_collections"("phlebotomist_id");

-- CreateIndex
CREATE INDEX "home_visit_collections_status_idx" ON "home_visit_collections"("status");

-- CreateIndex
CREATE INDEX "home_visit_collections_scheduled_collection_at_idx" ON "home_visit_collections"("scheduled_collection_at");

-- CreateIndex
CREATE INDEX "home_visit_collections_deleted_at_idx" ON "home_visit_collections"("deleted_at");

-- CreateIndex
CREATE INDEX "home_visit_status_history_tenant_id_idx" ON "home_visit_status_history"("tenant_id");

-- CreateIndex
CREATE INDEX "home_visit_status_history_branch_id_idx" ON "home_visit_status_history"("branch_id");

-- CreateIndex
CREATE INDEX "home_visit_status_history_collection_id_idx" ON "home_visit_status_history"("collection_id");

-- CreateIndex
CREATE INDEX "home_visit_status_history_created_at_idx" ON "home_visit_status_history"("created_at");

-- CreateIndex
CREATE INDEX "home_visit_status_history_deleted_at_idx" ON "home_visit_status_history"("deleted_at");

-- CreateIndex
CREATE INDEX "accession_samples_tenant_id_idx" ON "accession_samples"("tenant_id");

-- CreateIndex
CREATE INDEX "accession_samples_branch_id_idx" ON "accession_samples"("branch_id");

-- CreateIndex
CREATE INDEX "accession_samples_order_id_idx" ON "accession_samples"("order_id");

-- CreateIndex
CREATE INDEX "accession_samples_status_idx" ON "accession_samples"("status");

-- CreateIndex
CREATE INDEX "accession_samples_barcode_idx" ON "accession_samples"("barcode");

-- CreateIndex
CREATE INDEX "accession_samples_origin_branch_id_idx" ON "accession_samples"("origin_branch_id");

-- CreateIndex
CREATE INDEX "accession_samples_processing_branch_id_idx" ON "accession_samples"("processing_branch_id");

-- CreateIndex
CREATE INDEX "accession_samples_deleted_at_idx" ON "accession_samples"("deleted_at");

-- CreateIndex
CREATE INDEX "accession_sample_tests_tenant_id_idx" ON "accession_sample_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "accession_sample_tests_branch_id_idx" ON "accession_sample_tests"("branch_id");

-- CreateIndex
CREATE INDEX "accession_sample_tests_sample_id_idx" ON "accession_sample_tests"("sample_id");

-- CreateIndex
CREATE INDEX "accession_sample_tests_order_item_id_idx" ON "accession_sample_tests"("order_item_id");

-- CreateIndex
CREATE INDEX "accession_sample_tests_deleted_at_idx" ON "accession_sample_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "accession_status_history_tenant_id_idx" ON "accession_status_history"("tenant_id");

-- CreateIndex
CREATE INDEX "accession_status_history_branch_id_idx" ON "accession_status_history"("branch_id");

-- CreateIndex
CREATE INDEX "accession_status_history_sample_id_idx" ON "accession_status_history"("sample_id");

-- CreateIndex
CREATE INDEX "accession_status_history_created_at_idx" ON "accession_status_history"("created_at");

-- CreateIndex
CREATE INDEX "accession_status_history_deleted_at_idx" ON "accession_status_history"("deleted_at");

-- CreateIndex
CREATE INDEX "sample_transfers_tenant_id_idx" ON "sample_transfers"("tenant_id");

-- CreateIndex
CREATE INDEX "sample_transfers_branch_id_idx" ON "sample_transfers"("branch_id");

-- CreateIndex
CREATE INDEX "sample_transfers_sample_id_idx" ON "sample_transfers"("sample_id");

-- CreateIndex
CREATE INDEX "sample_transfers_kind_idx" ON "sample_transfers"("kind");

-- CreateIndex
CREATE INDEX "sample_transfers_transfer_status_idx" ON "sample_transfers"("transfer_status");

-- CreateIndex
CREATE INDEX "sample_transfers_destination_branch_id_idx" ON "sample_transfers"("destination_branch_id");

-- CreateIndex
CREATE INDEX "sample_transfers_outsource_center_id_idx" ON "sample_transfers"("outsource_center_id");

-- CreateIndex
CREATE INDEX "sample_transfers_deleted_at_idx" ON "sample_transfers"("deleted_at");

-- CreateIndex
CREATE INDEX "accession_settings_tenant_id_idx" ON "accession_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "accession_settings_branch_id_idx" ON "accession_settings"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "accession_settings_tenant_id_branch_id_key" ON "accession_settings"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "appointment_settings_tenant_id_idx" ON "appointment_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "appointment_settings_branch_id_idx" ON "appointment_settings"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_settings_tenant_id_branch_id_key" ON "appointment_settings"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "phlebotomist_settings_tenant_id_idx" ON "phlebotomist_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomist_settings_branch_id_idx" ON "phlebotomist_settings"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "phlebotomist_settings_tenant_id_branch_id_key" ON "phlebotomist_settings"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "sales_territories_tenant_id_idx" ON "sales_territories"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_territories_branch_id_idx" ON "sales_territories"("branch_id");

-- CreateIndex
CREATE INDEX "sales_territories_is_active_idx" ON "sales_territories"("is_active");

-- CreateIndex
CREATE INDEX "sales_territories_deleted_at_idx" ON "sales_territories"("deleted_at");

-- CreateIndex
CREATE INDEX "leads_tenant_id_idx" ON "leads"("tenant_id");

-- CreateIndex
CREATE INDEX "leads_branch_id_idx" ON "leads"("branch_id");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_pipeline_stage_idx" ON "leads"("pipeline_stage");

-- CreateIndex
CREATE INDEX "leads_assigned_salesperson_id_idx" ON "leads"("assigned_salesperson_id");

-- CreateIndex
CREATE INDEX "leads_territory_id_idx" ON "leads"("territory_id");

-- CreateIndex
CREATE INDEX "leads_deleted_at_idx" ON "leads"("deleted_at");

-- CreateIndex
CREATE INDEX "lead_status_histories_tenant_id_idx" ON "lead_status_histories"("tenant_id");

-- CreateIndex
CREATE INDEX "lead_status_histories_lead_id_idx" ON "lead_status_histories"("lead_id");

-- CreateIndex
CREATE INDEX "lead_meetings_tenant_id_idx" ON "lead_meetings"("tenant_id");

-- CreateIndex
CREATE INDEX "lead_meetings_branch_id_idx" ON "lead_meetings"("branch_id");

-- CreateIndex
CREATE INDEX "lead_meetings_lead_id_idx" ON "lead_meetings"("lead_id");

-- CreateIndex
CREATE INDEX "lead_meetings_deleted_at_idx" ON "lead_meetings"("deleted_at");

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_idx" ON "follow_ups"("tenant_id");

-- CreateIndex
CREATE INDEX "follow_ups_branch_id_idx" ON "follow_ups"("branch_id");

-- CreateIndex
CREATE INDEX "follow_ups_lead_id_idx" ON "follow_ups"("lead_id");

-- CreateIndex
CREATE INDEX "follow_ups_trip_id_idx" ON "follow_ups"("trip_id");

-- CreateIndex
CREATE INDEX "follow_ups_status_idx" ON "follow_ups"("status");

-- CreateIndex
CREATE INDEX "follow_ups_deleted_at_idx" ON "follow_ups"("deleted_at");

-- CreateIndex
CREATE INDEX "follow_up_status_histories_tenant_id_idx" ON "follow_up_status_histories"("tenant_id");

-- CreateIndex
CREATE INDEX "follow_up_status_histories_follow_up_id_idx" ON "follow_up_status_histories"("follow_up_id");

-- CreateIndex
CREATE INDEX "trips_tenant_id_idx" ON "trips"("tenant_id");

-- CreateIndex
CREATE INDEX "trips_branch_id_idx" ON "trips"("branch_id");

-- CreateIndex
CREATE INDEX "trips_lead_id_idx" ON "trips"("lead_id");

-- CreateIndex
CREATE INDEX "trips_salesperson_id_idx" ON "trips"("salesperson_id");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trips_deleted_at_idx" ON "trips"("deleted_at");

-- CreateIndex
CREATE INDEX "trip_visits_tenant_id_idx" ON "trip_visits"("tenant_id");

-- CreateIndex
CREATE INDEX "trip_visits_trip_id_idx" ON "trip_visits"("trip_id");

-- CreateIndex
CREATE INDEX "trip_visits_lead_id_idx" ON "trip_visits"("lead_id");

-- CreateIndex
CREATE INDEX "trip_visits_deleted_at_idx" ON "trip_visits"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_settings_tenant_id_key" ON "sales_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_configurations" ADD CONSTRAINT "tenant_configurations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "states" ADD CONSTRAINT "states_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_profiles" ADD CONSTRAINT "user_branch_profiles_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profile_permission_overrides" ADD CONSTRAINT "user_profile_permission_overrides_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_staff_memberships" ADD CONSTRAINT "tenant_staff_memberships_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_person_mappings" ADD CONSTRAINT "department_person_mappings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_person_mappings" ADD CONSTRAINT "category_person_mappings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_category_person_mappings" ADD CONSTRAINT "sub_category_person_mappings_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "sub_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_mandatory_dept_id_fkey" FOREIGN KEY ("mandatory_dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_mandatory_cat_id_fkey" FOREIGN KEY ("mandatory_cat_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_mandatory_subcat_id_fkey" FOREIGN KEY ("mandatory_subcat_id") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_group_mappings" ADD CONSTRAINT "test_group_mappings_test_group_id_fkey" FOREIGN KEY ("test_group_id") REFERENCES "test_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_lab_tests" ADD CONSTRAINT "equipment_lab_tests_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_adapter_branches" ADD CONSTRAINT "lab_adapter_branches_lab_adapter_id_fkey" FOREIGN KEY ("lab_adapter_id") REFERENCES "lab_adapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_adapter_tests" ADD CONSTRAINT "lab_adapter_tests_lab_adapter_id_fkey" FOREIGN KEY ("lab_adapter_id") REFERENCES "lab_adapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outsource_center_contacts" ADD CONSTRAINT "outsource_center_contacts_outsource_center_id_fkey" FOREIGN KEY ("outsource_center_id") REFERENCES "outsource_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_panels" ADD CONSTRAINT "referral_panels_referral_panel_settings_id_fkey" FOREIGN KEY ("referral_panel_settings_id") REFERENCES "referral_panel_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_panel_lab_tests" ADD CONSTRAINT "referral_panel_lab_tests_referral_panel_id_fkey" FOREIGN KEY ("referral_panel_id") REFERENCES "referral_panels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_panel_lab_panels" ADD CONSTRAINT "referral_panel_lab_panels_referral_panel_id_fkey" FOREIGN KEY ("referral_panel_id") REFERENCES "referral_panels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_qualifications" ADD CONSTRAINT "doctor_qualifications_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_experience" ADD CONSTRAINT "doctor_experience_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_days" ADD CONSTRAINT "doctor_schedule_days_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "doctor_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_holidays" ADD CONSTRAINT "doctor_schedule_holidays_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "doctor_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_overrides" ADD CONSTRAINT "doctor_schedule_overrides_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "doctor_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_slots" ADD CONSTRAINT "doctor_slots_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_slots" ADD CONSTRAINT "doctor_slots_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "doctor_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phlebotomist_schedules" ADD CONSTRAINT "phlebotomist_schedules_phlebotomist_id_fkey" FOREIGN KEY ("phlebotomist_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phlebotomist_schedule_days" ADD CONSTRAINT "phlebotomist_schedule_days_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "phlebotomist_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phlebotomist_schedule_zones" ADD CONSTRAINT "phlebotomist_schedule_zones_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "phlebotomist_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phlebotomist_schedule_zones" ADD CONSTRAINT "phlebotomist_schedule_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "service_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phlebotomist_schedule_holidays" ADD CONSTRAINT "phlebotomist_schedule_holidays_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "phlebotomist_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phlebotomist_schedule_overrides" ADD CONSTRAINT "phlebotomist_schedule_overrides_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "phlebotomist_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phlebotomist_slots" ADD CONSTRAINT "phlebotomist_slots_phlebotomist_id_fkey" FOREIGN KEY ("phlebotomist_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phlebotomist_slots" ADD CONSTRAINT "phlebotomist_slots_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "phlebotomist_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctors" ADD CONSTRAINT "referral_doctors_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctors" ADD CONSTRAINT "referral_doctors_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctors" ADD CONSTRAINT "referral_doctors_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctors" ADD CONSTRAINT "referral_doctors_referral_panel_settings_id_fkey" FOREIGN KEY ("referral_panel_settings_id") REFERENCES "referral_panel_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctor_qualifications" ADD CONSTRAINT "referral_doctor_qualifications_referral_doctor_id_fkey" FOREIGN KEY ("referral_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctor_experience" ADD CONSTRAINT "referral_doctor_experience_referral_doctor_id_fkey" FOREIGN KEY ("referral_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctor_lab_tests" ADD CONSTRAINT "referral_doctor_lab_tests_referral_doctor_id_fkey" FOREIGN KEY ("referral_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctor_lab_panels" ADD CONSTRAINT "referral_doctor_lab_panels_referral_doctor_id_fkey" FOREIGN KEY ("referral_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_referrals" ADD CONSTRAINT "external_referrals_referral_panel_settings_id_fkey" FOREIGN KEY ("referral_panel_settings_id") REFERENCES "referral_panel_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_referral_lab_tests" ADD CONSTRAINT "external_referral_lab_tests_external_referral_id_fkey" FOREIGN KEY ("external_referral_id") REFERENCES "external_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_referral_lab_panels" ADD CONSTRAINT "external_referral_lab_panels_external_referral_id_fkey" FOREIGN KEY ("external_referral_id") REFERENCES "external_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_referrals" ADD CONSTRAINT "internal_referrals_referral_panel_settings_id_fkey" FOREIGN KEY ("referral_panel_settings_id") REFERENCES "referral_panel_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_referral_lab_tests" ADD CONSTRAINT "internal_referral_lab_tests_internal_referral_id_fkey" FOREIGN KEY ("internal_referral_id") REFERENCES "internal_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_referral_lab_panels" ADD CONSTRAINT "internal_referral_lab_panels_internal_referral_id_fkey" FOREIGN KEY ("internal_referral_id") REFERENCES "internal_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_family_links" ADD CONSTRAINT "patient_family_links_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_family_links" ADD CONSTRAINT "patient_family_links_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_histories" ADD CONSTRAINT "medical_histories_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_referred_by_doctor_id_fkey" FOREIGN KEY ("referred_by_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_referral_panel_id_fkey" FOREIGN KEY ("referral_panel_id") REFERENCES "referral_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_internal_referral_id_fkey" FOREIGN KEY ("internal_referral_id") REFERENCES "internal_referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_external_referral_id_fkey" FOREIGN KEY ("external_referral_id") REFERENCES "external_referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_lab_test_id_fkey" FOREIGN KEY ("branch_lab_test_id") REFERENCES "branch_lab_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_lab_panel_id_fkey" FOREIGN KEY ("branch_lab_panel_id") REFERENCES "branch_lab_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_outsource_center_id_fkey" FOREIGN KEY ("outsource_center_id") REFERENCES "outsource_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_result_values" ADD CONSTRAINT "lab_report_result_values_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_notes" ADD CONSTRAINT "lab_report_notes_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_attachments" ADD CONSTRAINT "lab_report_attachments_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_history" ADD CONSTRAINT "lab_report_history_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "re_run_requests" ADD CONSTRAINT "re_run_requests_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_alerts" ADD CONSTRAINT "critical_alerts_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "out_of_range_flags" ADD CONSTRAINT "out_of_range_flags_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delta_checks" ADD CONSTRAINT "delta_checks_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tests" ADD CONSTRAINT "scheduled_tests_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tests" ADD CONSTRAINT "scheduled_tests_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multi_step_test_processes" ADD CONSTRAINT "multi_step_test_processes_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_inventory_usage" ADD CONSTRAINT "lab_report_inventory_usage_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_diagnostics" ADD CONSTRAINT "order_diagnostics_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_diagnostics" ADD CONSTRAINT "order_diagnostics_diagnostic_panel_id_fkey" FOREIGN KEY ("diagnostic_panel_id") REFERENCES "lab_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_diagnostics" ADD CONSTRAINT "order_diagnostics_phlebotomist_id_fkey" FOREIGN KEY ("phlebotomist_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_opd" ADD CONSTRAINT "order_opd_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_opd" ADD CONSTRAINT "order_opd_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_opd" ADD CONSTRAINT "order_opd_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_opd" ADD CONSTRAINT "order_opd_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_radiologist_id_fkey" FOREIGN KEY ("radiologist_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_radiologist_department_id_fkey" FOREIGN KEY ("radiologist_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_radiologist_category_id_fkey" FOREIGN KEY ("radiologist_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_radiology_technician_id_fkey" FOREIGN KEY ("radiology_technician_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_details" ADD CONSTRAINT "payment_details_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_visit_collections" ADD CONSTRAINT "home_visit_collections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_visit_collections" ADD CONSTRAINT "home_visit_collections_phlebotomist_id_fkey" FOREIGN KEY ("phlebotomist_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_visit_status_history" ADD CONSTRAINT "home_visit_status_history_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "home_visit_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accession_samples" ADD CONSTRAINT "accession_samples_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accession_sample_tests" ADD CONSTRAINT "accession_sample_tests_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "accession_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accession_sample_tests" ADD CONSTRAINT "accession_sample_tests_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accession_status_history" ADD CONSTRAINT "accession_status_history_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "accession_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_transfers" ADD CONSTRAINT "sample_transfers_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "accession_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "sales_territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_histories" ADD CONSTRAINT "lead_status_histories_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_meetings" ADD CONSTRAINT "lead_meetings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_status_histories" ADD CONSTRAINT "follow_up_status_histories_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "follow_ups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_visits" ADD CONSTRAINT "trip_visits_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_visits" ADD CONSTRAINT "trip_visits_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

