# FLUX / 流形

> 形随意动 — **form follows intent**.
>
> A single-surface desktop agent. No app grid, no chat bubbles, no buttons.
> One black ferrofluid core in a crystal sphere, a memory trace beneath it,
> and tools that come to you only when they are needed.

![FLUX hero](shots/01-hero.png)

## The idea

FLUX is an ambient intelligence prototype built around one object: a raymarched
crystal sphere containing a black magnetic liquid. The liquid listens, bends,
and grows sharp peaks with the audio spectrum. The whole operating surface is a
single page. There are no secondary routes and no navigation.

Small tools — weather, calendar, timer, music — appear as **satellites** at the
edges of the page. The core stays exactly where it is. A large context, such as
the built-in browser, becomes a **lens**: the core shrinks, docks to the side,
and the conversation condenses with it. The interface behaves like gravity, not
like a desktop of windows.

The agent is called **FLUX** in English and **流形** in Chinese. Mathematically a
manifold is a shape that can look flat only from very close; linguistically it is
"flowing form". Both meanings fit a liquid intelligence that has no fixed body.

## Preview

| Satellites | Speaking | Lens / built-in browser |
| --- | --- | --- |
| ![Satellites](shots/02-satellites.png) | ![Speaking](shots/03-orb-detail.png) | ![Lens](shots/04-lens.png) |

| Desktop core | Core settings | Capability field |
| --- | --- | --- |
| ![Desktop core](shots/desktop-01-hero.png) | ![Core settings](shots/desktop-02-settings.png) | ![Capability field](shots/desktop-03-capabilities.png) |

| Consent lens | Signal lens |
| --- | --- |
| ![Consent lens](shots/desktop-04-consent.png) | ![Signal lens](shots/desktop-05-signal.png) |

| Memory field | Sessions |
| --- | --- |
| ![Memory field](shots/desktop-memory.png) | ![Sessions](shots/desktop-sessions.png) |

| Engine Control / automation | Engine Control / studio |
| --- | --- |
| ![Engine automation](shots/desktop-systems-automation.png) | ![Engine studio](shots/desktop-systems-studio.png) |

| Software manager | Command palette |
| --- | --- |
| ![Software manager](shots/desktop-systems-software.png) | ![Command palette](shots/desktop-command-palette.png) |

| Quick guide | Advanced settings |
| --- | --- |
| ![Quick guide](shots/desktop-guide.png) | ![Advanced settings](shots/desktop-settings-advanced.png) |

| Bot QR + message bus | Configuration / connections |
| --- | --- |
| ![Bot QR and message bus](shots/desktop-connectors-bots.png) | ![Configuration connections](shots/desktop-settings-connections.png) |

| Pushed card (outside transcript) | Ferrofluid core |
| --- | --- |
| ![Pushed card](shots/desktop-push-card.png) | ![Ferrofluid core](shots/desktop-ferrofluid.png) |

## Ferrofluid, not a smooth ball

A ferrofluid is a colloidal magnetic liquid. With a field normal to its surface it
forms the Rosensweig instability: a set of sharp, uneven peaks. Under an
oscillatory field the same interface can also carry Faraday standing waves. FLUX
uses that physics as a visual grammar rather than a literal simulation: eight
magnetic crowns are displaced on an SDF, slow noise bends the envelope so the
body is never a flower, and the microphone FFT is split into eight bands so each
crown rises on its own band and phase.

The result is deliberately irregular: speech makes one side lift while another
falls, instead of the whole sphere pulsing in unison. The liquid itself is kept
small inside the glass, and the sphere was reduced so the transcript can occupy
more of the page. Replies are token-streamed into that transcript through the
engine's `chat-token` channel. The orb renders at 416² at 1× pixel ratio; the old
640²/1.6 backing store measured ~30 fps on the same page, while this one holds
60 fps (p50 16.7 ms) and keeps the same apparent size.

