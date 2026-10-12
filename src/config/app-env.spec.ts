import { appEnvSchema } from './app-env';

const DATABASE_URL = 'postgres://qaryati_app:secret@localhost:5432/qaryati';

describe('appEnvSchema', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(appEnvSchema.parse({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
    });
  });

  it('turns PORT from a string into a number', () => {
    expect(appEnvSchema.parse({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['0', '70000', 'abc', '3.5'])('rejects PORT=%s', (port) => {
    const result = appEnvSchema.safeParse({ DATABASE_URL, PORT: port });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['PORT']);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(appEnvSchema.safeParse({ DATABASE_URL, NODE_ENV: 'staging' }).success).toBe(false);
  });

  it('requires DATABASE_URL', () => {
    const result = appEnvSchema.safeParse({});
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['DATABASE_URL'], message: 'is required' }),
    ]);
  });

  it.each(['mysql://u:p@localhost/qaryati', 'localhost:5432', ''])(
    'rejects DATABASE_URL=%j',
    (url) => {
      const result = appEnvSchema.safeParse({ DATABASE_URL: url });
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ['DATABASE_URL'],
          message: 'must be a postgres:// connection URL',
        }),
      ]);
    },
  );
});
