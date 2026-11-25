import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { JwtPayload } from '../types/jwt-payload.type';

describe('JwtStrategy.validate', () => {
  const strategy = new JwtStrategy({
    getOrThrow: () => 'test-secret',
  } as unknown as ConfigService);

  const staffPayload = { person_id: 'person-1' } as unknown as JwtPayload;

  it('accepts a staff token that has no type claim (tokens issued before patient login)', () => {
    expect(strategy.validate(staffPayload)).toBe(staffPayload);
  });

  it("accepts a staff token with type 'business'", () => {
    const payload = {
      ...staffPayload,
      type: 'business',
    } as unknown as JwtPayload;
    expect(strategy.validate(payload)).toBe(payload);
  });

  it("rejects a patient access token (type 'patient')", () => {
    const payload = {
      person_id: 'person-1',
      patient_id: 'patient-1',
      tenant_id: 'tenant-1',
      type: 'patient',
    } as unknown as JwtPayload;
    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });

  it("rejects a patient bootstrap token (type 'patient_bootstrap')", () => {
    const payload = {
      person_id: 'person-1',
      type: 'patient_bootstrap',
    } as unknown as JwtPayload;
    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });

  it('still rejects a token with no person_id', () => {
    expect(() => strategy.validate({} as unknown as JwtPayload)).toThrow(
      UnauthorizedException,
    );
  });
});
