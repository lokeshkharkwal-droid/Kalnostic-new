-- Links a lab test result parameter to one or more Overall Result template
-- groups (Add Multiple Results dialog -> Configure: [Parameter] -> "Overall
-- Result" tab). Stored as a plain free-text array of
-- overall_result_templates.group_name values (string equality, no FK/relation
-- — same convention as the existing group_name/reflex_tests columns on this
-- table). A parameter may link to several groups; a group name may be linked
-- to many parameters across many tests.
ALTER TABLE "lab_test_result_params" ADD COLUMN "overall_result_groups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
