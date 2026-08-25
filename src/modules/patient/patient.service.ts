import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ExternalIdFormat,
  ExternalIdPurpose,
  Gender,
  MedicalHistory,
  Patient,
  PatientDocument,
  PatientDocumentCategory,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { PtCategoryService } from '../pt-category/pt-category.service';
import { ExternalIdService } from '../registration-settings/external-id.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import {
  MedicalHistoryDto,
  RichMedicalHistoryDto,
} from './dto/medical-history.dto';
import { UpdateMedicalHistoryDto } from './dto/update-medical-history.dto';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { CreatePatientDocumentDto } from './dto/create-patient-document.dto';
import { UpdatePatientDocumentDto } from './dto/update-patient-document.dto';
import {
  FamilyMemberResult,
  FamilyMemberSummary,
  PatientWithFamily,
  PatientWithHistory,
} from './entities/patient.entity';
import {
  FamilyLinkNotFoundException,
  MedicalHistoryNotFoundException,
  PatientDocumentNotFoundException,
  PatientMobileConflictException,
  PatientNotFoundException,
  PatientUmIdConflictException,
  PatientUmIdRequiredException,
  UmIdGenerationConflictException,
} from './exceptions/patient.exceptions';

/** Max attempts to allocate a unique UMID before giving up (collision retry). */
const MAX_UMID_ATTEMPTS = 5;

/**
 * Prisma `select` for the lightweight member summary embedded in family
 * responses (kept identical between the list endpoint and the family endpoint).
 */
const FAMILY_MEMBER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  age: true,
  mobile: true,
  umId: true,
} as const;

/** Context set from the JWT for a write: registration branch + acting person. */
export interface PatientWriteContext {
  branchId: string | null;
  actorId?: string;
}

/**
 * A patient document / consent record enriched with the owning patient's
 * display name, so the UI can show a human-readable name instead of the UUID.
 */
export type PatientDocumentWithPatientName = PatientDocument & {
  patientName: string;
};

/**
 * Patient management. Tenant-scoped: every query carries `tenantId` (defence in
 * depth on top of RLS — CLAUDE.md §4.3) and filters soft-deleted rows. Patients
 * are branch-level (`branchId` records the registration branch) but remain
 * visible tenant-wide. Medical-history records hang off a patient one-to-many.
 */
