import { Injectable } from '@nestjs/common';
import { DoctorPaymentMode, DoctorStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CategoryService } from '../category/category.service';
import { DepartmentService } from '../department/department.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { ListDoctorsDto } from './dto/list-doctors.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { DoctorExperienceDto } from './dto/doctor-experience.dto';
import { DoctorQualificationDto } from './dto/doctor-qualification.dto';
import {
  DOCTOR_DETAIL_INCLUDE,
  DOCTOR_LIST_SELECT,
  DoctorDetail,
  DoctorListItem,
  DoctorListRow,
} from './entities/doctor.entity';
import {
  DoctorNotFoundException,
  DuplicateRegistrationNoException,
} from './exceptions/doctors.exceptions';

/**
 * Doctor registry management. Tenant-scoped, tenant-level (CLAUDE.md §4.6) — the
 * registry belongs to the business as a whole, not a branch. Every query carries
 * `tenantId` (defence in depth on top of RLS, §4.3) and filters soft-deleted
 * rows. Classification ids (`departmentId`/`categoryId`) are validated against the
 * caller's tenant via the injected Department/Category services (CLAUDE.md
 * rule #3 — never import another service's file directly). Qualifications and
 * experiences are managed via the parent doctor (replace-on-update).
 */
@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentService: DepartmentService,
    private readonly categoryService: CategoryService,
  ) {}

  /**
   * Register a doctor in a tenant, with its qualifications and experiences. The
   * classification links (if supplied) are validated to be active department /
   * category rows of the same tenant first; the doctor and its children are then
   * created in one transaction.
   * @param tenantId owning tenant (from the JWT, never the body)
   * @param dto validated doctor payload
   * @returns the created doctor with its children and classification names
   * @throws DepartmentNotFoundException / CategoryNotFoundException if a supplied
   *   classification id isn't an active row of this tenant
   * @throws DuplicateRegistrationNoException if the registration number is already
   *   used by an active doctor in this tenant
   */
  async create(tenantId: string, dto: CreateDoctorDto): Promise<DoctorDetail> {
    await this.validateClassification(
      tenantId,
      dto.departmentId,
      dto.categoryId,
    );

    const data: Prisma.DoctorUncheckedCreateInput = {
      tenantId,
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
      subCategory: dto.subCategory ?? null,
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
      consultationFee: dto.consultationFee ?? 0,
      emergencyFee: dto.emergencyFee ?? 0,
      followUpFee: dto.followUpFee ?? 0,
      isAllowDiscount: dto.isAllowDiscount ?? false,
      accountHolderName: dto.accountHolderName ?? null,
      bankName: dto.bankName ?? null,
      accountNumber: dto.accountNumber ?? null,
      ifscCode: dto.ifscCode ?? null,
      paymentMode: dto.paymentMode ?? DoctorPaymentMode.BANK_TRANSFER,
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
   * name or registration number), a `departmentId` filter, and a `status` filter.
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
  async findById(id: string, tenantId: string): Promise<DoctorDetail> {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: DOCTOR_DETAIL_INCLUDE,
    });
    if (!doctor) {
      throw new DoctorNotFoundException(id);
    }
    return doctor;
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
    await this.validateClassification(
      tenantId,
      dto.departmentId,
      dto.categoryId,
    );

    const data: Prisma.DoctorUncheckedUpdateInput = {};
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
    if (dto.subCategory !== undefined) {
      data.subCategory = dto.subCategory ?? null;
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
    if (dto.consultationFee !== undefined) {
      data.consultationFee = dto.consultationFee;
    }
    if (dto.emergencyFee !== undefined) data.emergencyFee = dto.emergencyFee;
    if (dto.followUpFee !== undefined) data.followUpFee = dto.followUpFee;
    if (dto.isAllowDiscount !== undefined) {
      data.isAllowDiscount = dto.isAllowDiscount;
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
   * Soft-delete a doctor and its active qualifications/experiences (sets
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
   */
  private async validateClassification(
    tenantId: string,
    departmentId: string | undefined,
    categoryId: string | undefined,
  ): Promise<void> {
    if (departmentId) {
      await this.departmentService.findById(departmentId, tenantId);
    }
    if (categoryId) {
      await this.categoryService.findById(categoryId, tenantId);
    }
  }

  /**
   * Reshape a selected list row into the listing response: composed `name`,
   * `specialization` (category name), `superSpecialization` (free-text
   * subCategory), and `contact` (phone).
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
      superSpecialization: row.subCategory,
      contact: row.phone,
      email: row.email,
      consultationFee: row.consultationFee,
      followUpFee: row.followUpFee,
      status: row.status,
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
