import { ConfigModule } from '@nestjs/config';
import { appEnvSchema } from './app-env';

// Guards the startup error format: if a @nestjs/config upgrade changes how
// Standard Schema issues are reported, this test shows it before a teammate
// meets an unreadable startup error.
describe('configuration validation at startup', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('names every invalid variable with its reason', async () => {
    process.env.PORT = '70000';
    process.env.NODE_ENV = 'staging';
    delete process.env.DATABASE_URL;

    await expect(
      ConfigModule.forRoot({ ignoreEnvFile: true, validationSchema: appEnvSchema }),
    ).rejects.toThrow(
      /^Config validation error: NODE_ENV: .*\nPORT: must be between 1 and 65535\nDATABASE_URL: is required$/,
    );
  });

  it('rejects invalid JWT_ACCESS_TTL during startup validation', async () => {
    process.env.DATABASE_URL = 'postgres://qaryati_app:test@localhost/test';
    process.env.JWT_ACCESS_TTL = 'invalid';
    await expect(
      ConfigModule.forRoot({ ignoreEnvFile: true, validationSchema: appEnvSchema }),
    ).rejects.toThrow(/JWT_ACCESS_TTL: must be a positive integer followed by s, m or h/);
  });

  it('keeps the default JWT_ACCESS_TTL=15m valid across repeated startup validation', async () => {
    process.env.DATABASE_URL = 'postgres://qaryati_app:test@localhost/test';
    delete process.env.JWT_ACCESS_TTL;
    await ConfigModule.forRoot({ ignoreEnvFile: true, validationSchema: appEnvSchema });
    expect(process.env.JWT_ACCESS_TTL).toBe('15m');
    await expect(
      ConfigModule.forRoot({ ignoreEnvFile: true, validationSchema: appEnvSchema }),
    ).resolves.toBeDefined();
  });
});
