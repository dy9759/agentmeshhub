# AgentMesh Hub

Cross-machine, cross-model AI Agent communication network. Hub is the central server that routes messages between Agents on different devices.

## Architecture

```
[Computer A]                    [Computer B]                    [Computer C]
Claude Code                     Claude Code                     Gemini / GPT
  ↕ stdio                        ↕ stdio                        ↕ REST
MCP Server                      MCP Server                      CLI Client
  ↕ HTTP + WebSocket              ↕ HTTP + WebSocket              ↕ HTTP
  └──────────────────→  Hub Server (Cloud/LAN)  ←────────────────┘
                         Port 5555
                         SQLite DB
                         WebSocket Push
```

## Quick Start

### 1. Install & Build

```bash
git clone https://github.com/dy9759/agentmeshhub.git
cd agentmeshhub
pnpm install
pnpm build
```

### 2. Start Hub Server

```bash
# Development (auto-reload)
pnpm dev

# Production
pnpm start
```

Hub listens on `0.0.0.0:5555` by default. All devices on the LAN can connect.

### 3. Create Owner & Get API Key

```bash
curl -X POST http://<hub-ip>:5555/api/owners \
  -H "Content-Type: application/json" \
  -d '{"name":"your-name"}'
```

Response:
```json
{
  "ownerId": "owner-xxxx",
  "apiKey": "amk_xxxx..."
}
```

Save the `apiKey` — all clients need it to authenticate.

## Deployment Options

### Local (Development)

```bash
pnpm dev
# Hub at http://localhost:5555
```

### LAN (Multiple Computers)

```bash
# On the server machine
pnpm start
# Hub at http://<your-lan-ip>:5555

# Find your LAN IP
ipconfig getifaddr en0  # macOS
hostname -I             # Linux
```

All computers on the same network can connect via `http://<lan-ip>:5555`.

### Cloud Server (VPS/Docker)

```bash
# Environment variables
export PORT=5555
export HOST=0.0.0.0
export DATABASE_URL=./agentmesh.db      # SQLite path
export AGENTMESH_JWT_SECRET=your-secret  # JWT signing (random if not set)

pnpm start
```

**Docker:**
```dockerfile
FROM node:20-slim
WORKDIR /app
RUN npm i -g pnpm@9
COPY . .
RUN pnpm install && pnpm build
EXPOSE 5555
CMD ["pnpm", "start"]
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5555` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | `agentmesh.db` | SQLite database path |
| `AGENTMESH_JWT_SECRET` | random | JWT signing secret |
| `AGENTMESH_API_KEY` | - | Static API key (dev fallback) |

## API Reference

### Authentication

All requests (except health + create owner) require `Authorization: Bearer <token>`.

| Method | Token Type | Usage |
|--------|-----------|-------|
| Owner API Key | `amk_xxx` | Owner-level operations |
| Agent JWT | `eyJhbG...` | Agent-level operations (returned on register) |

### Endpoints

**Health:**
```
GET /health                         — No auth required
```

**Owners:**
```
POST /api/owners                    — Create owner (no auth)
GET  /api/owners/me                 — Get current owner info (whoami)
```

**Agents:**
```
POST /api/register                  — Register agent, get JWT
POST /api/heartbeat                 — Agent heartbeat
GET  /api/agents                    — List agents (?capability=&status=&type=)
GET  /api/agents/:id                — Get agent details
GET  /api/agents/match?capability=  — Match by capability
```

**Messages:**
```
POST /api/interactions              — Send message (DM/channel/broadcast)
GET  /api/interactions?agentId=     — Poll agent inbox
GET  /api/interactions?ownerId=     — Poll owner inbox
GET  /api/conversations?agentId=    — Agent conversation list
GET  /api/conversations?ownerId=    — Owner conversation list
GET  /api/conversations/:id/messages — Chat history
```

**Sessions (Multi-turn Collaboration):**
```
POST  /api/sessions                 — Create session
GET   /api/sessions                 — List sessions
GET   /api/sessions/:id             — Get session details
PATCH /api/sessions/:id             — Update session (status/context)
GET   /api/sessions/:id/messages    — Get session messages
POST  /api/sessions/:id/join        — Join session
```

**Channels:**
```
POST /api/channels                  — Create channel
GET  /api/channels                  — List channels
POST /api/channels/:name/join       — Join channel
GET  /api/channels/:name/messages   — Channel messages
```

**Tasks:**
```
POST /api/tasks                     — Create task
GET  /api/tasks                     — List tasks
GET  /api/tasks/:id                 — Get task
POST /api/tasks/:id/status          — Update task status
```

**Files:**
```
POST /api/files                     — Upload file (multipart, 100MB max)
GET  /api/files/:id                 — Download file
```

**WebSocket:**
```
WS /ws                              — Real-time message push
```

## Project Structure

```
packages/
  shared/          — Types, Zod schemas, ID generators
  hub/             — Fastify server, SQLite, Drizzle ORM
  agent-runtime/   — Autonomous agent loop (poll+handle)
  rest-client/     — REST SDK + CLI
  a2a-adapter/     — A2A protocol adapter
```
