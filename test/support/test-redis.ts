import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/** Same image as the `redis` service in docker-compose.yml; keep the two in sync. */
export const REDIS_IMAGE = 'redis:7.4-alpine';

/** A throwaway Redis, like the Compose `redis` service. */
export interface TestRedis {
  url: string;
  container: StartedTestContainer;
  stop(): Promise<void>;
}

/** Starts a Redis container; the rate-limit and readiness tests talk to it for real. */
export async function startTestRedis(): Promise<TestRedis> {
  const container = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    container,
    stop: async () => {
      await container.stop();
    },
  };
}
