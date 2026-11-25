import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PatientViewablePatient } from './entities/patient-lab-order.entity';
import { composePatientName } from './utils/compose-patient-name.util';

/**
 * Decides WHICH patient records a portal session may look at. Every patient
 * portal list/detail/PDF read derives its patient filter from here, so the rule
 * lives in one place:
 *
 * - the logged-in person's own patient row(s) in the session's tenant, plus
 * - the family members linked to those rows through `PatientFamilyLink`
 *   (a family member is a patient row with no login of its own, so only the
 *   head — the anchor of the link — can see them).
 *
 * The scope always comes from the token (tenant + person), never from the
 * request: a client-supplied patient id may only NARROW it.
 */
@Injectable()
export class PatientScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The patients this session may view, the person's own record(s) first.
   * @param tenantId active tenant (from the patient JWT)
   * @param personId the authenticated platform person (from the patient JWT)
   * @returns self row(s) followed by linked family members
   */
  async getViewablePatients(
    tenantId: string,
    personId: string,
  ): Promise<PatientViewablePatient[]> {
    const own = await this.prisma.patient.findMany({
      where: { tenantId, personId, deletedAt: null },
      select: {
        id: true,
        salutation: true,
        firstName: true,
        middleName: true,
        lastName: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const ownIds = own.map((p) => p.id);
    if (ownIds.length === 0) {
      return [];
    }

    const links = await this.prisma.patientFamilyLink.findMany({
      where: { tenantId, patientId: { in: ownIds }, deletedAt: null },
      select: { memberId: true, relationship: true },
      orderBy: { createdAt: 'asc' },
    });
    const relationshipByMember = new Map<string, string>();
    for (const link of links) {
      if (!relationshipByMember.has(link.memberId)) {
        relationshipByMember.set(link.memberId, link.relationship);
      }
    }

    const memberIds = [...relationshipByMember.keys()].filter(
      (id) => !ownIds.includes(id),
    );
    const members =
      memberIds.length === 0
        ? []
        : await this.prisma.patient.findMany({
            where: { id: { in: memberIds }, tenantId, deletedAt: null },
            select: {
              id: true,
              salutation: true,
              firstName: true,
              middleName: true,
              lastName: true,
            },
            orderBy: { createdAt: 'asc' },
          });

    return [
      ...own.map((p) => ({
        patientId: p.id,
        name: composePatientName(p),
        relationship: 'SELF',
        isSelf: true,
      })),
      ...members.map((p) => ({
        patientId: p.id,
        name: composePatientName(p),
        relationship: relationshipByMember.get(p.id) ?? 'OTHER',
        isSelf: false,
      })),
    ];
  }

  /**
   * The patient ids a read may cover. When the client asks for one patient the
   * result is the INTERSECTION with the viewable ids — an id outside the scope
   * gives an empty list, never somebody else's records.
   * @param tenantId active tenant (from the patient JWT)
   * @param personId the authenticated platform person (from the patient JWT)
   * @param requestedPatientId optional narrowing id from the query string
   * @returns the allowed patient ids (possibly empty)
   */
  async resolveScopedPatientIds(
    tenantId: string,
    personId: string,
    requestedPatientId?: string,
  ): Promise<string[]> {
    const viewable = await this.getViewablePatients(tenantId, personId);
    const ids = viewable.map((p) => p.patientId);
    return requestedPatientId
      ? ids.filter((id) => id === requestedPatientId)
      : ids;
  }
}