Reference for the surface behaviour: [Ferrofluids under oscillatory magnetic
fields, arXiv:2512.20497](https://arxiv.org/abs/2512.20497).

## Now a real desktop agent

`desktop/` turns this interaction prototype into a real Windows application. It
keeps the exact same single page — the sphere, the transcript, the satellites and
the lens — and mounts the **full Baize agent engine** underneath it:

- **Tauri 2 + Rust** backend, 173 native tools plus live MCP tools.
- Model routing, local Ollama, cloud providers, streaming tokens and thoughts.
- SQLite memory, RAG, permissions, audit, vault, browser/CDP, computer use, OCR,
  documents, terminal, schedules, WeChat/Feishu and more.
- The capability field (`G`) is generated from the live tool registry, so the UI
  never drifts from what the engine can actually do.
- Voice is the primary input; the agent's replies stream into the same
  edge-faded transcript, and dangerous tools interrupt with a consent lens.

The primary window remains one page. Browser, document, terminal and desktop
takeover surfaces are auxiliary tool windows opened by the engine, not app pages.
They use the same FLUX editorial shell: a hairline `FLUX / LENS` bar, a compact
action rail, serif document headings and a dark content plane. The browser has
real tabs, address navigation, back/forward, find, copy and handoff; the document
window has an outline, source/rendered toggle, save, print and a responsive
single-column layout at the 420 px side-window width; the terminal has presets,
session restart, clear, copy and a live PTY.

The browser lens on the main page is now a **control surface**, not a second fake
browser: it mirrors the real LENS window's tabs and current page, and its 「打开
LENS」 button takes you to the one WebView that owns cookies and login state.
Agent search is a staged pipeline: query refinement, parallel Bing/Baidu merge,
dedupe and relevance/authority rerank, 6-hour local cache, a live retrieval trace
and cited result cards. `unified_search` is the local half: FLUX's tool catalogue,
documents, conversations, knowledge, memories, IM and mail in one call. See
[docs/AGENT_SEARCH_RESEARCH.md](docs/AGENT_SEARCH_RESEARCH.md).

Replies are spoken **as they stream**, not after the answer is complete: the TTS
queue consumes the same token stream as the transcript, cuts it at sentence
boundaries and speaks each sentence while the remaining text is still arriving.
The voice provider is part of the saved configuration: 本机浏览器语音 picks a real
system voice, 本地 Kokoro picks a local Kokoro speaker, 豆包语音 2.0 uses App ID /
Token / speaker / rate, and 云端 OpenAI 兼容 uses base URL / model / key / voice.
`试听` saves the draft and speaks through that backend.

The conversation thread is now continuous across launches: FLUX remembers the
active conversation id instead of matching the old fixed title (the backend
renames a thread after its first topic), and falls back to the newest non-empty
thread. Context compaction only replaces early messages with a summary; if the
local summary model is unavailable it keeps a compact digest instead of
silently dropping the early history.

Kokoro is a slim local install under `F:\kokoro-tts`: two Chinese voices
(`zf_002`, `zm_009`), a ~313 MB local model in `kokoro-tts\model`, and an
immediate `/health` response — model warm-up no longer blocks the launch probe
with an 800 MB HuggingFace download.

There is exactly **one** settings surface: the `S` configuration deck (模型 / 运行 /
连接 / 安全 / 系统). The **Engine Control** lens (`E`) is operation only:
automation, model compare and meeting room, projects, test lab and software
diagnostics. It no longer duplicates security, connectors, runtime or system
settings.

FLUX is also isolated from a side-by-side Baize install. Runtime state lives in
`%LOCALAPPDATA%\FLUX\data\flux.db`; the legacy Baize directory
(`%LOCALAPPDATA%\baize`) is never opened. A stale `data\baize.db` from an early
FLUX build is renamed only when `flux.db` is absent; external Baize history,
memories and browser profiles are not imported. Existing imported Baize history
was archived to `flux.pre-isolation.db` and removed from the live DB. Inherited
WeChat/Feishu bot credentials are cleared on first launch, which prevents both
desktop processes from polling the same iLink token — the cause of “I chatted in
FLUX and Baize's WeChat bot answered too.” Reconfigure the bot inside FLUX if you
want it there.

Notifications are first-party FLUX signals: a bottom-left signal rail with
`ATTENTION` / `CRITICAL` tones and a restrained generated chime. The old shell
does not play Windows `Asterisk`/`Hand` sounds anymore, and the main page no
longer silently swallows `escalation-level` / `notify-user-request` events.

### WeChat conversations remember, and files move both ways

Every IM peer now maps to a stable FLUX conversation (`im:<channel>:<peer>`), so a
WeChat thread behaves like a desktop thread: the last 24 turns (user + assistant)
are replayed to the model before each new instruction, both sides are persisted in
the same `messages` table, and the thread appears in the sidebar where it can be
reopened or deleted. Approval prompts and their "已确认执行 / 已拒绝" acknowledgements
are filtered out of the replay, so control chatter never pollutes the context.
Peer ids are sanitized before they become conversation ids (non-ASCII peers fall
back to a stable hash), which keeps one peer from reading another's history.

Attachments flow in both directions. Inbound images, video, voice and documents
are decrypted, saved under `data\wechat-inbox` with their original file names
(they used to land in `%TEMP%` and vanish on reboot), and listed for the model as
name / kind / size plus a local path — up to six files per message, 64 MB each.
Outbound, FLUX can deliver any format: `wechat_send_file` uploads a local path as
a real file message (PDF, Word, Excel, PPT, archives, CSV, code, text, …), images
keep using `wechat_send_image`, and a local path that appears inside a reply is
attached automatically as a media message instead of being sent as plain text.
Outbound files are capped at 100 MB per message.

### A voice of its own

FLUX speaks through the local Kokoro service on `127.0.0.1:9800` with a sweet
Mandarin voice rather than the WebView's default (which was a lowered male SAPI
voice). `zf_001` — the brightest of the five bundled voices, ~255 Hz median F0 —
is the default; `zf_002/003/004` are warmer/softer/brighter alternates and
`zm_009` is the male voice. Speech is synthesised at speed 1.05 for a livelier
cadence, sentence by sentence, and the next sentence is pre-synthesised while
the current one plays, so replies start as soon as the first clause is ready.

