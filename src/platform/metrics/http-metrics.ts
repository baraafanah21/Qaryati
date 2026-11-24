import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

/** Route label of requests that matched no route, so random paths add no series. */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Prometheus metrics of one API process: Node's default metrics (event loop lag,
 * heap, GC, CPU) and `http_request_duration_seconds`, a histogram by method,
 * route **template** (`/api/v1/villages/:id`, never the concrete path, so the
 * number of series stays bounded) and status code.
 *
 * Each instance owns its own registry, not prom-client's global one, so two apps
 * in one process (the e2e tests) do not clash on metric names.
 */
export class HttpMetrics {
  readonly registry = new Registry();
  private readonly duration: Histogram<'method' | 'route' | 'status_code'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.duration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests by method, route template and status code.',
      labelNames: ['method', 'route', 'status_code'],
      // From 5 ms to 5 s: the API's reads should sit in the first buckets.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }

  /** Express middleware timing every request until its response is finished. */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      const start = process.hrtime.bigint();
      res.once('finish', () => {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        this.duration.observe(
          { method: req.method, route: routeTemplate(req), status_code: String(res.statusCode) },
          seconds,
        );
      });
      next();
    };
  }
}

/** The matched route's template, with the router's mount path in front. */
export function routeTemplate(req: Pick<Request, 'baseUrl'> & { route?: unknown }): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? `${req.baseUrl}${path}` : UNMATCHED_ROUTE;
}
