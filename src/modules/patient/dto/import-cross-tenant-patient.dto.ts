import { IsUUID } from 'class-validator';

/**
 * Body for `POST /patients/import-from-person`. References the shared
 * platform-level `Person` (surfaced by `GET /patients/cross-tenant-lookup`) to
 * reuse in the caller's tenant. The server re-derives every identity field from
 * the `Person`; the client supplies only the id.
 */
export class ImportCrossTenantPatientDto {
  @IsUUID('4')
  personId: string;
}
