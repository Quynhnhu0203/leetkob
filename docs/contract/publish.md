# `POST /v1/labs/{labId}/publish` — contract, version 1

LeeTKOB · CSC13114 PA#2 · frozen 2026-11-08

This file is the specification. `test/contract/publish.contract.test.ts` checks the
implementation against it. If the code and this file disagree, the code is wrong. If this
file is wrong, change it in a **separate commit** that says why, before or without touching
the tests' expectations in the same commit.

Publishing is the step in LeeTKOB that is hard to undo: once a lab is published, every student
of the class sees their mark and deductions, and appeals open. That is why this endpoint refuses
while any verdict still awaits the TA's review, and why it is safe to send twice.

## 1. Conventions

- The endpoint lives under `/v1`. Requests and responses are JSON, UTF-8.
- Ids are positive integers from 1 to 2147483647. Timestamps are ISO 8601 strings in UTC with
  milliseconds, e.g. `2026-11-11T14:00:00.000Z`.
- **Authentication**: every request carries `Authorization: Bearer <token>`. The token
  identifies one user with exactly one role: `admin`, `ta` or `student`.
- Clients ignore response fields they do not know. The server ignores request fields it does
  not know.

## 2. Errors

Every 4xx or 5xx response — including a request for a `/v1` path that does not exist — is a
**problem details** object (RFC 9457) with `Content-Type: application/problem+json`:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://leetkob.example/problems/reviews-pending",
  "title": "Reviews pending",
  "status": 409,
  "detail": "3 verdict(s) still await review.",
  "pendingReviews": 3
}
```

| Member    | Rule                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `type`    | `https://leetkob.example/problems/` followed by a slug from the table below. No other values                             |
| `title`   | the title from the table below, exactly                                                                                  |
| `status`  | a number, equal to the HTTP status of the response                                                                       |
| `detail`  | one sentence about **this** occurrence. Never a stack trace, an SQL message, a file path, a token or another user's data |
| extension | only the ones named in the table: `errors`, `closesAt`, `pendingReviews`                                                 |

| Slug                     | Status | Title                     | When                                                                                                                          | Extension                                                            |
| ------------------------ | ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `unauthenticated`        | 401    | Authentication required   | `Authorization` missing, not `Bearer <token>`, or the token is unknown                                                        | — (response also carries `WWW-Authenticate: Bearer realm="leetkob"`) |
| `forbidden`              | 403    | Not allowed for this role | the caller's role is `student` or `admin`                                                                                     | —                                                                    |
| `not-found`              | 404    | Not found                 | no lab with that id, the id is not a valid id, **or the lab belongs to a class the TA does not teach**, or no such `/v1` path | —                                                                    |
| `unsupported-media-type` | 415    | Unsupported media type    | `Content-Type` is missing or is not `application/json` (parameters such as `charset` are allowed)                             | —                                                                    |
| `invalid-json`           | 400    | Malformed JSON            | the body is not valid JSON (an empty body included)                                                                           | —                                                                    |
| `validation`             | 400    | Invalid request           | the body breaks a rule in §4.2                                                                                                | `errors`: one `{ "pointer", "detail" }` per problem found            |
| `lab-still-open`         | 409    | Lab still open            | the lab's submission window has not closed yet                                                                                | `closesAt`: when it closes                                           |
| `reviews-pending`        | 409    | Reviews pending           | at least one verdict in the lab's review queue has not been reviewed by a TA                                                  | `pendingReviews`: integer ≥ 1                                        |
| `internal`               | 500    | Internal error            | anything else. `detail` is a fixed, generic sentence                                                                          | —                                                                    |

Clients decide what to do from `type`, never from `title` or `detail`.

## 3. Resources

**Publication**: the record that a lab's marks were released.

```json
{
  "labId": 7,
  "status": "published",
  "publishedAt": "2026-11-11T14:00:00.000Z",
  "publishedBy": 12,
  "submissionCount": 80
}
```

| Field             | Rule                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| `labId`           | the lab's id                                                                |
| `status`          | always `"published"` in version 1                                           |
| `publishedAt`     | when the **first** successful publish happened; never changes afterwards    |
| `publishedBy`     | user id of the TA whose request published the lab; never changes afterwards |
| `submissionCount` | number of the lab's submissions whose marks were released, integer ≥ 0      |

There is at most one Publication per lab.

## 4. `POST /v1/labs/{labId}/publish`

### 4.1 Who may call it

- **Role**: `ta` only. A `student` or an `admin` gets `403 forbidden` — the brief makes the TA,
  after reviewing, the one who presses Publish.
- **Ownership**: the TA must be assigned to the class the lab belongs to. A TA calling it for a
  lab of another class gets **`404 not-found`, byte-for-byte the same body as for a lab that does
  not exist**, so a TA cannot learn which lab ids exist in other classes.
- Any TA of the class may publish; they do not need to be the one who reviewed.

