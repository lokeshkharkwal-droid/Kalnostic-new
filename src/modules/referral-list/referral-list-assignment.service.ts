import { Injectable } from '@nestjs/common';
import { ReferralListAssignment, ReferralType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PtCategoryService } from '../pt-category/pt-category.service';
import { ResolveListsQueryDto } from './dto/resolve-lists-query.dto';
import {
  ReferralListSelection,
  ResolvedLists,
} from './entities/referral-list.entity';

/** The branch's default (Walk-in) pricing list ids. */
type DefaultListIds = { testListId: string | null; panelListId: string | null };

/**
 * Referral (type, id) steps checked AFTER the B2B panel and PT category, in
 * priority order: referred-by doctor → internal → external.
 */
const RESOLVE_ORDER: Array<{
  type: ReferralType;
  key: keyof ResolveListsQueryDto;
}> = [
  { type: 'DOCTOR', key: 'referredByDoctorId' },
  { type: 'INTERNAL', key: 'internalReferralId' },
  { type: 'EXTERNAL', key: 'externalReferralId' },
];

/**
 * Per-branch referral → pricing-list mapping. A referral registry is shared across
 * the tenant, but each branch chooses which Lab Test / Lab Panel List applies to
 * that referral. `upsert` is called by the four referral services on create/update;
 * `resolve` is used by the Create-Order form (via the resolve endpoint) and by
 * `OrderService`. Tenant-scoped + branch-level (CLAUDE.md §4.7). Shared service —
 * injected via DI, never imported directly (rule #3).
 */
@Injectable()
export class ReferralListAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ptCategoryService: PtCategoryService,
  ) {}

  /**
   * Create or update the active branch's list assignment for a referral. Passing
   * both list ids as null/undefined clears the assignment (soft-deletes it) so the
   * referral falls back to the default Walk-in lists.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param referralType which referral kind
   * @param referralId the referral row id
   * @param selection the chosen list ids (either may be null)
   */
  async upsert(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    referralType: ReferralType,
    referralId: string,
    selection: ReferralListSelection,
  ): Promise<void> {
    const testListId = selection.branchLabTestListId ?? null;
    const panelListId = selection.branchLabPanelListId ?? null;
    const existing = await this.prisma.referralListAssignment.findFirst({
      where: { tenantId, branchId, referralType, referralId },
    });

    if (existing) {
      await this.prisma.referralListAssignment.update({
        where: { id: existing.id },
        data: {
          branchLabTestListId: testListId,
          branchLabPanelListId: panelListId,
          deletedAt:
            testListId === null && panelListId === null ? new Date() : null,
          updatedBy: actorId,
        },
      });
      return;
    }
    if (testListId === null && panelListId === null) {
      return;
    }
    await this.prisma.referralListAssignment.create({
      data: {
        tenantId,
        branchId,
        referralType,
        referralId,
        branchLabTestListId: testListId,
        branchLabPanelListId: panelListId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /**
   * Fetch the active branch's assignment for a single referral (or null).
   * Used by the referral services to prefill a form on `GET /:id`.
   */
  async getAssignment(
    tenantId: string,
    branchId: string,
    referralType: ReferralType,
    referralId: string,
  ): Promise<ReferralListAssignment | null> {
    return this.prisma.referralListAssignment.findFirst({
      where: { tenantId, branchId, referralType, referralId, deletedAt: null },
    });
  }

  /**
   * Resolve the pricing lists for an order. Walks the priority chain — B2B panel
   * → PT category → referred-by doctor → internal → external — and the first
   * applicable configuration wins. The PT category (slot 2) resolves to its
   * mapped Lab Test / Lab Panel's own pricing lists; the referral steps use the
   * branch's `ReferralListAssignment`. Each unset list on the winning result
   * falls back to the branch's default Walk-in list, as does the whole result
   * when nothing matches.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param query the selected referral / PT category ids
   */
  async resolve(
    tenantId: string,
    branchId: string,
    query: ResolveListsQueryDto,
  ): Promise<ResolvedLists> {
    const defaults = await this.getDefaultListIds(tenantId, branchId);

    // 1. Referral Panel (B2B) — highest priority.
    const panel = await this.resolveReferralAssignment(
      tenantId,
      branchId,
      'PANEL',
      query.referralPanelId,
      defaults,
    );
    if (panel) {
      return panel;
    }

    // 2. PT (Patient) Category — its mapped items' pricing lists.
    if (query.ptCategoryId) {
      const listIds = await this.ptCategoryService.getResolvedListIds(
        tenantId,
        branchId,
        query.ptCategoryId,
      );
      if (
        listIds &&
        (listIds.branchLabTestListId || listIds.branchLabPanelListId)
      ) {
        return {
          branchLabTestListId:
            listIds.branchLabTestListId ?? defaults.testListId,
          branchLabPanelListId:
            listIds.branchLabPanelListId ?? defaults.panelListId,
          source: 'PT_CATEGORY',
        };
      }
    }

    // 3-5. Referred-by doctor → internal → external.
    for (const { type, key } of RESOLVE_ORDER) {
      const resolved = await this.resolveReferralAssignment(
        tenantId,
        branchId,
        type,
        query[key],
        defaults,
      );
      if (resolved) {
        return resolved;
      }
    }

    return {
      branchLabTestListId: defaults.testListId,
      branchLabPanelListId: defaults.panelListId,
      source: 'DEFAULT',
    };
  }

  /**
   * Resolve a single referral's list assignment to a `ResolvedLists`, or null
   * when there's no referral id or no active assignment with a list. Each unset
   * list falls back to the branch default.
   */
  private async resolveReferralAssignment(
    tenantId: string,
    branchId: string,
    type: ReferralType,
    referralId: string | undefined,
    defaults: DefaultListIds,
  ): Promise<ResolvedLists | null> {
    if (!referralId) {
      return null;
    }
    const assignment = await this.getAssignment(
      tenantId,
      branchId,
      type,
      referralId,
    );
    if (
      assignment &&
      (assignment.branchLabTestListId || assignment.branchLabPanelListId)
    ) {
      return {
        branchLabTestListId:
          assignment.branchLabTestListId ?? defaults.testListId,
        branchLabPanelListId:
          assignment.branchLabPanelListId ?? defaults.panelListId,
        source: type,
      };
    }
    return null;
  }

  /** Read the branch's default (Walk-in) list ids (null if not imported yet). */
  private async getDefaultListIds(
    tenantId: string,
    branchId: string,
  ): Promise<DefaultListIds> {
    const [testList, panelList] = await Promise.all([
      this.prisma.branchLabTestList.findFirst({
        where: { tenantId, branchId, isDefault: true, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.branchLabPanelList.findFirst({
        where: { tenantId, branchId, isDefault: true, deletedAt: null },
        select: { id: true },
      }),
    ]);
    return {
      testListId: testList?.id ?? null,
      panelListId: panelList?.id ?? null,
    };
  }
}
