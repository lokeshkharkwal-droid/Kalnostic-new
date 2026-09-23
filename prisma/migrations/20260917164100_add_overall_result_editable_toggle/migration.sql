-- Gates whether a technician can apply/edit an Overall Result template on
-- the Test Entry screen, same convention as this table's other 5
-- is_*_editable toggles.
ALTER TABLE "technician_settings" ADD COLUMN "is_overall_result_editable" BOOLEAN NOT NULL DEFAULT false;
