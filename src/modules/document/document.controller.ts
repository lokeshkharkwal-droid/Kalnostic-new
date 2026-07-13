import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { DocumentService } from './document.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { DocumentSummaryQueryDto } from './dto/document-summary-query.dto';
import { DocumentVersionsQueryDto } from './dto/document-versions-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Document endpoints (business-authenticated). Tenant comes from the JWT; the
 * branch comes from the active profile (`active_branch_id`) and may be null.
 * Documents are tenant-scoped and either **branch-level** (Branch Admin, scoped
 * to the active branch) or **tenant-level** (Business Admin, which has no active
 * branch → `branchId` null). The global `JwtAuthGuard` protects all routes.
 * Version history is read-only — there is no endpoint to edit or delete an
 * individual version.
 */
@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /**
   * Create a document in the caller's scope (seeds version 1). Branch Admin →
   * the active branch; Business Admin → tenant-level (`branchId` null).
   */
  @Post()
  @Audit({
    module: AuditModule.DOCUMENT,
    action: AuditAction.CREATE,
    description: 'Created a document',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') actorId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documentService.create(
      tenantId,
      profile.branchId,
      dto,
      actorId,
    );
  }

  /**
   * List documents (paginated, with filters). Branch scope follows the optional
   * `branchId` query param: present → that branch only (Branch Admin, verified
   * to belong to the tenant); absent → all branches of the tenant (Business
   * Admin). Tenant isolation is always enforced.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListDocumentsQueryDto,
  ) {
    return this.documentService.findAll(tenantId, query);
  }

  /**
   * Exact document count per status for the caller's scope, computed in the
   * database. Declared before `:id` so this static path is not captured by the
   * param route. Branch scope follows the optional `branchId` query param
   * (present → that branch; absent → all branches of the tenant).
   */
  @Get('status-summary')
  getStatusSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: DocumentSummaryQueryDto,
  ) {
    return this.documentService.getStatusSummary(tenantId, query.branchId);
  }

  /**
   * Fetch one document (current version) by id. Scoped to the optional
   * `branchId` when supplied, otherwise tenant-wide.
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.documentService.findById(id, tenantId, branchId);
  }

  /**
   * List the complete, read-only version history of a document (newest first).
   * Scoped to the optional `branchId` when supplied, otherwise tenant-wide.
   */
  @Get(':id/versions')
  findVersions(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query() query: DocumentVersionsQueryDto,
  ) {
    return this.documentService.findVersions(
      id,
      tenantId,
      query.branchId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Fetch a single read-only version snapshot of a document. Scoped to the
   * optional `branchId` when supplied, otherwise tenant-wide.
   */
  @Get(':id/versions/:versionId')
  findVersion(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.documentService.findVersionById(
      id,
      versionId,
      tenantId,
      branchId,
    );
  }

  /**
   * Edit a document — creates a new preserved version on every edit.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.DOCUMENT,
    action: AuditAction.UPDATE,
    description: 'Edited a document (new version)',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documentService.update(
      id,
      tenantId,
      profile.branchId,
      dto,
      actorId,
    );
  }

  /**
   * Soft-delete a document (version history is preserved).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.DOCUMENT,
    action: AuditAction.DELETE,
    description: 'Deleted a document',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') actorId: string,
    @Param('id') id: string,
  ) {
    return this.documentService.remove(id, tenantId, profile.branchId, actorId);
  }
}
