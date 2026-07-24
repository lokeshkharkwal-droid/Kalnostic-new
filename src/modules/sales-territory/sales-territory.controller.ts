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
import { SalesTerritoryService } from './sales-territory.service';
import { CreateSalesTerritoryDto } from './dto/create-sales-territory.dto';
import { UpdateSalesTerritoryDto } from './dto/update-sales-territory.dto';
import { ListSalesTerritoriesDto } from './dto/list-sales-territories.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from './exceptions/sales-territory.exceptions';

/**
 * Sales territory / zone master (branch-scoped). Business-authenticated; tenant +
 * active branch come from the JWT (CLAUDE.md §4.7). Powers the "Territory / Zone"
 * dropdown + filter on Business Leads.
 */
@Controller('sales/territories')
export class SalesTerritoryController {
  constructor(private readonly territoryService: SalesTerritoryService) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** List the active branch's territories (paginated + search + status). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListSalesTerritoriesDto,
  ) {
    return this.territoryService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /** Active `{ id, name }` options for the Territory/Zone dropdown. */
  @Get('options')
  options(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.territoryService.options(tenantId, this.requireBranch(profile));
  }

  /** Fetch one territory by id. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.territoryService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Create a territory at the active branch. */
  @Post()
  @Audit({
    module: AuditModule.SALES_TERRITORY,
    action: AuditAction.CREATE,
    description: 'Created a sales territory',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateSalesTerritoryDto,
  ) {
    return this.territoryService.create(
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Update a territory. */
  @Patch(':id')
  @Audit({
    module: AuditModule.SALES_TERRITORY,
    action: AuditAction.UPDATE,
    description: 'Updated a sales territory',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSalesTerritoryDto,
  ) {
    return this.territoryService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Soft-delete a territory. */
  @Delete(':id')
  @Audit({
    module: AuditModule.SALES_TERRITORY,
    action: AuditAction.DELETE,
    description: 'Deleted a sales territory',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.territoryService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
