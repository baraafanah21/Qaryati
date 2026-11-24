import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppEnv } from '../../config/app-env';
import { HttpMetrics } from './http-metrics';

const logger = new Logger('Metrics');

/**
 * Serves `GET /metrics` (Prometheus text format) on its own port, `METRICS_PORT`
 * (#43). It is a separate plain Node server, not a Nest route, so:
 * - it is never reachable through the public port, the reverse proxy or Swagger;
 * - it needs no token and no rate limit, because only the internal network sees it
 *   (Compose does not publish the port);
 * - scraping it does not show up in the metrics it reports.
 *
 * configureApp adds the timing middleware to the public app.
 */
@Global()
@Module({
  providers: [{ provide: HttpMetrics, useFactory: () => new HttpMetrics() }],
  exports: [HttpMetrics],
})
export class MetricsModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private server: Server | undefined;

  constructor(
    @Inject(HttpMetrics) private readonly metrics: HttpMetrics,
    @Inject(ConfigService) private readonly config: ConfigService<AppEnv, true>,
  ) {}

  /** The bound port (useful with `METRICS_PORT=0`), or undefined before startup. */
  get port(): number | undefined {
    return (this.server?.address() as AddressInfo | null)?.port;
  }

  async onApplicationBootstrap(): Promise<void> {
    const server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      this.metrics.registry.metrics().then(
        (body) =>
          res.writeHead(200, { 'Content-Type': this.metrics.registry.contentType }).end(body),
        () => res.writeHead(500).end(),
      );
    });
    const port = this.config.get('METRICS_PORT', { infer: true });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => resolve());
    });
    this.server = server;
    logger.log(`Metrics served on port ${this.port}`);
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
