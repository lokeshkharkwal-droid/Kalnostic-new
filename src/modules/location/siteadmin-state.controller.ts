import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StateService } from './state.service';
import { CreateStateDto } from './dto/create-state.dto';
import { UpdateStateDto } from './dto/update-state.dto';
import { ListStateQueryDto } from './dto/list-state-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin state management (`/siteadmin/locations/states`). Global reference
 * data; a state's parent `countryId` is validated in the service. Auth mirrors
 * `SiteAdminCountryController` (SiteAdmin token, master-data read/write).
 */
@Controller('siteadmin/locations/states')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminStateController {
  constructor(private readonly stateService: StateService) {}

  /** Create a state under a country (404 if the country is unknown). */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(@Body() dto: CreateStateDto) {
    return this.stateService.create(dto);
  }

  /** List states (paginated; search + countryId + isActive filters). */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListStateQueryDto) {
    return this.stateService.findAll(query.page ?? 1, query.limit ?? 20, {
      search: query.search,
      countryId: query.countryId,
      isActive: query.isActive,
    });
  }

  /** Fetch one state. */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.stateService.findById(id);
  }

  /** Update a state. */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateStateDto) {
    return this.stateService.update(id, dto);
  }

  /** Soft-delete a state (blocked while it still has active cities). */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.stateService.remove(id);
  }
}
