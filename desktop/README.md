# FLUX / 流形 · Desktop

A single-surface Windows desktop agent. The primary window is one page: a
raymarched crystal sphere containing audio-reactive black ferrofluid, the name
**FLUX / 流形** at its centre, an edge-faded transcript below, and small
peripheral tools that appear only when needed.

The agent runtime is the full Baize-derived engine (Rust + Tauri 2): 173 native tools,
MCP tools, model routing, SQLite memory, permissions, browser/CDP, computer use,
documents, terminal, schedules, messaging, OCR, TTS and more. FLUX is the only
primary surface; the engine is the same one that powered Baize.

| Core | Core settings | Capability field |
| --- | --- | --- |
| ![Core](../shots/desktop-01-hero.png) | ![Settings](../shots/desktop-02-settings.png) | ![Capabilities](../shots/desktop-03-capabilities.png) |

| Consent | Signal |
| --- | --- |
| ![Consent](../shots/desktop-04-consent.png) | ![Signal](../shots/desktop-05-signal.png) |

| Memory field | Sessions |
| --- | --- |
| ![Memory](../shots/desktop-memory.png) | ![Sessions](../shots/desktop-sessions.png) |

| Engine / automation | Engine / studio |
| --- | --- |
| ![Automation](../shots/desktop-systems-automation.png) | ![Studio](../shots/desktop-systems-studio.png) |

| Software manager | Command palette |
| --- | --- |
| ![Software](../shots/desktop-systems-software.png) | ![Palette](../shots/desktop-command-palette.png) |

| Quick guide | Advanced settings |
| --- | --- |
| ![Guide](../shots/desktop-guide.png) | ![Advanced settings](../shots/desktop-settings-advanced.png) |

| Bot QR + message bus | Configuration / connections |
| --- | --- |
| ![Bot QR and message bus](../shots/desktop-connectors-bots.png) | ![Configuration connections](../shots/desktop-settings-connections.png) |

| Pushed card (outside transcript) | Ferrofluid core |
| --- | --- |
| ![Pushed card](../shots/desktop-push-card.png) | ![Ferrofluid core](../shots/desktop-ferrofluid.png) |

The full coverage audit and remaining UI-only gaps live in
[`../CAPABILITY_AUDIT.md`](../CAPABILITY_AUDIT.md).

## The one-page rule

- The primary window has **no navigation, no secondary routes, no chat bubbles,
  no persistent buttons or input fields**.
- Speaking is the primary input. The orb (or `Space`) starts listening. The
  hidden `/` command trace is an optional keyboard fallback for precise input and
  accessibility; it is invisible at rest.
- Small capabilities (weather, calendar, timer, music) arrive as **satellites**
  at the edges. The core stays put.
- Large capabilities dock the core to the left and unfold as a **lens**:
  - `S` — configuration deck: models, runtime, connections, security, system
  - `G` — the capability field (every live tool, grouped)
  - `M` — memory field (real SQLite memory graph, search, add, pin, forget)
  - `H` — conversation history / session switch / export
  - `E` — Engine Control (operation only): Automation, Studio, Projects,
    Test Lab, Software. Configuration is not duplicated here; it lives in `S`.
  - `L` — LOL esports desk (schedule, scores, standings, highlights)
  - `P` — FLUX PLAY: arcade, radio, focus pod, pick'em, achievements
  - `Ctrl / Cmd + K` — command palette for every lens and action
  - `?` — quick guide (voice, lenses, consent and palette)
  - permission requests — consent lens
  - agent cards / progress — signal lens
  - `1` — research lens preview
- `Esc` closes the lens. `Space` speaks. Touch the core again to interrupt.

## Capability access

Capabilities are not replicated as panels. They are called by the real agent
through natural language or voice, with the same permission model as Baize:

- Read-only tools execute directly.
- Writes and high-risk actions interrupt with a consent lens (allow once, allow
  and remember, or deny; voice 「允许 / 拒绝」 also works).
- The capability field is generated at runtime from `flux_capabilities`, so the
  list always matches the engine's live registry (native + MCP).
- The controlled browser, Markdown document window, terminal, execution-flow
  barrage and desktop halo are real tool windows from the engine
  (`surface.html#/browser`, `#/markdown`, `#/terminal`, `#/step`, `#/halo`,
  `#/orb`). They are auxiliary tool surfaces, not app pages.

