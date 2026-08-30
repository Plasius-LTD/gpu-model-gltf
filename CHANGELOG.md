
# Changelog

All notable changes to this project will be documented in this file.

The format is based on **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)**, and this project adheres to **[Semantic Versioning](https://semver.org/spec/v2.0.0.html)**.

---

## [Unreleased]

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [0.1.0] - 2026-08-30

- **Added**
  - Bootstrapped the dedicated package repository from the schema baseline.
  - Added the gpu.model.conversion.enabled rollout reference and package smoke test.
  - Added strict, bounded GLB v2 validation, deterministic GLB export, exact
    source/output SHA-256 evidence, embedded-image verification, and a
    fail-closed `@plasius/gpu-model-runtime` registration seam.
  - Added golden and hostile fixtures for malformed containers, URI admission,
    MIME/magic mismatch, accessor bounds and finite values, unsupported static
    world features, resource ceilings, and deterministic output.
  - Added Task `gpu-model-gltf#5`'s bounded ChatGPT demonstration import: a
    verified `GpuModelDocument`, compiler-safe static projection, exact source
    hashes, canonical basis/winding conversion, fixed material factors, and
    runtime-adapter loading behind `asset.pipeline.pvox-models.enabled` and
    `asset.pipeline.converter.gltf.enabled`.

- **Changed**
  - Aligned GitHub CI, release preparation, immutable package sealing, npm OIDC
    publication, privacy checks, and first-publication safeguards with the
    released `@plasius/schema` v1.4.2 package template.
  - Replaced the bootstrap-only validation surface with the first strict GLB
    slice while retaining bootstrap exports for compatibility. Canonical
    runtime loading is now enabled only for the narrower static demo profile;
    broad canonical ingestion remains outside this task.
  - Raised all local coverage gates to 80% and made dependency-tree auditing
    fail closed.

- **Fixed**
  - Prevented the read-only checkout credential from overriding the narrowly
    scoped release-prep GitHub App token during approved CD branch creation.
  - Retried protected release-metadata merges while required checks complete,
    allowing approved CD to proceed when repository auto-merge is disabled.
  - Added trusted same-repository pull-request validation and moved all CI jobs
    to GitHub-hosted Linux so protected release checks cannot wait on an
    unavailable self-hosted runner.
  - Rejected corrupt, oversized, and indexed PNGs and bounded chunk fan-out, decoded image
    dimensions, pixels, runtime texture bytes, zlib output, and scanline filters before
    evidence is emitted; JPEG now fails closed pending a reviewed full decoder.
  - Prevented wide JSON documents from escaping as raw `RangeError`s and
    replaced width-sized traversal stacks with depth-bounded incremental
    validation.
  - Reduced peak GLB working memory with direct one-pass output construction,
    sequential zero-copy hashing of private snapshots, early source release,
    and measured fixed, whole-input, and JSON-specific working-set gates.
  - Preserved bounded validator findings ahead of synthetic export diagnostics.
  - Narrowed package metadata to the strict GLB validation/export slice actually
    implemented by this release.
  - Kept broad strict admission attributable to predecessor Task
    `gpu-model-gltf#1` / Feature `plasius-ltd-site#1148`; Task #5 adds only the
    bounded Story `plasius-ltd-site#2094` compiler hand-off.
  - Rejected non-space GLB JSON padding and enforced caller JSON ceilings on
    aligned deterministic output so the same profile remains idempotent.
  - Included the real `tests/` directory in TypeScript validation.

- **Security**
  - Pinned patched transitive npm dependencies to clear the current audit baseline.
  - Added fail-closed source and npm-package admission for the administrative contributor registry and pinned the CI/CD runtime to Node.js 24.18.0 LTS.
  - Pinned audited transitive build dependencies to fixed `brace-expansion`, `esbuild`, and `postcss` releases.
  - Pinned the Apache-2.0 Khronos glTF Validator and reject external/data URIs,
    unsafe JSON keys, corrupt/unrecognized image bytes, non-finite geometry,
    resource overruns, and unsupported constructs before evidence is emitted.
  - Rejects disabled flags, source-hash disagreement, unused scene payloads,
    mixed accessor roles, implicit winding, unsupported surface inputs, and
    attempts to raise the 16 MiB/200,000-triangle demo ceilings.
  - Bounded canonical work with cached accessor decoders, per-mesh primitive
    plans, early instanced-triangle rejection, complete index coverage, a fixed
    processing deadline, captured native Blob reads, and the shared
    1,048,576-metre absolute coordinate ceiling.
  - Rejects rig and morph fan-out from shallow metadata before semantic graph
    expansion, and trips primitive-instance and computed-coordinate ceilings
    before nested canonical enumeration.

## [1.2.17] - 2026-06-28

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.16] - 2026-06-22

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.15] - 2026-06-22

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.12] - 2026-06-01

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.11] - 2026-05-13