@Injectable()
export class PatientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ptCategoryService: PtCategoryService,
    private readonly externalIdService: ExternalIdService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Include the patient's mapped PT Category (id + name + owning branch) so the
   * Create Order / Create Patient forms can pre-select it and confirm it belongs
   * to the active branch.
   */
  private static readonly PT_CATEGORY_INCLUDE = {
    ptCategory: { select: { id: true, categoryName: true, branchId: true } },
  } as const;

  /**
   * Validate that a PT category id belongs to the caller's active branch (throws
   * if not). Skipped when no id is given, or when there's no active branch to
   * scope against (defence in depth — the FK already guarantees tenant validity).
   * @throws PtCategoryNotFoundException if the id isn't an active category in the branch
   */
  private async validatePtCategory(
    tenantId: string,
    branchId: string | null,
    ptCategoryId?: string | null,
  ): Promise<void> {
    if (!ptCategoryId || !branchId) {
      return;
    }
    await this.ptCategoryService.findById(ptCategoryId, tenantId, branchId);
  }

  /**
   * Create a patient in the caller's tenant, optionally with one or more medical
   * -history records created atomically in the same transaction. `tenantId` and
   * the registration `branchId` come from the request context, never the body.
   * The patient's UMID follows the branch's `Patients` auto-increment format
   * (Registration Settings): when a format is set it is auto-generated as
   * `PAT`+format (globally unique, with collision auto-retry); when the format is
   * NONE — or there is no active branch — the operator must supply a `umId`
   * manually and it is stored as-is. UMID is required either way.
   * @param tenantId tenant scope (from the JWT)
   * @param dto validated patient payload (+ optional `medicalHistories`)
   * @param ctx registration branch + acting person from the JWT
   * @returns the created patient with its (newly created) medical histories
   * @throws PatientMobileConflictException if the mobile is already used by an
   *   active patient in this tenant
   * @throws PatientUmIdRequiredException if a manual UMID is required but absent
   * @throws PatientUmIdConflictException if a manual UMID is already in use
   * @throws UmIdGenerationConflictException if a unique UMID can't be allocated
   */
  async create(
    tenantId: string,
    dto: CreatePatientDto,
    ctx: PatientWriteContext,
  ): Promise<PatientWithHistory> {
    await this.validatePtCategory(tenantId, ctx.branchId, dto.ptCategoryId);
    const manualUmId = dto.umId?.trim() || null;

    // Resolve the branch's configured patient-id format. No branch → manual.
    const format = ctx.branchId
      ? await this.externalIdService.getConfiguredFormat(
          tenantId,
          ctx.branchId,
          ExternalIdPurpose.PATIENT,
        )
      : ExternalIdFormat.NONE;

    // Manual (NONE) — UMID is required and stored exactly as entered.
    if (format === ExternalIdFormat.NONE) {
      if (!manualUmId) {
        throw new PatientUmIdRequiredException();
      }
      try {
        return await this.createPatientRow(tenantId, dto, ctx, manualUmId);
      } catch (e) {
        this.rethrowPatientWriteConflict(e, dto.mobile, manualUmId);
      }
    }

    // Auto (PAT+format) — allocate a committed, globally-unique UMID and retry
    // on collision, drawing a fresh sequence each attempt (see ExternalIdService).
    const branchId = ctx.branchId!;
    for (let attempt = 0; attempt < MAX_UMID_ATTEMPTS; attempt++) {
      const { value } = await this.externalIdService.generateCommittedForBranch(
        tenantId,
        branchId,
        ExternalIdPurpose.PATIENT,
      );
      try {
        return await this.createPatientRow(tenantId, dto, ctx, value);
      } catch (e) {
        if (this.isUmIdConflict(e)) {
          continue; // collision → next allocated number
        }
        if (this.isMobileConflict(e)) {
          throw new PatientMobileConflictException(dto.mobile);
        }
        throw e;
      }
    }
    throw new UmIdGenerationConflictException(MAX_UMID_ATTEMPTS);
  }

  /**
   * Insert a patient (+ optional medical histories) with the resolved UMID, in
   * one `withTenant` transaction. Throws raw Prisma errors — the caller maps
   * unique-violation P2002s to typed conflicts (mobile vs UMID).
   */
  private async createPatientRow(
    tenantId: string,
    dto: CreatePatientDto,
    ctx: PatientWriteContext,
    umId: string | null,
  ): Promise<PatientWithHistory> {
    const { medicalHistories, dateOfBirth, ...patientFields } = dto;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const patient = await tx.patient.create({
        data: {
          ...patientFields,
          umId,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          tenantId,
          branchId: ctx.branchId,
          createdBy: ctx.actorId ?? null,
          updatedBy: ctx.actorId ?? null,
        },
        include: PatientService.PT_CATEGORY_INCLUDE,
      });

      if (medicalHistories && medicalHistories.length > 0) {
        await tx.medicalHistory.createMany({
          data: medicalHistories.map((h) => ({
            ...this.buildMedicalWriteData(h),
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
      includeFamily?: boolean;
    } = {},
  ): Promise<PaginatedResult<PatientWithFamily>> {
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
      ...(filters.includeFamily
        ? {
            include: {
              familyLinks: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
                include: { member: { select: FAMILY_MEMBER_SELECT } },
              },
            },
          }
        : {}),
    });
    const total = await this.prisma.patient.count({ where });
    if (!filters.includeFamily) {
      return { data, total, page, limit };
    }
    const withFamily: PatientWithFamily[] = data.map((p) => {
      const { familyLinks, ...patient } = p as Patient & {
        familyLinks: Array<{
          id: string;
          relationship: FamilyMemberSummary['relationship'];
          member: FamilyMemberSummary['member'];
        }>;
      };
      return {
        ...patient,
        familyMembers: familyLinks.map((l) => ({
          linkId: l.id,
          relationship: l.relationship,
          member: l.member,
        })),
      };
    });
    return { data: withFamily, total, page, limit };
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
        ...PatientService.PT_CATEGORY_INCLUDE,
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
   * @param ctx registration branch (for PT-category scoping) + acting person
   * @throws PatientNotFoundException if missing
   * @throws PatientMobileConflictException on a duplicate active mobile
   * @throws PtCategoryNotFoundException if `ptCategoryId` isn't valid for the branch
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdatePatientDto,
    ctx: PatientWriteContext = { branchId: null },
  ): Promise<Patient> {
    await this.ensurePatient(id, tenantId);
    await this.validatePtCategory(tenantId, ctx.branchId, dto.ptCategoryId);
    const { dateOfBirth, ...rest } = dto;
    const actorId = ctx.actorId;
    try {
      const updated = await this.prisma.patient.update({
        where: { id },
        data: {
          ...rest,
          ...(dateOfBirth !== undefined
            ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }
            : {}),
          updatedBy: actorId ?? null,
        },
      });
      // Fire-and-forget: confirm the profile change to the patient. Handled by
      // ClinicalEventListener (patient_profile_update).
      void this.eventEmitter.emitAsync('patient.updated', {
        tenantId,
        branchId: ctx.branchId ?? null,
        patientId: id,
      });
      return updated;
    } catch (e) {
      this.rethrowPatientWriteConflict(e, dto.mobile ?? '', dto.umId ?? null);
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
        ...this.buildMedicalWriteData(dto),
        tenantId,
        branchId: patient.branchId,
        patientId,
        createdBy: actorId ?? null,
        updatedBy: actorId ?? null,
      },
    });
  }

  /**
   * Normalise a medical-history DTO into Prisma write data: cast `richHistory`
   * to a JSON input value and, when it is present, derive the flat
   * boolean/symptom summary columns from it (see {@link deriveFlatFlags}) so any
   * legacy consumer of the flat fields stays in sync. `richHistory` is the
   * source of truth for display; the flat columns are a compatibility layer.
   * @param dto the (partial) medical-history payload
   * @returns Prisma write data without tenant/branch/patient/actor context
   */
  private buildMedicalWriteData(dto: MedicalHistoryDto) {
    const { richHistory, ...flat } = dto;
    if (richHistory === undefined) {
      return flat;
    }
    return {
      ...flat,
      ...this.deriveFlatFlags(richHistory),
      richHistory: richHistory as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Derive the flat boolean/symptom summary columns from the rich history so the
   * legacy flat fields remain a faithful (best-effort) summary. Condition,
   * allergy and smoking/alcohol matches are fuzzy (substring) because the rich
   * UI offers more options than the flat booleans capture; unmatched rich
   * entries simply live only in `richHistory`.
   * @param rich the rich, display-oriented history
   * @returns a partial of the flat boolean columns
   */
  private deriveFlatFlags(rich: RichMedicalHistoryDto) {
    const entries = rich.entries ?? {};
    const values = (cat: string, field: string): string[] =>
      (entries[cat] ?? []).map((e) => (e[field] ?? '').toLowerCase());
    const conditions = values('medical', 'condition');
    const allergies = values('allergy', 'type');
    const smoking = values('smoking', 'status');
    const alcohol = values('alcohol', 'status');
    const symptoms = new Set(rich.symptoms ?? []);
    return {
      hasDiabetes: conditions.some((c) => c.includes('diabet')),
      hasHypertension: conditions.some((c) => c.includes('hypertension')),
      hasCardiacDisease: conditions.some(
        (c) => c.includes('heart') || c.includes('cardiac'),
      ),
      hasThyroidDisease: conditions.some((c) => c.includes('thyroid')),
      hasKidneyDisease: conditions.some(
        (c) => c.includes('kidney') || c.includes('ckd'),
      ),
      hasLatexAllergy: allergies.some((a) => a.includes('latex')),
      hasFoodAllergy: allergies.some((a) => a.includes('food')),
      hasDrugAllergy: allergies.some((a) => a.includes('drug')),
      isCurrentSmoker: smoking.some((s) => s.includes('current')),
      isFormerSmoker: smoking.some((s) => s.includes('former')),
      isCurrentAlcoholic: alcohol.some((s) => s.includes('current')),
      isFormerAlcoholic: alcohol.some((s) => s.includes('former')),
      hasCough: symptoms.has('Cough'),
      hasFever: symptoms.has('Fever'),
      hasShortnessOfBreath: symptoms.has('Shortness of Breath'),
      hasChestPain: symptoms.has('Chest Pain'),
      hasAbdominalPain: symptoms.has('Abdominal Pain'),
      hasHeadache: symptoms.has('Headache'),
      hasVomiting: symptoms.has('Vomiting'),
      hasDiarrhea: symptoms.has('Diarrhea'),
      hasFatigue: symptoms.has('Fatigue'),
      hasWeightLoss: symptoms.has('Weight Loss'),
      hasBodyPains: symptoms.has('Body Pains'),
      hasDizziness: symptoms.has('Dizziness'),
    };
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
      data: { ...this.buildMedicalWriteData(dto), updatedBy: actorId ?? null },
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

  // ── Documents & consent ───────────────────────────────────────────────────────

  /**
   * Add a document / consent record to a patient. Only the `documentUrl` (e.g.
   * an AWS S3 link) is stored — never the file bytes. The record inherits the
   * patient's registration branch; tenant/patient come from the request context.
   * @param tenantId tenant scope (from the JWT)
   * @param patientId owning patient
   * @param dto validated payload
   * @param actorId acting person id (from the JWT)
   * @returns the created PatientDocument record
   * @throws PatientNotFoundException if the patient doesn't belong to the tenant
   */
  async addPatientDocument(
    tenantId: string,
    patientId: string,
    dto: CreatePatientDocumentDto,
    actorId?: string,
  ): Promise<PatientDocumentWithPatientName> {
    const patient = await this.ensurePatient(patientId, tenantId);
    const created = await this.prisma.patientDocument.create({
      data: {
        category: dto.category,
        name: dto.name,
        type: dto.type,
        documentDate: new Date(dto.documentDate),
        documentUrl: dto.documentUrl,
        tenantId,
        branchId: patient.branchId,
        patientId,
        createdBy: actorId ?? null,
        updatedBy: actorId ?? null,
      },
    });
    return this.withPatientName(created, patient);
  }

  /**
   * List a patient's active document / consent records (most recent first),
   * optionally filtered to a single category.
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @param category optional category filter (DOCUMENT / CONSENT)
   * @throws PatientNotFoundException if the patient is missing
   */
  async findPatientDocuments(
    tenantId: string,
    patientId: string,
    category?: PatientDocumentCategory,
  ): Promise<PatientDocumentWithPatientName[]> {
    const patient = await this.ensurePatient(patientId, tenantId);
    const records = await this.prisma.patientDocument.findMany({
      where: { patientId, tenantId, deletedAt: null, category },
      orderBy: { documentDate: 'desc' },
    });
    return records.map((record) => this.withPatientName(record, patient));
  }

  /**
   * Fetch one active document / consent record for a patient.
   * @param id document id
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @throws PatientDocumentNotFoundException if missing
   */
  async findPatientDocumentById(
    id: string,
    tenantId: string,
    patientId: string,
  ): Promise<PatientDocumentWithPatientName> {
    const record = await this.prisma.patientDocument.findFirst({
      where: { id, patientId, tenantId, deletedAt: null },
      include: { patient: true },
    });
    if (!record) {
      throw new PatientDocumentNotFoundException(id);
    }
    const { patient, ...document } = record;
    return this.withPatientName(document, patient);
  }

  /**
   * Update a patient's document / consent record. Only provided fields change.
   * @param id document id
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @param dto validated partial payload
   * @param actorId acting person id (from the JWT)
   * @throws PatientDocumentNotFoundException if missing
   */
  async updatePatientDocument(
    id: string,
    tenantId: string,
    patientId: string,
    dto: UpdatePatientDocumentDto,
    actorId?: string,
  ): Promise<PatientDocumentWithPatientName> {
    const existing = await this.findPatientDocumentById(
      id,
      tenantId,
      patientId,
    );
    const updated = await this.prisma.patientDocument.update({
      where: { id },
      data: {
        category: dto.category,
        name: dto.name,
        type: dto.type,
        documentDate: dto.documentDate ? new Date(dto.documentDate) : undefined,
        documentUrl: dto.documentUrl,
        updatedBy: actorId ?? null,
      },
    });
    return { ...updated, patientName: existing.patientName };
  }

  /**
   * Soft-delete a patient's document / consent record.
   * @param id document id
   * @param tenantId tenant scope
   * @param patientId owning patient
   * @throws PatientDocumentNotFoundException if missing
   */
  async removePatientDocument(
    id: string,
    tenantId: string,
    patientId: string,
  ): Promise<PatientDocument> {
    await this.findPatientDocumentById(id, tenantId, patientId);
    return this.prisma.patientDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Family members ──────────────────────────────────────────────────────────

  /**
   * Add a family member to an anchor patient. Creates a new, independent
   * `Patient` (only name/age/mobile/relationship/umId — the anchor's data is
   * never copied) and links it to the anchor via a `PatientFamilyLink`, both in
   * one transaction. The new member inherits the anchor's registration branch.
   * @param tenantId tenant scope (from the JWT)
   * @param patientId anchor patient the member is linked to
   * @param dto validated family-member payload (FE-supplied UMID)
   * @param ctx registration branch + acting person from the JWT
   * @returns the created link together with the new member patient
   * @throws PatientNotFoundException if the anchor patient is missing
   * @throws PatientMobileConflictException if the member's mobile is already used
   *   by an active patient in this tenant
   */
  async addFamilyMember(
    tenantId: string,
    patientId: string,
    dto: CreateFamilyMemberDto,
    ctx: PatientWriteContext,
  ): Promise<FamilyMemberResult> {
    const anchor = await this.ensurePatient(patientId, tenantId);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const member = await tx.patient.create({
          data: {
            firstName: dto.name,
            age: dto.age ?? null,
            mobile: dto.mobile,
            relationship: dto.relationship,
            umId: dto.umId ?? null,
            tenantId,
            branchId: anchor.branchId,
            createdBy: ctx.actorId ?? null,
            updatedBy: ctx.actorId ?? null,
          },
        });
        const link = await tx.patientFamilyLink.create({
          data: {
            tenantId,
            branchId: anchor.branchId,
            patientId,
            memberId: member.id,
            relationship: dto.relationship,
            createdBy: ctx.actorId ?? null,
            updatedBy: ctx.actorId ?? null,
          },
        });
        return { link, member };
      });
    } catch (e) {
      this.rethrowPatientWriteConflict(e, dto.mobile, dto.umId ?? null);
    }
  }

  /**
   * List an anchor patient's active family members (newest first). Each entry
   * carries the link id + relationship and a lightweight summary of the linked
   * member patient.
   * @param tenantId tenant scope
   * @param patientId anchor patient
   * @throws PatientNotFoundException if the anchor patient is missing
   */
  async findFamilyMembers(
    tenantId: string,
    patientId: string,
  ): Promise<FamilyMemberSummary[]> {
    await this.ensurePatient(patientId, tenantId);
    const links = await this.prisma.patientFamilyLink.findMany({
      where: { patientId, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { member: { select: FAMILY_MEMBER_SELECT } },
    });
    return links.map((l) => ({
      linkId: l.id,
      relationship: l.relationship,
      member: l.member,
    }));
  }

  /**
   * Unlink a family member: soft-delete the mapping row only. The member's
   * `Patient` record is left untouched (it may have its own orders / links).
   * @param tenantId tenant scope
   * @param patientId anchor patient the link must belong to
   * @param linkId the family-link id to remove
   * @throws FamilyLinkNotFoundException if the link is missing for this anchor
   */
  async removeFamilyMember(
    tenantId: string,
    patientId: string,
    linkId: string,
  ): Promise<{ id: string }> {
    const link = await this.prisma.patientFamilyLink.findFirst({
      where: { id: linkId, patientId, tenantId, deletedAt: null },
    });
    if (!link) {
      throw new FamilyLinkNotFoundException(linkId);
    }
    await this.prisma.patientFamilyLink.update({
      where: { id: linkId },
      data: { deletedAt: new Date() },
    });
    return { id: linkId };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Build a patient's human-readable display name from its identity fields
   * (salutation → first → middle → last), collapsing whitespace. Mirrors the
   * frontend's name assembly so the two never disagree.
   * @param patient the patient's identity fields
   * @returns the trimmed display name (may be empty if only blanks are set)
   */
  private buildPatientName(
    patient: Pick<
      Patient,
      'salutation' | 'firstName' | 'middleName' | 'lastName'
    >,
  ): string {
    return [
      patient.salutation,
      patient.firstName,
      patient.middleName,
      patient.lastName,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Enrich a raw document record with the owning patient's display name.
   * @param document the persisted document / consent record
   * @param patient the owning patient (for the name)
   * @returns the document with a `patientName` field appended
   */
  private withPatientName(
    document: PatientDocument,
    patient: Pick<
      Patient,
      'salutation' | 'firstName' | 'middleName' | 'lastName'
    >,
  ): PatientDocumentWithPatientName {
    return { ...document, patientName: this.buildPatientName(patient) };
  }

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

  /** Whether a P2002's `meta.target` names an index/column containing `needle`. */
  private violationTargets(e: unknown, needle: string): boolean {
    if (!this.isUniqueViolation(e)) return false;
    const target = e.meta?.target;
    if (Array.isArray(target)) {
      return target.some((t) => typeof t === 'string' && t.includes(needle));
    }
    return typeof target === 'string' && target.includes(needle);
  }

  /** True when a P2002 comes from the globally-unique patient UMID index. */
  private isUmIdConflict(e: unknown): boolean {
    return this.violationTargets(e, 'um_id');
  }

  /** True when a P2002 comes from the per-tenant active-mobile unique index. */
  private isMobileConflict(e: unknown): boolean {
    return this.violationTargets(e, 'mobile');
  }

  /**
   * Map a patient write's unique-violation (P2002) to a typed conflict — UMID vs
   * mobile — or rethrow anything else unchanged. Never returns.
   */
  private rethrowPatientWriteConflict(
    e: unknown,
    mobile: string,
    umId: string | null,
  ): never {
    if (this.isUmIdConflict(e)) {
      throw new PatientUmIdConflictException(umId ?? '');
    }
    if (this.isMobileConflict(e)) {
      throw new PatientMobileConflictException(mobile);
    }
    throw e;
  }
}
