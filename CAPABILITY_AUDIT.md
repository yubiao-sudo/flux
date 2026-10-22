# Baize → FLUX capability audit

**Date:** 2026-10-18
**Scope:** `F:\deepseek harness\deepseekworkplace\baize` → `F:\deepseek harnes\deepseek-harness\desktop`
**Rule:** FLUX keeps one primary page. Capabilities are reached through voice, the
agent, lenses and auxiliary tool windows; no secondary routes or navigation.

## Baseline

| Layer | Count / state |
| --- | --- |
| Registered Tauri commands | **191** (15 Rust modules) |
| Frontend API wrappers | **208** (169 distinct invoke targets) |
| Agent tools in installed build | **173** live (185 in the current dev data profile) |
| Native engine tools | 137 + MCP/skills from the local configuration |
| Primary FLUX lenses | Configuration deck (5 categories), Capability field, Memory, Sessions, **Engine Control** (5 operation tabs), Consent, Signal |
| Auxiliary tool surfaces | Browser, Markdown, Terminal, Step barrage, Halo, OrbFloat |
| Backend commands removed | **none** |

The engine command layer is intact. The work below is about **making the
capability reachable from FLUX**, not porting Rust again.

## Now integrated into the FLUX surface

### Conversation and models

- Streaming chat, stop/interrupt, model profiles, active model, key-preserving
  edits, model test, health.
- Model profiles include vision model, embedding model and multimodal flag.
- Model usage report (7 days) and 14-day token bars.
- Conversation history/switch/new/export/delete (`H`).
- Projects, current-session project assignment, quick commands.
- Work modes, runtime vision/embedding config. TTS is provider-aware: local
  browser voices are selectable by name, Kokoro by local voice id, Doubao by
  App ID / Access Token / speaker / speech rate, and OpenAI-compatible cloud by
  base URL / model / key / voice. `试听` saves the draft and speaks through the
  selected backend; the reply queue applies the same saved provider and voice.
- Token saver toggles plus compression threshold, recent-context window and
  max tool-result size.
- Escalation notification: enabled levels L0–L4, per-level timeouts, email,
  webhook and optional voice text.
- Model comparison (parallel answers) in **Engine Control → Studio**.

### Memory and knowledge

- Real SQLite memory graph/list (`M`), search, add, pin, forget.
- Kind-colored semantic map with salience-sized nodes.
- Nightly memory digest: enabled/time config, save and run-now.
- Local RAG: index folder, clear, list, search with citations
  (**Engine Control → Connectors**).

### Automation

- Scheduled jobs: list, add, enable/disable, delete, last-run state.
- Workflows: list, run with input, result display.
- Plaza: browse callable capabilities and run.

### Security

- Long-lived permission rules: list, add, delete.
- Advanced permission policy JSON (tool rules / class rules / default).
- Audit log viewer with tool/decision/arguments.
- Consent lens for live write/high-risk requests, including voice approve/deny.

### Connectors

- MCP server config (enabled/command/args) with live registry refresh.
- Local OpenAI-compatible gateway: status, start/stop, port and access token.
- WeChat QR login (engine-rendered QR image) and disconnect.
- Feishu credentials, connect/start/stop.
- Controlled browser executable detection/override.
- Database connection list/add/delete.
- Remote knowledge-base mode/config, profile, top-k, timeout, local fallback,
  access-code exchange, test/list.
- Local RAG index/clear/list/search with citations.

### Studio

- Model compare.
- Multi-agent meeting room (participants from configured profiles, rounds,
  utterances, summary).
- Teamwork planning/execution entries.
- Image generation when a supported model is configured.

### System, software and tests

- Environment/runtime/package-manager probe; full environment check with
  missing-tool fixes; document-parser dependency check/install.
- System config (on demand), disks/free space, recommended install root.
- Update check and install; data folder access.
- Software manager: search packages, installed inventory, install/uninstall
  requests routed through the agent and the consent lens.
- Test lab: project baselines, execution records, requirement → generated cases,
  run selected cases, pass/fail summary and report paths.
- Command palette (`Ctrl / Cmd + K`) for every lens and action.
- Quick guide (`?`) covering voice, lenses, the agent surface and consent.
- Typography pass: operational labels, HUD, panel rows and transcript are all
  larger while retaining the FLUX hierarchy.

### Configuration deck

- Settings is no longer a flat model form with a link to Engine Control. `S`
  opens a five-category deck: **模型 / 运行 / 连接 / 安全 / 系统**.
- A non-floating category strip (it scrolls with the page), Chinese-first labels,
  serif context hero, intent chips and grouped content keep each category
  readable; switching categories resets scroll instead of re-animating the
  chamber.
- Agent calls map through the same categories:
  `model → Models`, `runtime|workmode|voice|notify → Runtime`,
  `connections|tools|gateway|knowledge|bots → Connections`,
  `security → Security`, `system|environment|about → System`.
  The backend also accepts the new `runtime/connections/security/system` tab
  names directly.

### Agent-controlled UI and settings

- `panel_control` is registered as a real agent tool. FLUX now maps every
  panel/tab to the single-page UI: `settings` + tab → Models / Runtime /
  Connectors / System, `butler` → Software, `schedule|workflow|plaza` →
  Automation, `imlog|messages` → Message Bus, `test` → Test Lab,
  `meeting` → Studio, `galaxy` → Memory, `palette` → Command Palette.
- The tool description and the FLUX system prompt list every settings tab and
  config field, so the model can choose the right page instead of guessing.
- `config_get` exposes the real settings keys (model, token saver, gateway,
  KB, notification, TTS, runtime vision/embedding, work mode, permission
  policy, nightly digest, MCP) with secrets redacted.

