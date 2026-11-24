import { FieldErrorCode, ValidationError, type FieldError } from '../../../shared/kernel';
import { roundCoordinate } from '../../curation';
import {
  isLanguageTag,
  isLocationPrecision,
  isMeasureKind,
  isNameType,
  isRelationType,
  type LocationPrecision,
  type MeasureKind,
  type NameType,
  type RelationType,
} from './fact-values';
import { normalizeName } from './name-normalizer';

/** `village_name`: one name of a village in one language. */
export interface VillageNameValue {
  name: string;
  /** `normalizeName(name)`; the key of comparisons and of the question. */
  nameNormalized: string;
  lang: string;
  nameType: NameType;
  periodFromYear: number | null;
  periodToYear: number | null;
}

/** `name_origin`: where the name of a village comes from. */
export interface NameOriginValue {
  meaning: string;
  originLanguage: string | null;
  explanation: string | null;
}

/** `village_affiliation`: the administrative unit a village belonged to, and when. */
export interface AffiliationValue {
  adminUnitId: string;
  /** ISO date `YYYY-MM-DD`, or null when unknown. */
  validFrom: string | null;
  validTo: string | null;
}

/** `village_location`: a WGS 84 point, rounded to 5 decimals (about 1 m). */
export interface LocationValue {
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
  description: string | null;
}

/** `village_measure`: a measured quantity. */
export interface MeasureValue {
  kind: MeasureKind;
  value: number;
}

/** `village_relation`: how this village relates to another one. */
export interface RelationValue {
  relatedVillageId: string;
  relationType: RelationType;
}

/** Limits on free text; shape limits only, so they live here, not in the database. */
export const FACT_TEXT_LIMITS = {
  name: 200,
  meaning: 500,
  originLanguage: 100,
  explanation: 4000,
  description: 1000,
} as const;

/** Elevation in metres: from the Dead Sea shore (about −430) to the highest hills, with margin. */
export const ELEVATION_RANGE = { min: -500, max: 1500 } as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Collects field errors so one 422 names every problem of a request. */
class Errors {
  private readonly list: FieldError[] = [];

  add(field: string, code: FieldError['code'], message: string): void {
    this.list.push({ field, code, message });
  }

  text(field: string, value: string, max: number): string {
    const trimmed = value.trim();
    if (!trimmed) this.add(field, FieldErrorCode.REQUIRED, 'Must not be blank.');
    else if (trimmed.length > max)
      this.add(field, FieldErrorCode.TOO_LONG, `At most ${max} characters.`);
    return trimmed;
  }

  optionalText(field: string, value: string | null | undefined, max: number): string | null {
    if (value == null || !value.trim()) return null;
    return this.text(field, value, max);
  }

  throwIfAny(message: string): void {
    if (this.list.length > 0) throw new ValidationError(message, this.list);
  }
}

/**
 * A valid village name. `name_normalized` comes from {@link normalizeName};
 * the period is `from <= to`, and a `CURRENT` name has no period.
 */
export function validateVillageName(input: {
  name: string;
  lang: string;
  nameType: string;
  periodFromYear?: number | null;
  periodToYear?: number | null;
}): VillageNameValue {
  const errors = new Errors();
  const name = errors.text('name', input.name, FACT_TEXT_LIMITS.name);
  const nameNormalized = normalizeName(name);
  if (name && !nameNormalized) {
    errors.add('name', FieldErrorCode.INVALID_VALUE, 'The name has no letters or digits.');
  }
  if (!isLanguageTag(input.lang)) {
    errors.add('lang', FieldErrorCode.INVALID_FORMAT, 'Use a short BCP 47 tag such as ar or en.');
  }
  if (!isNameType(input.nameType)) {
    errors.add('nameType', FieldErrorCode.INVALID_VALUE, 'Unknown name type.');
  }
  const from = input.periodFromYear ?? null;
  const to = input.periodToYear ?? null;
  if (input.nameType === 'CURRENT' && (from !== null || to !== null)) {
    errors.add('periodFromYear', FieldErrorCode.NOT_ALLOWED, 'A current name has no period.');
  }
  for (const [field, year] of [
    ['periodFromYear', from],
    ['periodToYear', to],
  ] as const) {
    if (year !== null && !Number.isInteger(year)) {
      errors.add(field, FieldErrorCode.INVALID_VALUE, 'A year is a whole number.');
    }
  }
  if (from !== null && to !== null && from > to) {
    errors.add('periodToYear', FieldErrorCode.INVALID_VALUE, 'The period ends before it starts.');
  }
  errors.throwIfAny('The village name is invalid.');
  return {
    name,
    nameNormalized,
    lang: input.lang,
    nameType: input.nameType as NameType,
    periodFromYear: from,
    periodToYear: to,
  };
}

