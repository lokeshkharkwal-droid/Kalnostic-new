-- AlterTable
ALTER TABLE "lab_reports" ADD COLUMN     "signatory_authority_1_id" TEXT,
ADD COLUMN     "signatory_authority_1_type" "PersonMappingType",
ADD COLUMN     "signatory_authority_2_id" TEXT,
ADD COLUMN     "signatory_authority_2_type" "PersonMappingType",
ADD COLUMN     "signatory_authority_3_id" TEXT,
ADD COLUMN     "signatory_authority_3_type" "PersonMappingType";

-- AlterTable
ALTER TABLE "technician_settings" ADD COLUMN     "is_useful_for_editable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_interpretation_editable" BOOLEAN NOT NULL DEFAULT false;
