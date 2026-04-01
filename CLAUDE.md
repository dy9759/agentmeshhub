# AgentMesh Hub

Central Hub server for AgentMesh cross-machine Agent communication network.

## Project Structure

pnpm monorepo:

- `packages/shared` — Shared types, Interaction Protocol, Zod schemas
- `packages/hub` — Central Hub server (Fastify + Drizzle ORM + SQLite/PostgreSQL)
- `packages/agent-runtime` — Agent autonomous runtime loop
- `packages/rest-client` — REST SDK + CLI
- `packages/a2a-adapter` — OpenClaw A2A adapter

## Key Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Start Hub dev server (port 5555)
pnpm start            # Start Hub production server
pnpm test             # Run all tests
```

## Authentication

3-layer auth system:
1. Owner API Key (Bearer token)
2. OAuth 2.1 + PKCE (HTTP remote mode)
3. Agent Token (JWT) — per-agent identity after registration

## Messaging

Owner-Owner, Owner-Agent, and Agent-Agent bidirectional messaging supported.
All interactions use a unified `fromId`/`fromType` model.
