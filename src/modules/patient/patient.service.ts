import { Injectable } from '@nestjs/common';
import { Gender, MedicalHistory, Patient, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { MedicalHistoryDto } from './dto/medical-history.dto';
import { UpdateMedicalHistoryDto } from './dto/update-medical-history.dto';
import { PatientWithHistory } from './entities/patient.entity';
import {
  MedicalHistoryNotFoundException,
  PatientMobileConflictException,
  PatientNotFoundException,
} from './exceptions/patient.exceptions';

/** Context set from the JWT for a write: registration branch + acting person. */
export interface PatientWriteContext {
  branchId: string | null;
  actorId?: string;
}

/**
 * Patient management. Tenant-scoped: every query carries `tenantId` (defence in
 * depth on top of RLS — CLAUDE.md §4.3) and filters soft-deleted rows. Patients
 * are branch-level (`branchId` records the registration branch) but remain
 * visible tenant-wide. Medical-history records hang off a patient one-to-many.
 */
@Injectable()
export class PatientService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a patient in the caller's tenant, optionally with one or more medical
   * -history records created atomically in the same transaction. `tenantId` and
   * the registration `branchId` come from the request context, never the body.
   * @param tenantId tenant scope (from the JWT)
   * @param dto validated patient payload (+ optional `medicalHistories`)
   * @param ctx registration branch + acting person from the JWT
   * @returns the created patient with its (newly created) medical histories
   * @throws PatientMobileConflictException if the mobile is already used by an
   *   active patient in this tenant
   */
  async create(
    tenantId: string,
    dto: CreatePatientDto,
    ctx: PatientWriteContext,
  ): Promise<PatientWithHistory> {
    const { medicalHistories, dateOfBirth, ...patientFields } = dto;
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const patient = await tx.patient.create({
          data: {
            ...patientFields,
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
            tenantId,
            branchId: ctx.branchId,
            createdBy: ctx.actorId ?? null,
            updatedBy: ctx.actorId ?? null,
          },
        });

        if (medicalHistories && medicalHistories.length > 0) {
          await tx.medicalHistory.createMany({
            data: medicalHistories.map((h) => ({
              ...h,
              tenantId,
              branchId: ctx.branchId,
              patientId: patient.id,
              createdBy: ctx.actorId ?? null,
              updatedBy: ctx.actorId ?? null,
            })),
          });
        }

        const histories = await tx.medicalHistory.findMany({
          where: { patientId: patient.id, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        return { ...patient, medicalHistories: histories };
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new PatientMobileConflictException(dto.mobile);
      }
      throw e;
    }
  }

  /**
   * List patients in the tenant (paginated). Visible tenant-wide with optional
   * `search` (name/mobile), `patientCategory`, `status`, `isActive`, `gender`,
   * `bloodGroup`, a registration-date range (on `createdAt`), and `branchId`.
   * @param tenantId tenant scope
   * @param page 1-based page number
   * @param limit page size
   * @param filters optional search + category/status/isActive/gender/bloodGroup
   *   + registration-date range + branch filters
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      patientCategory?: Patient['patientCategory'];
      status?: Patient['status'];
      isActive?: boolean;
      gender?: Patient['gender'];
      bloodGroup?: Patient['bloodGroup'];
      dateFrom?: string;
      dateTo?: string;
      branchId?: string;
    } = {},
  ): Promise<PaginatedResult<Patient>> {
    const where: Prisma.PatientWhereInput = { tenantId, deletedAt: null };
    if (filters.patientCategory) {
      where.patientCategory = filters.patientCategory;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters.gender) {
      where.gender = filters.gender;
    }
    if (filters.bloodGroup) {
      where.bloodGroup = filters.bloodGroup;
    }
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { middleName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search, mode: 'insensitive' } },
      ];
    }
    const data = await this.prisma.patient.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.patient.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Aggregate patient counts for the dashboard summary cards. Scoped to the
   * caller's tenant (RLS + explicit `tenantId`) and, when provided, the active
   * branch; excludes soft-deleted rows. "Active" means `isActive = true`.
   * @param tenantId tenant scope (from the JWT)
   * @param branchId optional active-branch scope (from the JWT profile)
   * @returns totals: all / active / male / female patients
   */
  async getStats(
    tenantId: string,
    branchId?: string | null,
  ): Promise<{
    totalPatients: number;
    totalActivePatients: number;
    totalMalePatients: number;
    totalFemalePatients: number;
  }> {
    const base: Prisma.PatientWhereInput = { tenantId, deletedAt: null };
    if (branchId) base.branchId = branchId;

    const [
      totalPatients,
      totalActivePatients,
      totalMalePatients,
      totalFemalePatients,
    ] = await Promise.all([
      this.prisma.patient.count({ where: base }),
      this.prisma.patient.count({ where: { ...base, isActive: true } }),
      this.prisma.patient.count({ where: { ...base, gender: Gender.MALE } }),
      this.prisma.patient.count({
        where: { ...base, gender: Gender.FEMALE },
      }),
    ]);
    return {
      totalPatients,
      totalActivePatients,
      totalMalePatients,
      totalFemalePatients,
    };
  }

  /**
   * Fetch one active patient scoped to its tenant, including its active
   * (non-deleted) medical-history records.
   * @param id patient id
   * @param tenantId tenant scope
   * @throws PatientNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<PatientWithHistory> {
    const patient = await this.prisma.patient.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        medicalHistories: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!patient) {
      throw new PatientNotFoundException(id);
    }
    return patient;
  }

  /**
   * Update a patient's details. Only the provided fields are changed;
   * medical-history records are managed via their own endpoints.
   * @param id patient id
   * @param tenantId tenant scope
   * @param dto validated partial patient payload
   * @param actorId acting person id (from the JWT)
   * @throws PatientNotFoundException if missing
   * @throws PatientMobileConflictException on a duplicate active mobile
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdatePatientDto,
    actorId?: string,
  ): Promise<Patient> {
    await this.ensurePatient(id, tenantId);
    const { dateOfBirth, ...rest } = dto;
    try {
      return await this.prisma.patient.update({
        where: { id },
        data: {
          ...rest,
          ...(dateOfBirth !== undefined
            ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }
            : {}),
          updatedBy: actorId ?? null,
        },
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new PatientMobileConflictException(dto.mobile ?? '');
      }
      throw e;
    }
  }

  /**
   * Soft-delete a patient and cascade the soft-delete to its medical-history
   * records, atomically.
   * @param id patient id
   * @param tenantId tenant scope
   * @throws PatientNotFoundException if missing
   */
  async remove(id: string, tenantId: string): Promise<Patient> {
    await this.ensurePatient(id, tenantId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.medicalHistory.updateMany({
        where: { patientId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.patient.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  // ── Medical history ─────────────────────────────────────────────────────────

  /**
   * Add a medical-history record to a patient. The medical history inherits the
   * patient's registration branch.
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @param dto validated medical-history payload
   * @param actorId acting person id (from the JWT)
   * @throws PatientNotFoundException if the patient is missing
   */
  async addMedicalHistory(
    tenantId: string,
    patientId: string,
    dto: MedicalHistoryDto,
    actorId?: string,
  ): Promise<MedicalHistory> {
    const patient = await this.ensurePatient(patientId, tenantId);
    return this.prisma.medicalHistory.create({
      data: {
        ...dto,
        tenantId,
        branchId: patient.branchId,
        patientId,
        createdBy: actorId ?? null,
        updatedBy: actorId ?? null,
      },
    });
  }

  /**
   * List a patient's active medical-history records (most recent first).
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @throws PatientNotFoundException if the patient is missing
   */
  async findMedicalHistories(
    tenantId: string,
    patientId: string,
  ): Promise<MedicalHistory[]> {
    await this.ensurePatient(patientId, tenantId);
    return this.prisma.medicalHistory.findMany({
      where: { patientId, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Fetch one active medical-history record for a patient.
   * @param id medical-history id
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @throws MedicalHistoryNotFoundException if missing
   */
  async findMedicalHistoryById(
    id: string,
    tenantId: string,
    patientId: string,
  ): Promise<MedicalHistory> {
    const record = await this.prisma.medicalHistory.findFirst({
      where: { id, patientId, tenantId, deletedAt: null },
    });
    if (!record) {
      throw new MedicalHistoryNotFoundException(id);
    }
    return record;
  }

  /**
   * Update a patient's medical-history record. Only provided fields change.
   * @param id medical-history id
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @param dto validated partial payload
   * @param actorId acting person id (from the JWT)
   * @throws MedicalHistoryNotFoundException if missing
   */
  async updateMedicalHistory(
    id: string,
    tenantId: string,
    patientId: string,
    dto: UpdateMedicalHistoryDto,
    actorId?: string,
  ): Promise<MedicalHistory> {
    await this.findMedicalHistoryById(id, tenantId, patientId);
    return this.prisma.medicalHistory.update({
      where: { id },
      data: { ...dto, updatedBy: actorId ?? null },
    });
  }

  /**
   * Soft-delete a patient's medical-history record.
   * @param id medical-history id
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @throws MedicalHistoryNotFoundException if missing
   */
  async removeMedicalHistory(
    id: string,
    tenantId: string,
    patientId: string,
  ): Promise<MedicalHistory> {
    await this.findMedicalHistoryById(id, tenantId, patientId);
    return this.prisma.medicalHistory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Assert a patient exists (active) in the tenant and return it. Used to guard
   * updates/deletes and medical-history operations.
   */
  private async ensurePatient(id: string, tenantId: string): Promise<Patient> {
    const patient = await this.prisma.patient.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!patient) {
      throw new PatientNotFoundException(id);
    }
    return patient;
  }

  /** True when the error is a Prisma unique-constraint violation (P2002). */
  private isUniqueViolation(
    e: unknown,
  ): e is Prisma.PrismaClientKnownRequestError {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }
}
