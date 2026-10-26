# Error catalogue

Every error the API returns has the same shape ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details) and the media type `application/problem+json`:

```json
{
  "type": "https://github.com/baraafanah21/Qaryati/blob/main/docs/errors.md#validation-failed",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "detail": "The request is invalid. See errors for each field.",
  "instance": "/api/v1/villages",
  "traceId": "0192f0c4-8e1a-7c3b-9d2e-5f6a7b8c9d0e",
  "timestamp": "2026-10-15T08:00:00.000Z",
  "errors": [{ "field": "names[0].lang", "code": "REQUIRED", "message": "This field is required." }]
}
```

| Field       | Meaning                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `type`      | Link to the section of this page that explains `code`.                                                                                    |
| `title`     | Short, fixed text for the code. Do not parse it.                                                                                          |
| `status`    | The HTTP status, repeated in the body.                                                                                                    |
| `code`      | **Stable machine-readable code. Clients branch on this field only.**                                                                      |
| `detail`    | Human-readable explanation of this occurrence. May change wording at any time.                                                            |
| `instance`  | The request path (without the query string).                                                                                              |
| `traceId`   | The request ID, also sent in the `X-Request-Id` response header. Quote it when reporting a problem; every log line of the request has it. |
| `timestamp` | When the error was produced (ISO 8601, UTC).                                                                                              |
| `errors`    | Only on validation failures: one entry per invalid field (see [Field codes](#field-codes)).                                               |

Responses never contain stack traces, SQL, table names or constraint names. Database logs retain safe SQLSTATE/constraint/table/column metadata under the same `traceId`, without SQL text, query parameters or failing-row details.

The catalogue lives in [`src/shared/kernel/errors/error-codes.ts`](../src/shared/kernel/errors/error-codes.ts). A unit test fails if a code there has no section here. How to throw each error from code: [kernel.md](kernel.md#throwing-errors).

## Codes

<a id="validation-failed"></a>

### `VALIDATION_FAILED`

- **Status:** 400 when the request does not match its schema (body, query or path). 422 when the request is well formed but the domain rejects a value (`ValidationError`).
- **Meaning:** the input is invalid. `errors[]` lists each invalid field with a [field code](#field-codes).
- **When:** a required field is missing, a value has the wrong type or length, an unknown property is sent, `size=500`, an unknown sort field; malformed JSON; other client errors the framework raises without a more specific code (for example 413, body too large).
- **Client:** fix the listed fields and send the request again. Do not retry unchanged.

<a id="not-found"></a>

### `NOT_FOUND`

- **Status:** 404
- **Meaning:** the resource does not exist, or the route does not exist.
- **When:** an unknown id or slug; a parent that does not exist when creating a child (the service checks this before inserting).
- **Client:** check the id. Do not retry.

<a id="duplicate"></a>

### `DUPLICATE`

- **Status:** 409
- **Meaning:** a record with the same unique value already exists.
- **When:** a service detects the clash (`ConflictError`), or the database rejects the insert with a unique violation (SQLSTATE `23505`).
- **Client:** use a different value, or fetch the existing record.

<a id="reference-conflict"></a>

### `REFERENCE_CONFLICT`

- **Status:** 409
- **Meaning:** the change would break a reference between records.
- **When:** the database rejects a foreign key (SQLSTATE `23503`): deleting a record others still point to, or pointing to a record that does not exist. Services check a missing parent first and answer `NOT_FOUND`, so clients normally see this code only for the delete case.
- **Client:** remove or change the dependent records first.

<a id="constraint-violation"></a>

### `CONSTRAINT_VIOLATION`

- **Status:** 422
- **Meaning:** the data breaks a rule: a business rule in the domain (`BusinessRuleViolationError`), or a database check or not-null constraint (SQLSTATE `23514`, `23502`).
- **When:** for example a value outside the range a check constraint allows. Modules may add more specific codes for rules clients must tell apart.
- **Client:** change the data; `detail` says which rule failed when the domain raised it.

<a id="version-conflict"></a>

### `VERSION_CONFLICT`

- **Status:** 412 (also 409 when a service raises it as a `ConflictError`)
- **Meaning:** the resource changed since the client read it (optimistic locking).
- **When:** the `If-Match` version of a `PATCH` or `DELETE` no longer matches the stored one: someone else changed the resource since this client read it ([kernel.md](kernel.md#optimistic-locking-version-etag-and-if-match)).
- **Client:** fetch the resource again (new `ETag`), reapply the change, send it with the new `If-Match`.

<a id="precondition-required"></a>

### `PRECONDITION_REQUIRED`

- **Status:** 428
- **Meaning:** this request must say which version it changes, and it did not.
- **When:** a `PATCH` or `DELETE` of a versioned resource without an `If-Match` header. A malformed `If-Match` (`W/"3"`, `*`, a list, no quotes) is a 400 `VALIDATION_FAILED` with field `If-Match` instead.
- **Client:** read the resource and send its `ETag` back: `If-Match: "3"`.

<a id="unauthenticated"></a>

### `UNAUTHENTICATED`

- **Status:** 401
- **Meaning:** no valid credentials were sent.
- **When:** a missing, malformed or expired access token.
- **Client:** log in or refresh the token, then retry.

<a id="forbidden"></a>

### `FORBIDDEN`

- **Status:** 403
- **Meaning:** the caller is known but may not do this.
- **When:** a role guard rejects the request, or the domain refuses the action for this user (`ForbiddenError`).
- **Client:** do not retry with the same account.

<a id="rate-limited"></a>

### `RATE_LIMITED`

- **Status:** 429
- **Meaning:** too many requests in a short time.
- **When:** a rate limit (#25) is exceeded.
- **Client:** wait (see the `Retry-After` header when present), then retry.

<a id="service-unavailable"></a>

### `SERVICE_UNAVAILABLE`

- **Status:** 503
- **Meaning:** the API cannot answer right now; the request itself may be fine.
- **When:** a database statement timed out (SQLSTATE `57014`), or a dependency is down.
- **Client:** retry later with backoff.

<a id="internal-error"></a>

### `INTERNAL_ERROR`

- **Status:** 500
- **Meaning:** an unexpected error on the server. The response has a generic `detail`; the full error is logged with the `traceId`.
- **When:** a bug, or a database error without a specific mapping.
- **Client:** retry once at most, then report the `traceId`.

## Field codes

Entries of `errors[]` have `field` (the full path, like `names[0].lang`; an empty string means the whole body), a stable `code` from this table, and a `message` for humans.

| Code                 | Meaning                                                    |
| -------------------- | ---------------------------------------------------------- |
| `REQUIRED`           | The field is missing.                                      |
| `UNKNOWN_FIELD`      | The field is not part of the request; remove it.           |
| `INVALID_TYPE`       | Wrong type, e.g. text where a number is expected.          |
| `NOT_INTEGER`        | A number with a fraction where an integer is expected.     |
| `INVALID_FORMAT`     | Not a valid UUID, date, URL, email, ...                    |
| `INVALID_VALUE`      | Not one of the accepted values.                            |
| `NOT_ALLOWED`        | A value outside an allow-list, e.g. an unknown sort field. |
| `TOO_SHORT`          | Text shorter than the minimum.                             |
| `TOO_LONG`           | Text longer than the maximum.                              |
| `TOO_SMALL`          | A number below the minimum, e.g. `size=0` or `page=-1`.    |
| `TOO_LARGE`          | A number above the maximum, e.g. `size=101`.               |
| `TOO_FEW`            | A list with fewer items than the minimum.                  |
| `TOO_MANY`           | A list with more items than the maximum.                   |
| `MUST_NOT_BE_FUTURE` | A date that must not be after today.                       |

## Adding a code

1. Add it to `ErrorCode` (or `FieldErrorCode`) in [`error-codes.ts`](../src/shared/kernel/errors/error-codes.ts).
2. For an `ErrorCode`, add its title to `ERROR_TITLES` in [`problem-details.ts`](../src/platform/http/problem-details.ts) (the compiler insists).
3. Add a section here with `<a id="...">` (the code in lowercase kebab case) and the four bullets, or a row in the field code table.
4. `npm run test:unit` checks that step 3 is done.

<a id="invalid-credentials"></a>

### `INVALID_CREDENTIALS`

- **Status:** 401
- **Meaning:** login failed. Unknown email, wrong password, disabled and deleted accounts all return the same public detail: `The email or password is incorrect.`
- **Client:** check the credentials. This response does not disclose account existence. Malformed request bodies still return 400 `VALIDATION_FAILED`.
- **Implementation:** `UnauthenticatedError` is the kernel category mapped to 401; pass `ErrorCode.INVALID_CREDENTIALS` for login. Existing bearer failures remain `UNAUTHENTICATED`.