The service runs on the GPU when one is available (GTX 1650 here). A five-second
sentence now synthesises in ~0.4 s instead of ~7.8 s on CPU, so the 4–5 s waits
between sentences are gone; measured across sentence lengths: 5 chars 0.42 s,
15 chars 0.38 s, 35 chars 0.66 s, 70 chars 0.89 s. Two settings matter:
`torch.backends.cudnn.benchmark` must stay **off** (with it on, every new sentence
length re-runs cuDNN autotuning and the first sentence of each length costs
2.7–8 s), and the model itself is loaded once at startup rather than on first use.
If CUDA is unavailable or the card is out of memory, the server falls back to a
4-thread CPU pipeline automatically; `KOKORO_DEVICE=cpu` forces the CPU path.

Kokoro is started and warmed by FLUX itself at launch — server up in ~15 s, model
in VRAM and a real sentence synthesised by ~50 s (`GET /health` reports
`device`, `model_loaded` and `warm`) — so the first spoken reply does not pay the
~35 s model load.

Voice **input** does not use the Web Speech API: WebView2 has no speech-recognition
backend, so `SpeechRecognition` always fails there. Instead the mic button records
the default input device with ffmpeg and transcribes it locally with
faster-whisper (small, int8, 4 threads), through a warm worker process that keeps
the model loaded — about 8 s once at launch, then ~4 s per utterance. Recognised
text goes through the same `respond()` path as typed input, and the reply is spoken
back with the same voice. ffmpeg, Python with `faster-whisper`, and the cached
`small` model are the only prerequisites; a `whisper.exe` CLI is used as fallback.

### Interruptible tasks: keep talking while FLUX is working

A WeChat instruction no longer has to arrive in one piece. While a task for a
conversation is running, further messages from that peer are **merged into the
running task** instead of queueing a second one: the agent loop picks them up
between rounds, sees them as `【用户在你执行期间的补充】`, adjusts its remaining
steps and answers once at the end. The sender gets a one-line ack
(`收到补充（第 N 条）…`) so they know it landed. Supplements are capped at eight
per burst (oldest dropped) and are also written to the conversation, so a later
turn still knows they were said. Saying `停止` / `停` / `stop` / `取消` while a task
runs cancels it; messages that merely contain those words are untouched. Anything
that arrives just as the task finishes is drained and run as one short follow-up,
so no message is silently lost.

