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
import { SalesFollowUpService } from './sales-follow-up.service';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import { UpdateFollowUpStatusDto } from './dto/update-follow-up-status.dto';
import { ListFollowUpsDto } from './dto/list-follow-ups.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from './exceptions/sales-follow-up.exceptions';

/**
 * Sales follow-up endpoints (business-authenticated; tenant + active branch come
 * from the JWT). Powers the Sales → Follow-ups queue (list, detail, create,
 * update, status transitions).
 */
@Controller('sales/follow-ups')
export class SalesFollowUpController {
  constructor(private readonly followUpService: SalesFollowUpService) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** List the active branch's follow-ups (paginated + filters). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListFollowUpsDto,
  ) {
    return this.followUpService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /** Fetch one follow-up (with status history). */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.followUpService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Create a follow-up at the active branch. */
  @Post()
  @Audit({
    module: AuditModule.SALES_FOLLOW_UP,
    action: AuditAction.CREATE,
    description: 'Created a sales follow-up',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateFollowUpDto,
  ) {
    return this.followUpService.create(
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Update a follow-up's own fields. */
  @Patch(':id')
  @Audit({
    module: AuditModule.SALES_FOLLOW_UP,
    action: AuditAction.UPDATE,
    description: 'Updated a sales follow-up',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpDto,
  ) {
    return this.followUpService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Transition a follow-up's status (recorded in history). */
  @Patch(':id/status')
  @Audit({
    module: AuditModule.SALES_FOLLOW_UP,
    action: AuditAction.UPDATE,
    description: 'Updated a sales follow-up status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFollowUpStatusDto,
  ) {
    return this.followUpService.updateStatus(
      id,
      tenantId,
      this.requireBranch(profile),
      dto.status,
      dto.remarks,
      personId,
    );
  }

  /** Soft-delete a follow-up. */
  @Delete(':id')
  @Audit({
    module: AuditModule.SALES_FOLLOW_UP,
    action: AuditAction.DELETE,
    description: 'Deleted a sales follow-up',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.followUpService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }
}
