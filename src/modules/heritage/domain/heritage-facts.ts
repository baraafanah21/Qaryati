import { roundCoordinate } from '../../curation';
import { normalizeName } from '../../village';
import { FieldErrorCode, ValidationError, type FieldError } from '../../../shared/kernel';
import {
  HERITAGE_TEXT_LIMITS,
  isCulturalCategory,
  isDatePrecision,
  isLandmarkEra,
  isLandmarkType,
  type CulturalCategory,
  type DatePrecision,
  type LandmarkEra,
  type LandmarkType,
} from './heritage-values';
import { normalizeText } from './normalize-text';

/** `history_overview`: the story of a village in one text. */
export interface HistoryOverviewValue {
  summary: string;
}

/** `historical_event`: dates are `YYYY-MM-DD`, the first day of their period. */
export interface HistoricalEventValue {
  title: string;
  description: string;
  startDate: string;
  endDate: string | null;
  datePrecision: DatePrecision;
}

/** A WGS 84 point, rounded to 5 decimals (about a metre). */
export interface HeritagePoint {
  latitude: number;
  longitude: number;
}

/** `landmark`: a place in or near the village. */
export interface LandmarkValue {
  name: string;
  landmarkType: LandmarkType;
  description: string | null;
  location: HeritagePoint | null;
  era: LandmarkEra | null;
}

/** `cultural_item`: intangible heritage of the village. */
export interface CulturalItemValue {
  category: CulturalCategory;
  name: string;
  description: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Collects field errors, so one 422 names every problem of a request. */
class Errors {
  private readonly list: FieldError[] = [];

  add(field: string, code: FieldError['code'], message: string): void {
    this.list.push({ field, code, message });
  }

  /** Normalized required text of 1 … `max` characters. */
  text(field: string, value: string, max: number): string {
    const text = normalizeText(value);
    if (!text) this.add(field, FieldErrorCode.REQUIRED, 'Must not be blank.');
    else if (text.length > max) {
      this.add(field, FieldErrorCode.TOO_LONG, `At most ${max} characters.`);
    }
    return text;
  }

  /** Optional text: blank is `null`. */
  optionalText(field: string, value: string | null | undefined, max: number): string | null {
    if (value == null || !normalizeText(value)) return null;
    return this.text(field, value, max);
  }

  /** A name (1–200 characters) that keeps at least one letter or digit once normalized. */
  name(field: string, value: string): string {
    const name = this.text(field, value, HERITAGE_TEXT_LIMITS.name);
    if (name && !normalizeName(name)) {
      this.add(field, FieldErrorCode.INVALID_VALUE, 'The name has no letters or digits.');
    }
    return name;
  }

