import { Injectable } from '@nestjs/common';
import { AuthRole, BranchType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { InternalException } from '../../common/exceptions/kaltros.exception';
import { CreateAuthRoleDto } from './dto/create-auth-role.dto';
import { UpdateAuthRoleDto } from './dto/update-auth-role.dto';
import {
  RoleInUseException,
  RoleNameConflictException,
  RoleNotFoundException,
  SystemRoleImmutableException,
} from './exceptions/auth-role.exceptions';

/**
 * Role management. Roles come in two scopes (CLAUDE.md §4.2 template pattern):
 *  - **System roles** (`tenantId = null`, `isSystem = true`) are seeded from
 *    PROFILE_REGISTRY, shared by every tenant, and immutable (name/key/branch
 *    matrix fixed in code — only `description`/`isActive` may be edited).
 *  - **Custom roles** (`tenantId` set) are defined by a tenant through this CRUD.
 *
 * Reads always surface the caller's own custom roles plus the global system
 * roles; the RLS policy in prisma/rls.sql permits the NULL-tenant reads. `key`
 * is the stable identifier carried in the JWT and is never client-supplied.
 */
@Injectable()
export class AuthRoleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a custom role in a tenant. `key` is system-generated (a deduplicated
   * slug of the name) and immutable. An empty `allowedBranchTypes` yields a
   * tenant-level role.
   * @param tenantId owning tenant (from the JWT, never the body)
   * @param dto validated role payload
   * @returns the created role
   * @throws RoleNameConflictException if the name clashes with an existing role
   */
  async create(tenantId: string, dto: CreateAuthRoleDto): Promise<AuthRole> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const key = await this.generateUniqueKey(tx, tenantId, dto.name);
        return tx.authRole.create({
          data: {
            tenantId,
            key,
            name: dto.name,
            description: dto.description ?? null,
            allowedBranchTypes: dto.allowedBranchTypes ?? [],
            isSystem: false,
            isActive: dto.isActive ?? true,
          },
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name);
      throw e;
    }
  }

  /**
   * List roles visible to a tenant — its own custom roles plus the global system
   * roles (offset pagination).
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (name/key), an
   *   active/inactive `status`, and a `scope` (`SYSTEM`/`CUSTOM`) narrow
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      scope?: 'SYSTEM' | 'CUSTOM';
    } = {},
  ): Promise<PaginatedResult<AuthRole>> {
    const where: Prisma.AuthRoleWhereInput = { deletedAt: null };
    const and: Prisma.AuthRoleWhereInput[] = [];

    if (filters.scope === 'SYSTEM') {
      where.tenantId = null;
    } else if (filters.scope === 'CUSTOM') {
      where.tenantId = tenantId;
    } else {
      and.push({ OR: [{ tenantId }, { tenantId: null }] });
    }

    const search = filters.search?.trim();
    if (search) {
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { key: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    if (and.length > 0) {
      where.AND = and;
    }

    const data = await this.prisma.authRole.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      // System roles first, then custom, each newest-first — a stable ordering
      // for the role dropdown.
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
    });
    const total = await this.prisma.authRole.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one role visible to a tenant (its own custom role or a system role).
   * @param tenantId tenant scope
   * @param id role id
   * @throws RoleNotFoundException if missing/soft-deleted/out of scope
   */
  async findById(tenantId: string, id: string): Promise<AuthRole> {
    const role = await this.prisma.authRole.findFirst({
      where: { id, deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
    });
    if (!role) {
      throw new RoleNotFoundException(id);
    }
    return role;
  }

  /**
   * Update a role. System roles accept only `description`/`isActive`; any attempt
   * to change their `name` or `allowedBranchTypes` is rejected. `key` is never
   * editable.
   * @param tenantId tenant scope
   * @param id role id
   * @param dto partial update
   * @throws RoleNotFoundException if missing/out of scope
   * @throws SystemRoleImmutableException on a forbidden system-role change
   * @throws RoleNameConflictException on a name collision
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateAuthRoleDto,
  ): Promise<AuthRole> {
    const role = await this.findById(tenantId, id);

    if (role.isSystem) {
      const renaming = dto.name !== undefined && dto.name !== role.name;
      if (renaming || dto.allowedBranchTypes !== undefined) {
        throw new SystemRoleImmutableException(role.key);
      }
      const data: Prisma.AuthRoleUpdateInput = {};
      if (dto.description !== undefined)
        data.description = dto.description ?? null;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      return this.prisma.authRole.update({ where: { id }, data });
    }

    // Custom role — must belong to the caller (system roles handled above; a
    // custom role of another tenant is invisible via RLS/findById).
    if (role.tenantId !== tenantId) {
      throw new RoleNotFoundException(id);
    }
    const data: Prisma.AuthRoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.allowedBranchTypes !== undefined) {
      data.allowedBranchTypes = dto.allowedBranchTypes;
    }
    try {
      return await this.prisma.authRole.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a custom role. System roles cannot be deleted, and a custom role
   * still assigned to active users is refused (unassign first).
   * @param tenantId tenant scope
   * @param id role id
   * @throws RoleNotFoundException if missing/out of scope
   * @throws SystemRoleImmutableException if the role is a system role
   * @throws RoleInUseException if the role is still assigned to active users
   */
  async remove(tenantId: string, id: string): Promise<AuthRole> {
    const role = await this.findById(tenantId, id);
    if (role.isSystem) {
      throw new SystemRoleImmutableException(role.key);
    }
    if (role.tenantId !== tenantId) {
      throw new RoleNotFoundException(id);
    }
    const assignments = await this.prisma.userBranchProfile.count({
      where: { authRoleId: id, deletedAt: null, isActive: true },
    });
    if (assignments > 0) {
      throw new RoleInUseException(id, assignments);
    }
    return this.prisma.authRole.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Helpers for other modules (rule #3: injected, never file-imported) ───────

  /**
   * Resolve a role by its stable `key` for the caller's tenant, preferring a
   * tenant-owned custom role over a global system role of the same key. Used when
   * a role is chosen by key (create/update user, branch assignment).
   * @param tenantId tenant scope
   * @param key the role key
   * @throws RoleNotFoundException if no such active role exists in scope
   */
  async resolveByKey(tenantId: string, key: string): Promise<AuthRole> {
    const own = await this.prisma.authRole.findFirst({
      where: { key, tenantId, deletedAt: null },
    });
    if (own) {
      return own;
    }
    const system = await this.prisma.authRole.findFirst({
      where: { key, tenantId: null, deletedAt: null },
    });
    if (system) {
      return system;
    }
    throw new RoleNotFoundException(key);
  }

  /**
   * Resolve a global system role by key. Used by tenant creation to attach the
   * initial admin's `business_admin` role.
   * @param key the system role key (e.g. `business_admin`)
   * @throws InternalException if the system role is missing (seed not run)
   */
  async getSystemRoleByKey(key: string): Promise<AuthRole> {
    const role = await this.prisma.authRole.findFirst({
      where: { key, tenantId: null, isSystem: true, deletedAt: null },
    });
    if (!role) {
      // System roles are guaranteed by `pnpm prisma db seed`; a miss means the
      // seed has not been run against this database.
      throw new InternalException('auth-role-missing-system-role', { key });
    }
    return role;
  }

  // ── Global (SiteAdmin) role management ───────────────────────────────────────
  // Operate on the shared catalogue (tenant_id NULL): the 24 seeded built-ins
  // (isSystem) plus SiteAdmin-created global roles. These run GUC-less on the base
  // client — a SiteAdmin connection has no tenant context, and the auth_roles RLS
  // permits NULL-tenant reads/writes then (mirrors DepartmentService.createTemplate).

  /**
   * Create a new global role (tenant_id NULL, `isSystem = false`, fully editable),
   * available to every tenant. `key` is a generated slug, unique among global roles.
   * @param dto validated role payload
   * @throws RoleNameConflictException if the name/key clashes with a global role
   */
  async createGlobal(dto: CreateAuthRoleDto): Promise<AuthRole> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const key = await this.generateUniqueKey(tx, null, dto.name);
        return tx.authRole.create({
          data: {
            tenantId: null,
            key,
            name: dto.name,
            description: dto.description ?? null,
            allowedBranchTypes: dto.allowedBranchTypes ?? [],
            isSystem: false,
            isActive: dto.isActive ?? true,
          },
        });
      });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name);
      throw e;
    }
  }

  /**
   * List the global role catalogue (built-ins first, then custom), paginated.
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive `search` (name/key) + `status`
   */
  async findAllGlobal(
    page = 1,
    limit = 20,
    filters: { search?: string; status?: 'ACTIVE' | 'INACTIVE' } = {},
  ): Promise<PaginatedResult<AuthRole>> {
    const where: Prisma.AuthRoleWhereInput = {
      tenantId: null,
      deletedAt: null,
    };
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filters.status) {
      where.isActive = filters.status === 'ACTIVE';
    }
    const data = await this.prisma.authRole.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
    });
    const total = await this.prisma.authRole.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one global role by id.
   * @throws RoleNotFoundException if missing/soft-deleted/not global
   */
  async findGlobalById(id: string): Promise<AuthRole> {
    const role = await this.prisma.authRole.findFirst({
      where: { id, tenantId: null, deletedAt: null },
    });
    if (!role) {
      throw new RoleNotFoundException(id);
    }
    return role;
  }

  /**
   * Update a global role. Built-in (system) roles accept only
   * `description`/`isActive` — any `name`/`allowedBranchTypes` change is rejected;
   * SiteAdmin-created global roles are fully editable.
   * @throws RoleNotFoundException / SystemRoleImmutableException / RoleNameConflictException
   */
  async updateGlobal(id: string, dto: UpdateAuthRoleDto): Promise<AuthRole> {
    const role = await this.findGlobalById(id);

    if (role.isSystem) {
      const renaming = dto.name !== undefined && dto.name !== role.name;
      if (renaming || dto.allowedBranchTypes !== undefined) {
        throw new SystemRoleImmutableException(role.key);
      }
      const data: Prisma.AuthRoleUpdateInput = {};
      if (dto.description !== undefined)
        data.description = dto.description ?? null;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      return this.prisma.authRole.update({ where: { id }, data });
    }

    const data: Prisma.AuthRoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.allowedBranchTypes !== undefined) {
      data.allowedBranchTypes = dto.allowedBranchTypes;
    }
    try {
      return await this.prisma.authRole.update({ where: { id }, data });
    } catch (e) {
      this.rethrowUniqueViolation(e, dto.name ?? '');
      throw e;
    }
  }

  /**
   * Whether a role may be assigned at a branch of the given type. System roles
   * derive validity from PROFILE_BRANCH_MATRIX (code) via their `key`; custom
   * roles use their stored `allowedBranchTypes`. An empty allow-list means the
   * role is tenant-level (no branch).
   * @param role the resolved role
   * @param branchType the target branch's type
   * @param systemMatrixLookup validity check for a system role key (injected to
   *   avoid importing the permissions constants here)
   */
  isRoleValidForBranch(
    role: AuthRole,
    branchType: BranchType,
    systemMatrixLookup: (key: string, branchType: BranchType) => boolean,
  ): boolean {
    if (role.isSystem) {
      return systemMatrixLookup(role.key, branchType);
    }
    return role.allowedBranchTypes.includes(branchType);
  }

  /**
   * Build a unique, immutable role `key` from a name: a lowercase underscore slug,
   * suffixed (`_2`, `_3`, …) if it collides with an existing system or tenant key.
   * @param tx active tenant transaction client
   * @param tenantId tenant scope
   * @param name the role name to slugify
   */
  private async generateUniqueKey(
    tx: Prisma.TransactionClient,
    tenantId: string | null,
    name: string,
  ): Promise<string> {
    const base =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'role';
    let candidate = base;
    let n = 2;
    while (
      await tx.authRole.findFirst({
        where: {
          key: candidate,
          deletedAt: null,
          OR: [{ tenantId }, { tenantId: null }],
        },
        select: { id: true },
      })
    ) {
      candidate = `${base}_${n}`;
      n += 1;
    }
    return candidate;
  }

  /**
   * If the caught error is a Prisma unique violation (P2002 — the name/key
   * partial unique indexes in rls.sql), throw a typed 409. Returns normally
   * otherwise so the caller can rethrow.
   * @param e the caught error
   * @param name the attempted name (for the conflict's context)
   */
  private rethrowUniqueViolation(e: unknown, name: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new RoleNameConflictException(name);
    }
  }
}
