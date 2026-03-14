# claude-app-server

Provider-agnostic JSON-RPC server contract and adapter scaffolding.

## Current Scope

- Protocol spec: `docs/protocol/v1.md`
- Cross-provider parity mapping: `docs/parity-matrix.md`
- TDD and contract test strategy: `docs/testing-strategy.md`
- Implemented JSON-RPC methods:
  - `session.initialize`
  - `capability.list`
  - `thread.start`
  - `thread.list`
  - `thread.read`
  - `turn.start`

## Development

```bash
npm install
npm run lint
npm run format:check
npm test
```
