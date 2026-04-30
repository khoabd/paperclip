---
name: api-interface-design
description: >
  Design clean, consistent, and versioned APIs and interfaces. Use when creating
  new endpoints, designing SDKs, or reviewing API contracts. Activate with:
  "design an API", "REST endpoint", "API contract", "interface design",
  "OpenAPI spec".
---

# API & Interface Design

Design for the caller, not the implementer. Consistency beats cleverness.

## REST Conventions

```
GET    /resources          → list
GET    /resources/:id      → get one
POST   /resources          → create
PATCH  /resources/:id      → partial update
DELETE /resources/:id      → delete

Status codes:
200 OK, 201 Created, 204 No Content
400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found
409 Conflict, 422 Unprocessable, 429 Rate Limited, 500 Server Error
```

## Response Shape
```json
{
  "data": { ... },
  "error": null,
  "meta": { "page": 1, "total": 42 }
}
```

## Versioning
- URL prefix: `/api/v1/...`
- Never break existing contracts without a major version bump
- Deprecation period: minimum 6 months with `Deprecation` header

## OpenAPI First
Write the OpenAPI spec before implementation. Generate client SDKs from it.

## Red Flags
- Verbs in resource URLs (`/getUser`)
- Returning 200 for errors
- No versioning strategy
- Inconsistent naming (camelCase vs snake_case mixed)
