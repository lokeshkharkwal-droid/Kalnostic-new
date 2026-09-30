# Technician Reporting — Backend Architecture (verified 2026-09-07)

Read-only analysis of `Kalnostic-new/src`. All claims cite `file:line`. This
supersedes the 2026-08-04 pass where the two diverge — divergences are called
out explicitly. Panel-splitting (the 2026-09-04
`break_panel_reports_into_member_tests` migration) is out of scope; mentioned
only where it touches the reviewed code.

## 0. Controllers/services inventory

`src/modules/lab-report/`:
`lab-report.controller.ts` (886 lines, main), `lab-report.service.ts` (~3750
lines), `lab-report-attachment.controller.ts`/`.service.ts`,
`critical-alert.controller.ts`/`.service.ts`,
`out-of-range.controller.ts`/`.service.ts`,
`delta-check.controller.ts`/`.service.ts`, `re-run.controller.ts`/`.service.ts`,
`scheduled-test.controller.ts`/`.service.ts`, `multi-step-process.service.ts`
(no own controller — routes live on `LabReportController`),
`tat-adjustment.controller.ts`/`.service.ts`,
`inventory-usage.controller.ts`/`.service.ts`, `tat.service.ts`,
`nabl-tat-cron.service.ts`, `lab-report-directory.service.ts`.

`src/modules/technician-settings/`: `technician-settings.controller.ts`/`.service.ts`.

`src/modules/users/`: `lab-technician-options.controller.ts`,
`radiology-technician-options.controller.ts`, `phlebotomist-options.controller.ts`,
`radiologist-options.controller.ts`, `branch-user-options.controller.ts`.

---

## 1. Worklist listing — `GET /lab-reports`

- Route: `lab-report.controller.ts:116-123` (`findAll`), no `@RequirePermission`
  (unannotated — see §RBAC).
- Guard: class-level `@UseGuards(PermissionGuard)` at `lab-report.controller.ts:72`.
- Query DTO: `dto/list-lab-reports.dto.ts:25-133` — `status`, `branchId`
  (override, "All Branches"), `source` (`ALL`/`IN_HOUSE`/`OUTSOURCE`), `search`,
  `dateFrom`/`dateTo`, `referredByDoctorId`, `referralPanelId`, `departmentId`,
  `branchLabPanelId`, `branchLabTestId`, `patientId`, `orderId`, `sampleStatus`,
  `outsource`, `urgent`, `homeCollection`, `page`, `limit`. **No `sort`/`sortBy`
  field exists in the DTO.**
- Service: `lab-report.service.ts:432-483` (`findAll`).
  - `buildListWhere` (`lab-report.service.ts:305-430`) builds every filter as a
    Prisma `WHERE` clause: tenant/branch/status/urgent/source/outsource/date
    range all as direct `LabReport` columns (lines 310-328); department/panel/
    test/order/sampleStatus/doctor/referralPanel/homeCollection/patientId as
    nested `orderItem`/`order` `WHERE` filters (lines 330-368); free-text
    `search` as a nested OR across test name, panel name, order code, referral
    panel name, and a multi-word AND-of-OR patient-name match (lines 376-422).
    **All filtering happens in the DB query, not in application code.**
  - Pagination: DB-level `skip`/`take` (`lab-report.service.ts:451-452`),
    default `page=1, limit=25` (lines 439-440).
  - Sorting: **hardcoded**, not client-controlled —
    `orderBy: { orderItem: { order: { createdAt: 'desc' } } }`
    (`lab-report.service.ts:450`), explicitly chosen over the `LabReport` row's
    own `createdAt` (comment lines 446-449: sample-accept timing drifts out of
    order). No sort param exists to override this.
  - Post-fetch enrichment (application code, batched — not the base query):
    `attachBranchNames` (598-516, logical FK, no Prisma relation on `Branch`),
    `attachDepartmentNames` (525-551, same reason), `attachMemberTestNames`
    (561-585, panel-member test name), `attachResultTypes` (not read in full,
    exists per grep), `attachSampleStatuses` (via
    `worklist.entity.ts:275-306`, `OrderSampleTest`→`sample.status`, since
    sample linkage is many-to-many and not embeddable in the main `include`),
    `attachMultiStepProcess` (938-976, batched lookup by report id).
  - TAT band per row: `tatService.computeBandsForReports` (batched,
    `lab-report.service.ts:466-470`) — analytical TAT is live-computed for
    in-flight reports, frozen snapshot for approved ones.
  - Response envelope: `{ data, total, page, limit }` — deliberately named
    `data` (not `rows`) so `ResponseInterceptor` lifts pagination into
    `meta` (comment `lab-report.service.ts:477-482`).

## 2. Result save / partial save

- Route: `PATCH /lab-reports/:id/results` (`upsertResults`,
  `lab-report.controller.ts:383-404`) — result-value grid writes.
  Guard: `@RequirePermission(PERMISSION_KEYS.LAB_ENTER_RESULT)` (line 384).
- Separately, `POST /lab-reports/:id/save` (`save`,
  `lab-report.controller.ts:434-448`) — the status-transition "Save" action.
  Guard: same `LAB_ENTER_RESULT` (line 435).
