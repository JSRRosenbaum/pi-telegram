# Project Backlog

_This file owns unresolved project work only. Completed behavior belongs in `CHANGELOG.md`; durable contracts belong in `AGENTS.md` and `/docs`._

## Disposable Thread live acceptance

- [ ] After separate operator authorization, use disposable Telegram tabs to check leader Settings review/Back, one confirmed cleanup of an inactive slotless binding, preservation of its replacement letter holder, and visible outcome/recovery copy. Native filesystem and injected-transport tests do not prove live Telegram/client or native Windows acceptance. Never use production history as the disposable fixture.
- [ ] On separately authorized disposable routing tabs, verify pending-choice protection, Cancel after the view becomes unavailable, expiry notice in the owned leader Thread and no duplicate deletion after an unknown outcome. Local native journal/API-decoder fixtures are not live client acceptance.

## Prompt-cache live confirmation

The prompt-cache report remains open for the reporter's offered live Anthropic capture after the published fix. Native request/transcript checks do not replace cache-hit or signed-thinking measurements.

- [ ] Review the reporter's resume and mid-session tool-change results (versions, cache read/write counts and new thinking-drop events). Close the report if the live evidence confirms the fix, or narrow any residual failure into actionable follow-up. Do not reconstruct or claim recovery of previously lost thinking blocks.

## Stuck forwarded command after Thread re-creation

Evidence (2026-10-23 07:11–07:16): a `/start` sent in a former leader tab moved into a follower's journal as a raw original. After that follower's Thread was re-created by the restore probe, every execution attempt failed with `Telegram bus API call is not allowed for this follower` and retried every 60 s indefinitely, because the reply targeted a Thread the follower no longer owned. Terminal settlement alone is unsafe: the same rejection can be a benign race during a live-rebind pre-dispatch.

- [ ] Live acceptance: a forwarded command whose follower Thread was re-created is answered in the current Thread (disposable tabs only).
- [ ] Find why the temporary tab's selected `/start` stayed unresolved until expiry, and why that Restore moved custody without applying the rebind.
- [ ] Route an input that arrives in a tab bound to nothing through a fresh temporary routing tab (the All flow) instead of publishing the chooser in the orphan, deleting the orphan with it once nothing unspent remains. Needs its own durable-metadata design.
- [ ] Live acceptance on disposable tabs only: Cancel on an orphan tab deletes it; a second unspent input keeps it until the last Cancel; a plain `std::map` option button is delivered as an ordinary prompt.
