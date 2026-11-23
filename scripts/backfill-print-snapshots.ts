/**
 * ONE-TIME backfill of the frozen print decision ("old reports must not change", manager
 * decisions F1-F4, 2026-11-22) for every report that is ALREADY printable (Result Done, Approved,
 * Published) when the freeze feature is deployed.
 *
 * Why: from this release a finished report prints from `LabReportResultValue.printSnapshot`, written
 * when it is validated. Reports finished earlier have none, and would otherwise print with TODAY's
 * Master Data (the new rules). This script gives each of their readings the snapshot that reproduces
 * how it prints on the CURRENT production code (the pre-v1.3 rules, `legacyPrintMark`), plus the
 * parameter's present name, group, order, result type and configured note.
 *
 * WHEN: in the deploy window, right after the migrations and BEFORE the clean-up migration that drops
 * the old per-range style column and `highlight_in_report` (the old rules need both), and before
 * users get back in (a report validated meanwhile is frozen by the app itself and is skipped here,
 * because only readings WITHOUT a snapshot are touched).
 *
 * SAFE TO RE-RUN: only readings with no snapshot are considered, so a second run finds nothing and a
 * run that was interrupted resumes where it stopped. Per tenant (RLS-scoped via `runWithTenant`), in
 * pages of PAGE readings. `updatedAt` is written back unchanged.
 *
 * DRY RUN is the default and writes nothing: it prints what it WOULD freeze, how many readings would
 * print differently under the new rules (that is what the backfill protects), and the rows whose old
 * decision cannot be reconstructed with certainty (a pinned range that no longer exists, a
 * Quantitative value with no stored range, ...). Read it before applying.
 *
 * Run:
 *   pnpm backfill:print-snapshots                       (dry run, every tenant)
 *   pnpm backfill:print-snapshots -- --apply            (write)
 *   pnpm backfill:print-snapshots -- --tenant <id>      (one tenant)
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { LabReportStatus, Prisma, ResultType } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { legacyPrintMark } from '../src/modules/lab-report/utils/legacy-print-decision.util';
import {
  PRINT_SNAPSHOT_VERSION,
  ResultPrintSnapshot,
} from '../src/modules/lab-report/utils/print-snapshot.util';
import { resolvePrintStyle } from '../src/modules/lab-report/utils/reference-range.util';
import { PRINTABLE_REPORT_STATUSES } from '../src/modules/lab-report/utils/print-visibility.util';

const logger = new Logger('PrintSnapshotBackfill');
const PAGE = 200;
const SAMPLE_LIMIT = 20;

interface Stats {
  readings: number;
  frozen: number;
  styledByRange: number;
  styledByManualHighlight: number;
  normal: number;
  skippedNoParameter: number;
  differsFromNewRules: number;
  ambiguous: number;
  /** Readings the live app changed between our read and our write: left to the app, not overwritten. */
  raced: number;
}
const emptyStats = (): Stats => ({
  readings: 0,
  frozen: 0,
  styledByRange: 0,
  styledByManualHighlight: 0,
  normal: 0,
  skippedNoParameter: 0,
  differsFromNewRules: 0,
  ambiguous: 0,
  raced: 0,
});

function parseArgs(argv: string[]): { apply: boolean; tenant: string | null } {
  const apply = argv.includes('--apply');
  const i = argv.indexOf('--tenant');
  const tenant = i >= 0 ? (argv[i + 1] ?? null) : null;
  if (i >= 0 && !tenant) throw new Error('--tenant needs a tenant id');
  return { apply, tenant };
}

