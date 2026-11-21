import { get } from 'node:https';
import { z } from 'zod';
import type { GeocodingCandidate, GeocodingPort } from '../application/geocoding.port';

const resultSchema = z.array(
  z.object({
    display_name: z.string().min(1),
    lat: z.string().min(1).transform(Number).pipe(z.number().finite().min(-90).max(90)),
    lon: z.string().min(1).transform(Number).pipe(z.number().finite().min(-180).max(180)),
  }),
);

export class NominatimAdapter implements GeocodingPort {
  constructor(private readonly userAgent: string) {
    if (!userAgent.trim()) {
      throw new Error('Nominatim User-Agent is required');
    }
  }

  async search(query: string): Promise<GeocodingCandidate[]> {
    if (!query.trim()) return [];

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query.trim());
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');

    return new Promise<GeocodingCandidate[]>((resolve, reject) => {
      const request = get(
        url,
        {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json',
          },
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Nominatim HTTP ${response.statusCode}`));
            return;
          }

          let body = '';
          response.setEncoding('utf8');

          response.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > 1_000_000) {
              request.destroy(new Error('Nominatim response too large'));
            }
          });

          response.on('end', () => {
            try {
              const payload: unknown = JSON.parse(body);
              const results = resultSchema.parse(payload);

              resolve(
                results.map((item) => ({
                  displayName: item.display_name,
                  latitude: item.lat,
                  longitude: item.lon,
                })),
              );
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });

          response.on('error', reject);
        },
      );

      request.setTimeout(5000, () => {
        request.destroy(new Error('Nominatim request timed out'));
      });

      request.on('error', reject);
    });
  }
}