- DTO: `dto/upsert-result-values.dto.ts` (`UpsertResultValuesDto`, a `values[]`
  array of `{ resultParamId, observed1, observed2, unit, methodology,
  referenceRangeId, referenceDisplay }`).
- Service `upsertResultValues` (`lab-report.service.ts:1477-1540`): per-value
  `labReportResultValue.upsert` keyed on the composite unique
  `labReportId_resultParamId` (lines 1489-1528), inside
  `prisma.withTenant(tenantId, …)` (tenant-scoped transaction). `source` is
  always stamped `ResultValueSource.MANUAL` (1506, 1517). On update, explicitly
  resets `deletedAt: null` (1526) — needed because a slot soft-deleted by a
  prior Re-Run would otherwise silently stay excluded from every read path
  even after being re-saved (comment 1520-1525).
- Service `save` (`lab-report.service.ts:2939-2980`): `requireReport` (locked/
  tenant/branch check), `assertTransition('save', …)` against
  `LAB_REPORT_ALLOWED_FROM.save = ['PENDING','PARTIAL_PENDING','SAVED']`
  (`entities/lab-report.entity.ts:439`), then
  `requireAtLeastOneResultValue` (`lab-report.service.ts:1378-1393` — at least
  one non-empty `observed1` across the report, not "every parameter filled"),
  then a `withTenant` transaction: `labReport.update` to `SAVED` +
  `recordHistory`.
- "Partial save" as a distinct action does not exist — `upsertResultValues`
  itself already tolerates every field being blank per-call (any subset of
  parameters); the transition-gate (`save`) is the only place that requires
  "at least one real value."

## 3. Result submit / validate

- `POST /lab-reports/:id/submit` (`lab-report.controller.ts:450-469`), guard
  `LAB_ENTER_RESULT` (line 451). Service `submit`
  (`lab-report.service.ts:2982-3018`): same `requireAtLeastOneResultValue`
  gate as `save`, transition `['PENDING','PARTIAL_PENDING','SAVED']` →
  `VALIDATION_PENDING`.
- `POST /lab-reports/:id/validate` (`lab-report.controller.ts:471-492`), guard
  `LAB_ACCESS_VALIDATION_PENDING` (line 472). Body: `ActionNotesDto` (optional
  notes). Service `validate` (`lab-report.service.ts:3022-3075`): transition
  `['VALIDATION_PENDING']` → `RESULT_DONE`; also calls
  `tatService.resolveReportingDeferral` (line 3036-3040) to stamp
  `reportingDeferredUntil` per SRS §5.4/§5.5 (see §TAT below) — deferral is
  stamped here, enforced later at `approve`.

## 4. Approve

- `POST /lab-reports/:id/approve` (`lab-report.controller.ts:572-593`), guard
  `LAB_ACCESS_RESULT_DONE` (line 573). Body: `ApproveReportDto`
  (`dto/approve-report.dto.ts` — optional `notes` + 3 optional
  `signatoryAuthority{1,2,3}Id`).
- Service `approve` (`lab-report.service.ts:3257-3352`):
  1. `requireReport` + `assertTransition('approve', …)` → only from
     `RESULT_DONE` (`entities/lab-report.entity.ts:448`).
  2. Blocks if still deferred: `report.reportingDeferredUntil > now` throws
     `ReportingWindowClosedException` (lines 3270-3275).
  3. `resolveSignatoryColumns` (3191-3255) **re-validates** each submitted
     signatory id against a freshly re-fetched candidate list — never trusts
     whatever the client fetched when the modal opened (doc comment
     3181-3190); slot 1 mandatory only if the department has ≥1 candidate.
  4. Freezes the TAT snapshot at approval instant — either
     `tatService.buildNablFinalize` (NABL cron-managed reports) or
     `tatService.buildApprovalSnapshot` (everyone else) (3294-3315).
  5. `withTenant` transaction: `labReport.update` → `APPROVED`, stamps
     `approvedAt/approvedBy`, clears `reportingDeferredUntil`, writes
     `tatData` + `signatoryColumns`; optional note; `recordHistory`.

## 5. Publish

- `POST /lab-reports/:id/publish` (`lab-report.controller.ts:595-614`), guard
  `LAB_ACCESS_APPROVED` (line 596).
- Service `publish` (`lab-report.service.ts:3354-3393`): transition
  `['APPROVED']` → `PUBLISHED`, stamps `publishedAt/publishedBy`,
  `recordHistory`, then fire-and-forget `eventEmitter.emitAsync
  ('lab-report.published', …)` (3386-3391) — patient-notification side effect
  handled by `ClinicalEventListener` (not read in this pass).
- **No check that the report has no open/unresolved Critical Alert / Out of
  Range / errored state before publish** — `assertTransition` only checks
  `LabReportStatus`, not any worklist-entry status. This matches the
  2026-08-04 gap ("report publishable despite errored sample") — confirmed
  still true: nothing in `publish()` or `assertTransition` queries
  `CriticalAlert`/`OutOfRangeFlag`/`DeltaCheck` rows.

## 6. Lock / Unlock

- `POST /lab-reports/:id/lock` (`lab-report.controller.ts:639-660`), guard
  `LAB_MARK_LOCK_TEST` (line 640). Service `lock`
  (`lab-report.service.ts:3499-3535`): sets `isLocked: true` + `lockedAt/
  lockedBy/lockNotes`, optional `LOCK`-category note. No transition gate — any
  status can be locked.
