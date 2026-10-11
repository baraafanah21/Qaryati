// Conventional Commits with the module as scope (docs/workflow.md).
// The scope list is closed so a typo such as "vilage" fails the commit.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'platform',
        'shared',
        'village',
        'population',
        'heritage',
        'economy',
        'curation',
        'audit',
        'iam',
        'geo',
        'profile',
        'web',
        'deps',
      ],
    ],
  },
};
