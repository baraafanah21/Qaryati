/**
 * dependency-cruiser rules for Qaryati. They turn the architecture in
 * docs/architecture.md into failing checks. Every rule is an error.
 *
 * Run: npm run depcruise
 */

/**
 * Allowed module dependencies: module -> modules whose index.ts it may import.
 * Every module may also import src/shared. Keep this table identical to the
 * "Dependency directions" table in docs/architecture.md.
 */
const ALLOWED = {
  iam: [],
  curation: ['iam'],
  audit: [],
  village: ['iam', 'curation'],
  population: ['iam', 'curation', 'village'],
  heritage: ['iam', 'curation', 'village'],
  economy: ['iam', 'curation', 'village'],
  geo: ['iam', 'curation', 'village'],
  profile: ['iam', 'curation', 'village', 'population', 'heritage', 'economy'],
};

const MODULES = Object.keys(ALLOWED);

// Frameworks and drivers that must never reach domain code. The second form
// matches packages that are not installed yet (resolved by name only).
const FRAMEWORKS = '(@nestjs/|drizzle-orm(/|$)|pg(/|$)|ioredis(/|$)|express(/|$))';

/** One rule per module: it may not import modules outside its allowed list. */
const directionRules = MODULES.map((module) => {
  const forbidden = MODULES.filter((m) => m !== module && !ALLOWED[module].includes(m));
  return {
    name: 'module-dependency-direction',
    comment:
      `${module} may import only: ${ALLOWED[module].join(', ') || 'no other module'} ` +
      '(see docs/architecture.md, "Dependency directions").',
    severity: 'error',
    from: { path: `^src/modules/${module}/` },
    to: { path: `^src/modules/(${forbidden.join('|')})/` },
  };
}).filter((rule) => !rule.to.path.includes('()'));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Import cycles make modules impossible to change or test in isolation.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-framework-free',
      comment:
        'domain/ is plain TypeScript: no NestJS, Drizzle, pg, ioredis or Express, ' +
        'and no imports from the outer layers of any module.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: {
        path: [
          `^(node_modules/)?${FRAMEWORKS}`,
          '^src/modules/[^/]+/(web|application|infrastructure)/',
        ],
      },
    },
    {
      name: 'application-not-to-outer-layers',
      comment: 'application/ (use cases) must not depend on web/ or infrastructure/.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/application/' },
      to: { path: '^src/modules/[^/]+/(web|infrastructure)/' },
    },
    {
      name: 'no-cross-module-internals',
      comment: 'Another module may be imported only through its public index.ts.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    ...directionRules,
    {
      name: 'domain-imports-only-kernel',
      comment:
        'domain/ may use src/shared/kernel (plain TypeScript) and nothing else from ' +
        'src/shared or src/platform: platform code is framework code.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: { path: '^src/(shared|platform)/', pathNot: '^src/shared/kernel/' },
    },
    {
      name: 'kernel-is-framework-free',
      comment:
        'src/shared/kernel is imported by domain code, so it is plain TypeScript too: ' +
        'no npm packages at all (NestJS, Drizzle, pg, uuid, ...).',
      severity: 'error',
      from: { path: '^src/shared/kernel/' },
      to: { path: [`^(node_modules/)?${FRAMEWORKS}`, '^node_modules/'] },
    },
    {
      name: 'shared-is-independent',
      comment: 'The shared kernel sits below every module and must not import them or platform.',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/(modules|platform)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Type-only imports count too: a domain file importing a Drizzle type is a violation.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
