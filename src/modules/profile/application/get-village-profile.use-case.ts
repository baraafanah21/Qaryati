import { Injectable } from '@nestjs/common';
import { ClaimQueries, type ClaimProvenance } from '../../curation';
import { EconomyQueries } from '../../economy';
import { HeritageQueries } from '../../heritage';
import type { AuthenticatedUser } from '../../iam';
import { PopulationQueries } from '../../population';
import {
  AdminUnitQueries,
  VILLAGE_FACT_TYPES,
  VillageQueries,
  type VillageFactType,
  type VillageFactValues,
} from '../../village';
import type {
  ProfileAffiliation,
  ProfileFact,
  ProfileRelation,
  Provenance,
  VillageProfile,
} from './village-profile';

type FactValues = { [T in VillageFactType]: Map<string, VillageFactValues[T]> };

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Assembles the village profile (#39) from the public facades of village,
 * curation, population, heritage and economy; profile reads no table itself.
 *
 * **Fixed number of queries**, whatever the number of facts: the identity
 * (1), the provenance of every preferred claim (1), the village fact values
 * (at most one per village fact type, 6), the related villages (at most 1),
 * population (2), heritage (4) and economy (2), plus the administrative units
 * and products, which their modules cache in process. Every list is read whole
 * with `= ANY` / `village_id =` predicates, never one query per fact.
 *
 * Only preferred claims appear: the facades return preferred claims only, and
 * an item is kept only when the provenance query also saw its claim preferred,
 * so a claim that loses the flag between two statements drops out instead of
 * showing without a source.
 */
@Injectable()
export class GetVillageProfile {
  constructor(
    private readonly villages: VillageQueries,
    private readonly adminUnits: AdminUnitQueries,
    private readonly claims: ClaimQueries,
    private readonly population: PopulationQueries,
    private readonly heritage: HeritageQueries,
    private readonly economy: EconomyQueries,
  ) {}

  async execute(idOrSlug: string, user: AuthenticatedUser | undefined): Promise<VillageProfile> {
    // 404 for a missing village and, for anonymous readers, for a draft.
    const village = await this.villages.findVisible(idOrSlug, user);

    // Independent reads, started together; each is a fixed number of statements.
    const contentPromise = Promise.all([
      this.population.historyFor(village.id),
      this.population.latestFor([village.id]),
      this.heritage.sectionsFor(village.id),
      this.economy.sectionsFor(village.id),
      this.adminUnits.list({}),
    ]);
    // The ids of the preferred village facts come from the provenance query.
    const provenanceList = await this.claims.preferredProvenanceFor(village.id);
    const provenance = new Map(provenanceList.map((p) => [p.claimId, p]));
    const [values, content] = await Promise.all([
      this.villageFactValues(provenanceList),
      contentPromise,
    ]);
    const [history, latest, heritage, economy, units] = content;

    const related = await this.relatedVillages(values.RELATION, user);
    const unitsById = new Map(units.map((unit) => [unit.id as string, unit]));

    /** The facts of `rows` whose claim is preferred, each with its provenance. */
    const withProvenance = <V extends { claimId: string }, R = V>(
      rows: Iterable<V>,
      map: (row: V) => R | undefined = (row) => row as unknown as R,
    ): ProfileFact<R>[] => {
      const facts: ProfileFact<R>[] = [];
      for (const row of rows) {
        const claim = provenance.get(row.claimId);
        const value = claim && map(row);
        if (claim && value !== undefined) facts.push({ ...value, ...provenanceOf(claim) });
      }
      return facts;
    };
    const entries = <T extends VillageFactType>(type: T) =>
      [...values[type]].map(([claimId, value]) => ({ claimId, ...value }));

    const names = withProvenance(entries('VILLAGE_NAME'), (n) => ({
      name: n.name,
      lang: n.lang,
      nameType: n.nameType,
      periodFromYear: n.periodFromYear,
      periodToYear: n.periodToYear,
    })).sort(
      (a, b) =>
        Number(b.nameType === 'CURRENT') - Number(a.nameType === 'CURRENT') ||
        byText(a.lang, b.lang) ||
        byText(a.name, b.name),
    );
    const affiliations = withProvenance(
      entries('AFFILIATION'),
      (a): ProfileAffiliation | undefined => {
        const unit = unitsById.get(a.adminUnitId);
        return unit
          ? {
              adminUnit: {
                id: unit.id,
                code: unit.code,
                unitType: unit.unitType,
                era: unit.era,
                nameAr: unit.nameAr,
                nameEn: unit.nameEn,
              },
              validFrom: a.validFrom,
              validTo: a.validTo,
            }
          : undefined;
      },
    ).sort((a, b) => byText(a.validFrom ?? '', b.validFrom ?? ''));
    const relations = withProvenance(entries('RELATION'), (r): ProfileRelation | undefined => {
      const other = related.get(r.relatedVillageId);
      return other ? { relationType: r.relationType, relatedVillage: other } : undefined;
    }).sort((a, b) => byText(a.relationType, b.relationType));
    const populationFact = (row: (typeof history)[number]) => ({
      claimId: row.claimId,
      population: row.population,
      referenceYear: row.referenceYear,
      countType: row.countType,
    });
    const latestRow = latest.get(village.id);

    return {
      village: {
        id: village.id,
        slug: village.slug,
        settlementStatus: village.settlementStatus,
        publicationStatus: village.publicationStatus,
        displayNameAr: village.displayNameAr,
        displayNameEn: village.displayNameEn,
        location: village.location,
        version: village.version,
        createdAt: village.createdAt,
        updatedAt: village.updatedAt,
      },
      names,
      origin: withProvenance(entries('NAME_ORIGIN'))[0] ?? null,
      affiliations,
      location: withProvenance(entries('LOCATION'))[0] ?? null,
      measures: withProvenance(entries('MEASURE')).sort((a, b) => byText(a.kind, b.kind)),
      relations,
      population: {
        latest: latestRow ? (withProvenance([populationFact(latestRow)])[0] ?? null) : null,
        history: withProvenance(history.map(populationFact)),
      },
      heritage: {
        history: heritage.history ? (withProvenance([heritage.history])[0] ?? null) : null,
        events: withProvenance(heritage.events),
        landmarks: withProvenance(heritage.landmarks),
        culturalItems: withProvenance(heritage.culturalItems),
      },
      economy: {
        products: withProvenance(economy.products, (p) => ({
          claimId: p.claimId,
          product: {
            id: p.product.id,
            code: p.product.code,
            category: p.product.category,
            nameAr: p.product.nameAr,
            nameEn: p.product.nameEn,
          },
          significance: p.significance,
        })),
        facilities: withProvenance(economy.facilities),
      },
    };
  }

  /** One statement per village fact type that has preferred claims; none for the others. */
  private async villageFactValues(provenance: readonly ClaimProvenance[]): Promise<FactValues> {
    const ids = new Map<VillageFactType, string[]>(VILLAGE_FACT_TYPES.map((t) => [t, []]));
    for (const p of provenance) ids.get(p.claimType as VillageFactType)?.push(p.claimId);
    const read = <T extends VillageFactType>(type: T) => {
      const claimIds = ids.get(type) ?? [];
      return claimIds.length > 0
        ? this.villages.factValues(type, claimIds)
        : Promise.resolve(new Map<string, VillageFactValues[T]>());
    };
    const [names, origins, affiliations, locations, measures, relations] = await Promise.all([
      read('VILLAGE_NAME'),
      read('NAME_ORIGIN'),
      read('AFFILIATION'),
      read('LOCATION'),
      read('MEASURE'),
      read('RELATION'),
    ]);
    return {
      VILLAGE_NAME: names,
      NAME_ORIGIN: origins,
      AFFILIATION: affiliations,
      LOCATION: locations,
      MEASURE: measures,
      RELATION: relations,
    };
  }

  /**
   * The villages named by relations, in one statement. An anonymous reader
   * does not learn the name of a draft through a relation: relations to
   * villages hidden from `user` are left out.
   */
  private async relatedVillages(
    relations: FactValues['RELATION'],
    user: AuthenticatedUser | undefined,
  ): Promise<Map<string, ProfileRelation['relatedVillage']>> {
    const ids = [...new Set([...relations.values()].map((r) => r.relatedVillageId))];
    if (ids.length === 0) return new Map();
    const villages = await this.villages.findVisibleByIds(ids, user);
    return new Map(
      villages.map((v) => [
        v.id,
        { id: v.id, slug: v.slug, displayNameAr: v.displayNameAr, displayNameEn: v.displayNameEn },
      ]),
    );
  }
}

function provenanceOf(claim: ClaimProvenance): Provenance {
  return {
    claimId: claim.claimId,
    source: claim.source,
    sourceLocator: claim.sourceLocator,
    verifiedAt: claim.verifiedAt,
  };
}
