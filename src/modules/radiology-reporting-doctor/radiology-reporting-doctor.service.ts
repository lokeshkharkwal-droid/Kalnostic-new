import { Injectable } from '@nestjs/common';
import {
  PaymentMode,
  DoctorStatus,
  RadiologyReportingDoctorType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CategoryService } from '../category/category.service';
import { SubCategoryService } from '../sub-category/sub-category.service';
import { DepartmentService } from '../department/department.service';
import { CreateRadiologyReportingDoctorDto } from './dto/create-radiology-reporting-doctor.dto';
import { ListRadiologyReportingDoctorsDto } from './dto/list-radiology-reporting-doctors.dto';
import { UpdateRadiologyReportingDoctorDto } from './dto/update-radiology-reporting-doctor.dto';
import {
  ClassificationRef,
  RADIOLOGY_REPORTING_DOCTOR_LIST_SELECT,
  RadiologyReportingDoctorDetail,
  RadiologyReportingDoctorEntity,
  RadiologyReportingDoctorListItem,
  RadiologyReportingDoctorListRow,
} from './entities/radiology-reporting-doctor.entity';
import {
  DuplicateRadiologyReportingDoctorRegistrationNoException,
  RadiologyReportingDoctorNotFoundException,
} from './exceptions/radiology-reporting-doctor.exceptions';

/**
 * Radiology reporting-doctor registry management. Tenant-scoped (CLAUDE.md §4.6) —
 * the "Reporting Doctors" master under Radiology Configuration. Every query carries
 * `tenantId` (defence in depth on top of RLS, §4.3) and filters soft-deleted rows.
 * The model is FLAT — unlike `Doctor` it has no qualification/experience/schedule/
 * slot child tables — so there is nothing to nest or replace. Classification ids
 * (`departmentId`/`categoryId`/`subCategoryId`) and the assigned `branchId` are
 * plain logical refs with no Prisma relations; they are validated against the
 * caller's tenant via the injected Department/Category/SubCategory/Branch services
 * (CLAUDE.md rule #3 — never import another service's file directly) and resolved
 * to names on the detail/list responses via separate scoped queries.
 */