See [desktop/README.md](desktop/README.md) for the architecture and build steps,
and [CAPABILITY_AUDIT.md](CAPABILITY_AUDIT.md) for the command-by-command coverage
audit and the remaining UI-only gaps.

**Windows installer:**
[`release/FLUX_1.0.0_x64-setup.exe`](release/FLUX_1.0.0_x64-setup.exe) — NSIS,
per-user install, no data or keys bundled. Size 39,274,658 bytes · SHA-256
`6D2A24E1D93F8984309722141572C0004C114FBCB5B9AAE54D6A74ECD8E79103`.
Also published as the [GitHub release v1.0.0](https://github.com/yubiao-sudo/flux/releases/tag/v1.0.0).
This build carries the subagent permission enforcement, the
`http_request` / `db_query` reclassification, shadow-DOM / same-origin
iframe piercing for the browser tools and the qwen2.5vl vision default.

## Run

### Desktop app

```powershell
cd desktop
pnpm install
pnpm tauri dev
```

The desktop window is undecorated, 1600 × 1000 by default, and connects to the
real engine. Build the NSIS installer with `pnpm desktop:build`
(`tauri build --features custom-protocol`; outputs under
`desktop/src-tauri/target/release/bundle/nsis/`).

### Web design preview

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4173`. This preview keeps the local demo data and is
useful for working on the visual language without the engine.

For the best result use a recent Chrome or Edge with WebGL 2 enabled. Microphone
permission is requested only after you touch the core.

```bash
pnpm build
pnpm preview
```

## Controls

The home page deliberately has no visible controls. Everything is voice-first,
with quiet keyboard affordances for previewing the design:

| Action | Input |
| --- | --- |
| Talk / stop listening | click the core, or `Space` |
| Open the configuration deck (models / runtime / connections / security / system) | `S` (desktop) |
| Open the capability field | `G` (desktop) |
| Open the memory field | `M` (desktop) |
| Open conversation history / sessions | `H` (desktop) |
| Open Engine Control (automation, studio, projects, test lab, software) | `E` (desktop) |
| Open the LOL esports desk | `L` (desktop) |
| Open FLUX PLAY (arcade / radio / focus / achievements) | `P` (desktop) |
| Open CHRONICLE (local timeline / weekly letter / year in review) | `C` (desktop) |
| Open ATLAS (memory / conversation / document map) | `A` (desktop) |
| Open DOSSIER (local evidence board) | `I` (desktop) |
| Open the command palette | `Ctrl / Cmd + K` (desktop) |
| Open the quick guide | `?` (desktop) |
| Optional keyboard command trace | `/` (desktop) |
| Open the Lens / built-in browser | `1` |
| Open weather | `2` |
| Open calendar | `3` |
| Open focus timer | `4` |
| Open ambient music | `5` |
| Return / dismiss every overlay | `Esc`, or click the empty page |
| Replay the guided demo | `D` |

Voice intents include weather, calendar, timer, music, the browser/article view,
and closing the current context. The prototype uses the browser's Web Speech
API when available. If the microphone is unavailable, the surface still works
and the keyboard preview remains available.

## What is implemented

- A real-time **raymarched ferrofluid** inside a glass sphere. The fluid uses an
  SDF with low-frequency tides, audio-driven magnetic peaks, and smooth-merged
  satellite droplets.
- **Audio reactivity** from the microphone when listening, with a generative
  "breath" fallback when idle, thinking, or speaking.
- **Four state expressions**: dormant, listening, processing, speaking.
- A **FLUX PLAY** surface (`P`): a local arcade with reaction / memory / typing /
  orbit-dodge games, a daily challenge and a local leaderboard, plus a radio
  station (早间 / 赛事 / 深夜), a focus pod, match picks, achievements and a
  today dashboard. The profile lives in SQLite (`flux.play.*`) with a
  localStorage fallback for the web preview; the radio voice reuses the same
  streaming speech queue and its background bed is synthesised with WebAudio.
- Three **local content lenses**: `C` **CHRONICLE** reads conversations, audit,
  model usage, focus and play records into a today / week / year timeline;
  `A` **ATLAS** draws memories, sessions and indexed documents as a searchable
  relation map; `I` **DOSSIER** turns a question into a local evidence board
  with sources, claims and a timeline. All three read existing SQLite data — no
  new external service is required.
- A **no-bubble transcript** with a dynamic gradient mask that fades at the
  visible edges and auto-follows new messages through the dock transition.
- **Satellite widgets** that spring in from the core with a blur/scale reveal:
  weather, calendar, focus timer, ambient music.
- A **Lens** large-context module with a bespoke editorial page. Opening it docks
  the core left, condenses the transcript, and draws a thin connection line.
- A **choreographed demo** (`D`) showing the full small-module → large-module
  story, including the core shrink and return.
- Responsive layout for desktop sizes from 1024 × 768 upward, with height-aware
  scaling so the transcript never collides with the bottom HUD.
- System speech synthesis for voice-triggered replies, and a constant low-key
  HUD for time, geography, microphone, state, and phase.

## Stack

Web preview:

- React 19 + TypeScript + Vite
- Three.js with a custom fullscreen fragment shader
- Framer Motion for layout-aware entrances and exits
- Manrope, Fraunces, JetBrains Mono via Fontsource
- Playwright used only for the screenshots in `shots/`

Desktop app additionally uses Tauri 2, Rust, SQLite, the Baize engine and its
tool runtime. The primary surface is still the same React/Three visual system.

## Structure

```
src/                      FLUX web preview
  App.tsx                 state, voice flow, demo choreography, HUD
  audio.ts                microphone analyser + generative audio fallback
  components/Transcript.tsx
  modules/Modules.tsx     shards + Lens browser
  orb/OrbCanvas.tsx       renderer lifecycle, audio → uniform mapping
  orb/raymarchShader.ts   glass + ferrofluid SDF shader
  orb/shaders.ts          simplex noise
  styles.css              visual system and responsive choreography

desktop/                  real Windows app
  src/                    FLUX primary surface + engine overlays
  src/engine/             Baize bridge, settings, capability field, consent
  src/auxiliary/          real browser / documents / terminal tool windows
  src-tauri/              Baize Rust engine (Tauri 2)
  surface.html            auxiliary tool-surface entry
```

## LENS, operator mode and local voice

The browser has one owner: the **LENS** WebView window. The main surface is a
control deck that mirrors its live tabs, not a second browser. Tool calls and
manual opens go to the same window. Search results render inside LENS with a
staged retrieval trace — Bing and Baidu in parallel, canonical de-duplication,
relevance/authority re-ranking, then a native result list with citations.

GUI automation is FLUX-branded: a 92 px **OPERATOR** bar shows the latest step,
not Baize's danmaku. It no longer minimizes every other application; the black
screen was caused by minimizing the target along with everything else. The
target window is focused instead, capture keeps working, and F12/Ctrl+Shift+F12
releases control.

Remote knowledge-base tenant, KB and profile fields are real selects populated
from the connected catalogue. Push cards inherit the FLUX palette, dismiss
after 18 s of inactivity (900 ms when a panel opens), and the final
reply uses the same Markdown renderer as the streaming turn, so the cursor
disappearing no longer replays an entrance animation.

Kokoro runs locally with two Chinese voices (`zf_002`, `zm_009`). The first cold
synthesis after model load is CPU-bound (seconds); the speech queue prefetches
the next sentence, soft-splits at commas, and caches repeated phrases so
successive replies start without a fresh synth round-trip.

## Honest boundaries

The top-level Vite app remains a **high-fidelity visual preview**: its weather,
calendar, article and music cards are local demo data, and its voice intents are
local. The `desktop/` app is the real agent. There, the same surface is backed by
the Baize engine: real model calls, real tools, real permissions, real memory and
real local data.

The desktop app is Windows-first because computer use, OCR and UI automation are
native Windows capabilities. The auxiliary browser/document/terminal windows
retain their functional tool chrome; the primary FLUX window never navigates.

The name **FLUX / 流形** was chosen over alternatives such as VANTA / 玄塔,
MORPH / 形态, KYMA / 涌, and NOEMA / 意态. See [DESIGN.md](DESIGN.md) for the
full brief and [desktop/README.md](desktop/README.md) for the runtime details.
