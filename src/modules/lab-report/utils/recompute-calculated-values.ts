import { Prisma, ResultValueSource } from '@prisma/client';
import {
  buildEvaluationOrder,
  evaluateFormula,
  formatCalculatedValue,
  type FormulaParam,
} from '../../../common/utils';

/**
 * Re-derive every dynamic/calculated parameter of a report from its formula and persist the result with
 * `source = CALCULATED`. Runs inside the caller's tenant transaction, AFTER the incoming (measured / override) values
 * were saved, so it evaluates against the report's freshest values.
 *
 * Shared by the two ways a value reaches a report: a technician's Save / Submit (`LabReportService.upsertResultValues`) and
 * a machine's result (`EmiService.submitResult`). Without it on the machine path, a calculated value stayed at the number
 * it had before the analyzer re-sent one of its inputs, and every view that reads stored values (report view, print,
 * validate / approve) showed the old number until a technician opened the report and saved it.
 *
 * Evaluation is in dependency order (a calculated parameter may reference another calculated parameter). A parameter in
 * `keepParamIds` is left untouched (its value "sticks") but still feeds downstream formulas. A formula that cannot be
 * computed yet (a blank / non-numeric input, or division by zero) blanks the slot rather than failing the save, so partial
 * result entry stays allowed. A calculated parameter that has no stored row yet and cannot be computed gets no row.
 *
 * @param tx the active tenant-scoped Prisma transaction client
 * @param labReportId the report whose values are being (re)computed
 * @param tenantId the tenant that owns the report
 * @param labTestId the report's source lab test (defines the parameters / formulas)
 * @param keepParamIds parameter ids whose stored value must not be recomputed
 * @param actorId who is recorded as `enteredBy` on the rows written (the user, or the analyzer's id)
 * @param now the timestamp to stamp on written rows
 */
export async function recomputeCalculatedValues(
  tx: Prisma.TransactionClient,
  labReportId: string,
  tenantId: string,
  labTestId: string,
  keepParamIds: Set<string>,
  actorId: string,
  now: Date,
): Promise<void> {
  const params = await tx.labTestResultParam.findMany({
    where: { labTestId, deletedAt: null },
    select: {
      id: true,
      parameterCode: true,
      parameterType: true,
      resultType: true,
      calculationFormula: true,
      decimalPlaces: true,
    },
  });

  const formulaParams: FormulaParam[] = params.map((p) => ({
    code: p.parameterCode,
    isCalculated:
      p.parameterType === 'CALCULATED' || !!p.calculationFormula?.trim(),
    formula: p.calculationFormula,
  }));
  const ordered = buildEvaluationOrder(formulaParams);
  // A cycle should have been rejected at config time; skip defensively.
  if (!ordered.ok || ordered.order.length === 0) return;

  const paramByCode = new Map(params.map((p) => [p.parameterCode, p]));

  // Seed the value map from the report's current stored values (measured + any already-computed values), keyed by
  // parameter code.
  const existing = await tx.labReportResultValue.findMany({
    where: { labReportId, tenantId, deletedAt: null },
    select: { resultParamId: true, observed1: true },
  });
  const existingByParamId = new Map(existing.map((v) => [v.resultParamId, v]));
  const paramCodeById = new Map(params.map((p) => [p.id, p.parameterCode]));
  const values: Record<string, number | null> = {};
  for (const p of params) values[p.parameterCode] = null;
  for (const v of existing) {
    const code = paramCodeById.get(v.resultParamId);
    if (!code) continue;
    const raw = v.observed1?.trim();
    const num = raw ? Number(raw) : NaN;
    values[code] = Number.isFinite(num) ? num : null;
  }

  for (const code of ordered.order) {
    const param = paramByCode.get(code);
    if (!param || !param.calculationFormula) continue;
    // Keep a value that sticks (a manual override, or a number the analyzer itself sent): leave the stored value and let it
    // feed downstream formulas (its numeric value is already in `values`).
    if (keepParamIds.has(param.id)) continue;

    const result = evaluateFormula(param.calculationFormula, values);
    const computed = result.ok
      ? formatCalculatedValue(result.value, param.decimalPlaces)
      : null;
    values[code] = result.ok ? result.value : null;

    // Skip creating an empty row that never existed — only blank an existing slot (e.g. a source value was cleared) so
    // partial entry stays clean.
    if (computed === null && !existingByParamId.has(param.id)) continue;

    await tx.labReportResultValue.upsert({
      where: {
        labReportId_resultParamId: { labReportId, resultParamId: param.id },
      },
      create: {
        tenantId,
        labReportId,
        resultParamId: param.id,
        observed1: computed ?? undefined,
        source: ResultValueSource.CALCULATED,
        enteredAt: now,
        enteredBy: actorId,
      },
      update: {
        observed1: computed,
        source: ResultValueSource.CALCULATED,
        enteredAt: now,
        enteredBy: actorId,
        deletedAt: null,
      },
    });
  }
}

/**
 * Recalculate a report's calculated parameters right after a MACHINE saved its values onto it.
 *
 * Two kinds of calculated value are left exactly as they are:
 *  - one the technician took over by hand (a stored row whose source is MANUAL: the screen shows it as a manual override and
 *    a Save keeps it, so the machine must not change it either);
 *  - one the machine itself sent in this same submission (the analyzer's own number is kept, as before; it still feeds any
 *    formula that uses it).
 * Everything else is derived from the stored inputs.
 *
 * @param tx the active tenant-scoped Prisma transaction client (the machine's values are already written in it)
 * @param args the report, its lab test, the tenant, the analyzer, the parameters it just sent and the time to stamp
 */
export async function recomputeAfterMachineValues(
  tx: Prisma.TransactionClient,
  args: {
    labReportId: string;
    tenantId: string;
    labTestId: string;
    adapterId: string;
    sentParamIds: ReadonlySet<string>;
    now: Date;
  },
): Promise<void> {
  const calculated = await tx.labTestResultParam.findMany({
    where: {
      labTestId: args.labTestId,
      deletedAt: null,
      OR: [
        { parameterType: 'CALCULATED' },
        { calculationFormula: { not: null } },
      ],
    },
    select: { id: true, calculationFormula: true, parameterType: true },
  });
  const calculatedIds = calculated
    .filter(
      (p) => p.parameterType === 'CALCULATED' || !!p.calculationFormula?.trim(),
    )
    .map((p) => p.id);
  // Nothing is calculated on this test: no further work, no further queries.
  if (calculatedIds.length === 0) return;

  const manual = await tx.labReportResultValue.findMany({
    where: {
      labReportId: args.labReportId,
      tenantId: args.tenantId,
      deletedAt: null,
      resultParamId: { in: calculatedIds },
      source: ResultValueSource.MANUAL,
    },
    select: { resultParamId: true },
  });
  const keep = new Set<string>(manual.map((v) => v.resultParamId));
  for (const id of calculatedIds) if (args.sentParamIds.has(id)) keep.add(id);

  await recomputeCalculatedValues(
    tx,
    args.labReportId,
    args.tenantId,
    args.labTestId,
    keep,
    args.adapterId,
    args.now,
  );
}
