import { createHash } from 'node:crypto';

import { FieldErrorCode, ValidationError } from '../../../shared/kernel';

function invalidValue(): never {
  throw new ValidationError('Invalid claim value.', [
    {
      field: 'value',
      code: FieldErrorCode.INVALID_VALUE,
      message: 'Claim values must be JSON-compatible and contain finite numbers.',
    },
  ]);
}

/** Converts a finite number to decimal notation without exponent notation. */
function decimalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return invalidValue();
  }

  if (Object.is(value, -0)) {
    return '0';
  }

  const raw = String(value).toLowerCase();

  if (!raw.includes('e')) {
    return raw;
  }

  const [mantissa = '', exponentText = '0'] = raw.split('e');
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const decimalPosition = unsigned.indexOf('.');
  const integerDigits = decimalPosition === -1 ? unsigned.length : decimalPosition;

  const digits = unsigned.replace('.', '');
  const newPosition = integerDigits + exponent;

  let result: string;

  if (newPosition <= 0) {
    result = `0.${'0'.repeat(-newPosition)}${digits}`;
  } else if (newPosition >= digits.length) {
    result = digits + '0'.repeat(newPosition - digits.length);
  } else {
    result = `${digits.slice(0, newPosition)}.${digits.slice(newPosition)}`;
  }

  return negative ? `-${result}` : result;
}

/** Canonical JSON representation with sorted object keys. */
function canonicalize(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    return decimalNumber(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  if (typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      return invalidValue();
    }

    const record = value as Record<string, unknown>;

    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);

    return `{${entries.join(',')}}`;
  }

  return invalidValue();
}

/** Returns a deterministic SHA-256 hash of a claim value. */
export function valueHash(value: unknown): string {
  const canonical = canonicalize(value);

  return createHash('sha256').update(canonical).digest('hex');
}

/** Rounds a geographic coordinate to five decimal places. */
export function roundCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    return invalidValue();
  }

  return Math.round((value + Number.EPSILON) * 100_000) / 100_000;
}
