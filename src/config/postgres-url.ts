import { z } from 'zod';

/** A required `postgres://` or `postgresql://` connection URL. */
export const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: (issue) =>
    issue.input === undefined ? 'is required' : 'must be a postgres:// connection URL',
});