@Injectable()
export class RadiologyReportingDoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentService: DepartmentService,
    private readonly categoryService: CategoryService,
    private readonly subCategoryService: SubCategoryService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /radiology-reporting-doctors/options`). Tenant-scoped to non-deleted
   * reporting doctors; optionally filtered by `branchId` and a case-insensitive
   * name/phone `search`. Returns the full array when `page` is omitted, or a
   * paginated envelope when `page` is supplied.
   * @param tenantId tenant scope
   * @param filters optional `branchId`, `search`, and opt-in `page`/`limit`
   * @returns the full `{ id, name }[]` array, or a paginated `{ data, total, page, limit }` envelope
   */
  async findOptions(
    tenantId: string,
    filters: {
      branchId?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.RadiologyReportingDoctorWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const select = { id: true, firstName: true, lastName: true } as const;
    const orderBy = { firstName: 'asc' } as const;
    const toName = (r: { firstName: string; lastName: string }) =>
      [r.firstName, r.lastName].filter(Boolean).join(' ');

    if (filters.page === undefined) {
      const rows = await this.prisma.radiologyReportingDoctor.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: toName(r) }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.radiologyReportingDoctor.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.radiologyReportingDoctor.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: toName(r) })),
      total,
      page,
      limit,
    };
  }

  /**
   * Register a radiology reporting doctor in a tenant. The optional branch and
   * classification links are validated to be active rows of the same tenant first;
   * the doctor is then created in one tenant-scoped transaction.
   * @param tenantId owning tenant (from the JWT, never the body)
   * @param dto validated payload
   * @returns the created doctor with its resolved classification names
   * @throws BranchNotFoundException if `branchId` isn't an active branch of this tenant
   * @throws DepartmentNotFoundException / CategoryNotFoundException /
   *   SubCategoryNotFoundException if a supplied classification id isn't an active
   *   row of this tenant
   * @throws DuplicateRadiologyReportingDoctorRegistrationNoException if the
   *   registration number is already used by an active doctor in this tenant
   */
  async create(
    tenantId: string,
    dto: CreateRadiologyReportingDoctorDto,
  ): Promise<RadiologyReportingDoctorDetail> {
    if (dto.branchId) {
      await this.branchService.findById(dto.branchId, tenantId);
    }
    await this.validateClassification(
      tenantId,
      dto.departmentId,
      dto.categoryId,
      dto.subCategoryId,
    );

    const data: Prisma.RadiologyReportingDoctorUncheckedCreateInput = {
      tenantId,
      branchId: dto.branchId ?? null,
      doctorType: dto.doctorType ?? RadiologyReportingDoctorType.REPORTING,
      salutation: dto.salutation ?? null,
      firstName: dto.firstName,
      lastName: dto.lastName,
      dateOfBirth: this.toDate(dto.dateOfBirth),
      gender: dto.gender ?? null,
      phone: dto.phone,
      alternatePhone: dto.alternatePhone ?? null,
      email: dto.email ?? null,
      address: dto.address ?? null,
      registrationNo: dto.registrationNo,
      registrationCouncil: dto.registrationCouncil ?? null,
      registrationExpiry: this.toDate(dto.registrationExpiry),
      categoryId: dto.categoryId ?? null,
      subCategoryId: dto.subCategoryId ?? null,
      departmentId: dto.departmentId ?? null,
      isNablAuthorized: dto.isNablAuthorized ?? false,
      isCapCertified: dto.isCapCertified ?? false,
      isIsoCertified: dto.isIsoCertified ?? false,
      isReportSignatory: dto.isReportSignatory ?? false,
      signatoryName: dto.signatoryName ?? null,
      signatoryDesignation: dto.signatoryDesignation ?? null,
      signatureImagePath: dto.signatureImagePath ?? null,
      signatoryDepartmentIds: dto.signatoryDepartmentIds ?? Prisma.DbNull,
      signatoryCategoryIds: dto.signatoryCategoryIds ?? Prisma.DbNull,
      signatorySubCategoryIds: dto.signatorySubCategoryIds ?? Prisma.DbNull,
      accountHolderName: dto.accountHolderName ?? null,
      bankName: dto.bankName ?? null,
      accountNumber: dto.accountNumber ?? null,
      ifscCode: dto.ifscCode ?? null,
      paymentMode: dto.paymentMode ?? PaymentMode.BANK_TRANSFER,
      consultationFee: dto.consultationFee ?? 0,
      emergencyFee: dto.emergencyFee ?? 0,
      followUpFee: dto.followUpFee ?? 0,
      isAllowDiscount: dto.isAllowDiscount ?? false,
      status: dto.status ?? DoctorStatus.ACTIVE,
      joiningDate: this.toDate(dto.joiningDate),
      remarks: dto.remarks ?? null,
    };

    let created: RadiologyReportingDoctorEntity;
    try {
      created = await this.prisma.withTenant(tenantId, (tx) =>
        tx.radiologyReportingDoctor.create({ data }),
      );
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.registrationNo);
      throw e;
    }
    return this.resolveDetail(tenantId, created);
  }

  /**
   * List active radiology reporting doctors for a tenant (offset pagination),
   * returning the trimmed listing projection. Supports a free-text `search`
   * (first/last name or registration number), a `departmentId` filter, a `status`
   * filter, a `doctorType` filter, and a `branchId` filter.
   * @param tenantId tenant scope
   * @param query pagination + filters
   */
  async findAllForTenant(
    tenantId: string,
    query: ListRadiologyReportingDoctorsDto,
  ): Promise<PaginatedResult<RadiologyReportingDoctorListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.RadiologyReportingDoctorWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.doctorType) where.doctorType = query.doctorType;
    if (query.branchId) where.branchId = query.branchId;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { registrationNo: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.radiologyReportingDoctor.findMany({
        where,
        select: RADIOLOGY_REPORTING_DOCTOR_LIST_SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.radiologyReportingDoctor.count({ where }),
    ]);
    const data = await this.toListItems(tenantId, rows);
    return { data, total, page, limit };
  }

  /**
   * Fetch one active radiology reporting doctor scoped to its tenant, with its
   * linked department/category/sub-category names resolved.
   * @param id doctor id
   * @param tenantId tenant scope
   * @throws RadiologyReportingDoctorNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<RadiologyReportingDoctorDetail> {
    const doctor = await this.prisma.radiologyReportingDoctor.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!doctor) {
      throw new RadiologyReportingDoctorNotFoundException(id);
    }
    return this.resolveDetail(tenantId, doctor);
  }

  /**
   * Update a radiology reporting doctor. Only supplied fields change. When
   * `branchId` is supplied it is re-validated against the tenant; when a
   * classification id is supplied it is re-validated too.
   * @param id doctor id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws RadiologyReportingDoctorNotFoundException if missing/soft-deleted
   * @throws BranchNotFoundException if a supplied `branchId` isn't an active branch
   *   of this tenant
   * @throws DepartmentNotFoundException / CategoryNotFoundException /
   *   SubCategoryNotFoundException if a supplied classification id isn't an active
   *   row of this tenant
   * @throws DuplicateRadiologyReportingDoctorRegistrationNoException on a
   *   registration-number collision
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateRadiologyReportingDoctorDto,
  ): Promise<RadiologyReportingDoctorDetail> {
    await this.findById(id, tenantId);
    if (dto.branchId !== undefined && dto.branchId !== null) {
      await this.branchService.findById(dto.branchId, tenantId);
    }
    await this.validateClassification(
      tenantId,
      dto.departmentId,
      dto.categoryId,
      dto.subCategoryId,
    );

    const data: Prisma.RadiologyReportingDoctorUncheckedUpdateInput = {};
    if (dto.branchId !== undefined) data.branchId = dto.branchId ?? null;
    if (dto.doctorType !== undefined) data.doctorType = dto.doctorType;
    if (dto.salutation !== undefined) data.salutation = dto.salutation;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = this.toDate(dto.dateOfBirth);
    }
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.alternatePhone !== undefined) {
      data.alternatePhone = dto.alternatePhone ?? null;
    }
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.address !== undefined) data.address = dto.address ?? null;
    if (dto.registrationNo !== undefined) {
      data.registrationNo = dto.registrationNo;
    }
    if (dto.registrationCouncil !== undefined) {
      data.registrationCouncil = dto.registrationCouncil ?? null;
    }
    if (dto.registrationExpiry !== undefined) {
      data.registrationExpiry = this.toDate(dto.registrationExpiry);
    }
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId ?? null;
    if (dto.subCategoryId !== undefined) {
      data.subCategoryId = dto.subCategoryId ?? null;
    }
    if (dto.departmentId !== undefined) {
      data.departmentId = dto.departmentId ?? null;
    }
    if (dto.isNablAuthorized !== undefined) {
      data.isNablAuthorized = dto.isNablAuthorized;
    }
    if (dto.isCapCertified !== undefined) {
      data.isCapCertified = dto.isCapCertified;
    }
    if (dto.isIsoCertified !== undefined) {
      data.isIsoCertified = dto.isIsoCertified;
    }
    if (dto.isReportSignatory !== undefined) {
      data.isReportSignatory = dto.isReportSignatory;
    }
    if (dto.signatoryName !== undefined) {
      data.signatoryName = dto.signatoryName ?? null;
    }
    if (dto.signatoryDesignation !== undefined) {
      data.signatoryDesignation = dto.signatoryDesignation ?? null;
    }
    if (dto.signatureImagePath !== undefined) {
      data.signatureImagePath = dto.signatureImagePath ?? null;
    }
    if (dto.signatoryDepartmentIds !== undefined) {
      data.signatoryDepartmentIds = dto.signatoryDepartmentIds ?? Prisma.DbNull;
    }
    if (dto.signatoryCategoryIds !== undefined) {
      data.signatoryCategoryIds = dto.signatoryCategoryIds ?? Prisma.DbNull;
    }
    if (dto.signatorySubCategoryIds !== undefined) {
      data.signatorySubCategoryIds =
        dto.signatorySubCategoryIds ?? Prisma.DbNull;
    }
    if (dto.accountHolderName !== undefined) {
      data.accountHolderName = dto.accountHolderName ?? null;
    }
    if (dto.bankName !== undefined) data.bankName = dto.bankName ?? null;
    if (dto.accountNumber !== undefined) {
      data.accountNumber = dto.accountNumber ?? null;
    }
    if (dto.ifscCode !== undefined) data.ifscCode = dto.ifscCode ?? null;
    if (dto.paymentMode !== undefined) data.paymentMode = dto.paymentMode;
    if (dto.consultationFee !== undefined) {
      data.consultationFee = dto.consultationFee;
    }
    if (dto.emergencyFee !== undefined) data.emergencyFee = dto.emergencyFee;
    if (dto.followUpFee !== undefined) data.followUpFee = dto.followUpFee;
    if (dto.isAllowDiscount !== undefined) {
      data.isAllowDiscount = dto.isAllowDiscount;
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.joiningDate !== undefined) {
      data.joiningDate = this.toDate(dto.joiningDate);
    }
    if (dto.remarks !== undefined) data.remarks = dto.remarks ?? null;

    let updated: RadiologyReportingDoctorEntity;
    try {
      updated = await this.prisma.withTenant(tenantId, (tx) =>
        tx.radiologyReportingDoctor.update({ where: { id }, data }),
      );
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.registrationNo ?? '');
      throw e;
    }
    return this.resolveDetail(tenantId, updated);
  }

  /**
   * Soft-delete a radiology reporting doctor (sets `deletedAt`; the row is
   * preserved). The model has no child tables to cascade.
   * @param id doctor id
   * @param tenantId tenant scope
   * @throws RadiologyReportingDoctorNotFoundException if missing/soft-deleted
   */
  async remove(
    id: string,
    tenantId: string,
  ): Promise<RadiologyReportingDoctorDetail> {
    await this.findById(id, tenantId);
    const removed = await this.prisma.withTenant(tenantId, (tx) =>
      tx.radiologyReportingDoctor.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
    return this.resolveDetail(tenantId, removed);
  }

  /**
   * Validate that supplied classification ids belong to active rows of this tenant.
   * Each lookup throws its own typed NotFound exception if it doesn't.
   * @param tenantId tenant scope
   * @param departmentId candidate department id, if any
   * @param categoryId candidate category id, if any
   * @param subCategoryId candidate sub-category id, if any
   */
  private async validateClassification(
    tenantId: string,
    departmentId: string | undefined,
    categoryId: string | undefined,
    subCategoryId: string | undefined,
  ): Promise<void> {
    if (departmentId) {
      await this.departmentService.findById(departmentId, tenantId);
    }
    if (categoryId) {
      await this.categoryService.findById(categoryId, tenantId);
    }
    if (subCategoryId) {
      await this.subCategoryService.findById(subCategoryId, tenantId);
    }
  }

  /**
   * Augment a reporting-doctor row with its resolved classification names and
   * signatory `{ id, name }` references, all scoped to active rows of the tenant.
   * @param tenantId tenant scope
   * @param doctor the base reporting-doctor row
   */
  private async resolveDetail(
    tenantId: string,
    doctor: RadiologyReportingDoctorEntity,
  ): Promise<RadiologyReportingDoctorDetail> {
    const [
      department,
      category,
      subCategory,
      signatoryDepartments,
      signatoryCategories,
      signatorySubCategories,
    ] = await Promise.all([
      this.resolveDepartmentRef(tenantId, doctor.departmentId),
      this.resolveCategoryRef(tenantId, doctor.categoryId),
      this.resolveSubCategoryRef(tenantId, doctor.subCategoryId),
      this.resolveDepartmentRefs(
        tenantId,
        this.toIdArray(doctor.signatoryDepartmentIds),
      ),
      this.resolveCategoryRefs(
        tenantId,
        this.toIdArray(doctor.signatoryCategoryIds),
      ),
      this.resolveSubCategoryRefs(
        tenantId,
        this.toIdArray(doctor.signatorySubCategoryIds),
      ),
    ]);
    return {
      ...doctor,
      department,
      category,
      subCategory,
      signatoryDepartments,
      signatoryCategories,
      signatorySubCategories,
    };
  }

  /**
   * Reshape the selected list rows into listing responses, batching the
   * department/category/sub-category name lookups across all rows (no N+1).
   * @param tenantId tenant scope
   * @param rows rows from `RADIOLOGY_REPORTING_DOCTOR_LIST_SELECT`
   */
  private async toListItems(
    tenantId: string,
    rows: RadiologyReportingDoctorListRow[],
  ): Promise<RadiologyReportingDoctorListItem[]> {
    const deptIds = this.collectIds(rows.map((r) => r.departmentId));
    const catIds = this.collectIds(rows.map((r) => r.categoryId));
    const subIds = this.collectIds(rows.map((r) => r.subCategoryId));

    const [departments, categories, subCategories] = await Promise.all([
      this.resolveDepartmentRefs(tenantId, deptIds),
      this.resolveCategoryRefs(tenantId, catIds),
      this.resolveSubCategoryRefs(tenantId, subIds),
    ]);
    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    const subMap = new Map(subCategories.map((s) => [s.id, s.name]));

    return rows.map((row) => ({
      id: row.id,
      name: [row.firstName, row.lastName].filter(Boolean).join(' '),
      salutation: row.salutation,
      doctorType: row.doctorType,
      registrationNo: row.registrationNo,
      department: row.departmentId
        ? (deptMap.get(row.departmentId) ?? null)
        : null,
      specialization: row.categoryId
        ? (catMap.get(row.categoryId) ?? null)
        : null,
      superSpecialization: row.subCategoryId
        ? (subMap.get(row.subCategoryId) ?? null)
        : null,
      contact: row.phone,
      email: row.email,
      status: row.status,
      isReportSignatory: row.isReportSignatory,
      consultationFee: row.consultationFee,
      followUpFee: row.followUpFee,
    }));
  }

  /**
   * Collect the distinct non-null ids from a list of nullable id columns.
   * @param ids the raw id values (some may be null)
   */
  private collectIds(ids: Array<string | null>): string[] {
    return [...new Set(ids.filter((v): v is string => !!v))];
  }

  /**
   * Resolve a single department id into a `{ id, name }` ref scoped to the tenant,
   * or `null` when the id is unset or the row has since been deleted.
   * @param tenantId tenant scope
   * @param id the candidate department id, if any
   */
  private async resolveDepartmentRef(
    tenantId: string,
    id: string | null,
  ): Promise<ClassificationRef | null> {
    if (!id) return null;
    return this.prisma.department.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  /**
   * Resolve a single category id into a `{ id, name }` ref scoped to the tenant,
   * or `null` when the id is unset or the row has since been deleted.
   * @param tenantId tenant scope
   * @param id the candidate category id, if any
   */
  private async resolveCategoryRef(
    tenantId: string,
    id: string | null,
  ): Promise<ClassificationRef | null> {
    if (!id) return null;
    return this.prisma.category.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  /**
   * Resolve a single sub-category id into a `{ id, name }` ref scoped to the
   * tenant, or `null` when the id is unset or the row has since been deleted.
   * @param tenantId tenant scope
   * @param id the candidate sub-category id, if any
   */
  private async resolveSubCategoryRef(
    tenantId: string,
    id: string | null,
  ): Promise<ClassificationRef | null> {
    if (!id) return null;
    return this.prisma.subCategory.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  /**
   * Coerce a stored `signatory*Ids` JSON column into a string array. The column is
   * `Json?` (an array of ids when set, `null`/absent otherwise); anything that
   * isn't an array of strings collapses to `[]`.
   * @param value the raw JSON value read from the doctor row
   */
  private toIdArray(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  }

  /**
   * Resolve department ids into `{ id, name }` refs, scoped to active rows of the
   * tenant. Order follows the database, not the input array; missing ids drop out.
   * @param tenantId tenant scope
   * @param ids the candidate department ids (may be empty)
   */
  private async resolveDepartmentRefs(
    tenantId: string,
    ids: string[],
  ): Promise<ClassificationRef[]> {
    if (ids.length === 0) return [];
    return this.prisma.department.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  /**
   * Resolve category (specialty) ids into `{ id, name }` refs, scoped to active
   * rows of the tenant.
   * @param tenantId tenant scope
   * @param ids the candidate category ids (may be empty)
   */
  private async resolveCategoryRefs(
    tenantId: string,
    ids: string[],
  ): Promise<ClassificationRef[]> {
    if (ids.length === 0) return [];
    return this.prisma.category.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  /**
   * Resolve sub-category (super-specialty) ids into `{ id, name }` refs, scoped to
   * active rows of the tenant.
   * @param tenantId tenant scope
   * @param ids the candidate sub-category ids (may be empty)
   */
  private async resolveSubCategoryRefs(
    tenantId: string,
    ids: string[],
  ): Promise<ClassificationRef[]> {
    if (ids.length === 0) return [];
    return this.prisma.subCategory.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  /**
   * Convert an optional ISO date string into a Date (or null when absent), for
   * `@db.Date` columns.
   * @param value an ISO-8601 date string, or undefined
   */
  private toDate(value: string | undefined): Date | null {
    return value ? new Date(value) : null;
  }

  /**
   * If the caught error is a Prisma unique-constraint violation (P2002) on the
   * per-tenant active registration-number index, throw the typed 409. Returns
   * normally for any other error so the caller can rethrow.
   * @param e the caught error
   * @param registrationNo the attempted registration number (for the context)
   * @throws DuplicateRadiologyReportingDoctorRegistrationNoException
   */
  private rethrowUniqueViolation(e: unknown, registrationNo: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new DuplicateRadiologyReportingDoctorRegistrationNoException(
        registrationNo,
      );
    }
  }
}
