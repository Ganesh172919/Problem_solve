# Vision / Roadmap (Future)

This document captures aspirational direction for AI Auto News. It is intentionally forward-looking and may not match the current implementation.

For what is implemented today, see:

- `docs/README.md`
- `PLATFORM_OVERVIEW.md`

## Potential future directions

### Product

- Multi-tenant hosting and user workspaces
- More robust admin and editorial workflows (drafts, approvals, scheduling)
- Richer content ingestion (feeds, sources, citations) with provenance tracking

### Platform / infrastructure

- Production-grade deployment patterns (secrets management, backups, migrations)
- Observability improvements (structured logs, tracing, dashboards)
- Safer background job execution (separate worker process, queue persistence guarantees)

### API + developer experience

- Stable, documented API surface (OpenAPI), consistent auth, versioning policy
- First-class SDK packaging/publishing (npm/pypi/go modules) with CI releases
- CLI improvements for localhost mode (no hosted key verification step)

### AI

- Provider abstraction beyond mock/gemini
- Better rate-limit/backoff strategies per endpoint/task
- Content quality evaluation and moderation pipelines wired to publishing decisions

