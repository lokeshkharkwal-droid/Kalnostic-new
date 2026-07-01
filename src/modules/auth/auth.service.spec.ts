import { StaffStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { UsersService } from '../users/users.service';
import { TenantService } from '../tenant/tenant.service';
import { BranchService } from '../branch/branch.service';
import { AuthService } from './auth.service';
import { JwtPayload } from './types/jwt-payload.type';

/** Subset of the refresh-token create input the tests assert on. */
interface RefreshCreateArg {
  data: {
    personId: string;
    branchId: string | null;
    profileKey: string | null;
  };
}

/**
 * Unit coverage for the branch/profile switch flow. The regression guard:
 * after a switch, a subsequent token refresh must keep the SWITCHED context
 * (because switchProfile rotates the refresh token), not revert to the default.
 */
describe('AuthService — switchProfile / refresh context', () => {
  // A multi-branch user: default = branch_admin @ branch A; also doctor @ branch
  // B and a tenant-level business_admin (branchId null).
  const PROFILES = [
    {
      tenantId: 't1',
      branchId: 'branch-A',
      profileKey: 'branch_admin',
      isDefault: true,
      isActive: true,
      branchStatus: StaffStatus.ACTIVE,
    },
    {
      tenantId: 't1',
      branchId: 'branch-B',
      profileKey: 'doctor',
      isDefault: false,
      isActive: true,
      branchStatus: StaffStatus.ACTIVE,
    },
    {
      tenantId: 't1',
      branchId: null,
      profileKey: 'business_admin',
      isDefault: false,
      isActive: true,
      branchStatus: StaffStatus.ACTIVE,
    },
  ];

  const prismaMock = {
    userBranchProfile: { findFirst: jest.fn() },
    person: { findFirst: jest.fn() },
    refreshToken: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const jwtMock = { sign: jest.fn() };
  const usersServiceMock = { getPersonProfiles: jest.fn() };
  const branchServiceMock = { findById: jest.fn() };
  const configMock = { get: jest.fn((_key: string, def: unknown) => def) };

  let service: AuthService;

  /** The payload handed to the most recent jwtService.sign() call. */
  const lastSignedPayload = (): JwtPayload => {
    const calls = jwtMock.sign.mock.calls as unknown as Array<[JwtPayload]>;
    const last = calls[calls.length - 1];
    if (!last) throw new Error('jwtService.sign was not called');
    return last[0];
  };

  /** The `data` of the most recent refreshToken.create() call. */
  const lastRefreshCreateData = (): RefreshCreateArg['data'] => {
    const calls = prismaMock.refreshToken.create.mock.calls as unknown as Array<
      [RefreshCreateArg]
    >;
    const last = calls[calls.length - 1];
    if (!last) throw new Error('refreshToken.create was not called');
    return last[0].data;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwtMock.sign.mockReturnValue('signed-token');
    prismaMock.person.findFirst.mockResolvedValue({
      id: 'p1',
      isPatient: false,
      platformMrn: null,
      ownerTenantId: 't1',
    });
    usersServiceMock.getPersonProfiles.mockResolvedValue(PROFILES);
    branchServiceMock.findById.mockResolvedValue({
      name: 'A Branch',
      branchType: 'DIAGNOSTIC',
    });
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.refreshToken.update.mockResolvedValue({});

    service = new AuthService(
      prismaMock as unknown as PrismaService,
      jwtMock as unknown as JwtService,
      {} as unknown as PasswordService,
      usersServiceMock as unknown as UsersService,
      {} as unknown as TenantService,
      branchServiceMock as unknown as BranchService,
      configMock as unknown as ConfigService,
    );
  });

  it('rotates the refresh token to the switched branch and returns both tokens', async () => {
    prismaMock.userBranchProfile.findFirst.mockResolvedValue({
      id: 'a-doctor',
    });

    const result = await service.switchProfile(
      'p1',
      't1',
      { profileKey: 'doctor', branchId: 'branch-B' },
      '127.0.0.1',
    );

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    // New refresh-token row captures the SWITCHED context, not the default.
    const created = lastRefreshCreateData();
    expect(created.personId).toBe('p1');
    expect(created.branchId).toBe('branch-B');
    expect(created.profileKey).toBe('doctor');
    expect(lastSignedPayload().active_branch_id).toBe('branch-B');
    expect(lastSignedPayload().active_profile_key).toBe('doctor');
  });

  it('keeps the switched context on a subsequent refresh (regression guard)', async () => {
    // Simulate the refresh-token row that switchProfile persisted for branch B.
    prismaMock.refreshToken.findFirst.mockResolvedValue({
      id: 'r1',
      personId: 'p1',
      branchId: 'branch-B',
      profileKey: 'doctor',
      isUsed: false,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await service.refresh('raw-refresh-token', '127.0.0.1');

    // Must reflect branch B (the switched context) — NOT the default branch A.
    expect(lastSignedPayload().active_branch_id).toBe('branch-B');
    expect(lastSignedPayload().active_profile_key).toBe('doctor');
  });

  it('switches into a tenant-level profile (branchId null) e.g. business_admin', async () => {
    prismaMock.userBranchProfile.findFirst.mockResolvedValue({ id: 'a-biz' });

    const result = await service.switchProfile(
      'p1',
      't1',
      { profileKey: 'business_admin' },
      '127.0.0.1',
    );

    expect(result.refreshToken).toBeTruthy();
    const created = lastRefreshCreateData();
    expect(created.branchId).toBeNull();
    expect(created.profileKey).toBe('business_admin');
    expect(lastSignedPayload().active_branch_id).toBeNull();
    expect(lastSignedPayload().active_profile_key).toBe('business_admin');
  });

  it('rejects a switch to an assignment the user does not hold', async () => {
    prismaMock.userBranchProfile.findFirst.mockResolvedValue(null);

    await expect(
      service.switchProfile(
        'p1',
        't1',
        { profileKey: 'doctor', branchId: 'branch-X' },
        '127.0.0.1',
      ),
    ).rejects.toThrow();
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });
});
