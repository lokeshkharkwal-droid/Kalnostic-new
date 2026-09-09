import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  assertPanelHasBranch,
  assertNoExistingB2bUser,
  ReferralPanelUserService,
} from './referral-panel-user.service';
import {
  ConflictException,
  NotFoundException,
} from '../../common/exceptions/kaltros.exception';

describe('referral-panel-user guards', () => {
  it('rejects a panel without a branch', () => {
    expect(() => assertPanelHasBranch({ id: 'p1', branchId: null })).toThrow(
      ConflictException,
    );
  });

  it('accepts a panel with a branch', () => {
    expect(() =>
      assertPanelHasBranch({ id: 'p1', branchId: 'b1' }),
    ).not.toThrow();
  });

  it('rejects when a b2b user already exists for the panel', () => {
    expect(() =>
      assertNoExistingB2bUser('p1', { id: 'existing' }),
    ).toThrow(ConflictException);
  });

  it('accepts when no b2b user exists yet', () => {
    expect(() => assertNoExistingB2bUser('p1', null)).not.toThrow();
  });
});

/**
 * Unit coverage for `update` — the regression guard: it must delegate to
 * `UsersService.updateUser` with ONLY the six basic-profile fields (never
 * `roleKey`/`status`/`userType`, so branch/role assignment is never touched),
 * and handle `email` as a separate, additive direct-Prisma update (since
 * `UpdateUserDto` deliberately excludes email for every other user type).
 */
describe('ReferralPanelUserService.update', () => {
  const prismaMock = {
    referralPanel: { findFirst: jest.fn() },
    userBranchProfile: { findFirst: jest.fn() },
    person: { update: jest.fn() },
  };
  const usersServiceMock = { updateUser: jest.fn() };

  let service: ReferralPanelUserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReferralPanelUserService(
      prismaMock as unknown as PrismaService,
      usersServiceMock as unknown as UsersService,
    );
    prismaMock.referralPanel.findFirst.mockResolvedValue({ id: 'panel-1' });
    prismaMock.userBranchProfile.findFirst.mockResolvedValue({
      personId: 'person-1',
    });
    usersServiceMock.updateUser.mockResolvedValue({});
  });

  it('404s when the panel does not exist', async () => {
    prismaMock.referralPanel.findFirst.mockResolvedValue(null);
    await expect(
      service.update('t1', 'panel-1', {}, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
    expect(usersServiceMock.updateUser).not.toHaveBeenCalled();
  });

  it('404s when the panel has no login user yet', async () => {
    prismaMock.userBranchProfile.findFirst.mockResolvedValue(null);
    await expect(
      service.update('t1', 'panel-1', {}, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
    expect(usersServiceMock.updateUser).not.toHaveBeenCalled();
  });

  it('passes only the six basic-profile fields to updateUser — never role/status/userType', async () => {
    await service.update(
      't1',
      'panel-1',
      {
        employeeName: 'New Name',
        dateOfBirth: '1990-01-01',
        gender: 'MALE' as never,
        mobileNumber: '9800000001',
        address: 'New address',
        password: 'NewPassw0rd!',
      },
      'actor-1',
    );

    expect(usersServiceMock.updateUser).toHaveBeenCalledWith(
      'person-1',
      't1',
      {
        employeeName: 'New Name',
        dateOfBirth: '1990-01-01',
        gender: 'MALE',
        mobileNumber: '9800000001',
        address: 'New address',
        password: 'NewPassw0rd!',
      },
      'actor-1',
    );
    const calledDto = usersServiceMock.updateUser.mock.calls[0][2];
    expect(calledDto.roleKey).toBeUndefined();
    expect(calledDto.status).toBeUndefined();
    expect(calledDto.userType).toBeUndefined();
  });

  it('updates email directly via Prisma when provided', async () => {
    await service.update(
      't1',
      'panel-1',
      { email: 'new@example.com' },
      'actor-1',
    );
    expect(prismaMock.person.update).toHaveBeenCalledWith({
      where: { id: 'person-1' },
      data: { email: 'new@example.com' },
    });
  });

  it('never touches Person.email when not provided', async () => {
    await service.update('t1', 'panel-1', { employeeName: 'X' }, 'actor-1');
    expect(prismaMock.person.update).not.toHaveBeenCalled();
  });
});