- **Added**
  - (placeholder)

- **Changed**
  - Refreshed development dependencies to the latest stable published versions.
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.10] - 2026-04-21

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.9] - 2026-04-21

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.8] - 2026-04-02

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.7] - 2026-03-27

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.6] - 2026-03-09

- **Added**
  - Added field exposure metadata (`.exposure(...)`, `.internal()`, `.public()`) for separating validation/storage concerns from client-facing serialization.
  - Added schema-driven `serialize()` support that strips unknown fields and omits `internal` fields by default.

- **Changed**
  - Schema descriptions and rendered schema metadata now include field exposure information.

- **Fixed**
  - Prevented server-only fields from being treated as implicitly safe for client responses when callers serialize entities through the schema contract.

- **Security**
  - (placeholder)

## [1.2.5] - 2026-03-04

- **Added**
  - (placeholder)

- **Changed**
  - Added template-level dual-module packaging policy that mandates runtime-safe CommonJS boundaries when emitting `dist-cjs/*.js` under `type: module`.

- **Fixed**
  - Established publish-time guardrails (`build` + `pack:check`) in template governance to prevent dual-module regressions in downstream `@plasius/*` packages.

- **Security**
  - (placeholder)

## [1.2.2] - 2026-02-28

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.1] - 2026-01-22

- **Added**
  - Monthly GitHub Actions workflow to run `npm audit fix` on a schedule and open a PR with the results.

- **Changed**
  - Restore `main`, `module`, and `types` fields alongside the export map for broader CJS/ESM tool compatibility.
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.2.0] - 2025-12-31

- **Added**
  - Additional validator coverage for names, safe text, percentages, rich text, user IDs, languages (BCP47), and ISO country/currency codes.

- **Changed**
  - README usage examples refreshed to match current `createSchema` signature, field helpers, and default-handling behavior.
  - Optionality tracking consolidated to a single flag (`isRequired`, default `true`) used across validation, descriptions, and type inference; `.optional()`/`.default()` set `isRequired` to `false`.
  - Validation helpers re-export `validateLanguage` (BCP 47).

- **Fixed**
  - Ref logging keeps `type/id` when no nested shape is provided.
  - Optional PII fields no longer emit null/undefined artifacts when absent during storage/read/scrub.
  - Validation deep-clone now preserves non-JSON-safe values (e.g., `Date`) without mutating caller data.
  - PII helpers align array item encryption/hashing across storage/read/scrub, including nested object items.
  - Defaults are now applied during validation for top-level fields, nested objects, and array items.
  - `prepareForRead` now returns hashed values written by `prepareForStorage`, preventing loss of hash-only PII fields.
  - Composition validation now uses the item ref type for array-of-ref fields, correctly resolving and validating referenced entities.
  - Arrays of primitives now run their item validators (e.g., `.pattern()`, `.min()`) for every element instead of accepting invalid values.
  - Arrays of refs now validate nested ref shapes (defaults, required fields, and validators) instead of only checking `type/id`.
  - Single ref fields now enforce `refType` during validation, preventing mismatched entity links earlier.
  - PII helpers (`prepareForStorage`, `prepareForRead`, `sanitizeForLog`, `scrubPiiForDelete`) now recurse through nested objects, arrays, and refs so nested PII is transformed/sanitized/scrubbed correctly.
  - Validation now deep-clones inputs before applying defaults to avoid mutating caller-owned objects.
  - Schema descriptions now surface optionality, system/immutable flags, deprecation metadata, and normalize nullable fields (`enum`, `refType`, `pii`, `deprecatedVersion`) to `null`.
  - Composition validation rejects mismatched reference types before resolution.
  - Numeric enums are enforced during validation instead of accepting out-of-range values.
  - Immutable flags are honored for nested object/array/ref children when validating updates against an existing entity.
  - PII strict/warn enforcement now applies to nested fields (objects, arrays, refs), blocking empty high-PII subfields.
  - ISO 3166-1 list updated to include `PS`; ISO 4217 list updated to include `SLE` (while retaining `SLL` for legacy data).

