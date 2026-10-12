import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports the process as alive', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });
});
