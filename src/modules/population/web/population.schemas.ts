import { z } from 'zod';
import { CLAIM_STATUSES } from '../../curation';
import { paginationQuery } from '../../../platform/http/pagination';
import { COUNT_TYPES, POPULATION_WARNINGS } from '../domain/population-values';

// Shape limits only; the domain owns the rules (population range, year 1800 … this year).

const population = z.int();
const referenceYear = z.int().min(-9999).max(9999);
const countType = z.enum(COUNT_TYPES);
const sourceId = z.uuid().nullable().optional();
const sourceLocator = z.string().min(1).max(500).nullable().optional();

export const createPopulationBody = z.strictObject({
  population,
  referenceYear,
  countType,
  sourceId,
  sourceLocator,
  supersedesId: z.uuid().nullable().optional(),
});
export type CreatePopulationBody = z.infer<typeof createPopulationBody>;

/** PATCH of an unverified record by its author: any subset of the value and source fields. */
export const updatePopulationBody = z.strictObject({
  population: population.optional(),
  referenceYear: referenceYear.optional(),
  countType: countType.optional(),
  sourceId,
  sourceLocator,
});
export type UpdatePopulationBody = z.infer<typeof updatePopulationBody>;

/** `?page=&size=&includeUnverified=`. */
export const listPopulationQuery = paginationQuery.extend({
  includeUnverified: z.stringbool().default(false),
});
export type ListPopulationQuery = z.infer<typeof listPopulationQuery>;

const recordFields = {
  claimId: z.uuid(),
  status: z.enum(CLAIM_STATUSES),
  isPreferred: z.boolean(),
  sourceId: z.uuid().nullable(),
  sourceLocator: z.string().nullable(),
  supersedesId: z.uuid().nullable(),
  createdBy: z.uuid(),
  /** The claim's version, for `If-Match`. */
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  population: z.int(),
  referenceYear: z.int(),
  countType,
};

export const populationRecordResponse = z
  .strictObject(recordFields)
  .meta({ id: 'PopulationRecordResponse' });
export type PopulationRecordResponse = z.infer<typeof populationRecordResponse>;

export const writtenPopulationRecordResponse = z
  .strictObject({
    ...recordFields,
    warnings: z
      .array(z.enum(POPULATION_WARNINGS))
      .describe(
        'Non-blocking remarks. ANOMALY_SUSPECTED: the average yearly change against the nearest ' +
          'published record of the same count type is above 50%.',
      ),
  })
  .meta({ id: 'WrittenPopulationRecordResponse' });
export type WrittenPopulationRecordResponse = z.infer<typeof writtenPopulationRecordResponse>;

const mark = z.strictObject({
  claimId: z.uuid(),
  referenceYear: z.int(),
  countType,
  population: z.int(),
});

export const populationStatsResponse = z
  .strictObject({
    villageId: z.uuid(),
    series: z.array(
      z.strictObject({
        ...mark.shape,
        previousYear: z.int().nullable(),
        previousPopulation: z.int().nullable(),
        absoluteChange: z.int().nullable(),
        percentChange: z.number().nullable(),
        averageYearlyGrowthPercent: z.number().nullable(),
      }),
    ),
    summary: z
      .strictObject({ first: mark, latest: mark, min: mark, max: mark })
      .nullable()
      .describe('null when the village has no published population record.'),
  })
  .meta({ id: 'PopulationStatsResponse' });
export type PopulationStatsResponse = z.infer<typeof populationStatsResponse>;
