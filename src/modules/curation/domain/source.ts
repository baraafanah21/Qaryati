import {
  FieldErrorCode,
  INITIAL_VERSION,
  ValidationError,
  type Id,
  type Versioned,
} from '../../../shared/kernel';

export const SOURCE_TYPES = [
  'BOOK',
  'ARTICLE',
  'CENSUS',
  'GOV_DATASET',
  'ARCHIVE',
  'ORAL_HISTORY',
  'WEBSITE',
  'EXTERNAL_API',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export interface SourceData {
  sourceType: SourceType;
  title: string;
  author: string | null;
  publisher: string | null;
  publishedYear: number | null;
  url: string | null;
  isbn: string | null;
  reliability: number;
  notes: string | null;
}

export interface SourceProps extends SourceData {
  id: Id<'Source'>;
  createdBy: string;
  updatedBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** A cited information source, independent of persistence and HTTP. */
export class Source implements Versioned {
  private constructor(private readonly props: SourceProps) {}

  static create(input: { id: Id<'Source'>; data: SourceData; actorId: string; now: Date }): Source {
    return new Source({
      ...Source.validate(input.data, input.now),
      id: input.id,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      version: INITIAL_VERSION,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    });
  }

  /** Rebuilds a source from a trusted persistence record. */
  static restore(props: SourceProps): Source {
    return new Source({ ...props });
  }

  get id(): Id<'Source'> {
    return this.props.id;
  }

  get version(): number {
    return this.props.version;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get updatedBy(): string {
    return this.props.updatedBy;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get data(): Readonly<SourceData> {
    return {
      sourceType: this.props.sourceType,
      title: this.props.title,
      author: this.props.author,
      publisher: this.props.publisher,
      publishedYear: this.props.publishedYear,
      url: this.props.url,
      isbn: this.props.isbn,
      reliability: this.props.reliability,
      notes: this.props.notes,
    };
  }

  /** The database owns version and update timestamps. */
  update(data: SourceData, actorId: string, now: Date): Source {
    return new Source({
      ...this.props,
      ...Source.validate(data, now),
      updatedBy: actorId,
    });
  }

  snapshot(): Record<string, unknown> {
    return { ...this.data };
  }

  private static validate(data: SourceData, now: Date): SourceData {
    const fail = (
      field: string,
      code: (typeof FieldErrorCode)[keyof typeof FieldErrorCode],
      message: string,
    ): never => {
      throw new ValidationError('The source information is invalid.', [{ field, code, message }]);
    };

    if (!SOURCE_TYPES.includes(data.sourceType)) {
      fail('sourceType', FieldErrorCode.INVALID_VALUE, 'Invalid source type.');
    }

    const title = data.title.trim();

    if (!title || title.length > 300) {
      fail(
        'title',
        !title ? FieldErrorCode.REQUIRED : FieldErrorCode.TOO_LONG,
        'The title must contain 1 to 300 characters.',
      );
    }

    if (!Number.isInteger(data.reliability) || data.reliability < 1 || data.reliability > 5) {
      fail('reliability', FieldErrorCode.INVALID_VALUE, 'Use an integer from 1 to 5.');
    }

    if (data.publishedYear !== null) {
      if (!Number.isInteger(data.publishedYear) || data.publishedYear < 1000) {
        fail('publishedYear', FieldErrorCode.INVALID_VALUE, 'Invalid publication year.');
      }

      if (data.publishedYear > now.getUTCFullYear()) {
        fail(
          'publishedYear',
          FieldErrorCode.MUST_NOT_BE_FUTURE,
          'The publication year cannot be in the future.',
        );
      }
    }

    const url = data.url?.trim() || null;

    if (url !== null) {
      if (url.length > 2048) {
        fail('url', FieldErrorCode.TOO_LONG, 'The URL is too long.');
      }

      try {
        const parsed = new URL(url);

        if (!['http:', 'https:'].includes(parsed.protocol)) {
          fail('url', FieldErrorCode.INVALID_FORMAT, 'Use an HTTP or HTTPS URL.');
        }
      } catch {
        fail('url', FieldErrorCode.INVALID_FORMAT, 'Invalid URL.');
      }
    }

    const isbn = data.isbn?.replace(/-/g, '').trim() || null;

    if (isbn !== null && !Source.validIsbn(isbn)) {
      fail('isbn', FieldErrorCode.INVALID_FORMAT, 'Invalid ISBN-10 or ISBN-13.');
    }

    const notes = data.notes?.trim() || null;

    if (notes !== null && notes.length > 2000) {
      fail('notes', FieldErrorCode.TOO_LONG, 'Notes exceed 2000 characters.');
    }

    return {
      ...data,
      title,
      author: data.author?.trim() || null,
      publisher: data.publisher?.trim() || null,
      url,
      isbn,
      notes,
    };
  }

  private static validIsbn(isbn: string): boolean {
    if (/^[0-9]{9}[0-9X]$/.test(isbn)) {
      const sum = [...isbn].reduce(
        (total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index),
        0,
      );

      return sum % 11 === 0;
    }

    if (/^[0-9]{13}$/.test(isbn)) {
      const sum = [...isbn].reduce(
        (total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3),
        0,
      );

      return sum % 10 === 0;
    }

    return false;
  }
}
