import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppEnv } from '../../src/config/app-env';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { CLOCK, type Clock } from '../../src/shared/kernel';

/** Keeps IAM-specific test wiring outside the module-independent reference template. */
export async function createAuthenticatedAgent(app: INestApplication<App>) {
  const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
  const issuer = await createTestTokenIssuer({
    privateKeyFile: config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
    publicKeyFile: config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
    issuer: config.get('JWT_ISSUER', { infer: true }),
    clock: app.get<Clock>(CLOCK),
  });
  const token = await issuer.mint({
    id: '00000000-0000-7000-8000-000000000001',
    role: Role.CONTRIBUTOR,
  });
  return request.agent(app.getHttpServer()).set('Authorization', `Bearer ${token}`);
}
