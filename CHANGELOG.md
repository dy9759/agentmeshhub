# Changelog

## [0.2.0] - 2026-04-02

### Added — Multi-Turn Collaboration
- **Sessions table**: `id`, `title`, `status`, `participants` (JSON), `maxTurns`, `currentTurn`, `context` (JSON)
- **SessionService**: create, findById, updateStatus, incrementTurn, join, updateContext, getMessages, list
- **6 REST endpoints**: POST/GET/PATCH `/api/sessions`, GET messages, POST join, GET list
- **Auto-complete**: session auto-closes when `currentTurn` reaches `maxTurns`
- **Interaction.sessionId**: messages can be linked to a session
- **Session turn increment on send**: `messageBusService` auto-increments session turns

### Added — Owner Messaging
- **Owner-Owner, Owner-Agent DM**: `POST /api/interactions` supports Owner auth
- **Owner inbox**: `GET /api/interactions?ownerId=`
- **Owner conversations**: `GET /api/conversations?ownerId=`
- **Owner whoami**: `GET /api/owners/me`
- **`fromId`/`fromType` model**: unified sender identity (replaces agent-only `fromAgent`)
- **`ownerId` in registration response**: `POST /api/register` now returns `ownerId`

### Added — Reliability
- **BoundedUUIDSet**: ring buffer dedup for WebSocket push (capacity 2000, O(1))
- **Interaction reaper**: auto-cleanup interactions older than 30 days
- **Stale agent threshold**: increased from 60s to 300s (5 minutes)

### Fixed — P0 Critical
- **Target validation**: reject sends to non-existent agents/owners (404)
- **Participant validation**: reject session creation with non-existent IDs (404)
- **Session status check**: block messages to completed/failed/archived sessions (400)
- **Payload validation**: require at least `text`, `data`, or `file`

### Fixed — P1 Important
- **Atomic turn increment**: `SET currentTurn = currentTurn + 1` (no race condition)
- **Safe JSON.parse**: `safeJsonParse()` with fallback (crash prevention)
- **Auth checks**: session routes validate creator/participant access (403)
- **`fromAgent` field**: empty string for owner senders (was leaking ownerId)
- **Message status**: `pending` → `delivered` on poll
- **Chat history**: exclude broadcasts
- **Error handling**: only catch `AppError(404)` in session turn increment

### Fixed — P2 Improvements
- **`nextCursor`** in poll responses for pagination
- **Conversation query limit**: `.limit(500)` prevents memory exhaustion
- **Remove `as any`** type cast in session routes

### Added — Documentation
- **README**: architecture diagram, deployment guide (local/LAN/cloud/Docker), full API reference

## [0.1.0] - 2026-04-01

### Added
- Initial Hub server (Fastify + SQLite + Drizzle ORM)
- 3-layer auth: Owner API Key, Static Key, Agent JWT (HS256, 1h TTL)
- Agent registration, discovery, heartbeat, stale agent reaper
- Unified interaction model: DM, channel, broadcast
- WebSocket real-time push with ping/pong
- Task engine with capability matching
- Channel messaging with membership
- File transfer (multipart upload, 100MB max)
- REST CLI client + A2A adapter