### Message bus and bots

- Message bus UI: channel state (WeChat/Feishu), in/out counts, peer and
  timestamped message log from `im_list` + `im_log`.
- Dedicated bot QR panel for WeChat login, with a large QR placeholder/scan
  state and bot logout.
- Feishu bot credentials/start/stop remain in the same Connectors page.

### Pushed cards and orb

- `chat_card` payloads are parsed out of the assistant reply before it reaches
  the transcript. They float as a sanitized push card at the right edge of the
  surface; the chat log contains only the written answer.
- Card HTML is sanitized with DOMPurify; up to three cards stack and each can be
  dismissed independently.
- The orb fluid is smaller inside the glass (radius `0.82` vs glass `1.35`) and
  shaped as a rounded water mass: heavier base, slightly narrower crown, much
  softer magnetic peaks.

### Tool windows and agent tools

- All native agent tools remain callable through naturally spoken/typed tasks.
- Controlled browser, Markdown, terminal, step barrage, desktop halo and floating
  orb open as real engine tool windows from `surface.html#/…`.
- Permission, ACUI cards, todos, thoughts and proactive events are bridged into
  FLUX lenses.

## Still not surfaced as a FLUX UI

These are **not missing from the backend**; they are UI/UX gaps. The commands
remain registered and callable by the engine.

| Capability | Current state | Why not yet in main UI |
| --- | --- | --- |
| Full test-authoring suite | Basic test lab integrated | Case editor, trend chart, OpenAPI import UI and per-case evidence viewer are still only commands; user explicitly deferred this |
| Baize’s old Galaxy / ConsciousnessNetwork / ExecutionFlow canvases | Not recreated | FLUX has the fluid core, transcript, memory map, audit replay and execution thought-line instead |
| Image generation | UI added, capability probe only | No supported image model is configured on this machine |

## Verification in this round

- `tsc --noEmit` passes.
- Engine Control opens with `E`; all 5 operation tabs render live data
  (Automation, Studio, Projects, Test Lab, Software).
- **Memory**: 20 graph nodes, 42/34 memory rows depending on data root; add,
  pin and delete tested; graph renders inside the panel height.
- **Sessions**: 17/14 sessions listed; switching and restoring tested.
- **Automation**: 2 workflows and 189 plaza items loaded; schedules list empty
  and add form rendered.
- **Security**: 4 permission rules and 80 audit rows loaded.
- **Connectors**: MCP config, gateway, WeChat QR component, Feishu credential
  form, browser path, DB links, remote KB, local RAG and RAG search loaded.
- **Studio**: 3 participants discovered; compare/meeting controls render.
- **Runtime**: 3 work modes, model usage (338 calls / 7 days), vision/embedding,
  advanced TTS, token-saver numbers, nightly digest, L0–L4 notification levels,
  per-level timeouts, email/webhook and voice text all render.
- **Connectors advanced**: gateway port/token and KB profile/top-k/timeout/
  fallback fields render.
- **Security**: permission policy JSON loads and saves.
- **System advanced**: full environment check and document-parser install exist.
- **Settings lens**: model profiles now include vision/embedding/multimodal; the
  advanced TTS form lives in the single settings deck instead of Engine Control;
  installed build
  verified with 173 tools and no boot-time stream.
- **Projects**: project list, session assignment and quick-command editor render.
- **System**: env/runtime/package-manager/disk/image probes render; update check
  and install are user-triggered.
- **Test Lab**: project baselines, records, case generation and run controls
  render (0–3 baselines depending on the data root); commands are wired to
  `test_*`.
- **Software**: 236 installed packages loaded; search and install/remove actions
  route through the agent.
- **Email**: six SMTP fields render when the email channel is enabled.
- **Command palette**: `Ctrl / Cmd + K` lists 11 lens/action entries and filters.
- **Quick guide**: `?` opens the four-step guide; `Esc` returns to the core.
- **Configuration deck**: `S` opens five categories; Models shows the profile
  rail, Runtime shows work modes + usage, Connections shows QR/message bus,
  System shows environment checks. Category switches reset scroll without
  re-animating the chamber.
- **Agent UI control**: injected `panel-control` events for
  `settings+voice`, `settings+gateway`, `butler`, `imlog`, `settings+model`
  and `palette` all opened the expected FLUX page/tab; `voice` → Runtime and
  `gateway` → Connections in the deck. The `panel_control` description now
  carries the full settings catalog and accepts
  `runtime/connections/security/system` categories.
- **Bots/message bus**: QR panel, channel cards and message log render in
  Connectors; `im_list` and `im_log` return live channel/log data.
- **Pushed card**: a live `chat_card` request produced a right-side card,
  transcript had zero `chat_card` / `<style>` text, and the card closed
  independently.
- **Ferrofluid core**: installed orb renders the smaller rounded mass with
  magnetic crowns inside the glass ring with a visible margin.
- **Typography**: operational labels are now 9–11px (previously 5–8px), body
  copy is 16–17px, and the five Engine Control tabs fit at the tested window
  width.
- **Streaming voice**: the reply queue starts speaking on the first complete
  sentence while later text is still arriving; provider and saved voice are
  applied by the queue, not only by the settings preview.
- Production installer rebuilt and installed; boot is clean (no background chat
  tokens shown as a FLUX answer).

## Next (optional)

1. A fuller test-authoring UI (case editor, trend chart, OpenAPI import).
2. Email SMTP fields and software-manager UI.
3. Onboarding/replay/command-palette surfaces if they are wanted without
   weakening the one-page design.

Everything above is additive; none of it changes the one-page rule.
