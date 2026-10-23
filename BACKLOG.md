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

## Stuck forwarded command after Thread re-creation

Evidence (2026-10-23 07:11–07:16): a `/start` sent in a former leader tab moved into a follower's journal as a raw original. After that follower's Thread was re-created by the restore probe, every execution attempt failed with `Telegram bus API call is not allowed for this follower` and retried every 60 s indefinitely, because the reply targeted a Thread the follower no longer owned. Terminal settlement alone is unsafe: the same rejection can be a benign race during a live-rebind pre-dispatch.

- [ ] Reproduce with a native fixture (follower Thread re-created while a Restore-moved command is journaled). Then retarget the reply to the recipient's current Thread or settle the input only after proving no rebind is in flight, with a visible notice. Never discard accepted input silently.
- [ ] Find why the temporary tab's selected `/start` stayed unresolved until expiry, and why that Restore moved custody without applying the rebind.
- [ ] Route an input that arrives in a tab bound to nothing through a fresh temporary routing tab (the All flow) instead of publishing the chooser in the orphan, deleting the orphan with it once nothing unspent remains. Needs its own durable-metadata design.
- [ ] Live acceptance on disposable tabs only: Cancel on an orphan tab deletes it; a second unspent input keeps it until the last Cancel; a plain `std::map` option button is delivered as an ordinary prompt.