async function backfillTenant(
  prisma: PrismaService,
  tenantId: string,
  apply: boolean,
  samples: { differs: string[]; ambiguous: string[] },
): Promise<Stats> {
  const stats = emptyStats();
  let lastId: string | null = null;
  for (;;) {
    const page = await prisma.runWithTenant(tenantId, async () => {
      const values = await prisma.labReportResultValue.findMany({
        where: {
          tenantId,
          deletedAt: null,
          printSnapshot: { equals: Prisma.DbNull },
          labReport: {
            tenantId,
            deletedAt: null,
            status: { in: [...PRINTABLE_REPORT_STATUSES] as LabReportStatus[] },
          },
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: PAGE,
        select: {
          id: true,
          resultParamId: true,
          observed1: true,
          observed2: true,
          referenceRangeId: true,
          flagOption: true,
          highlightLogic: true,
          highlightInReport: true,
          updatedAt: true,
          labReport: { select: { id: true } },
        },
      });
      if (values.length === 0) return { values, done: true };

      const params = await prisma.labTestResultParam.findMany({
        where: { id: { in: [...new Set(values.map((v) => v.resultParamId))] } },
        select: {
          id: true,
          parameterName: true,
          groupName: true,
          sortOrder: true,
          resultType: true,
          abnormalFlagLogic: true,
          notes: true,
        },
      });
      const paramById = new Map(params.map((p) => [p.id, p]));
      const rangeIds = [
        ...new Set(
          values.map((v) => v.referenceRangeId).filter((r): r is string => !!r),
        ),
      ];
      const ranges = rangeIds.length
        ? await prisma.labTestReferenceRange.findMany({
            where: { id: { in: rangeIds } },
            select: {
              id: true,
              lowerLimit: true,
              upperLimit: true,
              abnormalFlagLogic: true,
            },
          })
        : [];
      const rangeById = new Map(ranges.map((r) => [r.id, r]));

      for (const v of values) {
        stats.readings++;
        const param = paramById.get(v.resultParamId);
        if (!param) {
          stats.skippedNoParameter++;
          continue;
        }
        const range = v.referenceRangeId
          ? rangeById.get(v.referenceRangeId)
          : undefined;
        const where = `report ${v.labReport.id} value ${v.id} (${param.parameterName})`;

        // Rows whose old decision cannot be known for certain: reported, never guessed silently.
        const flags: string[] = [];
        if (v.referenceRangeId && !range)
          flags.push('pinned range row is gone');
        if (param.resultType !== ResultType.QUANTITATIVE && v.referenceRangeId)
          flags.push('non-quantitative reading carries a range id');
        if (
          param.resultType === ResultType.QUANTITATIVE &&
          !v.referenceRangeId &&
          (v.observed1 ?? '').trim() !== ''
        )
          flags.push('quantitative reading with no stored range');
        if (flags.length) {
          stats.ambiguous++;
          if (samples.ambiguous.length < SAMPLE_LIMIT)
            samples.ambiguous.push(`${where}: ${flags.join('; ')}`);
        }

        const mark = (observed: string | null) =>
          legacyPrintMark({
            resultType: param.resultType,
            observed,
            range,
            rangeStyle: range ? range.abnormalFlagLogic : null,
            highlightTick: v.highlightInReport,
            highlightStyle: v.highlightLogic,
          });
        const o1 = mark(v.observed1);
        const o2 = mark(v.observed2);
        const snapshot: ResultPrintSnapshot = {
          v: PRINT_SNAPSHOT_VERSION,
          o1,
          o2,
          name: param.parameterName,
          group: param.groupName ?? '',
          order: param.sortOrder,
          type: param.resultType,
          note: param.notes,
        };
        if (o1.abnormal || o2.abnormal) stats.styledByRange++;
        else if (o1.style || o2.style) stats.styledByManualHighlight++;
        else stats.normal++;

        // Would the NEW rules (today's Master Data) print this reading differently? This is exactly what
        // the freeze protects, so it is worth counting and showing.
        const live = (observed: string | null) =>
          resolvePrintStyle({
            resultType: param.resultType,
            paramStyle: param.abnormalFlagLogic,
            flagOption: v.flagOption,
            selectedStyle: v.highlightLogic,
            observed,
            range,
          });
        if (
          JSON.stringify([o1, o2]) !==
          JSON.stringify([live(v.observed1), live(v.observed2)])
        ) {
          stats.differsFromNewRules++;
          if (samples.differs.length < SAMPLE_LIMIT)
            samples.differs.push(
              `${where}: old ${JSON.stringify(o1)} / new ${JSON.stringify(live(v.observed1))}`,
            );
        }

        if (apply) {
          // Conditional write: only a reading that STILL has no snapshot and whose report is STILL printable.
          // Between the page read and this write the live app may have reopened, edited and re-validated the
          // report (it then froze the reading with TODAY's rules); an unconditional update would overwrite that
          // with the old rules and old parameter names.
          const res = await prisma.labReportResultValue.updateMany({
            where: {
              id: v.id,
              deletedAt: null,
              printSnapshot: { equals: Prisma.DbNull },
              labReport: {
                status: {
                  in: [...PRINTABLE_REPORT_STATUSES] as LabReportStatus[],
                },
              },
            },
            data: {
              printSnapshot: snapshot as unknown as Prisma.InputJsonValue,
              updatedAt: v.updatedAt,
            },
          });
          if (res.count === 1) stats.frozen++;
          else stats.raced++;
        }
      }
      return { values, done: values.length < PAGE };
    });
    if (page.values.length === 0) break;
    lastId = page.values[page.values.length - 1]!.id;
    if (page.done) break;
  }
  return stats;
}

async function main(): Promise<void> {
  const { apply, tenant } = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  try {
    // Refuse to run where every query would silently see ZERO rows: a database role that row-level security
    // applies to (not a superuser, no BYPASSRLS) is only given a tenant by the app when RLS_ENABLED=true. Without
    // it the script would "succeed" with 0 readings and the finished reports would stay unfrozen.
    const [role] = await prisma.$queryRaw<
      { name: string; privileged: boolean }[]
    >`SELECT current_user::text AS name, (r.rolsuper OR r.rolbypassrls) AS privileged FROM pg_roles r WHERE r.rolname = current_user`;
    const rlsOn = process.env.RLS_ENABLED === 'true';
    if (role && !role.privileged && !rlsOn) {
      throw new Error(
        `Database role "${role.name}" is subject to row-level security but RLS_ENABLED is not "true": every query would return 0 rows. Set RLS_ENABLED=true (as the app does) and run again.`,
      );
    }
    logger.log(
      `database role "${role?.name}" (${role?.privileged ? 'bypasses RLS' : 'subject to RLS'}), RLS_ENABLED=${rlsOn}`,
    );
    const tenants = tenant
      ? [{ id: tenant }]
      : await prisma.tenant.findMany({ select: { id: true } });
    logger.log(
      `${apply ? 'APPLYING' : 'DRY RUN (nothing is written)'} - ${tenants.length} tenant(s)`,
    );
    const total = emptyStats();
    const samples = { differs: [] as string[], ambiguous: [] as string[] };
    for (const { id } of tenants) {
      const s = await backfillTenant(prisma, id, apply, samples);
      logger.log(`tenant ${id}: ${JSON.stringify(s)}`);
      (Object.keys(total) as (keyof Stats)[]).forEach(
        (k) => (total[k] += s[k]),
      );
    }
    logger.log(`TOTAL: ${JSON.stringify(total)}`);
    if (samples.differs.length)
      logger.log(
        `Would print DIFFERENTLY under the new rules (first ${samples.differs.length}):\n  ${samples.differs.join('\n  ')}`,
      );
    if (samples.ambiguous.length)
      logger.warn(
        `Old decision not certain (first ${samples.ambiguous.length}):\n  ${samples.ambiguous.join('\n  ')}`,
      );
    if (!apply)
      logger.log('Dry run only. Re-run with --apply to write the snapshots.');
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
