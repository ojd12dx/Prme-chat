---
name: OpenAPI client codegen pitfalls
description: Generated React Query client issues encountered with OpenAPI operation and parameter naming.
---

When changing OpenAPI operations, inspect generated TypeScript names for collisions between path and query parameters; similarly named parameters can produce duplicate generated types. The generated client may also use iterable `Headers` APIs, which require the DOM iterable library in TypeScript.

**Why:** These mismatches can make code generation or type checking fail even when the API schema itself validates.

**How to apply:** After code generation, type-check the shared client and review any duplicate parameter types before wiring generated hooks into the frontend.
