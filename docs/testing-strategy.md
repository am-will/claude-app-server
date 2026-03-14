# Testing Strategy (TDD-First)

Status: Required for all protocol surface changes.

## 1) Principles

- **Red → Green → Refactor** is mandatory for behavior changes.
- Contract tests are the source of truth for protocol compatibility.
- Tests assert canonical camelCase output and snake_case input acceptance.
- Provider adapters are validated through shared fixtures.

## 2) Test Pyramid

1. **Unit tests** (fast)
   - Normalizers (snake_case → camelCase)
   - Validators (required fields, type/range checks)
   - Error mapping helpers
2. **Contract tests** (medium)
   - JSON-RPC request/response semantics
   - Method/notification lifecycle ordering
   - Capability negotiation behavior
3. **Adapter integration tests** (slower, mocked providers)
   - Codex-style and Claude-style event transformation
   - Tool-call roundtrip
4. **Smoke/e2e tests** (minimal)
   - End-to-end session/start/send/complete flow

## 3) Explicit TDD Workflow

For each protocol feature or bugfix:

1. Write/extend failing test in the narrowest scope first.
2. Confirm failure message matches intended behavior.
3. Implement minimal code to pass.
4. Refactor internals without changing test contract.
5. Run full contract suite before merge.

Merge gate: no green contract suite, no merge.

## 4) Contract Test Plan (v1)

## 4.1 Envelope and Routing

- `rejects malformed envelope with INVALID_REQUEST (1000)`
- `rejects unknown method with METHOD_NOT_FOUND (1002)`
- `echoes request id exactly in success and error responses`
- `ignores notifications for response correlation`

## 4.2 Naming Canonicalization

- `accepts camelCase params`
- `accepts snake_case params`
- `rejects conflicting alias values with INVALID_PARAMS (1001)`
- `emits camelCase only in results`
- `emits camelCase only in notifications`

## 4.3 Session and Capability Negotiation

- `session.start returns negotiated capabilities`
- `capability-gated method fails with CAPABILITY_MISMATCH (1004)`
- `capabilities immutable after session.start`

## 4.4 Conversation Lifecycle

- `conversation.send non-stream returns completed payload`
- `conversation.send stream emits started -> delta* -> completed`
- `conversation.cancel transitions in-flight request to cancelled outcome`
- `conversation.failed emitted on upstream timeout mapped to 2001`

## 4.5 Tooling

- `tool.callRequested contains stable toolCallId`
- `tool.result accepts canonical payload and resumes run`
- `tool.result invalid id returns STATE_CONFLICT (1005)`

## 4.6 Error Taxonomy

- `maps validation errors to 1001`
- `maps upstream unavailable to 2000`
- `maps upstream timeout to 2001`
- `maps internal exception fallback to 9000 with safe message`

## 5) Fixture Strategy

Maintain versioned fixtures under `tests/fixtures/v1/`:
- `requests/*.json` (input envelopes)
- `responses/*.json` (expected canonical outputs)
- `streams/*.jsonl` (notification sequences)

Fixture naming format:
`<method>.<scenario>.<direction>.json`
Example:
- `conversation.send.snake_case.request.json`
- `conversation.send.snake_case.response.json`

## 6) Suggested Initial Test Layout

```text
tests/
  contract/
    v1/
      envelope.test.ts
      naming.test.ts
      session.test.ts
      conversation.test.ts
      tools.test.ts
      errors.test.ts
  adapters/
    codex.test.ts
    claude.test.ts
  fixtures/
    v1/
      requests/
      responses/
      streams/
```

## 7) CI Expectations

CI pipeline stages:
1. lint
2. format:check
3. unit
4. contract
5. adapter

Required checks for protected branch:
- contract suite
- lint
- format check

## 8) Change Control

Any protocol doc update under `docs/protocol/v1.md` MUST include:
- matching contract test changes
- parity-matrix impact note (if cross-provider semantics changed)
- migration note for compatibility-impacting behavior
