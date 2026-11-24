jest.mock('@nestjs-cls/transactional', () => ({
  Transactional: () => (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
}));

import type { RequestContext } from '../../../platform/context/request-context';
import { ConflictError, UnauthenticatedError, asId } from '../../../shared/kernel';
import { Source, type SourceData } from '../domain/source';
import type { SourceRepository } from '../domain/source.repository';
import type { CreateSource } from './create-source.use-case';
import { EXTERNAL_API_RELIABILITY, SourceWriter } from './source-writer';

describe('SourceWriter.findOrCreateExternalApiSource', () => {
  const actorId = '019a0000-0000-7000-8000-0000000000a1';
  const input = {
    provider: 'nominatim',
    url: 'https://nominatim.openstreetmap.org',
    title: 'OpenStreetMap Nominatim',
  };
  const source = (sourceType: SourceData['sourceType']) =>
    Source.create({
      id: asId<'Source'>('019a0000-0000-7000-8000-0000000000b1'),
      actorId,
      now: new Date('2026-11-25T00:00:00Z'),
      data: {
        sourceType,
        title: 'Existing',
        author: null,
        publisher: null,
        publishedYear: null,
        url: input.url,
        isbn: null,
        reliability: 3,
        notes: null,
      },
    });

  let repository: jest.Mocked<Pick<SourceRepository, 'findByUrl'>>;
  let createSource: jest.Mocked<Pick<CreateSource, 'execute'>>;
  let context: { actorId: string | undefined };
  let writer: SourceWriter;

  beforeEach(() => {
    repository = { findByUrl: jest.fn() };
    createSource = { execute: jest.fn() };
    context = { actorId };
    writer = new SourceWriter(
      repository as unknown as SourceRepository,
      createSource as unknown as CreateSource,
      context as unknown as RequestContext,
    );
  });

  it('returns the existing EXTERNAL_API source with that URL', async () => {
    const existing = source('EXTERNAL_API');
    repository.findByUrl.mockResolvedValue(existing);

    await expect(writer.findOrCreateExternalApiSource(input)).resolves.toEqual({
      id: existing.id,
      created: false,
    });
    expect(createSource.execute).not.toHaveBeenCalled();
  });

  it('creates it on first use, by the current user, through the audited use case', async () => {
    const created = source('EXTERNAL_API');
    repository.findByUrl.mockResolvedValue(undefined);
    createSource.execute.mockResolvedValue(created);

    await expect(writer.findOrCreateExternalApiSource(input)).resolves.toEqual({
      id: created.id,
      created: true,
    });
    expect(createSource.execute).toHaveBeenCalledWith({
      actorId,
      data: expect.objectContaining({
        sourceType: 'EXTERNAL_API',
        title: input.title,
        url: input.url,
        publisher: 'nominatim',
        reliability: EXTERNAL_API_RELIABILITY,
      }) as unknown,
    });
  });

  it('refuses a URL that belongs to another kind of source', async () => {
    repository.findByUrl.mockResolvedValue(source('WEBSITE'));
    await expect(writer.findOrCreateExternalApiSource(input)).rejects.toBeInstanceOf(ConflictError);
  });

  it('needs a signed-in user to create one', async () => {
    repository.findByUrl.mockResolvedValue(undefined);
    context.actorId = undefined;
    await expect(writer.findOrCreateExternalApiSource(input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