/** A valid name origin: a meaning, and optionally its language and an explanation. */
export function validateNameOrigin(input: {
  meaning: string;
  originLanguage?: string | null;
  explanation?: string | null;
}): NameOriginValue {
  const errors = new Errors();
  const value = {
    meaning: errors.text('meaning', input.meaning, FACT_TEXT_LIMITS.meaning),
    originLanguage: errors.optionalText(
      'originLanguage',
      input.originLanguage,
      FACT_TEXT_LIMITS.originLanguage,
    ),
    explanation: errors.optionalText(
      'explanation',
      input.explanation,
      FACT_TEXT_LIMITS.explanation,
    ),
  };
  errors.throwIfAny('The name origin is invalid.');
  return value;
}

/** A valid affiliation period: ISO dates, `validFrom <= validTo`. The unit is checked by the caller. */
export function validateAffiliation(input: {
  adminUnitId: string;
  validFrom?: string | null;
  validTo?: string | null;
}): AffiliationValue {
  const errors = new Errors();
  const validFrom = input.validFrom ?? null;
  const validTo = input.validTo ?? null;
  for (const [field, date] of [
    ['validFrom', validFrom],
    ['validTo', validTo],
  ] as const) {
    if (date !== null && (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
      errors.add(field, FieldErrorCode.INVALID_FORMAT, 'Use an ISO date, YYYY-MM-DD.');
    }
  }
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    errors.add('validTo', FieldErrorCode.INVALID_VALUE, 'The affiliation ends before it starts.');
  }
  errors.throwIfAny('The affiliation is invalid.');
  return { adminUnitId: input.adminUnitId, validFrom, validTo };
}

/** A valid location: latitude −90…90, longitude −180…180, both rounded to 5 decimals. */
export function validateLocation(input: {
  latitude: number;
  longitude: number;
  precision: string;
  description?: string | null;
}): LocationValue {
  const errors = new Errors();
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    errors.add('latitude', FieldErrorCode.INVALID_VALUE, 'Latitude is between -90 and 90.');
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    errors.add('longitude', FieldErrorCode.INVALID_VALUE, 'Longitude is between -180 and 180.');
  }
  if (!isLocationPrecision(input.precision)) {
    errors.add('precision', FieldErrorCode.INVALID_VALUE, 'Unknown precision.');
  }
  const description = errors.optionalText(
    'description',
    input.description,
    FACT_TEXT_LIMITS.description,
  );
  errors.throwIfAny('The location is invalid.');
  return {
    latitude: roundCoordinate(input.latitude),
    longitude: roundCoordinate(input.longitude),
    precision: input.precision as LocationPrecision,
    description,
  };
}

/** A valid measure: elevation −500…1500 m, area > 0 dunum. */
export function validateMeasure(input: { kind: string; value: number }): MeasureValue {
  const errors = new Errors();
  if (!isMeasureKind(input.kind)) {
    errors.add('kind', FieldErrorCode.INVALID_VALUE, 'Unknown measure kind.');
  } else if (!Number.isFinite(input.value)) {
    errors.add('value', FieldErrorCode.INVALID_VALUE, 'The value must be a finite number.');
  } else if (
    input.kind === 'ELEVATION_M' &&
    (input.value < ELEVATION_RANGE.min || input.value > ELEVATION_RANGE.max)
  ) {
    errors.add(
      'value',
      FieldErrorCode.INVALID_VALUE,
      `Elevation is between ${ELEVATION_RANGE.min} and ${ELEVATION_RANGE.max} metres.`,
    );
  } else if (input.kind === 'AREA_DUNUM' && input.value <= 0) {
    errors.add('value', FieldErrorCode.INVALID_VALUE, 'An area is greater than 0.');
  }
  errors.throwIfAny('The measure is invalid.');
  return { kind: input.kind as MeasureKind, value: input.value };
}

/** A valid relation: a known type, never to the village itself. The other village is checked by the caller. */
export function validateRelation(
  villageId: string,
  input: { relatedVillageId: string; relationType: string },
): RelationValue {
  const errors = new Errors();
  if (input.relatedVillageId === villageId) {
    errors.add(
      'relatedVillageId',
      FieldErrorCode.NOT_ALLOWED,
      'A village cannot relate to itself.',
    );
  }
  if (!isRelationType(input.relationType)) {
    errors.add('relationType', FieldErrorCode.INVALID_VALUE, 'Unknown relation type.');
  }
  errors.throwIfAny('The relation is invalid.');
  return {
    relatedVillageId: input.relatedVillageId,
    relationType: input.relationType as RelationType,
  };
}
