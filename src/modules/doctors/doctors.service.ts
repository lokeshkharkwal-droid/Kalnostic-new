import { Injectable } from '@nestjs/common';
import {
  DoctorPaymentMode,
  DoctorStatus,
  DoctorType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CategoryService } from '../category/category.service';
import { SubCategoryService } from '../sub-category/sub-category.service';
import { DepartmentService } from '../department/department.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { ListDoctorsDto } from './dto/list-doctors.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { DoctorExperienceDto } from './dto/doctor-experience.dto';
import { DoctorQualificationDto } from './dto/doctor-qualification.dto';
import {
  ClassificationRef,
  DOCTOR_DETAIL_INCLUDE,
  DOCTOR_LIST_SELECT,
  DoctorDetail,
  DoctorDetailResolved,
  DoctorListItem,
  DoctorListRow,
} from './entities/doctor.entity';
import {
  DoctorNotFoundException,
  DuplicateRegistrationNoException,
} from './exceptions/doctors.exceptions';

/**
 * Doctor registry management. Tenant-scoped (CLAUDE.md §4.6) — the registry
 * belongs to the business as a whole. Every query carries `tenantId` (defence in
 * depth on top of RLS, §4.3) and filters soft-deleted rows. Classification ids
 * (`departmentId`/`categoryId`) and assigned branch ids are validated against the
 * caller's tenant via the injected Department/Category/Branch services (CLAUDE.md
 * rule #3 — never import another service's file directly). The doctor's branch
 * (`branchId`) is client-supplied and validated against the caller's tenant via
 * the injected BranchService (CLAUDE.md §4.7 — never trusted from the body).
 * Qualifications and experiences are managed via the parent doctor
 * (replace-on-update). A doctor's charges (consultation/emergency/follow-up fee +
 * allow-discount) live on the doctor record.
 */
