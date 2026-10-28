import { ValidationError, type Id } from '../../../shared/kernel';
import { Source, type SourceData } from './source';

describe('Source Domain', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  const validData = (): SourceData => ({
    sourceType: 'BOOK',
    title: 'History of Palestinian Villages',
    author: 'Test Author',
    publisher: 'Test Publisher',
    publishedYear: 2020,
    url: 'https://example.com/source',
    isbn: '0306406152',
    reliability: 5,
    notes: 'Historical reference',
  });

  const createSource = (changes: Partial<SourceData> = {}) =>
    Source.create({
      id: '019a0000-0000-7000-8000-000000000001' as Id<'Source'>,
      data: { ...validData(), ...changes },
      actorId: '019a0000-0000-7000-8000-000000000002',
      now,
    });

  describe('creation', () => {
    it('creates a valid source', () => {
      const source = createSource();

      expect(source.data.title).toBe('History of Palestinian Villages');
      expect(source.data.reliability).toBe(5);
      expect(source.version).toBe(1);
    });

    it.each([0, 6, -1, 10, 2.5])('rejects invalid reliability %s', (reliability) => {
      expect(() => createSource({ reliability })).toThrow(ValidationError);
    });

    it.each([1, 5])('accepts reliability %s', (reliability) => {
      expect(createSource({ reliability }).data.reliability).toBe(reliability);
    });

    it('rejects an empty title', () => {
      expect(() => createSource({ title: '   ' })).toThrow(ValidationError);
    });

    it('rejects a title longer than 300 characters', () => {
      expect(() => createSource({ title: 'A'.repeat(301) })).toThrow(ValidationError);
    });

    it('rejects a future publication year', () => {
      expect(() => createSource({ publishedYear: 2027 })).toThrow(ValidationError);
    });

    it('rejects an invalid URL scheme', () => {
      expect(() => createSource({ url: 'ftp://example.com/source' })).toThrow(ValidationError);
    });

    it('accepts a valid ISBN-10', () => {
      expect(createSource().data.isbn).toBe('0306406152');
    });

    it('accepts a valid ISBN-13', () => {
      expect(createSource({ isbn: '9780306406157' }).data.isbn).toBe('9780306406157');
    });

    it('rejects an invalid ISBN-10 checksum', () => {
      expect(() => createSource({ isbn: '0306406153' })).toThrow(ValidationError);
    });

    it('rejects an invalid ISBN-13 checksum', () => {
      expect(() => createSource({ isbn: '9780306406158' })).toThrow(ValidationError);
    });

    it('normalizes the title and ISBN', () => {
      const source = createSource({
        title: '  Village History  ',
        isbn: '978-0-306-40615-7',
      });

      expect(source.data.title).toBe('Village History');
      expect(source.data.isbn).toBe('9780306406157');
    });
  });

  describe('updates', () => {
    it('updates source information without changing the version', () => {
      const original = createSource();

      const updated = original.update(
        { ...validData(), title: 'Updated Village History' },
        '019a0000-0000-7000-8000-000000000003',
        now,
      );

      expect(updated.data.title).toBe('Updated Village History');
      expect(updated.version).toBe(original.version);
      expect(original.data.title).toBe('History of Palestinian Villages');
    });
  });

  describe('audit snapshot', () => {
    it('returns the source information', () => {
      const source = createSource();

      expect(source.snapshot()).toMatchObject({
        title: 'History of Palestinian Villages',
        reliability: 5,
        sourceType: 'BOOK',
      });
    });
  });
});
