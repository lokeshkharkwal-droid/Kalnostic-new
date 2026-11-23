import { Injectable } from '@nestjs/common';
import {
  LabReportStatus,
  Prisma,
  SampleStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { OrderSampleService } from './accession-sample.service';
import {
  FLAG_ACTIONS,
  IN_HOUSE_ACTION_KEY,
  IN_HOUSE_SEARCH_ACTIONS,
  REFERRAL_ACTION_KEY,
  REFERRAL_SEARCH_ACTIONS,
  type SearchMenu,
} from './constants/sample-search-actions.constant';
import {
  TRANSFERRED_STATUSES,
  nextSampleStatus,
  type SampleAction,
} from './constants/sample-transitions.constant';
import {
  nextTransferStatus,
  previousTransferStatus,
  type TransferAction,
} from './constants/transfer-transitions.constant';
import { SearchSampleQueryDto } from './dto/search-sample.dto';
import type {
  SampleSearchResult,
  SearchDateTime,
  SearchFields,
  SearchRouting,
  SearchSampleRow,
  SearchSection,
} from './entities/sample-search.entity';
import { barcodeEquals } from './utils/barcode-match.util';
import { findItemRemovedSampleIds } from './utils/item-removed.util';
import { HIDDEN_FROM_RECEIVER_WHERE } from './utils/receiver-visibility.util';

/** What the lookup reads of a sample (one row = one test). */
const SAMPLE_SELECT = {
  id: true,
  status: true,
  branchId: true,
  originBranchId: true,
  processingBranchId: true,
  orderId: true,
  departmentId: true,
  sampleType: true,
  containerType: true,
  barcode: true,
  barcodeBeforeRepeat: true,
  isRecoverable: true,
  returnedVerifiedAt: true,
  sourceTransferId: true,
  createdAt: true,
  order: {
    select: {
      id: true,
      orderCode: true,
      externalOrderId: true,
      status: true,
      branchId: true,
    },
  },
  tests: {
    where: { deletedAt: null },
    select: {
      orderItemId: true,
      labTestId: true,
      testName: true,
      orderItem: {
        select: {
          deletedAt: true,
          branchLabTestId: true,
          branchLabTest: {
            select: {
              departmentId: true,
              categoryId: true,
              subCategoryId: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderSampleSelect;

type SampleRow = Prisma.OrderSampleGetPayload<{ select: typeof SAMPLE_SELECT }>;

/** What the lookup reads of a transfer. */
const TRANSFER_SELECT = {
  id: true,
  kind: true,
  transferStatus: true,
  sampleId: true,
  originBranchId: true,
  destinationBranchId: true,
  outsourceCenterId: true,
  externalPartnerName: true,
  sendDate: true,
  sendTime: true,
  createdAt: true,
} satisfies Prisma.SampleTransferSelect;

type TransferRow = Prisma.SampleTransferGetPayload<{
  select: typeof TRANSFER_SELECT;
}>;

/** The hand-off an In-House sample in each out-of-branch status is on (decides what the details column shows). */
const IN_HOUSE_ROUTING: Partial<
  Record<
    SampleStatus,
    { transfer: TransferKind; routing: 'SEND' | 'FORWARD' | 'OUTSOURCE' }
  >
> = {
  [SampleStatus.SENT_INTERNAL]: {
    transfer: TransferKind.INTERNAL,
    routing: 'SEND',
  },
  [SampleStatus.FORWARD_EXTERNAL]: {
    transfer: TransferKind.EXTERNAL,
    routing: 'FORWARD',
  },
  [SampleStatus.OUTSOURCED]: {
    transfer: TransferKind.OUTSOURCE,
    routing: 'OUTSOURCE',
  },
};

/** One row of the popup before it is grouped into sections. */
interface Entry {
  sample: SampleRow;
  transfer: TransferRow | null;
  status: SampleStatus | TransferStatus;
}

/**
 * Sample Search (requirements of 2026-11-06): the user types or scans a barcode in In-House Orders,
 * Internal Referral Orders or External Referral Orders and gets the sample's details with the actions
 * its current status allows.
 *
 * Each menu looks where its own list looks: In-House the samples this branch holds (with the user's
 * department scope), Internal Referral the transfers coming TO this branch, External Referral the
 * transfers going FROM this branch. The page filters and status tabs are ignored. A barcode can cover
 * several rows (one row = one test) in different statuses, so the result is split into one section
 * per status. A barcode with nothing in the menu says which other menus have it.
 *
 * The order itself (patient, referral, billing, notes) is loaded by the screen with `GET /orders/:id`;
 * this lookup supplies the branch rows, dates, tests, reports, the flags and the buttons.
 */
@Injectable()
export class SampleSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly samples: OrderSampleService,
    private readonly userDepartmentScope: UserDepartmentScopeService,
  ) {}

  /**
   * Find a barcode in a menu.
   * @param tenantId tenant scope (from the JWT)
   * @param branchId the caller's active branch
   * @param personId the caller, for the department scope
   * @param dto the barcode and the menu
   * @returns the sections found, or `found: false` with the other menus that have the barcode
   */
  async search(
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    dto: SearchSampleQueryDto,
  ): Promise<SampleSearchResult> {
    const scopeIds = personId
      ? await this.userDepartmentScope.resolveDepartmentIds(tenantId, personId)
      : [];
    return this.prisma.withTenant(tenantId, async (tx) => {
      const ctx = { tx, tenantId, branchId, scopeIds, code: dto.barcode };
      const entries =
        dto.menu === 'IN_HOUSE'
          ? await this.inHouseEntries(ctx)
          : await this.referralEntries(ctx, dto.menu);
      if (entries.length === 0) {
        return {
          found: false as const,
          menu: dto.menu,
          barcode: dto.barcode,
          foundIn: await this.otherMenusWith(ctx, dto.menu),
          replacedBy: await this.replacedBy(ctx),
        };
      }
      return this.build(ctx, dto, entries);
    });
  }

  // ── Where each menu looks ─────────────────────────────────────────────────

  /** The branch and department-scope part shared by every lookup of the samples this branch holds. */
  private heldWhere(ctx: Ctx): Prisma.OrderSampleWhereInput {
    return {
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      deletedAt: null,
      ...(ctx.scopeIds.length > 0
        ? {
            OR: [
              { departmentId: null },
              { departmentId: { in: ctx.scopeIds } },
            ],
          }
        : {}),
    };
  }

  /**
   * In-House: the samples this branch holds with the barcode (department scope applied), plus the samples that
   * WAIT for a new tube because a Repeat took this barcode off them (`barcodeBeforeRepeat`, only while they have no
   * barcode). A tube can still carry the barcode for some tests while one test was repeated, so both appear.
   * A sample that already has a barcode is never found by the barcode it lost, and the samples that carry the
   * barcode decide the order: waiting samples of another order never replace them.
   */
  private async inHouseEntries(ctx: Ctx): Promise<Entry[]> {
    const held = this.heldWhere(ctx);
    const live = await ctx.tx.orderSample.findMany({
      where: { ...held, barcode: barcodeEquals(ctx.code) },
      select: SAMPLE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    // A barcode belongs to one order's group: if rows of several orders ever carry it, the newest wins.
    const liveOrderId = live[0]?.orderId;
    const waiting = await ctx.tx.orderSample.findMany({
      where: {
        ...held,
        barcode: null,
        barcodeBeforeRepeat: barcodeEquals(ctx.code),
        ...(liveOrderId ? { orderId: liveOrderId } : {}),
      },
      select: SAMPLE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    const orderId = liveOrderId ?? waiting[0]?.orderId;
    const own = [...live, ...waiting].filter((r) => r.orderId === orderId);
    if (own.length === 0) return [];
    const transfers = await ctx.tx.sampleTransfer.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        sampleId: { in: own.map((s) => s.id) },
      },
      select: TRANSFER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return own.map((sample) => ({
      sample,
      transfer: transfers.find((t) => t.sampleId === sample.id) ?? null,
      status: sample.status,
    }));
  }

  /**
   * Internal Referral: transfers coming to this branch. External Referral: transfers going out of it.
   * Only the latest live transfer of each sample counts.
   */
  private async referralEntries(
    ctx: Ctx,
    menu: 'INTERNAL' | 'EXTERNAL',
  ): Promise<Entry[]> {
    const transfers = await ctx.tx.sampleTransfer.findMany({
      where: this.referralWhere(ctx, menu),
      select: { ...TRANSFER_SELECT, sample: { select: SAMPLE_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
    // A sample that carries the barcode decides the order (as in-house); one that lost it to a Repeat comes after.
    const orderId = (transfers.find((t) => !!t.sample.barcode) ?? transfers[0])
      ?.sample.orderId;
    const latestPerSample = new Map<string, (typeof transfers)[number]>();
    for (const t of transfers) {
      if (t.sample.orderId !== orderId) continue;
      if (!latestPerSample.has(t.sampleId)) latestPerSample.set(t.sampleId, t);
    }
    return [...latestPerSample.values()]
      .sort((a, b) => Number(!!b.sample.barcode) - Number(!!a.sample.barcode))
      .map(({ sample, ...transfer }) => ({
        sample,
        transfer,
        status: transfer.transferStatus,
      }));
  }

  /** The `where` of the transfers a referral menu lists for a barcode. */
  private referralWhere(
    ctx: Ctx,
    menu: 'INTERNAL' | 'EXTERNAL' | 'OUTSOURCE',
  ): Prisma.SampleTransferWhereInput {
    return {
      tenantId: ctx.tenantId,
      deletedAt: null,
      kind: menu,
      // Internal Referral lists what comes TO this branch (and hides an In-Transit transfer whose logistics
      // are not chosen yet); External Referral and Outsource list what goes OUT of it.
      ...(menu === 'INTERNAL'
        ? {
            destinationBranchId: ctx.branchId,
            NOT: HIDDEN_FROM_RECEIVER_WHERE,
          }
        : { originBranchId: ctx.branchId }),
      // The sample carries the barcode, or it waits for a new tube because a Repeat took this barcode off it.
      sample: {
        is: {
          deletedAt: null,
          OR: [
            { barcode: barcodeEquals(ctx.code) },
            { barcode: null, barcodeBeforeRepeat: barcodeEquals(ctx.code) },
          ],
        },
      },
    };
  }

  /**
   * A barcode a Repeat took off a sample that has a NEW barcode now: the answer is only the new number ("replaced by"),
   * never the sample, so an old tube can never open the new tube's actions. Same branch and department scope as the
   * search itself.
   */
  private async replacedBy(ctx: Ctx): Promise<string | null> {
    const row = await ctx.tx.orderSample.findFirst({
      where: {
        ...this.heldWhere(ctx),
        barcode: { not: null },
        barcodeBeforeRepeat: barcodeEquals(ctx.code),
      },
      select: { barcode: true },
      orderBy: { createdAt: 'desc' },
    });
    const now = row?.barcode ?? null;
    return now && now.toLowerCase() !== ctx.code.toLowerCase() ? now : null;
  }

  /** The other menus that do have the barcode (for the "not found here" hint). */
  private async otherMenusWith(
    ctx: Ctx,
    menu: SearchMenu,
  ): Promise<Array<SearchMenu | 'OUTSOURCE'>> {
    const found: Array<SearchMenu | 'OUTSOURCE'> = [];
    if (menu !== 'IN_HOUSE' && (await this.inHouseEntries(ctx)).length > 0) {
      found.push('IN_HOUSE');
    }
    for (const other of ['INTERNAL', 'EXTERNAL', 'OUTSOURCE'] as const) {
      if (other === menu) continue;
      const count = await ctx.tx.sampleTransfer.count({
        where: this.referralWhere(ctx, other),
      });
      if (count > 0) found.push(other);
    }
    return found;
  }

  // ── Building the answer ───────────────────────────────────────────────────

  /** Group the entries into sections and add the names, reports, flags and buttons. */
  private async build(
    ctx: Ctx,
    dto: SearchSampleQueryDto,
    entries: Entry[],
  ): Promise<SampleSearchResult> {
    const first = entries[0]!;
    const order = first.sample.order;
    const orderCancelled = order.status === 'CANCELLED';

    const names = await this.lookupNames(ctx, entries);
    const reports = await this.lookupReports(ctx, entries);
    const removed = await findItemRemovedSampleIds(
      ctx.tx,
      ctx.tenantId,
      entries.map((e) => e.sample.id),
    );

    // Sections: the entries in the same status, in the order of their first appearance. A sample whose test
    // was removed from the order is frozen (only Store stays open), so it gets its own section: the other
    // rows of the barcode keep their buttons.
    // A sample that waits for a new tube (a Repeat took its barcode off) never shares a section with the samples that
    // still carry the barcode: it has its own status, buttons and note.
    const waitingForTube = (e: Entry) =>
      !e.sample.barcode && !!e.sample.barcodeBeforeRepeat;
    const byStatus = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = `${e.status}::${removed.has(e.sample.id) ? 'removed' : 'live'}::${waitingForTube(e) ? 'waiting' : 'held'}`;
      const list = byStatus.get(key) ?? [];
      list.push(e);
      byStatus.set(key, list);
    }

    const sections: SearchSection[] = [];
    for (const [, group] of byStatus) {
      const rows = group.flatMap((e) =>
        this.rowsOf(e, names, reports, removed.has(e.sample.id), dto.menu),
      );
      const { actions, hiddenActionReasons } =
        dto.menu === 'IN_HOUSE'
          ? await this.inHouseActions(
              ctx,
              group,
              removed,
              orderCancelled,
              new Set(entries.map((e) => e.sample.id)),
            )
          : this.referralActions(group, removed, orderCancelled);
      const distinct = (values: Array<string | null>) =>
        [...new Set(values.filter((v): v is string => !!v))].join(', ') || null;
      const status = group[0]!.status;
      sections.push({
        kind: dto.menu === 'IN_HOUSE' ? 'SAMPLE' : 'TRANSFER',
        status,
        sampleType: distinct(group.map((e) => e.sample.sampleType)),
        container: distinct(group.map((e) => e.sample.containerType)),
        sampleIds: group.map((e) => e.sample.id),
        transferIds: group.flatMap((e) => (e.transfer ? [e.transfer.id] : [])),
        rows,
        actions,
        hiddenActionReasons,
        flags: {
          recoverable:
            status === SampleStatus.DISCARDED
              ? group.every((e) => e.sample.isRecoverable === true)
              : null,
          returnedVerified:
            status === SampleStatus.RETURNED
              ? group.every((e) => !!e.sample.returnedVerifiedAt)
              : null,
          mixed:
            (status === SampleStatus.DISCARDED &&
              new Set(group.map((e) => e.sample.isRecoverable === true)).size >
                1) ||
            (status === SampleStatus.RETURNED &&
              new Set(group.map((e) => !!e.sample.returnedVerifiedAt)).size >
                1),
        },
        orderCancelled,
        itemRemoved: removed.has(group[0]!.sample.id),
        barcodeTakenOff: waitingForTube(group[0]!)
          ? group[0]!.sample.barcodeBeforeRepeat
          : null,
      });
    }

    return {
      found: true,
      menu: dto.menu,
      barcode: first.sample.barcode ?? dto.barcode,
      order: {
        id: order.id,
        orderCode: order.orderCode,
        externalOrderId: order.externalOrderId,
        branchId: order.branchId,
        // Billing belongs to the branch that registered the order.
        billingVisible: !!ctx.branchId && order.branchId === ctx.branchId,
      },
      fields: this.fieldsOf(dto.menu, entries, names),
      sections,
    };
  }

  /** The test lines of one entry (a sample row normally holds one test). */
  private rowsOf(
    e: Entry,
    names: Names,
    reports: Map<string, LabReportStatus>,
    itemRemoved: boolean,
    menu: SearchMenu,
  ): SearchSampleRow[] {
    const routing = this.routingOf(menu, e, names);
    return e.sample.tests.map((t) => {
      const classification = names.classificationOf(e.sample, t);
      const link = `${t.orderItemId}::${t.labTestId ?? ''}`;
      return {
        sampleId: e.sample.id,
        transferId: e.transfer?.id ?? null,
        testName: t.testName ?? '-',
        department: names.department(
          e.sample.departmentId ?? classification.departmentId,
        ),
        category: names.category(classification.categoryId),
        subcategory: names.subCategory(classification.subCategoryId),
        reportStatus:
          reports.get(link) ?? reports.get(`${t.orderItemId}::`) ?? null,
        itemRemoved,
        routing,
        recoverable:
          e.status === SampleStatus.DISCARDED
            ? e.sample.isRecoverable === true
            : null,
        returnedVerified:
          e.status === SampleStatus.RETURNED
            ? !!e.sample.returnedVerifiedAt
            : null,
      };
    });
  }

  /**
   * Where the test of this entry is RIGHT NOW (the "Send / Forward / Outsource Details" column).
   * In-House follows the sample's current status, as the In-House list does: Sent, Forwarded or Outsourced show their
   * hand-off, every other status is "In-House" - even if an older, finished hand-off of the sample still exists (a Retrieve
   * or a Repeat brought it back), so an old destination is never shown. The referral menus describe the transfer of the row
   * itself (every row there is one).
   */
  private routingOf(menu: SearchMenu, e: Entry, names: Names): SearchRouting {
    const none: SearchDateTime = { date: null, time: null };
    const t = e.transfer;
    const when: SearchDateTime = t
      ? {
          date: t.sendDate ? t.sendDate.toISOString() : null,
          time: t.sendTime ?? null,
        }
      : none;
    if (menu === 'IN_HOUSE') {
      const out = IN_HOUSE_ROUTING[e.sample.status];
      if (!out) return { kind: 'IN_HOUSE', to: null, when: none };
      // Only a hand-off of the matching kind describes the status; anything else leaves the details empty, not wrong.
      const own = t && t.kind === out.transfer ? t : null;
      return {
        kind: out.routing,
        to: own ? this.destinationOf(own, names) : null,
        when: own ? when : none,
      };
    }
    return {
      kind: menu === 'INTERNAL' ? 'INTERNAL_REFERRAL' : 'EXTERNAL_REFERRAL',
      to: t ? this.destinationOf(t, names) : null,
      when,
    };
  }

  /** The name of where a transfer goes: its branch, partner business or outsource center. */
  private destinationOf(t: TransferRow, names: Names): string | null {
    if (t.kind === TransferKind.INTERNAL)
      return names.branch(t.destinationBranchId);
    if (t.kind === TransferKind.EXTERNAL) return t.externalPartnerName ?? null;
    return names.outsourceCenter(t.outsourceCenterId);
  }

  /** The branch / center / date fields of the popup, by menu. */
  private fieldsOf(
    menu: SearchMenu,
    entries: Entry[],
    names: Names,
  ): SearchFields {
    const first = entries[0]!;
    const none: SearchDateTime = { date: null, time: null };
    const at = (t: TransferRow | null): SearchDateTime =>
      t
        ? {
            date: t.sendDate ? t.sendDate.toISOString() : null,
            time: t.sendTime ?? null,
          }
        : none;
    // A barcode can have rows with and without a transfer (some sent out, the rest here): the transfer
    // details come from the row that has one.
    const t = (entries.find((e) => e.transfer) ?? first).transfer;
    if (menu === 'IN_HOUSE') {
      // In-House shows "RM Branch" only (requirements of 2026-11-06): the manager's answer is that RM Branch is the
      // ORIGIN branch - the branch the sample came from (its own branch for an own sample, the sending branch for a copy
      // received from another branch). Processing Branch is hidden here.
      return {
        processingBranch: null,
        originBranch: names.branch(
          first.sample.originBranchId ?? first.sample.branchId,
        ),
        outsourceCenter:
          t?.kind === TransferKind.OUTSOURCE
            ? names.outsourceCenter(t.outsourceCenterId)
            : null,
        externalPartner: null,
        sent: t?.kind === TransferKind.INTERNAL ? at(t) : none,
        forwarded: t?.kind === TransferKind.EXTERNAL ? at(t) : none,
        outsourced: t?.kind === TransferKind.OUTSOURCE ? at(t) : none,
      };
    }
    return {
      processingBranch:
        menu === 'INTERNAL'
          ? names.branch(t?.destinationBranchId ?? null)
          : null,
      originBranch: names.branch(t?.originBranchId ?? first.sample.branchId),
      outsourceCenter: null,
      externalPartner:
        menu === 'EXTERNAL' ? (t?.externalPartnerName ?? null) : null,
      sent: menu === 'INTERNAL' ? at(t) : none,
      forwarded: menu === 'EXTERNAL' ? at(t) : none,
      outsourced: none,
    };
  }

  // ── Buttons ───────────────────────────────────────────────────────────────

  /**
   * In-House buttons: the document's list for the status, narrowed to what the server allows - a legal
   * transition, a cancelled order (only the wind-down), a removed test (Store only), the Store / Return
   * "all tests published" gate, and the Discarded / Returned flags. A narrowed-out button that has a
   * reason a person can act on is reported in `hiddenActionReasons`.
   */
  private async inHouseActions(
    ctx: Ctx,
    group: Entry[],
    removed: Set<string>,
    orderCancelled: boolean,
    visibleSampleIds: Set<string>,
  ): Promise<{
    actions: string[];
    hiddenActionReasons: Record<string, string>;
  }> {
    const status = group[0]!.status as SampleStatus;
    const hiddenActionReasons: Record<string, string> = {};
    let actions = IN_HOUSE_SEARCH_ACTIONS[status].filter((label) => {
      const key = IN_HOUSE_ACTION_KEY[label] as SampleAction;
      return key === 'retrieve' || nextSampleStatus(key, status) !== null;
    });

    if (orderCancelled) {
      // A cancelled order's samples are frozen; only the wind-down stays open.
      actions = actions.filter(
        (label) =>
          (label === 'Retrieve' && TRANSFERRED_STATUSES.has(status)) ||
          (label === 'Store' && group.some((e) => !!e.sample.sourceTransferId)),
      );
    } else if (group.some((e) => removed.has(e.sample.id))) {
      // A removed test's sample keeps only the tube wind-down.
      actions = actions.filter((label) => label === 'Store');
    }

    if (
      status === SampleStatus.ACCEPTED &&
      (actions.includes('Store') || actions.includes('Return'))
    ) {
      // One barcode = one group, so one answer covers the whole section.
      const gate = await this.samples.storeReturnGate(
        ctx.tx,
        ctx.tenantId,
        group[0]!.sample,
      );
      if (gate.gated && gate.unpublished > 0) {
        // A department-scoped person does not see every test of the tube: say so, instead of "1 test is not published"
        // next to a list in which every test they can see is Published.
        const hidden = gate.unpublishedSampleIds.filter(
          (id) => !visibleSampleIds.has(id),
        ).length;
        const why = this.notPublishedReason(gate.unpublished, hidden);
        for (const label of ['Store', 'Return']) {
          if (actions.includes(label)) hiddenActionReasons[label] = why;
        }
        actions = actions.filter((l) => l !== 'Store' && l !== 'Return');
      }
    }

    // Repeat, Send / Forward / Outsource and Retrieve are refused by the server for the report's state. A group action runs
    // with "skip invalid", so a button stays whenever ANY sample of the section would still be accepted.
    if (
      !orderCancelled &&
      (actions.includes('Repeat') ||
        actions.includes('Send') ||
        actions.includes('Forward') ||
        actions.includes('Outsource'))
    ) {
      const blocks = await Promise.all(
        group.map((e) =>
          this.samples.reportBlocksFor(ctx.tx, ctx.tenantId, e.sample.id),
        ),
      );
      if (actions.includes('Repeat') && blocks.every((b) => b.repeat)) {
        hiddenActionReasons['Repeat'] =
          'A result is already validated (Result Done, Approved or Published). Use Re-run in Technician to redo it.';
        actions = actions.filter((l) => l !== 'Repeat');
      }
      if (blocks.every((b) => b.dispatch)) {
        for (const label of ['Send', 'Forward', 'Outsource']) {
          if (!actions.includes(label)) continue;
          hiddenActionReasons[label] =
            'The report has already been worked on (results, notes or attachments exist, or it is past Pending).';
        }
        actions = actions.filter(
          (l) => l !== 'Send' && l !== 'Forward' && l !== 'Outsource',
        );
      }
    }
    if (!orderCancelled && actions.includes('Retrieve')) {
      const refused = await Promise.all(
        group.map((e) =>
          this.samples.retrieveRefusedByStartedReport(
            ctx.tx,
            ctx.tenantId,
            e.sample.id,
          ),
        ),
      );
      if (refused.every(Boolean)) {
        hiddenActionReasons['Retrieve'] =
          'A report has already been worked on. Use Repeat for an unfinished result or Re-run for a finished one.';
        actions = actions.filter((l) => l !== 'Retrieve');
      }
    }

    // A section can mix rows with different flags (one barcode shared by tests of several departments, each discarded or
    // returned by its own department). Each button then stays for the rows it can act on and the screen sends only those:
    // Retrieve while any row qualifies (the server retrieves those and skips the rest), Mark Recoverable while any row is
    // not recoverable, Mark Not Recoverable while any row is, Mark Returned & Verified while any row is unverified.
    if (status === SampleStatus.DISCARDED && !orderCancelled) {
      const recoverable = group.filter(
        (e) => e.sample.isRecoverable === true,
      ).length;
      if (recoverable === 0) {
        hiddenActionReasons['Retrieve'] = 'Not marked recoverable.';
        actions = actions.filter((l) => l !== 'Retrieve');
      }
      if (recoverable < group.length)
        actions.push(FLAG_ACTIONS.MARK_RECOVERABLE);
      if (recoverable > 0) actions.push(FLAG_ACTIONS.MARK_NOT_RECOVERABLE);
    }
    if (status === SampleStatus.RETURNED && !orderCancelled) {
      const verified = group.filter(
        (e) => !!e.sample.returnedVerifiedAt,
      ).length;
      if (verified === 0) {
        hiddenActionReasons['Retrieve'] =
          'Not confirmed as physically back and verified.';
        actions = actions.filter((l) => l !== 'Retrieve');
      }
      if (verified < group.length) {
        actions.push(FLAG_ACTIONS.MARK_RETURNED_VERIFIED);
      }
    }
    return { actions, hiddenActionReasons };
  }

  /** The popup's words for the Store / Return gate: how many tests are unpublished, and how many of them the person cannot see. */
  private notPublishedReason(unpublished: number, hidden: number): string {
    const visible = unpublished - hidden;
    if (hidden === 0) {
      return `${unpublished} test${unpublished === 1 ? ' is' : 's are'} not published yet.`;
    }
    const hiddenText = `${hidden} test${hidden === 1 ? '' : 's'} in a department you cannot see ${hidden === 1 ? 'is' : 'are'} not published yet`;
    return visible === 0
      ? `${hiddenText}.`
      : `${visible} test${visible === 1 ? ' is' : 's are'} not published yet, and ${hiddenText}.`;
  }

  /** Internal / External Referral buttons: the document's list for the transfer status, narrowed likewise. */
  private referralActions(
    group: Entry[],
    removed: Set<string>,
    orderCancelled: boolean,
  ): { actions: string[]; hiddenActionReasons: Record<string, string> } {
    const status = group[0]!.status as TransferStatus;
    let actions = REFERRAL_SEARCH_ACTIONS[status].filter((label) => {
      const key = REFERRAL_ACTION_KEY[label]!;
      return key === 'retrieve'
        ? previousTransferStatus(status) !== null
        : nextTransferStatus(key as TransferAction, status) !== null;
    });
    if (group.some((e) => removed.has(e.sample.id))) actions = [];
    // A cancelled order keeps only the send-back of a Received transfer.
    if (orderCancelled) {
      actions = actions.filter(
        (l) => l === 'Reject' && status === TransferStatus.RECEIVED,
      );
    }
    // The receiving branch cannot Retrieve its Repeat / Reject once the SENDER has acted on it (the sender's sample left Sent).
    // A group action skips what the server refuses, so the button goes only when every transfer here is past that point.
    const hiddenActionReasons: Record<string, string> = {};
    if (
      (status === TransferStatus.REPEAT ||
        status === TransferStatus.REJECTED) &&
      actions.includes('Retrieve') &&
      group.every(
        (e) =>
          e.transfer?.kind === TransferKind.INTERNAL &&
          e.sample.status !== SampleStatus.SENT_INTERNAL,
      )
    ) {
      hiddenActionReasons['Retrieve'] =
        status === TransferStatus.REPEAT
          ? 'The sending branch has already confirmed the Repeat.'
          : 'The sending branch has already flagged the rejected sample as Error.';
      actions = actions.filter((l) => l !== 'Retrieve');
    }
    return { actions, hiddenActionReasons };
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  /** Department / category / subcategory / branch / center names for every entry, in a few batched reads. */
  private async lookupNames(ctx: Ctx, entries: Entry[]): Promise<Names> {
    const { tx, tenantId } = ctx;
    // The branch test a row stands for: the ordered test itself, or (panel member) the branch's copy of
    // the member test.
    const panelLinks = entries.flatMap((e) =>
      e.sample.branchId
        ? e.sample.tests
            .filter((t) => !t.orderItem.branchLabTest && t.labTestId)
            .map((t) => ({
              branchId: e.sample.branchId!,
              labTestId: t.labTestId!,
            }))
        : [],
    );
    const memberTests =
      panelLinks.length > 0
        ? await tx.branchLabTest.findMany({
            where: {
              tenantId,
              deletedAt: null,
              OR: panelLinks.map((p) => ({
                branchId: p.branchId,
                sourceLabTestId: p.labTestId,
              })),
            },
            select: {
              branchId: true,
              sourceLabTestId: true,
              departmentId: true,
              categoryId: true,
              subCategoryId: true,
            },
          })
        : [];

    type Cls = {
      departmentId: string | null;
      categoryId: string | null;
      subCategoryId: string | null;
    };
    const classificationOf = (
      sample: SampleRow,
      t: SampleRow['tests'][number],
    ): Cls => {
      const direct = t.orderItem.branchLabTest;
      if (direct) return direct;
      const member = memberTests.find(
        (m) =>
          m.branchId === sample.branchId && m.sourceLabTestId === t.labTestId,
      );
      return (
        member ?? { departmentId: null, categoryId: null, subCategoryId: null }
      );
    };

    const ids = {
      department: new Set<string>(),
      category: new Set<string>(),
      subCategory: new Set<string>(),
      branch: new Set<string>(),
      center: new Set<string>(),
    };
    for (const e of entries) {
      for (const b of [
        e.sample.branchId,
        e.sample.originBranchId,
        e.sample.processingBranchId,
        e.transfer?.originBranchId,
        e.transfer?.destinationBranchId,
      ]) {
        if (b) ids.branch.add(b);
      }
      if (e.transfer?.outsourceCenterId)
        ids.center.add(e.transfer.outsourceCenterId);
      if (e.sample.departmentId) ids.department.add(e.sample.departmentId);
      for (const t of e.sample.tests) {
        const c = classificationOf(e.sample, t);
        if (c.departmentId) ids.department.add(c.departmentId);
        if (c.categoryId) ids.category.add(c.categoryId);
        if (c.subCategoryId) ids.subCategory.add(c.subCategoryId);
      }
    }
    const read = async <T extends { id: string; name: string }>(
      set: Set<string>,
      fetch: (ids: string[]) => Promise<T[]>,
    ): Promise<Map<string, string>> =>
      new Map(
        set.size === 0
          ? []
          : (await fetch([...set])).map((r) => [r.id, r.name] as const),
      );
    const [department, category, subCategory, branch, center] =
      await Promise.all([
        read(ids.department, (x) =>
          tx.department.findMany({
            where: { id: { in: x } },
            select: { id: true, name: true },
          }),
        ),
        read(ids.category, (x) =>
          tx.category.findMany({
            where: { id: { in: x } },
            select: { id: true, name: true },
          }),
        ),
        read(ids.subCategory, (x) =>
          tx.subCategory.findMany({
            where: { id: { in: x } },
            select: { id: true, name: true },
          }),
        ),
        read(ids.branch, (x) =>
          tx.branch.findMany({
            where: { id: { in: x }, tenantId },
            select: { id: true, name: true },
          }),
        ),
        read(ids.center, (x) =>
          tx.outsourceCenter.findMany({
            where: { id: { in: x }, tenantId },
            select: { id: true, name: true },
          }),
        ),
      ]);
    const get = (m: Map<string, string>, id: string | null) =>
      id ? (m.get(id) ?? null) : null;
    return {
      classificationOf,
      department: (id) => get(department, id),
      category: (id) => get(category, id),
      subCategory: (id) => get(subCategory, id),
      branch: (id) => get(branch, id),
      outsourceCenter: (id) => get(center, id),
    };
  }

  /**
   * The report status of every test line, keyed `${orderItemId}::${labTestId}` (a panel member's own
   * report) or `${orderItemId}::` (a standalone test's report). Read from whichever branch holds the
   * report now: after an internal transfer is accepted the report belongs to the receiving branch.
   */
  private async lookupReports(
    ctx: Ctx,
    entries: Entry[],
  ): Promise<Map<string, LabReportStatus>> {
    const itemIds = [
      ...new Set(
        entries.flatMap((e) => e.sample.tests.map((t) => t.orderItemId)),
      ),
    ];
    const rows = await ctx.tx.labReport.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        orderItemId: { in: itemIds },
      },
      select: {
        orderItemId: true,
        labTestId: true,
        memberBranchLabTestId: true,
        status: true,
      },
    });
    const map = new Map<string, LabReportStatus>();
    for (const r of rows) {
      const key = `${r.orderItemId}::${r.memberBranchLabTestId ? (r.labTestId ?? '') : ''}`;
      if (!map.has(key)) map.set(key, r.status);
    }
    return map;
  }
}

/** What every step of one lookup shares. */
interface Ctx {
  tx: Prisma.TransactionClient;
  tenantId: string;
  branchId: string | null;
  scopeIds: string[];
  code: string;
}

/** The names the lookup resolved. */
interface Names {
  classificationOf: (
    sample: SampleRow,
    test: SampleRow['tests'][number],
  ) => {
    departmentId: string | null;
    categoryId: string | null;
    subCategoryId: string | null;
  };
  department: (id: string | null) => string | null;
  category: (id: string | null) => string | null;
  subCategory: (id: string | null) => string | null;
  branch: (id: string | null) => string | null;
  outsourceCenter: (id: string | null) => string | null;
}