- `POST /lab-reports/:id/unlock` (`lab-report.controller.ts:670-688`): **no
  `@RequirePermission` decorator at all.** The route body hardcodes
  `const canUnlock = false; // TODO: replace with real supervisor permission
  check` (line 681) and always calls
  `labReportService.unlock(id, tenantId, profile.branchId, canUnlock)` with
  `canUnlock = false`. Service `unlock`
  (`lab-report.service.ts:3544-3566`): `if (!canUnlock) throw
  UnlockNotPermittedException()` (line 3550) — **unlock is still hardcoded to
  always deny**, confirming the 2026-08-04 finding is unchanged. The
  controller's own comment (662-669) names the missing permission key as
  `lab_operations:lock_override`, not yet added to
  `PERMISSION_KEYS`.

## 7. Re-Run

- `POST /lab-reports/:id/re-run` (`lab-report.controller.ts:713-734`), guard
  `LAB_MARK_RE_RUN` (line 714). Body: `RaiseReRunDto` (optional `notes`,
  `dto/re-run.dto.ts:4-8`).
- Controller calls `reRunService.raise` (`re-run.service.ts:42-87`), which:
  1. Verifies the report exists in tenant+branch.
  2. Calls `labReportService.resetForRerun` (`lab-report.service.ts:3446-3495`)
     — **no `assertTransition` gate; explicitly allowed from any status**
     (doc comment 3439-3445, "Any status" row).
  3. Creates a `ReRunRequest` row (`status: PENDING`) — the worklist-tracking
     entity, independent of the report reset (doc comment `re-run.service.ts:
     20-29`: "Re-Run Status reflects the current report status ...
     independently").
  4. `recordWorklistHistory('re_run_requested', …)`.
- `resetForRerun` precisely (`lab-report.service.ts:3446-3495`):
  - **Soft-deletes**, does not hard-delete: `labReportResultValue.updateMany
    ({ where: { labReportId: id, deletedAt: null }, data: { deletedAt: new
    Date() } })` (3458-3461) — rows remain in the table with `deletedAt` set;
    every read path (`LAB_REPORT_DETAIL_INCLUDE`, `requireAtLeastOneResultValue`,
    etc.) filters `deletedAt: null` so they become invisible, but are not
    physically removed.
  - Resets `LabReport.status` to `PENDING` and nulls every lifecycle
    timestamp/actor column (`savedAt/By`, `submittedAt/By`, `validatedAt/By`,
    `approvedAt/By`, `publishedAt/By`) and every TAT snapshot column
    (`tatStartAt/NetMinutes/MaxMinutes/Band`) — TAT clock reopens live
    (3476-3481).
  - **Notes, critical-alert, and out-of-range rows tied to the report are NOT
    touched** — `CriticalAlert`/`OutOfRangeFlag`/`DeltaCheck`/`LabReportNote`
    rows referencing this `labReportId` survive Re-Run untouched (no query
    against those tables anywhere in `resetForRerun`). Confirmed by absence —
    the method only touches `labReportResultValue` and `labReport` itself.
  - A `LabReportHistory` row is written (`re_run`, 3484-3492) — the audit
    record of the reset itself is preserved (append-only table, never
    modified by the reset).
- `GET /re-run-requests` / `PATCH /re-run-requests/:id/status` — separate
  worklist controller `re-run.controller.ts:21-55`, guards
  `LAB_ACCESS_RE_RUN_LIST` / `LAB_UPDATE_RE_RUN`.

## 8. Multi-Step Process

- Routes on `LabReportController`: `GET :id/multi-step-process`
  (`lab-report.controller.ts:828-839`, **no permission decorator**), `POST
  :id/multi-step-process` (assign, 841-862, guard `LAB_MARK_MULTISTEP`), `POST
  :id/multi-step-process/advance` (864-885, guard `LAB_MARK_MULTISTEP`).
- Service `multi-step-process.service.ts`. Fixed forward sequence: GROSSING →
  SECTIONING → STAINING → REPORTING (`STAGE_SEQUENCE`, lines 18-23).
- `assign` (54-116): **re-assignment behavior — still overwrites, now on
  assign rather than advance.** When `multiStepTestProcess.findUnique` finds
  an existing row for this `labReportId` (line 73), `assign` calls
  `tx.multiStepTestProcess.update` with
  `stageHistory: [historyEntry] as unknown as Prisma.InputJsonValue` (line
  86) — a **fresh single-entry array**, replacing whatever history existed
  before, and resets `currentStage` back to `GROSSING` (line 85). This is the
  same "stageHistory overwritten in place" defect the 2026-08-04 finding
  described, just relocated: it no longer happens on a normal `advance` call.
- `advance` (141-205): correctly **appends** —
  `stageHistory: [...existingHistory, historyEntry]` (184-187) — advancing
  through stages preserves history. Validates strict one-step-forward-only:
  `dto.stage !== expectedNextStage` throws
  `InvalidMultiStepTransitionException` (164-172); no skipping, no going
  backward.
- `findByReport` (118-139): simple tenant/branch-scoped lookup, throws
  `MultiStepProcessNotFoundException` if none exists yet.

## 9. Trend Report

- `GET /lab-reports/:id/trend` (`lab-report.controller.ts:335-349`), guard
  `LAB_VIEW_TREND` (line 336). Query: `TrendReportQueryDto` (`resultParamId`).
- Service `findTrend` (`lab-report.service.ts:1706-1750+`): confirms report
  exists, then `labReportResultValue.findMany` filtered by
  `tenantId + resultParamId + deletedAt: null +
  labReport.orderItem.order.patientId = <this report's patient>`, ordered
  `enteredAt: asc` (1719-1729) — **all filtering/ordering is DB-level.**
  Reference ranges for flagging are then batch-fetched by the distinct
  `referenceRangeId`s already stored on each value (1731-1745) and joined in
  application code (no re-run of age/gender/methodology matching — doc
  comment 1696-1704). Returns Normal/High/Low flag on `observed1` only,
  `observed2` unflagged; no critical tier used (`criticalMin/Max` unused,
  deliberate v1 scope per comment 1700-1701).

## 10. Delta Check

- Raise: `POST /lab-reports/:id/delta-check` (`lab-report.controller.ts:
  782-803`), guard `LAB_MARK_DELTA_CHECK`. Worklist list/status:
  `delta-check.controller.ts` — `GET /delta-checks` (guard
  `LAB_ACCESS_DELTA_LIST`), `PATCH /delta-checks/:id/status` (guard
  `LAB_UPDATE_DELTA`).
- `previousResultValueId` resolution: `delta-check.service.ts:46-64`
  (`findPreviousResultValue`) — `labReportResultValue.findFirst` filtered by
  `tenantId + resultParamId + deletedAt: null + labReportId: { not:
  excludeLabReportId } + labReport.orderItem.order.patientId = <this
  patient>`, `orderBy: { enteredAt: 'desc' }` — i.e. **the most recent prior
  saved value for the same parameter, same patient, any other report.** Only
  looked up when `dto.resultParamId` is supplied (66, 85-94) — raising a
  delta check without a specific parameter leaves `previousResultValueId`
  undefined.
- `raise` (66-131): `$transaction` creates `DeltaCheck` (`status: NEW,
  trigger: MANUAL`) + a `DELTA`-category `LabReportNote`, then
  `recordWorklistHistory('delta_check_raised', …)`.
- Automatic (non-manual) delta detection is explicitly out of scope — doc
  comment `delta-check.service.ts:24-28`: "automatic detection... is out of
  scope for this pass."

## 11. Critical Alerts

- Raise: `POST /lab-reports/:id/critical-alert`
  (`lab-report.controller.ts:736-757`), guard `LAB_MARK_CRITICAL_ALERT`.
  Worklist: `critical-alert.controller.ts` — `GET /critical-alerts` (guard
  `LAB_ACCESS_CRITICAL_LIST`), `PATCH /critical-alerts/:id/status` (guard
  `LAB_UPDATE_CRITICAL`).
- `raise` (`critical-alert.service.ts:43-96`): creates `CriticalAlert`
  (`status: NEW, trigger: MANUAL`, `reportStatusAtTrigger: report.status`) +
  `CRITICAL_ALERT`-category note, in one `$transaction`; then
  `recordWorklistHistory('critical_alert_raised', …)`.
- Automatic trigger (value inside admin-configured critical range) is **not
  implemented** — doc comment lines 21-25: depends on Reporting Settings,
  "out of scope for this pass." Manual-only, matching the 2026-08-04 finding.
- Per CR-02 (comment 27-29), the worklist controller itself exposes no
  "raise again" action — raising only ever happens via `LabReportController`.

## 12. Out of Range

- Raise: `POST /lab-reports/:id/out-of-range`
  (`lab-report.controller.ts:759-780`), guard `LAB_MARK_OOR`. Worklist:
  `out-of-range.controller.ts` — `GET /out-of-range-flags` (guard
  `LAB_ACCESS_OOR`), `PATCH /out-of-range-flags/:id/status` (guard
  `LAB_UPDATE_OOR`).
- `raise` (`out-of-range.service.ts:37-90`): identical shape to Critical
  Alert — creates `OutOfRangeFlag` + `OUT_OF_RANGE`-category note in one
  transaction, then `recordWorklistHistory('out_of_range_raised', …)`.
  Automatic trigger likewise out of scope (comment lines 20-24).

## 13. Sample Overview

- **No dedicated "sample overview" endpoint exists.** Sample data reaches the
  client two ways:
  1. Embedded in the report detail response: `GET /lab-reports/:id`
     (`findOne`, `lab-report.controller.ts:234-241` → `findByIdForApi`,
     `lab-report.service.ts:1131+`), which flattens `LAB_REPORT_DETAIL_INCLUDE`
     (`entities/lab-report.entity.ts:32-46`) — includes `orderItem.order.patient`,
     `referredByDoctor`, `referralPanel`, `branchLabTest`/`branchLabPanel`,
     `resultValues`, `notes`, `attachments`, `multiStepProcess` — but **not**
     a direct `Accession`/`OrderSample` relation (no such Prisma relation
     exists on `LabReport`/`OrderItem` per the worklist code's own comments).
  2. Worklist rows' `sampleStatuses`/`sampleIds` — resolved separately via
     `attachSampleStatuses`/`attachWorklistSampleStatuses`
     (`worklist.entity.ts:275-306`), a batched `OrderSampleTest.findMany`
     joined by `orderItemId`, done as **post-fetch application code**, not
     inside the main list/detail Prisma query.
  No `sample-overview`-named route, controller, or DTO exists anywhere under
  `src/modules/lab-report` or `src/modules/accession` (grep confirmed no
  match for that phrase).

## 14. Notes

- **One shared endpoint pair**, not separate per note-type endpoints: `GET
  /lab-reports/:id/notes` (`findNotes`, `lab-report.controller.ts:267-280`,
  no permission decorator) and `POST /lab-reports/:id/notes` (`createNote`,
  282-303, guard `LAB_UPDATE_TECH_NOTES`).
- DTO categories: only 3 "plain" categories are writable through this path —
  `ORDER`, `SAMPLE`, `TECH` (`PLAIN_NOTE_CATEGORIES`,
  `dto/lab-report-note.dto.ts:8`). `ListLabReportNotesDto.category` (line
  22-26) filters to one of the 3, or all 3 when omitted.
- Schema: single table `LabReportNote` (`category` is a free enum spanning
  12 total values — the 3 plain ones plus 9 action-side-effect ones: `LOCK`,
  `RE_RUN`(via history, not notes)... actually the other 9 are written only
  by their own specific action services: `DELTA`, `CRITICAL_ALERT`,
  `OUT_OF_RANGE`, `SCHEDULE`, `MULTI_STEP`, `LOCK`, `RESULT_REJECTED`,
  `ERROR_REPORTED`, `UPDATE_STATUS` — confirmed by grep of every
  `category: '...'` literal across the service files read in this pass).
- Cross-report scoping fix (already live): `createNote`/`findNotes` resolve
  every sibling `LabReport` on the same order via `siblingReportIds`
  (`lab-report.service.ts:3612-3634`, joins on `orderItem.orderId`) and
  read/write across all of them — so a note added on one test's tab is
  visible on every other test's tab for the same order (doc comment
  3596-3610 explains the bug this fixed). The other 9 action-triggered
  categories keep their original single-report scoping.
- `createdByName` is resolved via `resolveActorNames`
  (`worklist.entity.ts:318-334`) against `Person`, falling back to the raw id
  if unresolvable (`lab-report.service.ts:3683-3690`).

## 15. Audit Trail

- `GET /lab-reports/:id/history` (`getHistory`,
  `lab-report.controller.ts:257-264`, no permission decorator). Service
  `lab-report.service.ts:3695-3707`: reads `labReportHistory.findMany({
  where: { labReportId, tenantId }, orderBy: { createdAt: 'desc' } })`, then
  `enrichActorNames` (3718-3729+).
- Table: `LabReportHistory` — append-only (schema comment
  `schema.prisma:7257`, "Append-only audit trail... every status transition
  and notable action"). Every lifecycle transition (save/submit/validate/
  editReport/reject/resubmit/approve/publish/errorReported/re-run) calls
  `recordHistory` (private, `lab-report.service.ts:1409-1430`) inside the
  same `withTenant` transaction as the status write. The 5 worklist services
  (Re-Run/Critical Alert/Out of Range/Delta Check/Scheduled Test) fold their
  own status changes into the same table via the public
  `recordWorklistHistory` (1449-1473) — since their own status vocab
  (`ReRunStatus`/`AlertReviewStatus`/`ScheduledTestStatus`) doesn't fit the
  `LabReportStatus`-typed `fromStatus`/`toStatus` columns, both columns are
  set to the report's *unchanged* current status and the real transition is
  folded into the free-text `action`/`notes` fields (doc comment
  1432-1447).
- Actor resolution: `actorId` is a **logical reference to `Person.id`, no
  enforced FK** (doc comment 3709-3716) — same pattern as `AuditLog.
  actorPersonId` (deliberate: an audit trail must survive independent of the
  referenced person). `enrichActorNames` (3718+) batches a `Person.findMany`
  and falls back to `null` (never guesses) if unresolved.
- Separate, broader system: `AuditLog` via the `@Audit(...)` decorator
  (`common/decorators/audit.decorator.ts:44-45`) + a global `AuditInterceptor`
  (not read in this pass) — records caller identity/role/IP for annotated
  routes tenant-wide, distinct from and in addition to `LabReportHistory`.
  Every mutating lab-report/technician route in this module carries an
  `@Audit({...})` decorator except: `unlock`, `GET .../multi-step-process`,
  `GET .../notes`, `GET .../history`, and every plain `GET` (all read-only,
  by design — `AuditInterceptor` doc line 33-34 confirms unannotated routes
  are never logged into `AuditLog`).

## 16. Scheduled / Reschedule Test

- Create: `POST /lab-reports/:id/schedule` (`lab-report.controller.ts:
  805-826`), guard `LAB_MARK_SCHEDULED`. Worklist controller
  `scheduled-test.controller.ts`: `GET /scheduled-tests` (guard
  `LAB_ACCESS_SCHEDULED_LIST`), `PATCH /scheduled-tests/:id` (reschedule,
  guard `LAB_UPDATE_SCHEDULED`), `PATCH /scheduled-tests/:id/status` (guard
  `LAB_UPDATE_SCHEDULED`).
- Per CR-03 (doc comment `scheduled-test.controller.ts:16-19`): **no
  standalone "+ Add Schedule" route** — creation only via the per-test
  `schedule` action; the worklist itself only supports reschedule/status.
- `schedule` (`scheduled-test.service.ts:41-110`): if `dto.assignedToId` is
  present, validates via `directory.assertActiveTechnician(tenantId,
  branchId, assignedToId)` (59-64) before creating — **a real
  active-technician check**, not a trusted client value. Creates
  `ScheduledTest` (`status: SCHEDULED`) + optional `SCHEDULE`-category note in
  one transaction; then `recordWorklistHistory('scheduled_test_created', …)`.
- `reschedule` (135-194): same `assertActiveTechnician` re-check, updates
  `scheduledAt`/`dispatchAt`/`assignedToId` in place (same row, no history
  row created for the schedule change itself beyond the `LabReportHistory`
  entry).

## 17. Methodology dropdown

- `GET /lab-reports/:id/reference-range/methods`
  (`listMethodsForParam`, `lab-report.controller.ts:305-318`, no permission
  decorator). Query: `ReferenceRangeMethodsQueryDto` (`resultParamId`).
- Service `listMethodsForParam` (`lab-report.service.ts:1550-1590`): **real
  admin-configured catalogue data**, confirmed. Resolves the parameter's own
  default `method` (`LabTestResultParam.method`, line 1573) plus every
  distinct non-null `method` value actually configured on that parameter's
  reference rows — `labTestReferenceValue.method` for `QUALITATIVE` params
  (1575-1580) or `labTestReferenceRange.method` for quantitative ones
  (1581-1586) — deduplicated into a `Set`. Not a hardcoded enum/array
  anywhere in this path.

## 18. Attachments

**Correction to the 2026-08-04 finding ("totally absent, FE-mock-only") — a
real backend now exists.** (One stale doc-comment,
`dto/notes-attachments.dto.ts:6-8`, still describes attachments as living on
"the separate `/attachments` endpoint" without detail — consistent with,
not contradicting, what follows.)

- Routes, `lab-report-attachment.controller.ts:29-81`, all under `@Controller
  ('lab-reports')` + class-level `@UseGuards(PermissionGuard)`:
  - `GET :id/attachments` (34-41) — **no `@RequirePermission`** (comment
    line 26: "GET is open (a view)").
  - `POST :id/attachments` (43-64) — guard `LAB_UPDATE_TECH_NOTES`.
  - `DELETE :id/attachments/:attachmentId` (66-80) — guard
    `LAB_UPDATE_TECH_NOTES`.
- Schema: real table `LabReportAttachment` (`prisma/schema.prisma:7238-7255`)
  — `kind` (string: "image"|"document"|"file"), `fileUrl`, `fileName`,
  `notes`, `uploadedBy`, `uploadedAt`; FK to `LabReport` with
  `onDelete: Cascade`.
- Service `lab-report-attachment.service.ts`: **URL-only pattern** — doc
  comment lines 8-12: "the bytes are already in S3 (via `POST
  /uploads/attachment`); this stores the URL + metadata." `addAttachment`
  (27-48) does a real tenant/branch-scoped `labReportAttachment.create`
  inside `withTenant`. `listForReport` (54-64) does a real tenant-scoped
  `findMany`. `remove` (70-88) does a real **hard** delete (`tx.
  labReportAttachment.delete`, line 85 — doc comment 66-69: "the model has no
  soft-delete column").
- The same table doubles as the store for EMI-analyzer-uploaded histogram
  images (doc comments on both controller line 27 and service lines 11-12,
  50-51) — `kind`/`uploadedBy` distinguish machine- vs human-uploaded rows,
  but there's no separate flag column confirmed in this pass; not fully
  verified which field marks EMI-origin rows.
- Conclusion: **a real, permission-gated, tenant/branch-scoped backend
  endpoint exists**; it stores a reference to an externally-uploaded file
  (S3 URL) rather than proxying file bytes itself. This is a materially
  different, and more complete, state than the 2026-08-04 "FE-mock-only"
  finding described.

## 19. TAT (turnaround time)

- Breakdown endpoint: `GET /lab-reports/:id/tat` (`getTat`,
  `lab-report.controller.ts:248-255`, no permission decorator) →
  `tatService.computeForReport`.
- Summary endpoint: `GET /lab-reports/tat/summary` (`getTatSummary`,
  `lab-report.controller.ts:107-114`, no permission decorator, declared
  before `:id` routes to avoid capturing `tat` as an id) →
  `tatService.summary`.
- Model (`tat.service.ts:1-141`): **hybrid storage.** Live-computed for
  in-flight reports (end = "now"); frozen at `approve()` onto 4 `LabReport`
  columns (`tatStartAt`, `tatNetMinutes`, `tatMaxMinutes`, `tatBand`) so
  analytics survive later TAT-config changes (doc comment 130-137). Clock:
  earliest linked sample's `acceptedAt` → `approvedAt` (or "now"), net of
  breaks/closed hours/non-scheduled days (`WorkingShift`/`scheduleDays`
  config on `BranchLabTest`).
- Feeds the worklist: `computeBandsForReports`, batched, called once per page
  from `findAll` (`lab-report.service.ts:466-470`) — not per-row.
- Reporting-cutoff/deferral logic (SRS §5.4/§5.5): `resolveReportingCutoff`
  (`common/utils/tat-working-time.util.ts:397-412`) computes `cutoffMinutes =
  hhmmToMinutes(reportingTimeTo) - maxApprovalMinutes` (line 405) with **no
  guard against a negative result** when `maxApprovalMinutes` (Approval
  Duration Max) exceeds the reporting window — confirmed still present,
  unchanged from the prior finding (`bug_tat_negative_cutoff_deferred`
  memory). `nextReportingSessionStart` (424-447) computes the next session
  open time when deferred, with its own bounded 7-day forward scan and a
  documented fallback to "tomorrow" if no scheduled day is found within a
  week (443-446).
- NABL cron path: a report with `isNablTat: true` is managed by
  `NablTatCronService` (not read in this pass) and finalized via
  `tatService.buildNablFinalize` at approve time (`lab-report.service.ts:
  3295-3301`) instead of the legacy accepted→approved snapshot.

---

## RBAC / Permission audit

`PermissionGuard` (`src/modules/permissions/guards/permission.guard.ts:
25-63`) is **opt-in per-route**, not fail-closed globally:
- Line 42-44: if a route carries **no** `@RequirePermission`/
  `@RequireAnyPermission` metadata, `canActivate` returns `true`
  unconditionally — **"unannotated routes are never gated"** (comment
  line 43), relying only on the global JWT auth guard running earlier in the
  pipeline.
- Line 48-50: if `req.user` is absent (a `@Public` route slipped through),
  it also returns `true` — nothing to gate, by design for public routes.
- Delegates the actual check to `PermissionCheckService.enforce`
  (`permission-check.service.ts:68-94`), which:
  - Bypasses entirely for `business_admin`/`administrator` profile keys
    (`ADMIN_BYPASS_ROLES`, line 13; `isAdmin` check at line 74) — **admin
    roles unconditionally bypass every permission check**, confirming the
    pattern flagged elsewhere in this codebase.
  - Is **log-only, not enforcing**, when `process.env.RBAC_ENFORCE ===
    'false'` (lines 85-92): logs the missing keys and **returns `true`**
    (allows the request) instead of throwing. Enforcement only actually
    blocks when `RBAC_ENFORCE` is unset or any value other than the literal
    string `'false'`.
  - Otherwise throws `PermissionDeniedException` (line 93) — this is the
    fail-**closed** branch, reached only for an annotated route, a
    non-admin caller, and `RBAC_ENFORCE` not disabled.

**Net effect for lab-report/technician controllers specifically:** the guard
itself is fail-open for missing metadata (matches the "fail-open" pattern
noted elsewhere in this codebase) and unconditionally bypasses admin roles —
but is **not** the "bypasses admin roles unconditionally regardless of
enforcement mode" note from the other module's finding in the sense of
ignoring a real check; rather, admin bypass is a deliberate, documented
design (`permission-check.service.ts:9-12` — "prevents self-lockout of
admins while RBAC is rolled out per module"), applied uniformly to every
permission-checked route in the codebase, not specific to lab-report.

**Routes confirmed to carry zero `@RequirePermission`/`@RequireAnyPermission`
(rely on global JWT auth only)**, from the controllers read in this pass:
- `lab-report.controller.ts`: `findOne` (:234), `getTat` (:248), `getHistory`
  (:257), `findNotes` (:267), `listMethodsForParam` (:305),
  `resolveReferenceRange` (:320), `getSignatoryCandidates` (:559),
  `unlock` (:670 — see §6, deliberately hardcoded deny, not merely
  ungated), `getMultiStepProcess` (:828), `getCounts` (:85), `getOptions`
  (:94), `shareInfo` (:170), `shareOrderReport` (:183 — mutating, no
  permission decorator), `shareAllOrderReport` (:212 — mutating, no
  permission decorator), `printAll`/`print` (:131, :354 — mutating/side-
  effecting, no permission decorator).
- `lab-report-attachment.controller.ts`: `list` (:34, deliberately open per
  comment).
- `tat-adjustment.controller.ts`: **all three routes** — `create`, `findAll`,
  `remove` — carry no `@UseGuards(PermissionGuard)` at class or method level
  and no `@RequirePermission` anywhere in the file. This is a stronger gap
  than "unannotated route under a guarded controller": the controller itself
  never imports/applies `PermissionGuard`, so even the opt-in check never
  runs — pure JWT-auth-only for create/list/delete of TAT adjustment records.
- `technician-settings.controller.ts`: both routes are gated
  (`LAB_SETTINGS_VIEW`/`LAB_SETTINGS_UPDATE`) — no gap here.
- `lab-technician-options.controller.ts`: the whole controller has **no
  `@UseGuards(PermissionGuard)`** — JWT-auth-only, same as
  `tat-adjustment.controller.ts`.

**Routes confirmed to carry real permission gating** (representative, not
exhaustive — every other route in `lab-report.controller.ts` not listed
above has a `@RequirePermission`/`@RequireAnyPermission`, per the full file
read in §0): `upsertResults` (`LAB_ENTER_RESULT`), `save`
(`LAB_ENTER_RESULT`), `submit` (`LAB_ENTER_RESULT`), `validate`
(`LAB_ACCESS_VALIDATION_PENDING`), `editReport` (`LAB_EDIT_REPORT`), `reject`
(`LAB_MARK_RESULT_REJECTED`), `resubmit` (`LAB_RESUBMIT_KEYS`, any-of),
`approve` (`LAB_ACCESS_RESULT_DONE`), `publish` (`LAB_ACCESS_APPROVED`),
`errorReported` (`LAB_MARK_ERROR_REPORTED`), `lock` (`LAB_MARK_LOCK_TEST`),
`updateStatus`/`createNote` (`LAB_UPDATE_TECH_NOTES`), `reRun`
(`LAB_MARK_RE_RUN`), `raiseCriticalAlert` (`LAB_MARK_CRITICAL_ALERT`),
`raiseOutOfRange` (`LAB_MARK_OOR`), `raiseDeltaCheck`
(`LAB_MARK_DELTA_CHECK`), `scheduleTest` (`LAB_MARK_SCHEDULED`),
`assignMultiStepProcess`/`advanceMultiStepProcess` (`LAB_MARK_MULTISTEP`),
`findTrend` (`LAB_VIEW_TREND`), `updateContentSections` (`LAB_EDIT_REPORT`);
plus every worklist controller's list/status/reschedule route (§7, §10-12,
§16) and inventory-usage's routes (§0/inventory-usage.controller.ts, guards
`LAB_VIEW_INVENTORY`/`LAB_UPDATE_INVENTORY`).

## Tenant / branch scoping — verified

- **Worklist** (`findAll`): `tenantId`/`branchId` come from
  `@CurrentTenant()`/`@CurrentProfile()` decorators
  (`lab-report.controller.ts:118-119`) — resolved from the JWT, not the query
  string — then applied as literal Prisma `WHERE` columns in `buildListWhere`
  (`lab-report.service.ts:310-313`: `{ tenantId, branchId, deletedAt: null
  }`). A client-supplied `filters.branchId` is accepted (`ListLabReportsDto.
  branchId`) but only to **override which branch within the same tenant**
  the caller's own JWT tenant scopes to (`resolveBranch`,
  `lab-report.service.ts:298-303`) — the same "All Branches" pattern
  documented as matching `OrderService.findAll` elsewhere in the codebase;
  tenant itself is never client-supplied.
- **Save**: `tenantId`/`branchId` from `@CurrentTenant()`/`@CurrentProfile()`
  (`lab-report.controller.ts:441-443`), passed to `requireBranch` →
  `requireReport(id, tenantId, activeBranchId)`
  (`lab-report.service.ts:1346-1349`) — a literal Prisma `WHERE {id,
  tenantId, branchId, deletedAt: null}` — so a report id from another
  tenant/branch 404s before any write. The subsequent `labReport.update` runs
  inside `prisma.withTenant(tenantId, …)` (RLS-scoped transaction).
- **Approve**: identical pattern — `@CurrentTenant()`/`@CurrentProfile()`
  (`lab-report.controller.ts:580-581`) → `requireReport` (same tenant/branch
  `WHERE`) → `withTenant` transaction. Signatory ids are separately
  re-validated against a tenant/branch-scoped candidate query
  (`resolveSignatoryColumns`/`getSignatoryCandidatesInternal`), not trusted
  from the request body.
- Every other mutation read in this pass (`submit`, `validate`, `reject`,
  `resubmit`, `publish`, `errorReported`, `lock`, `unlock`, `reRun`'s
  underlying `resetForRerun`, all 5 worklist services' `raise`/`updateStatus`,
  `tat-adjustment`, `inventory-usage`, `scheduled-test`, `multi-step-process`)
  follows the same shape: `tenantId` from `@CurrentTenant()`, `branchId` from
  `@CurrentProfile()`, both passed into a `findFirst`/`requireReport`-style
  existence check with `tenantId`/`branchId` as literal `WHERE` clauses
  before any write — never read from the request body.

## Open items not determined in this pass

- Which field on `LabReportAttachment` (if any) distinguishes an
  EMI-analyzer-uploaded row from a human upload — not confirmed (§18).
- `AuditInterceptor` internals (how it resolves actor/role/IP for `AuditLog`)
  — not read in this pass; only its trigger (`@Audit(...)`) was confirmed.
- `ClinicalEventListener`'s handling of `lab-report.published` — not read;
  only the emit call site was confirmed (§5).
- `attachResultTypes` (`lab-report.service.ts`, referenced at line 461) — not
  read in full; its existence and call site are confirmed, its internal
  query is not documented here.
- Whether `PARTIAL_PENDING` is ever actually *written* to `LabReport.status`
  anywhere in the codebase: it is a real enum value, appears in
  `getCounts` (line 1004), is included in `LAB_REPORT_ALLOWED_FROM.save`/
  `.submit` (`entities/lab-report.entity.ts:439-440`), and has its own
  permission key (`LAB_ACCESS_PARTIAL_PENDING`,
  `module-permissions.constant.ts:785`) — but no `labReport.update({data:
  {status: 'PARTIAL_PENDING'}})` call site was found in
  `lab-report.service.ts` or the accession sample-acceptance path
  (`grep -r "PARTIAL_PENDING" src/modules/accession` — no matches). The
  status appears to be reachable in the transition-allow-list and counted in
  the worklist, but not currently set anywhere — consistent with the prior
  finding that this status is unimplemented, though not conclusively proven
  absent everywhere in the codebase.
