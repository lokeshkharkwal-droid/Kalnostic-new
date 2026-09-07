-- Parameter-level "Image Settings" dropdown (ParameterConfigPanel.tsx) reads
-- from the real LabImageSetting catalogue but had no column to save the pick
-- into — selecting one was silently dropped on save. Adding a plain logical
-- ref (no FK), matching the existing group_layout_id/group_settings_id/
-- icon_settings_id columns on this same table.
ALTER TABLE "lab_test_result_params" ADD COLUMN "image_settings_id" TEXT;
