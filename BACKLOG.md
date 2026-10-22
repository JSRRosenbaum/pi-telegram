# Project Backlog

_This file owns unresolved project work only. Completed behavior belongs in `CHANGELOG.md`; durable contracts belong in `AGENTS.md` and `/docs`._

## Slot reuse follow-up

- [ ] Retitle the displaced Thread when its letter is reassigned, so two tabs never show the same letter between display reconciliations. Keep it a display-only change: no Telegram deletion, no binding or journal mutation.
- [ ] Bound the growth of slotless bindings: each reuse leaves the displaced binding and its Thread behind, and neither capacity retirement nor restore ever releases them. Offer the existing manual inactive-Workspace cleanup for them without making deletion automatic.

## 0.57.4 publication

The prompt-cache hotfix shipped alone as 0.57.4; metadata-only slot reuse follows as 0.57.5. Preserve contributor history, Pi >=1.0.0 compatibility and the distinction between native transcript evidence and unrun live provider/Telegram checks. Never rewrite `main`, published tags or consumed release history. Transit Thread lifecycle remains deferred.

- [ ] Report verified results, limitations, installation instructions and thanks to the reporter and contributors; close the report only after publication verification, then remove this coordination outcome and synchronize the operator checkout while preserving its pre-existing routing test.

## Transit Thread lifecycle

An All input's temporary routing Thread must outlive its pending choice and leave no residue.

- [ ] A Thread with a pending Reroute/Restore choice is never deleted by unbound-topic reconciliation; only its own Reroute, cancel or expiry removes it.
- [ ] Cancel resolves from the durable journal, so it still works after the tab or chooser message is gone.
- [ ] Expiry reports a visible "prompt not delivered" result instead of silently discarding the input as `routing-expiry`.
