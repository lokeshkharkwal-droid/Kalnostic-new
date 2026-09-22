-- E2E test seed for the EzHealthTrack → kalnostics migration.
-- Tenant 423 (GETWELL). Patient ids 95000x are synthetic (max real id = 696850).
-- Exercises: family members (shared mobile / no mobile / no user_patient_relation
-- row), profile photo, full address, age-from-DOB, and geo stored as NAMES.

SET @T := 423;      -- tenant business id
SET @BR := 717;     -- a branch of tenant 423
SET @BR2 := 718;
SET @NOW := '2025-09-01 10:00:00';

-- ── patientregister ──────────────────────────────────────────────────────────
INSERT INTO patientregister
  (PATIENT_ID, PATIENT_FIRST_NAME, PATIENT_MIDDLE_NAME, PATIENT_LAST_NAME,
   PATIENT_MOBILE_NUMBER, PATIENT_EMAIL, PATIENT_USERNAME, PATIENT_PASSWORD,
   PATIENT_DATE, salutation, whatsapp_number)
VALUES
  (950001,'Rajesh','Kumar','Sharma','9800000001','rajesh@test.com','INTST-95001','x','2025-09-01','Mr.','9800000001'),
  (950002,'Priya','','Sharma','9800000001','','INTST-95002','x','2025-09-01','Ms.',NULL),
  (950003,'Aarav','','Sharma','','','INTST-95003','x','2025-09-01','',NULL),
  (950004,'Sita','','Devi','','','INTST-95004','x','2025-09-01','Mrs.',NULL),
  (950010,'Amit','','Verma','9800000010','amit@test.com','INTST-95010','x','2025-09-01','Mr.','9800000010');

-- ── patient_personal_info (photo, address, geo) ────────────────────────────────
-- 95000x store geo as numeric IDS (country 1=India, state 29=Rajasthan,
-- city 595283=Jaipur, area 660527=Jaipur). 950010 stores geo as NAMES to test
-- the resolveGeoValue passthrough that the old id-only patient code would drop.
INSERT INTO patient_personal_info
  (PATIENT_ID, PATIENT_DOB, PATIENT_GENDER, PATIENT_ADDRESS1, PATIENT_ADDRESS2,
   PATIENT_CONTRY, PATIENT_STATE, PATIENT_CITY, PATIENT_AREA, PATIENT_ZIP,
   PATIENT_PHOTO, PATIENT_RECORD_DATE)
VALUES
  (950001,'1985-06-15','Male','12 MG Road','Near Clock Tower','1','29','595283','660527',302001,'rajesh_950001.jpg','2025-09-01'),
  (950002,'2010-03-10','Female','12 MG Road','Near Clock Tower','1','29','595283','660527',302001,NULL,'2025-09-01'),
  (950003,'2024-01-01','Male','12 MG Road','','1','29','595283','660527',302001,NULL,'2025-09-01'),
  (950004,'1955-08-08','Female','12 MG Road','','1','29','595283','660527',302001,NULL,'2025-09-01'),
  (950010,'1990-01-01','Male','99 Lake View','','India','Haryana','hisar','ODM',125001,'amit_950010.png','2025-09-01');

-- ── user_patient_relation ──────────────────────────────────────────────────────
-- Anchor + 2 members get B + branch rows. 950004 (Sita) intentionally has NO row
-- (only reachable via patient_family) to exercise the union step.
INSERT INTO user_patient_relation
  (patient_id, patient_family_id, user_id, user_type, tenant_id, tenant_type,
   set_primary, cdate, cuser, status, entity_id, entity_type)
VALUES
  (950001,0,0,'',@T,'B',1,@NOW,'seed',1,@T,'B'),
  (950001,0,0,'',@T,'B',0,@NOW,'seed',1,@BR,'branch'),
  (950002,0,0,'',@T,'B',1,@NOW,'seed',1,@T,'B'),
  (950002,0,0,'',@T,'B',0,@NOW,'seed',1,@BR,'branch'),
  (950003,0,0,'',@T,'B',1,@NOW,'seed',1,@T,'B'),
  (950003,0,0,'',@T,'B',0,@NOW,'seed',1,@BR,'branch'),
  (950010,0,0,'',@T,'B',1,@NOW,'seed',1,@T,'B'),
  (950010,0,0,'',@T,'B',0,@NOW,'seed',1,@BR2,'branch');

-- ── patient_family (relationships) ─────────────────────────────────────────────
INSERT INTO patient_family
  (PATIENT_ID, FAMILY_MEMBER_PATIENT_ID, FNAME, LNAME, RELATION, CUSER, CDATE, FLAG)
VALUES
  (950001,950002,'Priya','Sharma','Daughter','seed','2025-09-01',0),
  (950001,950003,'Aarav','Sharma','Son','seed','2025-09-01',0),
  (950001,950004,'Sita','Devi','Mother','seed','2025-09-01',0);

-- ── referring panel (full geo + address, branch-mapped via price_detail) ───────
INSERT INTO referring_panels
  (id, name, code, address, country, state, city, area, zip, phone, email,
   tenant_id, created_on, created_by, status, commission_current, commission_tobe,
   panel_type, parent_id, branch_id, commission_type, director_name, director_contact)
VALUES
  (950,'Test Diagnostics','TD-01','45 Health Plaza','1','29','595283','660527','302016',
   '[{"num":"9811111111"}]','[{"email":"panel@test.com"}]',@T,@NOW,0,1,0.00,0.00,
   'credit',0,0,'percentage','Dr. Panel','9811111111');

INSERT INTO referring_panel_price_detail
  (context_id, context_type, context_name, commission, commission_type,
   referring_panel_id, tenant_id, branch_id, status, effective_start_date,
   created_on, created_by)
VALUES
  (0,'labtest','seed',0.00,'percentage',950,@T,@BR,1,@NOW,@NOW,0);
