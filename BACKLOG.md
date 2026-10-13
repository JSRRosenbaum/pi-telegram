# Project Backlog

_This file owns unresolved project work only. Completed behavior belongs in `CHANGELOG.md`; durable contracts belong in `AGENTS.md` and `/docs`._

- [ ] **Steer follow-up live acceptance.** Release authorization explicitly defers these checks beyond 0.56.0; do not treat automated coverage or the accepted busy-run smoke as live proof for unrun scenarios. Preserve the [queue and dispatch contract](./docs/architecture.md#queue-and-dispatch-safety).
  - [ ] **Operator scenarios.** Verify final selector/counter rendering; idle packets, native pending input, compaction, model switching, abort/Continue, complete media groups, Reroute/Restore, negotiated leader/follower transfer, reply/preview ownership and session-generation replacement. Record actual Pi/OS/Telegram versions, peer capabilities and redacted outcomes. Reload and disposable live tests require operator intent; do not manipulate runtime files to obtain acceptance.
  - [ ] **Post-reload diagnostics.** Investigate recurring typing-authority refusals and Workspace publication retries observed alongside successful leader/follower reconnection. Establish whether they are expected fenced stale work or affect current-session delivery; successful registration alone does not establish error-free operation.
  - [ ] **Native Windows scenarios.** Verify named-pipe custody/ACK, journal/atomic rename, reused-context lifecycle and the phone scenarios on an actual Windows host. Record skipped tests and missing platform evidence explicitly; a hosted CI result does not establish phone or full live-runtime acceptance.
