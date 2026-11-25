import { assertNotProduction } from './production-guard';

describe('assertNotProduction', () => {
  it('refuses production', () => {
    expect(() => assertNotProduction('production', 'db:seed')).toThrow(
      'db:seed refuses to run with NODE_ENV=production',
    );
  });

  it.each(['development', 'test'])('allows %s', (env) => {
    expect(() => assertNotProduction(env, 'db:seed')).not.toThrow();
  });
});
