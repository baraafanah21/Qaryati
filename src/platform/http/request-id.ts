import type { IncomingMessage, ServerResponse } from 'node:http';
import { v7 as uuidv7 } from 'uuid';

/** Header that carries the request ID in both directions. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

// A UUID, or a conservative token. Anything else (too long, spaces, CR/LF) is
// replaced, so a client cannot inject text into our logs or response headers.
const SAFE_REQUEST_ID =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9-]{8,64})$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * Returns the ID of this request, assigning it on first call: the incoming
 * `X-Request-Id` when it is safe, otherwise a new UUIDv7. The ID is stored on
 * `req.id` and echoed in the `X-Request-Id` response header.
 *
 * Both the CLS middleware (nestjs-cls) and the access logger (pino-http) call
 * this, in whichever order Nest mounts them; the first call decides and the
 * second reads `req.id`, so logs, CLS and the response always agree.
 */
export function resolveRequestId(req: IncomingMessage, res?: ServerResponse): string {
  const request = req as RequestWithId;
  if (typeof request.id === 'string') {
    return request.id;
  }
  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : uuidv7();
  request.id = id;
  if (res && !res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER, id);
  }
  return id;
}
