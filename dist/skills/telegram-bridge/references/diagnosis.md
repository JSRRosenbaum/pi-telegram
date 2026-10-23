# Bridge Diagnosis

Read this reference only when diagnosing Telegram bridge health or delivery failure.

Inspect in this order:

1. `/telegram-status` for compact health in the Pi TUI.
2. `/telegram-status --debug` for bounded human-readable diagnostics in the Pi TUI.
3. `~/.pi/agent/tmp/pi-telegram/state.json` (per-profile `transport`, `workspace` canonical bindings and `runtime` roster/diagnostics sections) and `logs.jsonl` (profile-labelled redacted evidence); rotated history is `logs/logs._prev.jsonl`.
4. For a named profile, read its `profiles.<name>` entry and filter log records by `profile`; service journals are `journals/<kind>.<profile sha256>.json`.

These slash commands are registered Pi commands, not shell executables or agent tools. If the agent cannot invoke them through a supported Pi surface, read the diagnostic files directly; do not run them in Bash or inject terminal input.

When `PI_CODING_AGENT_DIR` selects another compatible runtime, resolve its equivalent `tmp/pi-telegram` directory.

A `persistent-conflict` polling stop means the bounded competing-`getUpdates` threshold triggered full transport stand-down, not cancellation of accepted local Pi work. The terminal diagnostic distinguishes lost local ownership from a competing client despite an apparently owned lock. Check other profiles, agent directories, installations, or non-Pi clients sharing the bot; after removing the competition, reconnect through the supported Pi command. Do not restart repeatedly or alter lock files to compete for the stream.

After a live Workspace rebind, the acknowledged follower registration target is authoritative even if a local topic projection still shows the former Thread. Repeated follower API denials during input handling can come from a stale projection probing the old target; do not broaden follower API permissions. A supported `/telegram-connect <profile>` refreshes shared topic metadata before re-registering with the existing owner. It can rotate registration and must run at an operator-approved interaction boundary; it is not a request to clear journals, resend messages or force takeover.

Do not mutate ownership files, bridge state, journals, bindings, or locks to force recovery. Use supported commands and preserve exact profile, target, transport, and session authority. Never claim successful delivery without transport evidence.
