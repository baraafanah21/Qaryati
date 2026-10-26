import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { readFile, writeFile } from 'node:fs/promises';
import request from 'supertest';
import type { App } from 'supertest/types';
import { appEnvSchema, type AppEnv } from '../src/config/app-env';
import {
  createTestTokenIssuer,
  CurrentUser,
  PermissionChecker,
  Public,
  Role,
  Roles,
  type AuthenticatedUser,
  type TestTokenIssuer,
} from '../src/modules/iam';
import { IamModule } from '../src/modules/iam/iam.module';
import { RequestContext } from '../src/platform/context/request-context';
import { RequestContextModule } from '../src/platform/context/request-context.module';
import { configureApp } from '../src/platform/http/configure-app';
import { HttpPlatformModule } from '../src/platform/http/http-platform.module';
import { ApiModule } from '../src/platform/http/openapi';
import { KernelModule } from '../src/platform/kernel/kernel.module';
import { LoggingModule } from '../src/platform/logging/logging.module';
import { AuditPlaceholderModule } from '../src/platform/audit/audit-placeholder.module';
import { DatabaseModule } from '../src/platform/database/database.module';
import {
  startTestDatabase,
  type TestDatabase,
  CONTAINER_STARTUP_TIMEOUT_MS,
} from './support/test-database';
import { CLOCK, FixedClock } from '../src/shared/kernel';
import { createTestJwtKeys, type TestJwtKeys } from './support/jwt-test-keys';

@ApiModule('iamprobe')
@Controller('__iam')
class IamProbeController {
  constructor(
    private readonly context: RequestContext,
    private readonly permissions: PermissionChecker,
  ) {}

  @Get('identity')
  async identity(@CurrentUser() user: AuthenticatedUser | undefined) {
    // Yield to let other requests overlap and expose any accidental shared identity.
    await new Promise<void>((resolve) => setImmediate(resolve));
    return {
      user: user ?? null,
      actorId: this.context.actorId ?? null,
      editor: this.permissions.hasRole(user, Role.EDITOR),
    };
  }

  @Public()
  @Get('public')
  publicIdentity(@CurrentUser() user: AuthenticatedUser | undefined) {
    return { user: user ?? null, actorId: this.context.actorId ?? null };
  }

  @Roles(Role.EDITOR)
  @Get('editor')
  editor() {
    return { allowed: true };
  }

  @Roles(Role.ADMIN, Role.CONTRIBUTOR)
  @Get('any')
  any() {
    return { allowed: true };
  }

  @Public()
  @Roles(Role.ADMIN)
  @Get('conflict')
  conflict() {
    return { allowed: true };
  }
}

@ApiModule('iamclass')
@Roles(Role.ADMIN)
@Controller('__iam-class')
class ClassRoleController {
  @Get()
  admin() {
    return { allowed: true };
  }

  @Roles(Role.CONTRIBUTOR)
  @Get('override')
  override() {
    return { allowed: true };
  }
}

@ApiModule('iampublic')
@Public()
@Controller('__iam-public')
class PublicClassController {
  @Get()
  public() {
    return { allowed: true };
  }
}

@Module({
  imports: [
    LoggingModule,
    RequestContextModule,
    HttpPlatformModule,
    KernelModule,
    DatabaseModule,
    AuditPlaceholderModule,
    IamModule,
  ],
  controllers: [IamProbeController, ClassRoleController, PublicClassController],
})
class IamTestModule {}