## Voice and configuration

There is exactly one configuration surface: the `S` deck (模型 / 运行 / 连接 /
安全 / 系统). Engine Control (`E`) only operates the engine and no longer repeats
the settings tabs.

The voice section is provider-aware. **本机浏览器语音** selects from the system's
installed Chinese voices; **本地 Kokoro** selects from the local Kokoro voice
list; **豆包语音 2.0** uses App ID, Access Token, speaker and speech rate;
**云端 OpenAI 兼容** uses base URL, model, API key and voice id. `试听` saves the
current draft and speaks a sample through the selected backend. The reply voice
queue reads the same saved config: local replies select the saved
`SpeechSynthesisVoice`, while cloud / Kokoro / Doubao replies call the matching
backend for each sentence. The transcript and the spoken text both come from the
same token stream; nothing is spoken only after the full answer lands.

Local Kokoro is installed at `F:\kokoro-tts` with a trimmed model in
`kokoro-tts\model` (~313 MB) and exactly two Chinese voices, `zf_002` (女) and
`zm_009` (男). `server.py` answers `/health` immediately and warms the model in a
background thread, so the settings voice list no longer waits on a full model
load. The old 50+ voice / 800 MB HuggingFace cache is not used.

Conversations persist by id (`flux.active_conversation`), not by the old fixed
title — the backend renames a thread after its first topic. On launch FLUX
reopens the active thread if it has messages, otherwise the newest non-empty
one. Context compaction keeps a local digest if the summary model is unavailable;
it never drops the early half of a conversation just because the summary came
back empty.

## Architecture

```
desktop/
  src/                 FLUX primary surface (React 19 + Three.js + Framer Motion)
    engine/           engine bridge, settings/capability/consent/signal lenses
    auxiliary/        Baize tool-window surfaces (lazy, isolated CSS)
  src-tauri/          Baize Rust engine (Tauri 2)
  surface.html         multi-entry surface for auxiliary tool windows
  resources/pyoffice/ portable Python for document/OCR tools
```

- `src/engine/useFluxEngine.ts` binds conversations, streaming tokens, thoughts,
  permissions, cards, todos, model config and the tool registry.
- `src/engine/EnginePanels.tsx` implements the FLUX-styled overlays.
- `src-tauri/src/commands.rs` exposes `flux_capabilities` and `flux_engine_info`
  in addition to the original command surface.
- The system prompt identifies the agent as **FLUX / 流形**.
- The visual layer is intentionally decoupled from the tool windows; the main
  page never navigates.

### IM conversations (WeChat / Feishu)

`src-tauri/src/im_session.rs` maps an IM peer to a stable FLUX conversation
(`im:<channel>:<peer>`), replays the last 24 turns into `Supervisor::run`, and
persists both sides into the same `messages` table the desktop threads use — so a
WeChat thread can be reopened from the sidebar, survives restarts, and the model
knows what "刚才那个" refers to. Peer ids are sanitized (non-ASCII peers hash to a
stable id) so two peers can never share history; approval prompts and their
acknowledgements are excluded from the replay.

`src-tauri/src/wechat.rs` owns the media pipeline. Inbound items are decrypted and
written to `data\wechat-inbox` under their original names, then listed for the
model as name/kind/size/path (max six per message, 64 MB each). Outbound, FLUX can
send any format: `wechat_send_file` uploads a local path as a real file message
(100 MB cap), `wechat_send_image` keeps the preview path, and local paths found in
a reply are attached automatically instead of being sent as text.

The same module runs tasks in an interruptible mode. `im_session::try_mark_active`
claims a conversation atomically when an instruction starts; any further message
for that peer becomes a supplement (`push_supplement`) instead of a queued task.
`AgentLoop` (via `Supervisor::with_inbox`) drains supplements at the top of every
round and appends them as a `【用户在你执行期间的补充】` user turn, so the model
finishes the original work with the new constraint applied and replies once.
`停止 / 停 / stop / 取消` sets the shared cancel flag while a task is active, and
supplements that arrive after the last round are drained into one final
follow-up, which means no message can be lost at the finish line.

## Data and migration