- **Security**
  - (placeholder)

## [1.1.1] - 2025-09-24

- **Added**
  - new Schema upgrade pathway

- **Changed**
  - package.json update to include:
    - "sideEffects": false,
    - "files": ["dist"],
  - package.json removed:
    - "main": "./dist/index.cjs",
    - "module": "./dist/index.js",
    - "types": "./dist/index.d.ts",

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [1.1.0] - 2025-09-18

- **Added**
  - field().upgrade() function now added to allow upgrades of older data sets to newer data.
  - min/max/pattern/default FieldBuilder elements added for validation.
  - Added new validator for language code BCP 47 format.
  - Added new validator options for ISO DATE TIME filtering to Date or Time or Both
  - Added new pre-built field() types including PII flags and validators for:
    - email
    - phone
    - url
    - uuid
    - dateTimeISO
    - dateISO
    - timeISO
    - richText
    - generalText
    - latitude
    - longitude
    - version
    - countryCode
    - languageCode
  - New field().xxx tests for the above types.

- **Changed**
  - Updated CD Pipeline to accept a new param for version Major, Minor or Patch update

- **Fixed**
  - validateISODateTime for dateTime now accepts string matches that might not be the same as the date.toISOString() return value but are still valid ISO Date Time Strings.

- **Security**
  - (placeholder)

## [1.0.18] - 2025-09-17

- **Fixed**
  - CD pipeline reorder fix to restore CHANGELOG.md versions

## [1.0.17] - 2025-09-17

- **Added**
  - chore: Code coverage added

## [1.0.13] - 2025-09-16

- **Changed**
  - ./src/schema.ts Added comments defining functionality on all externally facing functions.

- **Fixed**
  - ./src/schema.ts Validation no longer mutates the input, internal system fields are set only on result if not previously present.

---

## [1.0.0] - 2025-09-16

- **Added**
  - Initial public release of `@plasius/schema`.
  - Fluent field builder API: `field().string().required()`, `field().number().min()`, etc.
  - Type inference utilities to derive TypeScript types from schema definitions.
  - Built-in validators for common standards:
    - ISO-3166 country codes
    - ISO-4217 currency codes
    - RFC 5322 email format
    - E.164 phone format
    - WHATWG URL format
    - ISO 8601 date/time
    - OWASP-guided text/name constraints
    - UUID (RFC 4122) and SemVer 2.0.0
  - PII annotations and helpers for redaction/masking before logging.
  - Lightweight validation runner with success/error result types.

- **Changed**
  - N/A (initial release)

- **Fixed**
  - N/A (initial release)

---

## Release process (maintainers)

1. Update `CHANGELOG.md` under **Unreleased** with user‑visible changes.
2. Bump version in `package.json` following SemVer (major/minor/patch).
3. Move entries from **Unreleased** to a new version section with the current date.
4. Tag the release in Git (`vX.Y.Z`) and push tags.
5. Publish to npm (via CI/CD or `npm publish`).

> Tip: Use Conventional Commits in PR titles/bodies to make changelog updates easier.

---

[Unreleased]: https://github.com/Plasius-LTD/gpu-model-gltf/compare/v0.1.0...HEAD
[1.0.0]: https://github.com/Plasius-LTD/schema/releases/tag/v1.0.0
[1.0.13]: https://github.com/Plasius-LTD/schema/releases/tag/v1.0.13
[1.0.17]: https://github.com/Plasius-LTD/schema/releases/tag/v1.0.17
[1.0.18]: https://github.com/Plasius-LTD/schema/releases/tag/v1.0.18
[1.1.0]: https://github.com/Plasius-LTD/schema/releases/tag/v1.1.0
[1.1.1]: https://github.com/Plasius-LTD/schema/releases/tag/v1.1.1
[1.2.0]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.0
[1.2.1]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.1

## [1.2.1] - 2026-02-11

- **Added**
  - Initial release.

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)
[1.2.2]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.2
[1.2.5]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.5
[1.2.6]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.6
[1.2.7]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.7
[1.2.8]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.8
[1.2.9]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.9
[1.2.10]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.10
[1.2.11]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.11
[1.2.12]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.12
[1.2.15]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.15
[1.2.16]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.16
[1.2.17]: https://github.com/Plasius-LTD/schema/releases/tag/v1.2.17
[0.1.0]: https://github.com/Plasius-LTD/gpu-model-gltf/releases/tag/v0.1.0
