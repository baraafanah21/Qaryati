// ESLint flat config. Type-aware rules catch async bugs that the compiler
// misses (floating and misused promises); Prettier owns formatting, so
// eslint-config-prettier turns off every stylistic rule that would conflict.
import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', 'coverage/', 'node_modules/']),
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Business code gets time and ids through the kernel ports (Clock,
    // IdGenerator), so tests can fix both. See docs/kernel.md.
    files: ['src/modules/*/domain/**/*.ts', 'src/modules/*/application/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Inject CLOCK and call clock.now() instead of new Date() (docs/kernel.md).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Inject CLOCK and call clock.now() instead of Date.now() (docs/kernel.md).',
        },
        {
          selector: "CallExpression[callee.property.name='randomUUID']",
          message:
            'Inject ID_GENERATOR and call ids.next() instead of randomUUID() (docs/kernel.md).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'uuid', message: 'Inject ID_GENERATOR and call ids.next() (docs/kernel.md).' },
            ...['crypto', 'node:crypto'].map((name) => ({
              name,
              importNames: ['randomUUID'],
              message: 'Inject ID_GENERATOR and call ids.next() (docs/kernel.md).',
            })),
          ],
        },
      ],
    },
  },
  {
    // Plain JavaScript config files are outside tsconfig, so lint them without types.
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  prettier,
);