// Real Nest/HTTP and #10 guards, with the persistence wiring introduced by #14.
describe('IAM guards and public API (integration)', () => {
  let app: INestApplication<App>;
  let keys: TestJwtKeys;
  let issuer: TestTokenIssuer;
  let database: TestDatabase;
  const clock = new FixedClock('2026-10-24T10:00:00Z');
  const id = '00000000-0000-7000-8000-000000000001';
  const secondId = '00000000-0000-7000-8000-000000000002';
  let contributor: string;
  let editor: string;
  let admin: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    keys = await createTestJwtKeys();
    const env = appEnvSchema.parse({
      DATABASE_URL: database.appUrl,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JWT_PRIVATE_KEY_FILE: keys.privateKeyFile,
      JWT_PUBLIC_KEY_FILE: keys.publicKeyFile,
      JWT_ISSUER: 'test',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => env],
        }),
        IamTestModule,
      ],
    })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    issuer = await createTestTokenIssuer({ ...keys, issuer: 'test', clock });
    contributor = await issuer.mint({ id, role: Role.CONTRIBUTOR });
    editor = await issuer.mint({ id, role: Role.EDITOR });
    admin = await issuer.mint({ id, role: Role.ADMIN });
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await keys?.cleanup();
    await database?.stop();
  });

  it.each([
    undefined,
    'Basic credentials',
    'Bearer',
    'Bearer malformed',
    'Bearer a b',
    'Bearer a,b',
  ])('denies missing/malformed credentials (%s) with ProblemDetails', async (header) => {
    const req = request(app.getHttpServer()).get('/api/v1/__iam/identity');
    if (header !== undefined) req.set('Authorization', header);
    const response = await req.expect(401);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      traceId: response.headers['x-request-id'] as string,
    });
    expect(response.text).not.toContain('stack');
  });

  it('sets CurrentUser and the existing actor context from verified sub', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/__iam/identity')
      .auth(editor, { type: 'bearer' })
      .expect(200);
    expect(response.body).toEqual({ user: { id, role: Role.EDITOR }, actorId: id, editor: true });
  });

  it('keeps public methods and controllers anonymous even with invalid or valid credentials', async () => {
    for (const token of ['malformed', contributor]) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/__iam/public')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(response.body).toEqual({ user: null, actorId: null });
    }
    await request(app.getHttpServer()).get('/api/v1/__iam/public').expect(200);
    await request(app.getHttpServer()).get('/api/v1/__iam-public').expect(200);
  });

  it('enforces role hierarchy and OR semantics after authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/__iam/editor').expect(401);
    const denied = await request(app.getHttpServer())
      .get('/api/v1/__iam/editor')
      .auth(contributor, { type: 'bearer' })
      .expect(403);
    expect(denied.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(denied.body).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    for (const token of [editor, admin]) {
      await request(app.getHttpServer())
        .get('/api/v1/__iam/editor')
        .auth(token, { type: 'bearer' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/api/v1/__iam/any')
      .auth(contributor, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/__iam-class')
      .auth(editor, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/__iam-class')
      .auth(admin, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/__iam-class/override')
      .auth(contributor, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer()).get('/api/v1/__iam/conflict').expect(403);
  });

  it('does not share actors across concurrent authenticated and public requests', async () => {
    const other = await issuer.mint({ id: secondId, role: Role.ADMIN });
    const identities = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const [first, second, anonymous] = await Promise.all([
          request(app.getHttpServer())
            .get('/api/v1/__iam/identity')
            .auth(contributor, { type: 'bearer' })
            .expect(200),
          request(app.getHttpServer())
            .get('/api/v1/__iam/identity')
            .auth(other, { type: 'bearer' })
            .expect(200),
          request(app.getHttpServer()).get('/api/v1/__iam/public').expect(200),
        ]);
        return [first.body as unknown, second.body as unknown, anonymous.body as unknown];
      }),
    );
    for (const [first, second, anonymous] of identities) {
      expect(first).toMatchObject({ user: { id, role: Role.CONTRIBUTOR }, actorId: id });
      expect(second).toMatchObject({ user: { id: secondId, role: Role.ADMIN }, actorId: secondId });
      expect(anonymous).toEqual({ user: null, actorId: null });
    }
  });

  it('rejects expired tokens and tokens from another key pair through the HTTP pipeline', async () => {
    const expired = await issuer.mint({ id, role: Role.ADMIN }, -1);
    await request(app.getHttpServer())
      .get('/api/v1/__iam/identity')
      .auth(expired, { type: 'bearer' })
      .expect(401);
    const foreign = await createTestJwtKeys();
    try {
      const foreignIssuer = await createTestTokenIssuer({ ...foreign, issuer: 'test', clock });
      const token = await foreignIssuer.mint({ id, role: Role.ADMIN });
      await request(app.getHttpServer())
        .get('/api/v1/__iam/identity')
        .auth(token, { type: 'bearer' })
        .expect(401);
    } finally {
      await foreign.cleanup();
    }
  });

  it('documents public opt-outs, default bearer requirements and 401/403 problem responses', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const doc = response.body as {
      paths: Record<string, { get: { security: unknown; responses: Record<string, unknown> } }>;
    };
    expect(doc.paths['/api/v1/__iam/public']?.get.security).toEqual([]);
    expect(doc.paths['/api/v1/__iam-public']?.get.security).toEqual([]);
    expect(doc.paths['/api/v1/__iam/identity']?.get.security).toEqual([{ bearer: [] }]);
    expect(doc.paths['/api/v1/__iam/identity']?.get.responses).toHaveProperty('401');
    expect(doc.paths['/api/v1/__iam/editor']?.get.responses).toHaveProperty('403');
  });

  it('fails application compilation on invalid secret files without exposing key material', async () => {
    const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
    const privatePem = await readFile(keys.privateKeyFile, 'utf8');
    await writeFile(keys.privateKeyFile, 'invalid-secret');
    try {
      await expect(
        Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              ignoreEnvFile: true,
            }),
            IamTestModule,
          ],
        })
          .overrideProvider(ConfigService)
          .useValue(config)
          .compile(),
      ).rejects.toThrow('JWT key files must contain');
    } finally {
      await writeFile(keys.privateKeyFile, privatePem, { mode: 0o600 });
    }
  });
});
