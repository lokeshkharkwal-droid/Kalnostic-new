import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Validates that a date-of-birth value (ISO date string or Date) is at least
 * `minAge` whole years in the past. Used by the User DTOs to enforce the v2.0
 * "must be at least 18 years old" rule declaratively (CLAUDE.md rule #2).
 *
 * @param minAge minimum age in years (e.g. 18)
 * @param validationOptions standard class-validator options
 */
export function IsAtLeastYearsOld(
  minAge: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAtLeastYearsOld',
      target: object.constructor,
      propertyName,
      constraints: [minAge],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value === null || value === undefined || value === '') {
            // Presence is enforced separately (@IsNotEmpty/@IsDateString);
            // this validator only checks the age once a value exists.
            return true;
          }
          let dob: Date;
          if (value instanceof Date) {
            dob = value;
          } else if (typeof value === 'string' || typeof value === 'number') {
            dob = new Date(value);
          } else {
            return false;
          }
          if (Number.isNaN(dob.getTime())) {
            return false;
          }
          const [min] = args.constraints as [number];
          const now = new Date();
          const threshold = new Date(
            now.getFullYear() - min,
            now.getMonth(),
            now.getDate(),
          );
          return dob.getTime() <= threshold.getTime();
        },
        defaultMessage(args: ValidationArguments): string {
          const [min] = args.constraints as [number];
          return `${args.property} must be at least ${min} years in the past`;
        },
      },
    });
  };
}