FLUX keeps runtime state in `%LOCALAPPDATA%\FLUX\data\flux.db` (or the
exe-adjacent `data\flux.db` in dev). A stale early-FLUX `data\baize.db` is renamed
once into `flux.db`; external Baize history/memories/browser profiles are never
imported, and `%LOCALAPPDATA%\baize` is never opened at runtime. Inherited
WeChat/Feishu credentials are cleared on the first FLUX start. Previously imported
Baize history is archived as `flux.pre-isolation.db`. Baize and FLUX can therefore
run side by side without polling the same bot token. The NSIS installer preserves
`data` on upgrade/uninstall via `nsis-hooks.nsh`.

The vault stores model API keys on the local machine (Windows credential vault /
local encrypted store). Nothing is bundled into the installer.

## Auxiliary windows

The browser, document and terminal are separate Tauri webviews loading
`surface.html#/browser`, `#/markdown` and `#/terminal`. They share
`src/auxiliary/flux-surface.css` — the same hairline chrome, Manrope/Fraunces/
JetBrains Mono type and dark surface as the core. Browser and document windows
are 420 px side slots, so both layout down to a single column at that width; the
terminal is 760 px wide and keeps a live PTY.

The browser lens in the **main** window (`BrowserHub` in `src/modules/Modules.tsx`)
is a control surface over that one WebView: it mirrors the real LENS tabs and
exposes 「打开 LENS」. It is no longer a second, static fake browser; tool-driven
navigation and manual navigation land in the same Tauri window (`open_browser_window`
also exists for UI code).

Search is staged in `src-tauri/src/browser.rs`: query normalization + intent
expansion, parallel Bing/Baidu merge, dedupe and relevance/authority rerank, a
6-hour local cache and a live `SearchTrace`. The result view is the native
`search` tab in the LENS window, not the old blue `build_results_html` page.
`src-tauri/src/unified_search.rs` is the local index: the `tools` source is built
from `ToolRegistry::catalog()`, alongside files, knowledge, conversations,
memories, IM and mail.

Replies are spoken from `src/engine/streamingSpeech.ts`: it consumes the same
`engine.streaming` tokens the transcript uses, splits at sentence boundaries and
speaks each sentence while the rest is still arriving. This replaces the old
post-completion `extractMonologue` path, so the voice no longer summarizes or
drops lists. The queue also prefetches the next sentence while the current clip
is playing, uses a play serial so a stale audio callback cannot start a second
voice, and breaks long Chinese runs at a comma after 30 characters instead of
waiting for a full stop.

Notifications use `src/components/NoticeStack.tsx` and the FLUX signal tones
(`signal-info` / `signal-attention` / `signal-critical`) defined in
`src/engine/utils/sound.ts`. `notify-user-request` and `escalation-level` reach
the main page as a bottom-left signal rail; `info` / `attention` / `critical` each
keep their original glass-chime interval. The tones used to live in
`fluxSignal.ts`, which created its own AudioContext lazily inside the async
notification callback: WebView2 kept that context suspended, so every chime was
silent. The tone recipes now share the main engine's gesture-time unlock, pending
queue and volume control (and the auxiliary windows), so they actually sound.
The other interface cues (message sent, task done, permission, error, voice
wake/handoff, startup) now use the same glass palette with distinct intervals
and rhythms; the old Baize marimba/chime/noise-strike recipes are no longer used.
The orb renders at 416² at 1× pixel ratio, measured at 60 fps (p50 16.7 ms) on
the desktop build.

### LOL / ESPORTS OBSERVER

`src/modules/esports/EsportsPanel.tsx` is a full-bleed esports desk, opened with
`L` or from the command palette. It reads `lolesports.com/leagues` (the page's
Apollo SSR payload) through `src-tauri/src/esports.rs`: season/league metadata,
current and upcoming matches, series scores, team logos, VODs, Worlds/MSI
history and the global GPR ranking. The Rust command is
`lol_esports_overview`, cached for 90 seconds; the page refreshes every 90
seconds and has a manual sync button. The data window follows what lolesports
publishes on the current schedule page (2026 season plus recent Worlds/MSI
finals); older seasons show their split calendar from the season archive.

### FLUX PLAY

`src/modules/play/` is the daily-open surface: opened with `P` or from the
command palette. Six modes share one local profile, one level curve and one
achievement set:

