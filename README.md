# claude-app-server

A provider-capable JSON-RPC app server for mobile/IDE clients.

It currently supports Claude and Codex adapters (Claude is wired to real CLI streaming), persistence-backed threads, and a canonical camelCase protocol surface.

## Features

- Canonical JSON-RPC contract (camelCase output)
- Compatibility layer for snake_case input aliases at request boundary
- Persistence-backed thread state (JSONL + snapshot index)
- Real-time events for turns (`event.turnStarted`, `event.turnDelta`, `event.turnCompleted`)
- WebSocket server entrypoint for app clients
- Skills discovery endpoint (`skills.list`) with workspace + user scopes

## Implemented RPC methods

- `session.initialize`
- `capability.list`
- `thread.start`
- `thread.list`
- `thread.read`
- `turn.start`
- `skills.list`

## Protocol docs

- `docs/protocol/v1.md`
- `docs/parity-matrix.md`
- `docs/testing-strategy.md`

## Requirements

- Node.js 22+ (25 works)
- `claude` CLI installed and authenticated for real Claude execution/streaming

## Install

```bash
npm install
```

## Build / type-check / test

```bash
npm run lint
npm run format:check
npm test
npx tsc --noEmit
```

## Run server (WebSocket)

```bash
npm run start
```

Default endpoint:

- `ws://127.0.0.1:3284`

### Environment variables

- `HOST` (default `127.0.0.1`)
- `PORT` (default `3284`)
- `CLAUDE_MODE` = `cli` | `mock` (default in ws server: `cli`)
- `CLAUDE_PERMISSION_MODE` = `default` | `acceptEdits` | `bypassPermissions`

## Example JSON-RPC flow

1. Start thread

```json
{"jsonrpc":"2.0","id":"1","method":"thread.start","params":{"title":"Demo"}}
```

2. Start turn

```json
{"jsonrpc":"2.0","id":"2","method":"turn.start","params":{"provider":"claude","threadId":"thread-...","input":"Reply with hello"}}
```

3. Receive streamed events

- `event.turnStarted`
- `event.turnDelta` (repeated)
- `event.turnCompleted`

4. List skills for a workspace

```json
{"jsonrpc":"2.0","id":"3","method":"skills.list","params":{"cwd":"/path/to/repo"}}
```

Response shape:

```json
{
  "jsonrpc":"2.0",
  "id":"3",
  "result":{
    "data":[
      {
        "cwd":"/path/to/repo",
        "skills":[
          {
            "name":"read-github",
            "description":"...",
            "shortDescription":"...",
            "path":"/path/to/repo/.claude/skills/read-github",
            "scope":"workspace"
          }
        ]
      }
    ]
  }
}
```

## Notes

- Public contract should remain camelCase; snake_case aliases are accepted only at input boundary.
- For live Claude tests, use the opt-in smoke test with your local CLI/auth configured.
