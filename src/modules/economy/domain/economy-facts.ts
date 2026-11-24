import { roundCoordinate } from '../../curation';
import { normalizeName } from '../../village';
import { FieldErrorCode, ValidationError, type FieldError } from '../../../shared/kernel';
import {
  FACILITY_NAME_MAX,
  isFacilityType,
  isProductSignificance,
  MIN_ESTABLISHED_YEAR,
  type FacilityType,
  type ProductSignificance,
} from './economy-values';

/** `village_product`: a village produces a product, with how much it matters. */
export interface VillageProductValue {
  productId: string;
  significance: ProductSignificance;
}

/** A WGS 84 point, rounded to 5 decimals (about a metre). */
export interface EconomyPoint {
  latitude: number;
  longitude: number;
}

/** `facility`: a community facility of the village (supporting context only). */
export interface FacilityValue {
  facilityType: FacilityType;
  name: string;
  location: EconomyPoint | null;
  establishedYear: number | null;
}

/** The value of each economy fact, by claim type. */
export interface EconomyFactValues {
  VILLAGE_PRODUCT: VillageProductValue;
  FACILITY: FacilityValue;
}

/** A claim type whose value the economy module stores. */
export type EconomyFactType = keyof EconomyFactValues;

/** The raw (unvalidated) input of each type, as the API accepts it. */
export interface EconomyFactInputs {
  VILLAGE_PRODUCT: { productId: string; significance: string };
  FACILITY: {
    facilityType: string;
    name: string;
    location?: { latitude: number; longitude: number } | null;
    establishedYear?: number | null;
  };
}

/** The list filter each type accepts (`?type=` for facilities). */
export interface EconomyFactFilters {
  VILLAGE_PRODUCT: Record<string, never>;
  FACILITY: { facilityType?: FacilityType };
}

/** A facility name: NFC, every run of white space as one space, trimmed. */
export const cleanName = (input: string): string =>
  input.normalize('NFC').replace(/\s+/gu, ' ').trim();

function fail(message: string, errors: FieldError[]): void {
  if (errors.length > 0) throw new ValidationError(message, errors);
}

/** A valid village product: a known significance. Whether the product exists is the use case's 404. */
export function validateVillageProduct(
  input: EconomyFactInputs['VILLAGE_PRODUCT'],
): VillageProductValue {
  const errors: FieldError[] = [];
  if (!isProductSignificance(input.significance)) {
    errors.push({
      field: 'significance',
      code: FieldErrorCode.INVALID_VALUE,
      message: 'Unknown significance.',
    });
  }
  fail('The village product is invalid.', errors);
  return {
    productId: input.productId.toLowerCase(),
    significance: input.significance as ProductSignificance,
  };
}

/**
 * A valid facility: known type; name 1–200 characters with at least one
 * letter or digit; coordinates in range, rounded to 5 decimals; established
 * year an integer from 1800 to `currentYear` (from the `Clock`).
 */
export function validateFacility(
  input: EconomyFactInputs['FACILITY'],
  currentYear: number,
): FacilityValue {
  const errors: FieldError[] = [];
  const add = (field: string, code: FieldError['code'], message: string) =>
    errors.push({ field, code, message });

  if (!isFacilityType(input.facilityType)) {
    add('facilityType', FieldErrorCode.INVALID_VALUE, 'Unknown facility type.');
  }
  const name = cleanName(input.name);
  if (!name) add('name', FieldErrorCode.REQUIRED, 'Must not be blank.');
  else if (name.length > FACILITY_NAME_MAX) {
    add('name', FieldErrorCode.TOO_LONG, `At most ${FACILITY_NAME_MAX} characters.`);
  } else if (!normalizeName(name)) {
    add('name', FieldErrorCode.INVALID_VALUE, 'The name has no letters or digits.');
  }

  const location = input.location ?? null;
  if (location) {
    const { latitude, longitude } = location;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      add('location.latitude', FieldErrorCode.INVALID_VALUE, 'Latitude is between -90 and 90.');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      add('location.longitude', FieldErrorCode.INVALID_VALUE, 'Longitude is between -180 and 180.');
    }
  }

  const year = input.establishedYear ?? null;
  if (year !== null) {
    if (!Number.isInteger(year)) {
      add('establishedYear', FieldErrorCode.NOT_INTEGER, 'A whole year.');
    } else if (year < MIN_ESTABLISHED_YEAR) {
      add('establishedYear', FieldErrorCode.TOO_SMALL, `Not before ${MIN_ESTABLISHED_YEAR}.`);
    } else if (year > currentYear) {
      add('establishedYear', FieldErrorCode.MUST_NOT_BE_FUTURE, 'Not after the current year.');
    }
  }

  fail('The facility is invalid.', errors);
  return {
    facilityType: input.facilityType as FacilityType,
    name,
    location: location && {
      latitude: roundCoordinate(location.latitude),
      longitude: roundCoordinate(location.longitude),
    },
    establishedYear: year,
  };
}
