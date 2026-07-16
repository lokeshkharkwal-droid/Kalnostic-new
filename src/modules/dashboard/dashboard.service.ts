import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DashboardSlice,
  MasterDataSummarySlice,
} from './dto/master-data-summary.dto';

/**
 * Aggregate read-models for the branch-admin dashboard. Every method here is a
 * `groupBy`/count rollup across a whole branch (not scoped to one master data
 * folder — `LabTest.masterDataId` is just an organisational grouping and is
 * unrelated to `LabTest.departmentId`), for the dashboard's donut/bar widgets.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Active lab tests, grouped by department. Departments are returned as they
   * actually exist for the tenant (no fixed label set) — a department with
   * zero active tests is omitted.
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted (business-admin, "All Branches") aggregates across the whole tenant
   */
  async getMasterDataSummary(
    tenantId: string,
    branchId?: string,
  ): Promise<MasterDataSummarySlice[]> {
    const grouped = await this.prisma.labTest.groupBy({
      by: ['departmentId'],
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        isActive: true,
        deletedAt: null,
        departmentId: { not: null },
      },
      _count: { _all: true },
    });
    if (grouped.length === 0) {
      return [];
    }

    const departmentIds = grouped
      .map((g) => g.departmentId)
      .filter((id): id is string => Boolean(id));
    const departments = await this.prisma.department.findMany({
      where: { id: { in: departmentIds }, tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(departments.map((d) => [d.id, d.name]));

    return grouped
      .filter((g) => nameById.has(g.departmentId!))
      .map((g) => ({
        label: nameById.get(g.departmentId!)!,
        value: g._count._all,
      }));
  }

  /**
   * Active vs. inactive referral doctors.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getReferralDoctorsSummary(
    tenantId: string,
    branchId?: string,
  ): Promise<DashboardSlice[]> {
    return this.countActiveInactive(this.prisma.referralDoctor, tenantId, branchId);
  }

  /**
   * Active vs. inactive external referrals.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getExternalReferralsSummary(
    tenantId: string,
    branchId?: string,
  ): Promise<DashboardSlice[]> {
    return this.countActiveInactive(this.prisma.externalReferral, tenantId, branchId);
  }

  /**
   * Active vs. inactive internal referrals.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getInternalReferralsSummary(
    tenantId: string,
    branchId?: string,
  ): Promise<DashboardSlice[]> {
    return this.countActiveInactive(this.prisma.internalReferral, tenantId, branchId);
  }

  /**
   * Shared Active/Inactive count for any model with a `status` field using
   * that two-value convention (`ReferralDoctor`, `ExternalReferral`,
   * `InternalReferral` all share the same ACTIVE/INACTIVE enum shape, just
   * under different Prisma-generated enum types). `branchId` omitted (or
   * "all") aggregates across the whole tenant — the business-admin case.
   */
  private async countActiveInactive(
    delegate: {
      count(args: {
        where: {
          tenantId: string;
          branchId?: string;
          status: 'ACTIVE' | 'INACTIVE';
          deletedAt: null;
        };
      }): Promise<number>;
    },
    tenantId: string,
    branchId?: string,
  ): Promise<DashboardSlice[]> {
    const scope = { tenantId, ...(branchId ? { branchId } : {}) };
    const [active, inactive] = await Promise.all([
      delegate.count({ where: { ...scope, status: 'ACTIVE', deletedAt: null } }),
      delegate.count({ where: { ...scope, status: 'INACTIVE', deletedAt: null } }),
    ]);
    return [
      { label: 'Active', value: active },
      { label: 'Inactive', value: inactive },
    ];
  }

  /**
   * Referral panels, grouped by client (payment) type.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getReferralPanelsSummary(
    tenantId: string,
    branchId?: string,
  ): Promise<DashboardSlice[]> {
    const grouped = await this.prisma.referralPanel.groupBy({
      by: ['clientType'],
      where: { tenantId, ...(branchId ? { branchId } : {}), isActive: true, deletedAt: null },
      _count: { _all: true },
    });
    const labelByType: Record<string, string> = {
      CASH: 'Cash',
      PREPAID: 'Prepaid',
      POSTPAID: 'Postpaid',
    };
    return grouped.map((g) => ({
      label: labelByType[g.clientType] ?? g.clientType,
      value: g._count._all,
    }));
  }
}