@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentService: DepartmentService,
    private readonly categoryService: CategoryService,
    private readonly subCategoryService: SubCategoryService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /doctors/options`). Tenant-scoped to non-deleted CONSULTANT doctors
   * (`doctorType = CONSULTANT`); optionally filtered by `branchId` and a
   * case-insensitive `firstName` search. The `name` is the doctor's first + last
   * name joined. Returns the full array when `page` is omitted, or a paginated
   * envelope when `page` is supplied.
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
    const where: Prisma.DoctorWhereInput = {
      tenantId,
      deletedAt: null,
      doctorType: DoctorType.CONSULTANT,
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
      const rows = await this.prisma.doctor.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: toName(r) }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.doctor.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.doctor.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: toName(r) })),
      total,
      page,
      limit,
    };
  }

  /**
   * Register a doctor in a tenant, scoped to a branch, with its qualifications and
   * experiences. The branch and classification links are validated to be active
   * rows of the same tenant first; the doctor and its children are then created in
   * one transaction.
   * @param tenantId owning tenant (from the JWT, never the body)
   * @param dto validated doctor payload
   * @returns the created doctor with its children and classification names
   * @throws BranchNotFoundException if `branchId` isn't an active branch of this
   *   tenant
   * @throws DepartmentNotFoundException / CategoryNotFoundException if a supplied
   *   classification id isn't an active row of this tenant
   * @throws DuplicateRegistrationNoException if the registration number is already
   *   used by an active doctor in this tenant
   */
  async create(tenantId: string, dto: CreateDoctorDto): Promise<DoctorDetail> {
    await this.branchService.findById(dto.branchId, tenantId);
    await this.validateClassification(
      tenantId,
      dto.departmentId,
      dto.categoryId,
      dto.subCategoryId,
    );

    const data: Prisma.DoctorUncheckedCreateInput = {
      tenantId,
      branchId: dto.branchId,
      doctorType: dto.doctorType,
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
      paymentMode: dto.paymentMode ?? DoctorPaymentMode.BANK_TRANSFER,
      consultationFee: dto.consultationFee ?? 0,
      emergencyFee: dto.emergencyFee ?? 0,
      followUpFee: dto.followUpFee ?? 0,
      isAllowDiscount: dto.isAllowDiscount ?? false,
      status: dto.status ?? DoctorStatus.ACTIVE,
      joiningDate: this.toDate(dto.joiningDate),
      remarks: dto.remarks ?? null,
      qualifications: {
        create: (dto.qualifications ?? []).map((q) =>
          this.toQualificationCreate(tenantId, q),
        ),
      },
      experiences: {
        create: (dto.experiences ?? []).map((e) =>
          this.toExperienceCreate(tenantId, e),
        ),
      },
    };

    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.doctor.create({ data, include: DOCTOR_DETAIL_INCLUDE }),
      );
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.registrationNo);
      throw e;
    }
  }

  /**
   * List active doctors for a tenant (offset pagination), returning the trimmed
   * listing projection (CLAUDE.md §6). Supports a free-text `search` (first/last
   * name or registration number), a `departmentId` filter, a `status` filter, a
   * `doctorType` filter (CONSULTANT / REPORTING), and a `branchId` filter (doctors
   * scoped to that branch).
   * @param tenantId tenant scope
   * @param query pagination + filters
   */
  async findAllForTenant(
    tenantId: string,
    query: ListDoctorsDto,
  ): Promise<PaginatedResult<DoctorListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.DoctorWhereInput = { tenantId, deletedAt: null };
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

    const rows = await this.prisma.doctor.findMany({
      where,
      select: DOCTOR_LIST_SELECT,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.doctor.count({ where });
    return { data: rows.map((r) => this.toListItem(r)), total, page, limit };
  }

  /**
   * Fetch one active doctor scoped to its tenant, with all active qualifications
   * and experiences plus the linked department/category names.
   * @param id doctor id
   * @param tenantId tenant scope
   * @throws DoctorNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<DoctorDetailResolved> {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: DOCTOR_DETAIL_INCLUDE,
    });
    if (!doctor) {
      throw new DoctorNotFoundException(id);
    }
    const [signatoryDepartments, signatoryCategories, signatorySubCategories] =
      await Promise.all([
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
      signatoryDepartments,
      signatoryCategories,
      signatorySubCategories,
    };
  }

  /**
   * Update a doctor. Only supplied fields change. When `categoryId`/`departmentId`
   * is supplied it is re-validated against the tenant. When `qualifications` or
   * `experiences` is supplied it REPLACES the whole set (existing active rows are
   * soft-deleted and the new set created), all in one transaction.
   * @param id doctor id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws DoctorNotFoundException if missing/soft-deleted
   * @throws BranchNotFoundException if a supplied `branchId` isn't an active
   *   branch of this tenant
   * @throws DepartmentNotFoundException / CategoryNotFoundException if a supplied
   *   classification id isn't an active row of this tenant
   * @throws DuplicateRegistrationNoException on a registration-number collision
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateDoctorDto,
  ): Promise<DoctorDetail> {
    await this.findById(id, tenantId);
    if (dto.branchId !== undefined) {
      await this.branchService.findById(dto.branchId, tenantId);
    }
    await this.validateClassification(
      tenantId,
      dto.departmentId,
      dto.categoryId,
      dto.subCategoryId,
    );

    const data: Prisma.DoctorUncheckedUpdateInput = {};
    if (dto.branchId !== undefined) data.branchId = dto.branchId;
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
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.subCategoryId !== undefined) {
      data.subCategoryId = dto.subCategoryId ?? null;
    }
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
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
      data.signatoryDepartmentIds = dto.signatoryDepartmentIds;
    }
    if (dto.signatoryCategoryIds !== undefined) {
      data.signatoryCategoryIds = dto.signatoryCategoryIds;
    }
    if (dto.signatorySubCategoryIds !== undefined) {
      data.signatorySubCategoryIds = dto.signatorySubCategoryIds;
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

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const now = new Date();
        if (dto.qualifications !== undefined) {
          await tx.doctorQualification.updateMany({
            where: { doctorId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          data.qualifications = {
            create: dto.qualifications.map((q) =>
              this.toQualificationCreate(tenantId, q),
            ),
          };
        }
        if (dto.experiences !== undefined) {
          await tx.doctorExperience.updateMany({
            where: { doctorId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          data.experiences = {
            create: dto.experiences.map((e) =>
              this.toExperienceCreate(tenantId, e),
            ),
          };
        }
        return tx.doctor.update({
          where: { id },
          data,
          include: DOCTOR_DETAIL_INCLUDE,
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.registrationNo ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a doctor and its active qualifications and experiences (sets
   * `deletedAt`; rows are preserved) in one transaction.
   * @param id doctor id
   * @param tenantId tenant scope
   * @throws DoctorNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<DoctorDetail> {
    await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      await tx.doctorQualification.updateMany({
        where: { doctorId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.doctorExperience.updateMany({
        where: { doctorId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.doctor.update({
        where: { id },
        data: { deletedAt: now },
        include: DOCTOR_DETAIL_INCLUDE,
      });
    });
  }

  /**
   * Validate that supplied classification ids belong to active rows of this
   * tenant. Each lookup throws its own typed NotFound exception if it doesn't.
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
   * Reshape a selected list row into the listing response: composed `name`,
   * `specialization` (category name), `superSpecialization` (sub-category name),
   * and `contact` (phone). Fees are not part of the listing projection (fetch the
   * detail endpoint for a doctor's charges).
   * @param row a row from `DOCTOR_LIST_SELECT`
   */
  private toListItem(row: DoctorListRow): DoctorListItem {
    return {
      id: row.id,
      name: [row.firstName, row.lastName].filter(Boolean).join(' '),
      salutation: row.salutation,
      registrationNo: row.registrationNo,
      department: row.department,
      specialization: row.category?.name ?? null,
      superSpecialization: row.subCategory?.name ?? null,
      contact: row.phone,
      email: row.email,
      status: row.status,
      isReportSignatory: row.isReportSignatory,
    };
  }

  /**
   * Shape a validated qualification DTO into a nested-create row, stamping the
   * tenant (doctorId comes from the parent create/update).
   * @param tenantId tenant scope (set from context, never the body)
   * @param q the validated qualification
   */
  private toQualificationCreate(
    tenantId: string,
    q: DoctorQualificationDto,
  ): Prisma.DoctorQualificationCreateWithoutDoctorInput {
    return {
      tenantId,
      degree: q.degree ?? null,
      institution: q.institution ?? null,
      yearOfPassing: q.yearOfPassing ?? null,
    };
  }

  /**
   * Shape a validated experience DTO into a nested-create row, stamping the
   * tenant. `toDate` null means the engagement is current.
   * @param tenantId tenant scope (set from context, never the body)
   * @param e the validated experience
   */
  private toExperienceCreate(
    tenantId: string,
    e: DoctorExperienceDto,
  ): Prisma.DoctorExperienceCreateWithoutDoctorInput {
    return {
      tenantId,
      organisation: e.organisation ?? null,
      rolePosition: e.rolePosition ?? null,
      fromDate: this.toDate(e.fromDate),
      toDate: this.toDate(e.toDate),
    };
  }

  /**
   * Coerce a stored `signatory*Ids` JSON column into a string array. The column
   * is `Json?` (an array of ids when set, `null`/absent otherwise); anything that
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
   * @throws DuplicateRegistrationNoException
   */
  private rethrowUniqueViolation(e: unknown, registrationNo: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new DuplicateRegistrationNoException(registrationNo);
    }
  }
}