- **游戏厅 / Arcade** — reaction (five-round average), memory sequence, typing
  (Chinese / English / code word sets, 30 s WPM + accuracy) and **轨道躲避**, a
  Canvas game where the core is dragged through falling shards. Each run writes
  a local top-5 leaderboard entry and can complete the day's rotating challenge.
- **电台 / Radio** — a generated program with 早间 / 赛事 / 深夜 channels. The
  script is composed from the live weather, tasks, LoL schedule and the player's
  own day; the voice goes through the existing `streamingSpeech` queue (Kokoro,
  Doubao, cloud or system voice, whichever `S` is configured), with subtitle
  sync, pause/resume and a WebAudio-synthesised background bed. An optional
  **AI 写稿** button asks the configured model to rewrite the 5–7 segment
  programme (`play_radio_script`); if the engine/model is unavailable the local
  editorial composer stays in place.
- **专注舱 / Focus** — 25 / 45 / 60 minute timer with rain / cafe / space /
  deep WebAudio soundscapes, a breathing core and a 14-day focus history.
- **预测 / Pick'em** — picks upcoming matches from the esports overview and
  settles them automatically when the real result lands.
- **成就 / Profile** — levels, daily quests, badges and streak.
- **驾驶舱 / Today** — weather, next match, tasks, focus week and badges in one
  page.

The profile (XP, level, streak, daily challenge, leaderboard, badges) is kept in
the SQLite `settings` table under `flux.play.*` through `play_state_get` /
`play_state_set`, with localStorage as the browser-preview fallback. Nothing is
uploaded. The panel reuses `playSfx`, the FLUX glass palette and the same
full-bleed `[data-panel]` treatment as the esports desk.

### CHRONICLE / ATLAS / DOSSIER

Three local content lenses share `src/modules/lenses/` and the same hairline
surface shell:

- **CHRONICLE** (`C`) — `ChroniclePanel.tsx` reads `query_audit_log`,
  `list_conversations`, `model_usage_daily`, `model_usage_report`,
  `get_memory_graph` plus the local PLAY profile. It renders today / week /
  year timelines, a generated weekly letter, top tools and models, and a year
  card. No new database or network source is involved.
- **ATLAS** (`A`) — `AtlasPanel.tsx` lays out recent, high-salience memories,
  conversations and indexed RAG documents as a relation field. Search keeps the
  layout and dims non-matches; the right rail opens a node and can ask the local
  RAG index (`search_rag`), showing citations only when there is evidence.
- **DOSSIER** (`I`) — `DossierPanel.tsx` takes a topic and searches local RAG,
  memories, audit rows, conversation titles and the active session. It builds a
  source list, cross-source claims, an extracted timeline and entities. Nothing
  is fabricated: if local evidence is missing it says so and offers the LENS
  browser for a web pass.

All three are full-bleed, mounted through `ModuleLayer`, and appear in the
command palette. `Esc` returns to the core; `C` / `A` / `I` switch directly
between them.

## Development

```powershell
pnpm install
pnpm dev              # browser design preview on :1421
pnpm tauri dev        # desktop app with the real engine
```

The Tauri dev URL is fixed to `http://127.0.0.1:1421`.

Useful environment for UI automation:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
pnpm tauri dev
```

## Build the Windows installer

```powershell
pnpm tauri build
```

Produces an NSIS installer under `src-tauri/target/release/bundle/nsis/`.
A prebuilt copy is kept at
[`../release/FLUX_1.0.0_x64-setup.exe`](../release/FLUX_1.0.0_x64-setup.exe).
The installer uses the `currentUser` mode and installs to
`%LOCALAPPDATA%\FLUX`, so the exe-adjacent `data` directory stays writable.
Targets are `nsis` only; the app is Windows-first because the engine's computer
use, OCR and UI automation are Windows-native.

## Design references

The original FLUX prototype and its design notes live one level up:

- `../README.md`
- `../DESIGN.md`
- `../shots/01-hero.png`, `02-satellites.png`, `03-speaking.png`,
  `03-orb-detail.png`, `04-lens.png`

The desktop surface keeps the same visual language: near-black void, glass,
ferrofluid, Manrope / Fraunces / JetBrains Mono, thin hairlines, long horizons,
and motion that behaves like gravity.