  throwIfAny(message: string): void {
    if (this.list.length > 0) throw new ValidationError(message, this.list);
  }
}

/** A valid overview: 1 … 10 000 characters after {@link normalizeText}. */
export function validateHistoryOverview(input: { summary: string }): HistoryOverviewValue {
  const errors = new Errors();
  const summary = errors.text('summary', input.summary, HERITAGE_TEXT_LIMITS.summary);
  errors.throwIfAny('The history overview is invalid.');
  return { summary };
}

/** `[year, month, day]` of a real calendar date, or `undefined`. */
function calendarDate(value: string): [number, number, number] | undefined {
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0–99 to 1900–1999; setUTCFullYear keeps the year as given.
  date.setUTCFullYear(year);
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? [year, month, day] : undefined;
}

/**
 * Whether a date is the first day of its period: any day for `DAY`, the 1st
 * for `MONTH`, 1 January for `YEAR`, of a year ending in 0 for `DECADE` and
 * in 00 for `CENTURY`.
 */
export function matchesPrecision(
  [year, month, day]: [number, number, number],
  precision: DatePrecision,
): boolean {
  switch (precision) {
    case 'DAY':
      return true;
    case 'MONTH':
      return day === 1;
    case 'YEAR':
      return month === 1 && day === 1;
    case 'DECADE':
      return month === 1 && day === 1 && year % 10 === 0;
    case 'CENTURY':
      return month === 1 && day === 1 && year % 100 === 0;
  }
}

/**
 * A valid event. Title 1–200, description 1 … 5 000 characters; both dates
 * are real `YYYY-MM-DD` dates that match `datePrecision`; the start is not
 * after `today` (`YYYY-MM-DD` from the `Clock`); the end, when given, is not
 * before the start.
 */
export function validateHistoricalEvent(
  input: {
    title: string;
    description: string;
    startDate: string;
    endDate?: string | null;
    datePrecision: string;
  },
  today: string,
): HistoricalEventValue {
  const errors = new Errors();
  const title = errors.name('title', input.title);
  const description = errors.text(
    'description',
    input.description,
    HERITAGE_TEXT_LIMITS.description,
  );
  const precision = isDatePrecision(input.datePrecision) ? input.datePrecision : undefined;
  if (!precision) errors.add('datePrecision', FieldErrorCode.INVALID_VALUE, 'Unknown precision.');

  const endDate = input.endDate ?? null;
  const start = calendarDate(input.startDate);
  const end = endDate === null ? undefined : calendarDate(endDate);
  if (!start) errors.add('startDate', FieldErrorCode.INVALID_FORMAT, 'Use a real YYYY-MM-DD date.');
  if (endDate !== null && !end) {
    errors.add('endDate', FieldErrorCode.INVALID_FORMAT, 'Use a real YYYY-MM-DD date.');
  }
  if (start && precision && !matchesPrecision(start, precision)) {
    errors.add(
      'startDate',
      FieldErrorCode.INVALID_VALUE,
      `A ${precision} date is the first day of its period.`,
    );
  }
  if (end && precision && !matchesPrecision(end, precision)) {
    errors.add(
      'endDate',
      FieldErrorCode.INVALID_VALUE,
      `A ${precision} date is the first day of its period.`,
    );
  }
  // ISO dates of four-digit years compare correctly as strings.
  if (start && input.startDate > today) {
    errors.add('startDate', FieldErrorCode.MUST_NOT_BE_FUTURE, 'The event cannot start later.');
  }
  if (start && end && endDate! < input.startDate) {
    errors.add('endDate', FieldErrorCode.TOO_SMALL, 'The end is on or after the start.');
  }

  errors.throwIfAny('The historical event is invalid.');
  return {
    title,
    description,
    startDate: input.startDate,
    endDate,
    datePrecision: precision!,
  };
}

/** A valid landmark: name 1–200, known type and era, coordinates in range, rounded. */
export function validateLandmark(input: {
  name: string;
  landmarkType: string;
  description?: string | null;
  location?: { latitude: number; longitude: number } | null;
  era?: string | null;
}): LandmarkValue {
  const errors = new Errors();
  const name = errors.name('name', input.name);
  if (!isLandmarkType(input.landmarkType)) {
    errors.add('landmarkType', FieldErrorCode.INVALID_VALUE, 'Unknown landmark type.');
  }
  const era = input.era ?? null;
  if (era !== null && !isLandmarkEra(era)) {
    errors.add('era', FieldErrorCode.INVALID_VALUE, 'Unknown era.');
  }
  const description = errors.optionalText(
    'description',
    input.description,
    HERITAGE_TEXT_LIMITS.description,
  );
  const location = input.location ?? null;
  if (location) {
    const { latitude, longitude } = location;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      errors.add(
        'location.latitude',
        FieldErrorCode.INVALID_VALUE,
        'Latitude is between -90 and 90.',
      );
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      errors.add(
        'location.longitude',
        FieldErrorCode.INVALID_VALUE,
        'Longitude is between -180 and 180.',
      );
    }
  }

  errors.throwIfAny('The landmark is invalid.');
  return {
    name,
    landmarkType: input.landmarkType as LandmarkType,
    description,
    location: location && {
      latitude: roundCoordinate(location.latitude),
      longitude: roundCoordinate(location.longitude),
    },
    era: era as LandmarkEra | null,
  };
}

/** A valid cultural item: known category, name 1–200, description 1 … 5 000. */
export function validateCulturalItem(input: {
  category: string;
  name: string;
  description: string;
}): CulturalItemValue {
  const errors = new Errors();
  if (!isCulturalCategory(input.category)) {
    errors.add('category', FieldErrorCode.INVALID_VALUE, 'Unknown category.');
  }
  const name = errors.name('name', input.name);
  const description = errors.text(
    'description',
    input.description,
    HERITAGE_TEXT_LIMITS.description,
  );
  errors.throwIfAny('The cultural item is invalid.');
  return { category: input.category as CulturalCategory, name, description };
}
