import { Test } from '@nestjs/testing';
import { SourceQueries } from './source-queries';
import { SOURCE_REPOSITORY, type SourceRepository } from '../domain/source.repository';
import { asId } from '../../../shared/kernel';

describe('SourceQueries', () => {
  let queries: SourceQueries;
  let repository: jest.Mocked<Pick<SourceRepository, 'exists'>>;

  const sourceId = asId<'Source'>('019a1836-50be-711f-89d1-217f90834922');

  beforeEach(async () => {
    repository = {
      exists: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        SourceQueries,
        {
          provide: SOURCE_REPOSITORY,
          useValue: repository,
        },
      ],
    }).compile();

    queries = module.get(SourceQueries);
  });

  it('returns true when the source exists', async () => {
    repository.exists.mockResolvedValue(true);

    await expect(queries.exists(sourceId)).resolves.toBe(true);
    expect(repository.exists).toHaveBeenCalledWith(sourceId);
  });

  it('returns false when the source does not exist', async () => {
    repository.exists.mockResolvedValue(false);

    await expect(queries.exists(sourceId)).resolves.toBe(false);
    expect(repository.exists).toHaveBeenCalledWith(sourceId);
  });
});
