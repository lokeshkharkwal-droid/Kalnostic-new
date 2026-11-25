import { AppointmentType } from '@prisma/client';

/** The patient identity shown in the portal header/sidebar. */
export interface PatientPortalIdentity {
  patientId: string;
  name: string;
  /** Uppercase initials for the avatar (e.g. "SK"). */
  initials: string;
  platformMrn: string | null;
  photoUrl: string | null;
  tenantId: string;
  tenantName: string;
}

/** The four home stat tiles. `balanceDue` is whole rupees (Order rollups are Int). */
export interface PatientPortalStats {
  upcomingAppointments: number;
  reportsReady: number;
  unreadMessages: number;
  balanceDue: number;
  billsCount: number;
}

/** The "Next appointment" card. */
export interface PatientPortalNextAppointment {
  orderCode: string;
  appointmentAt: string | null;
  appointmentType: AppointmentType | null;
  doctorName: string | null;
  branchName: string | null;
  reason: string | null;
  /** Appointment lifecycle status (e.g. NEW, CONFIRMED) — drives the badge. */
  status: string | null;
}

/** One "Reports ready" row. */
export interface PatientPortalReport {
  id: string;
  testName: string;
  orderCode: string | null;
  publishedAt: string | null;
}

/** One "Recent messages" row (empty until a patient inbox exists). */
export interface PatientPortalMessage {
  id: string;
  from: string;
  subject: string;
  date: string | null;
}

/** The composed home-summary payload. */
export interface PatientPortalHome {
  patient: PatientPortalIdentity;
  stats: PatientPortalStats;
  nextAppointment: PatientPortalNextAppointment | null;
  reportsReady: PatientPortalReport[];
  recentMessages: PatientPortalMessage[];
}

/** One selectable business for the lab switcher. */
export interface PatientPortalBusiness {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  shortName: string | null;
  logoUrl: string | null;
}
