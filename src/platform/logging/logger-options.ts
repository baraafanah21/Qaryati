import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LoggerOptions } from 'pino';
import type { Options } from 'pino-http';
import type { AppEnv } from '../../config/app-env';
import { resolveRequestId } from '../http/request-id';
import { REDACTED, redactDeep } from './redact';

type LoggingEnv = Pick<AppEnv, 'NODE_ENV' | 'LOG_LEVEL'>;

/** The Express additions to a request that the access log reads. */
type RoutedRequest = IncomingMessage & {
  originalUrl?: string;
  route?: { path?: unknown };
  body?: unknown;
  user?: { id?: unknown };
};

/**
 * Base pino options shared by the app logger and the redaction test.
 *
 * - Level from `LOG_LEVEL`.
 * - Sensitive keys (`password`, `token`, `accessToken`, `refreshToken`,
 *   `secret`, ...) in the object of a log call are replaced at any depth by
 *   `formatters.log`. pino does not run formatters on `child()` bindings, so
 *   bindings (and nestjs-pino's `assign`) must never carry secrets.
 * - `redact` additionally covers the credential headers of a request object
 *   someone logs whole (`{ req }`): pino serializes it after the formatter ran.
 */
export function createPinoOptions(env: LoggingEnv): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: REDACTED,
    },
    formatters: {
      log: (object) => redactDeep(object),
    },
  };
}

function accessLine(req: RoutedRequest, res: ServerResponse, durationMs: unknown, env: LoggingEnv) {
  const route = typeof req.route?.path === 'string' ? req.route.path : undefined;
  const userId = req.user?.id;
  return {
    method: req.method,
    route,
    path: (req.originalUrl ?? req.url ?? '').split('?')[0],
    status: res.statusCode,
    durationMs,
    ...(userId === undefined ? {} : { userId }),
    // Bodies can hold personal data; only a developer's own machine logs them.
    ...(env.NODE_ENV === 'development' && req.body !== undefined ? { body: req.body } : {}),
  };
}

/**
 * pino-http options for nestjs-pino: one JSON access-log line per request with
 * method, route, path, status, duration, requestId and (once #10 sets
 * `req.user`) userId. Pretty-printed only in `development`.
 */
export function createPinoHttpOptions(env: LoggingEnv): Options {
  return {
    ...createPinoOptions(env),
    genReqId: (req, res) => resolveRequestId(req, res),
    // Only the request ID is bound to every line; the access line is built below.
    quietReqLogger: true,
    quietResLogger: true,
    customAttributeKeys: { reqId: 'requestId', responseTime: 'durationMs' },
    customLogLevel: (_req, res, error) => (error || res.statusCode >= 500 ? 'error' : 'info'),
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
    customSuccessObject: (req, res, val: { durationMs?: unknown }) =>
      accessLine(req, res, val.durationMs, env),
    // The problem filter has already logged the error with its stack.
    customErrorObject: (req, res, _error, val: { durationMs?: unknown }) =>
      accessLine(req, res, val.durationMs, env),
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' } }
        : undefined,
  };
}
