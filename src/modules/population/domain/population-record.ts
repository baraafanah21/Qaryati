import { FieldErrorCode, ValidationError, type FieldError } from '../../../shared/kernel';
import {
  isCountType,
  MIN_REFERENCE_YEAR,
  POPULATION_RANGE,
  type CountType,
} from './population-values';

/** The value of a `POPULATION` claim: how many people, in which year, counted how. */
export interface PopulationValue {
  population: number;
  referenceYear: number;
  countType: CountType;
}

/**
 * A valid population value, or a 422 naming every broken field:
 * population is an integer 0 … 1 000 000; the year is an integer from 1800 to
 * `currentYear` (rule 3, never in the future); the count type is one of
 * {@link COUNT_TYPES}. `currentYear` comes from the `Clock`.
 */
export function validatePopulation(
  input: { population: number; referenceYear: number; countType: string },
  currentYear: number,
): PopulationValue {
  const errors: FieldError[] = [];
  const add = (field: string, code: FieldError['code'], message: string) =>
    errors.push({ field, code, message });

  if (!Number.isInteger(input.population)) {
    add('population', FieldErrorCode.NOT_INTEGER, 'The population is a whole number.');
  } else if (input.population < POPULATION_RANGE.min) {
    add('population', FieldErrorCode.TOO_SMALL, 'The population cannot be negative.');
  } else if (input.population > POPULATION_RANGE.max) {
    add(
      'population',
      FieldErrorCode.TOO_LARGE,
      `The population is at most ${POPULATION_RANGE.max}.`,
    );
  }

  if (!Number.isInteger(input.referenceYear)) {
    add('referenceYear', FieldErrorCode.NOT_INTEGER, 'The year is a whole number.');
  } else if (input.referenceYear > currentYear) {
    add('referenceYear', FieldErrorCode.MUST_NOT_BE_FUTURE, 'The year cannot be in the future.');
  } else if (input.referenceYear < MIN_REFERENCE_YEAR) {
    add('referenceYear', FieldErrorCode.TOO_SMALL, `The year is ${MIN_REFERENCE_YEAR} or later.`);
  }

  if (!isCountType(input.countType)) {
    add('countType', FieldErrorCode.INVALID_VALUE, 'Unknown count type.');
  }

  if (errors.length > 0) throw new ValidationError('The population record is invalid.', errors);
  return {
    population: input.population,
    referenceYear: input.referenceYear,
    countType: input.countType as CountType,
  };
}
