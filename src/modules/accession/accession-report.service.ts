import { Injectable } from '@nestjs/common';
import { Prisma, SampleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult, paginated } from '../../common/dto/response.dto';
import { SAMPLE_LIST_INCLUDE } from './entities/accession-sample.entity';
import { REPORT_STATUSES } from './constants/report-statuses.constant';
import { AccessionReportQueryDto } from './dto/accession-report-query.dto';

/** A report row = an exception sample plus the reason recorded for that exception. */
export type AccessionReportRow = Prisma.AccessionSampleGetPayload<{
  include: typeof SAMPLE_LIST_INCLUDE;
}> & { reason: string | null };

/**
 * Accession Report (PDF Part F) — exception tracking across all order types.
 * Tenant-scoped + branch-level. Aggregates samples currently in an exception
 * status (Error/Halt/Hold/Repeat/Cancelled/Returned) into count cards (§F.2) and a
 * per-type data table (§F.3) with the reason recorded at the time of the exception.
 * Report *creation/dispatch* is the Finance/Reports module's job — this covers
 * exception tracking only.
 */
@Injectable()
export class AccessionReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Count of samples in each exception status (§F.2 count cards). All six report
   * statuses are present with a 0 default.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   */
  async counts(
    tenantId: string,
    branchId: string | null,
  ): Promise<Record<SampleStatus, number>> {
    const grouped = await this.prisma.accessionSample.groupBy({
      by: ['status'],
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        status: { in: [...REPORT_STATUSES] },
      },
      _count: { _all: true },
    });
    const counts = REPORT_STATUSES.reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<SampleStatus, number>,
    );
    for (const g of grouped) counts[g.status] = g._count._all;
    return counts;
  }

  /**
   * List the samples in one exception status (§F.3 data table), each with the
   * reason recorded on its most recent transition into that status.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param query the exception `type` + pagination
   */
  async list(
    tenantId: string,
    branchId: string | null,
    query: AccessionReportQueryDto,
  ): Promise<PaginatedResult<AccessionReportRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AccessionSampleWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      status: query.type,
    };
    if (query.search) {
      where.OR = [
        { accessionNo: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.order = {
        is: {
          orderDate: {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
          },
        },
      };
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.accessionSample.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          ...SAMPLE_LIST_INCLUDE,
          statusHistory: {
            where: { toStatus: query.type },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.accessionSample.count({ where }),
    ]);
    const rows: AccessionReportRow[] = data.map((row) => {
      const { statusHistory, ...rest } = row;
      return { ...rest, reason: statusHistory[0]?.reason ?? null };
    });
    return paginated(rows, total, page, limit);
  }
}