### 4.2 Request

Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`.

Body:

```json
{ "confirm": true }
```

| Field     | Rule                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------- |
| (body)    | a JSON object; anything else (array, string, `null`, number) is `validation` with pointer `""`           |
| `confirm` | required, the boolean `true`. Missing, `false`, `"true"` or `1` are `validation` with pointer `/confirm` |

`confirm` exists so that an empty or accidental request cannot release marks.

### 4.3 Order of checks

The server checks in this order and **stops at the first step that fails**:

1. Authenticated, else `401 unauthenticated`.
2. Role is `ta`, else `403 forbidden`.
3. `labId` is a valid id, the lab exists and the TA teaches its class, else `404 not-found`.
4. `Content-Type` is `application/json`, else `415 unsupported-media-type`.
5. The body is valid JSON, else `400 invalid-json`.
6. The body follows §4.2, else `400 validation` listing every broken field.
7. **The lab is already published** → `200` replay (§4.5). Steps 8–9 are skipped.
8. The lab has closed (`now ≥ closesAt`), else `409 lab-still-open`.
9. No verdict of this lab is pending review, else `409 reviews-pending`.
10. The lab is published: `201`.

Because ownership (3) is checked before the body (4–6), a TA of another class learns nothing
from the shape of their request.

### 4.4 Responses

| Status  | When                           | Headers                                                                   | Body                                                      |
| ------- | ------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `201`   | this request published the lab | `Location: /v1/labs/{labId}/publication`                                  | Publication                                               |
| `200`   | the lab was already published  | `Location: /v1/labs/{labId}/publication`, **`Idempotent-Replayed: true`** | the stored Publication, identical to the first `201` body |
| 4xx/5xx | see §2 and §4.3                | `Content-Type: application/problem+json`                                  | Problem                                                   |

The `201` response never carries `Idempotent-Replayed`.

### 4.5 Idempotency and concurrency

Publishing is idempotent by resource, not by key: a lab is published at most once, so no
`Idempotency-Key` header is needed.

- A TA whose request timed out sends the same request again. If the first one went through,
  they get `200` with the **stored** Publication — same `publishedAt`, same `publishedBy`,
  same `submissionCount` — and `Idempotent-Replayed: true`. Nothing happens a second time:
  no second release, no second notification to students.
- A second TA of the same class who publishes afterwards also gets the `200` replay;
  `publishedBy` stays the first TA.
- Two requests for the same lab at the same time: **exactly one** gets `201`; every other one
  gets the `200` replay. The server makes the check-and-publish atomic (in the database
  version: a conditional update on a row that is not yet published).
- A failed request (any 4xx or 5xx) publishes nothing and may be retried as it is.

### 4.6 What changes when it succeeds

After the `201`, for this lab:

- the lab's state becomes **published**; it never goes back in version 1 (there is no
  unpublish endpoint — reopening marks is a manual admin operation outside this API);
- every verdict and deduction is **frozen**: review-queue changes for this lab are refused from
  now on (that endpoint's own contract names the error);
- each student of the class can see their mark and the deductions with their evidence lines;
- appeals open: `POST /v1/submissions/{id}/appeals` accepts appeals on this lab's submissions
  only from this moment.

Nothing else changes. A `200` replay changes nothing at all.

### 4.7 Examples

```http
POST /v1/labs/7/publish HTTP/1.1
Authorization: Bearer ta-12-token
Content-Type: application/json

{ "confirm": true }
```

```http
HTTP/1.1 201 Created
Location: /v1/labs/7/publication
Content-Type: application/json; charset=utf-8

{ "labId": 7, "status": "published", "publishedAt": "2026-11-11T14:00:00.000Z", "publishedBy": 12, "submissionCount": 80 }
```

Same request again:

```http
HTTP/1.1 200 OK
Location: /v1/labs/7/publication
Idempotent-Replayed: true
Content-Type: application/json; charset=utf-8

{ "labId": 7, "status": "published", "publishedAt": "2026-11-11T14:00:00.000Z", "publishedBy": 12, "submissionCount": 80 }
```

## 5. Versions and changes

- **Within `/v1`, only additive changes**: a new optional request field, a new response field,
  a new problem type for a new situation. Anything else — removing or renaming a field,
  changing a status, reordering §4.3, tightening a rule — is `/v2`.
- A change to this file goes in its own commit with the reason in the message, and the
  contract tests are updated to match **the file**, never the other way round.

## 6. Decisions the brief leaves open

The brief (§8) gives these to the product owners. Until their FAQ answers, this contract
assumes the following; each will cite the FAQ entry once it exists.

| Question                                                    | Assumed here                          |
| ----------------------------------------------------------- | ------------------------------------- |
| May an admin publish on a TA's behalf?                      | No (`403 forbidden`)                  |
| May a lab be published before its submission window closes? | No (`409 lab-still-open`)             |
| Can a published lab be unpublished through the API?         | No; manual admin operation, out of v1 |
