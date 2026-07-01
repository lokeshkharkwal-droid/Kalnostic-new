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
import { BranchContextRequiredException } from './exceptions/document.exceptions';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Document endpoints (business-authenticated). Tenant comes from the JWT and the
 * branch from the active profile (`active_branch_id`); both are branch-level, so
 * the JWT must carry an active branch. The global `JwtAuthGuard` protects all
 * routes. Version history is read-only — there is no endpoint to edit or delete
 * an individual version.
 */
@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /** Resolve the active branch from the JWT or reject the request. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new BranchContextRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Create a document in the caller's active branch (seeds version 1).
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
      this.requireBranch(profile),
      dto,
      actorId,
    );
  }

  /**
   * List documents in the caller's active branch (paginated, with filters).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListDocumentsQueryDto,
  ) {
    return this.documentService.findAllForBranch(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /**
   * Fetch one document (current version) by id.
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.documentService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /**
   * List the complete, read-only version history of a document (newest first).
   */
  @Get(':id/versions')
  findVersions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.documentService.findVersions(
      id,
      tenantId,
      this.requireBranch(profile),
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Fetch a single read-only version snapshot of a document.
   */
  @Get(':id/versions/:versionId')
  findVersion(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.documentService.findVersionById(
      id,
      versionId,
      tenantId,
      this.requireBranch(profile),
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
      this.requireBranch(profile),
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
    return this.documentService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
      actorId,
    );
  }
}
