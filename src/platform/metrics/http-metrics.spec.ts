import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { HttpMetrics, UNMATCHED_ROUTE, routeTemplate } from './http-metrics';

describe('HttpMetrics', () => {
  it('labels requests by route template, never by concrete path', () => {
    expect(routeTemplate({ baseUrl: '', route: { path: '/api/v1/villages/:id' } })).toBe(
      '/api/v1/villages/:id',
    );
    expect(routeTemplate({ baseUrl: '' })).toBe(UNMATCHED_ROUTE);
  });

  it('records the duration histogram when the response finishes', async () => {
    const metrics = new HttpMetrics();
    const req = { method: 'GET', baseUrl: '', route: { path: '/api/v1/villages/:id' } };
    const res = Object.assign(new EventEmitter(), { statusCode: 404 });
    const next = jest.fn();
    metrics.middleware()(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    res.emit('finish');
    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/v1/villages/:id",status_code="404"} 1',
    );
    expect(text).toContain('process_cpu_user_seconds_total');
  });
});
