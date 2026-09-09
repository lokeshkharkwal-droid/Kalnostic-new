-- The "Approval Workflow" dropdown (Basic Details section) and the Excel
-- template's "Approval Workflow" column were both backed only by a free-text,
-- never-populated `approval_workflow_id` column (no relation, no validation,
-- never written by the FE, always blank on export). Replacing it with a real
-- enum matching the exact 4 values the UI already hardcodes.
CREATE TYPE "ApprovalWorkflow" AS ENUM (
  'SINGLE_APPROVAL',
  'DUAL_APPROVAL',
  'AUTO_APPROVE',
  'PATHOLOGIST_REVIEW'
);

ALTER TABLE "lab_test" DROP COLUMN "approval_workflow_id";
ALTER TABLE "lab_test" ADD COLUMN "approval_workflow" "ApprovalWorkflow";
