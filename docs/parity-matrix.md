# Primitive Parity Matrix

Status legend:
- **native**: direct equivalent primitive
- **adapter-required**: concept exists but shape/semantics differ enough to require translation
- **emulated**: no direct primitive; can be approximated in server logic
- **unsupported**: not currently representable without breaking contract assumptions

Scope: provider-agnostic server contract mapping against common "Codex-style" and "Claude-style" client/runtime primitives.

| Server Primitive | Codex-style | Claude-style | Status | Notes |
|---|---|---|---|---|
| Session bootstrap (`session.start`) | Run/session init metadata | Conversation/session open metadata | native | Both ecosystems expose startup context; negotiated capabilities normalized at adapter boundary. |
| Session shutdown (`session.end`) | Explicit run close / process end | Conversation close/end | native | May map to transport close if explicit end not provided upstream. |
| Conversation creation (`conversation.create`) | Thread/run container init | Conversation container init | native | IDs may need translation to canonical `conversationId`. |
| Send input (`conversation.send`) | Prompt/message submit API | Message create/send API | native | Base semantics align; optional fields vary by provider. |
| Streaming deltas (`conversation.delta`) | Token/chunk stream events | Content block delta events | adapter-required | Event granularity differs (token vs block); normalize to delta parts. |
| Completion (`conversation.completed`) | Final output event | Message completed/finalized event | native | Stop reasons require normalization map. |
| Failure (`conversation.failed`) | Error/failure event | Error/abort event | native | Error payload fields differ; map to canonical taxonomy. |
| Tool call request (`tool.callRequested`) | Function/tool call event | Tool use/request event | adapter-required | Argument schema and IDs differ; require deterministic ID mapping. |
| Tool result submit (`tool.result`) | Tool output submit | Tool result submit | native | May require shape coercion for content arrays vs raw JSON. |
| Cancel in-flight (`conversation.cancel`) | Cancel run/generation | Stop generation | native | Cancellation timing semantics vary; server must reconcile race outcomes. |
| Attachments (`input[].type=file/image`) | File input support | File/image content blocks | adapter-required | MIME metadata and upload references differ by provider. |
| Structured JSON mode (`options.jsonMode`) | JSON/schema output toggles | JSON/tool/schema guidance | emulated | Often prompt-level or model-level hint; enforce via validator on server side. |
| Reasoning trace exposure (`reasoningTrace`) | Hidden/internal chain states | Internal reasoning not exposed | unsupported | Contract should default off; do not guarantee provider reasoning traces. |
| Token usage accounting (`usage.*Tokens`) | Usage stats in run response | Usage fields in completion response | adapter-required | Counters may be absent or differently named; derive best-effort totals. |
| Capability negotiation (`capabilities`) | Feature flags at client/runtime level | Feature flags/model options | emulated | Unified negotiation is server-level abstraction across providers. |

## Gap Notes

1. **Streaming normalization is the highest-risk parity area** due to different chunk boundaries and event names.
2. **Tooling flows are close but not identical**; stable `toolCallId` generation is essential for cross-provider consistency.
3. **Reasoning trace is intentionally unsupported** unless explicit provider-safe abstraction is added in a future protocol version.
4. **JSON mode is emulated** unless provider guarantees strict schema adherence; contract tests should enforce post-validation regardless.

## Recommended Adapter Priorities

1. Implement robust event normalizer (stream start/delta/end/fail).
2. Implement tool call ID and argument canonicalizer.
3. Implement usage reconciler with missing-field fallback.
4. Implement attachment descriptor translator.
