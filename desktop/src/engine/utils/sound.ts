// FLUX 界面音效引擎：WebAudio 实时合成，零外部音频文件。
// 统一音色：短玻璃音（sine/triangle + 指数衰减），不再使用白泽的钟琴/木琴/
// 噪声敲击/伪混响；每个事件用不同的音区、音程与节奏区分，SIGNAL 三档保持原样。
// 设置持久化到 localStorage，供 AcuiCard / App / chat store / 设置面板使用。

export type SfxEvent =
  | "startup" // 应用启动 · 觉醒
  | "notify" // 弹窗通知（主动提醒 / 定时提醒）
  | "permission" // 高危操作审批请求
  | "card-pop" // 受控卡片弹出
  | "task-done" // 任务完成
  | "error" // 出错
  | "escalation" // 通知升级警报
  | "voice-wake" // 语音唤醒 · 进入聆听（我在听）
  | "voice-handoff" // 问句交回 · 白泽提问后自动把话筒交还用户（该你说了）
  | "message-sent" // 消息已发出（轻触感）
  // FLUX 原生通知信号（与右侧 signal rail 配套的那套玻璃音，不是白泽旧音色）
  | "signal-info" // SIGNAL / INFO：两声短玻璃音
  | "signal-attention" // SIGNAL / ATTENTION：三声上行
  | "signal-critical" // SIGNAL / CRITICAL：低音三角波三连
  | "signal-send" // 消息发出：轻二音
  | "signal-complete"; // 完成：上行二音

/** 普通提醒弹窗的三档 FLUX 质感（键名兼容旧设置） */
export type NotifyStyle = "windchime" | "arp" | "soft";

const KEY_ENABLED = "baize.chime.enabled"; // 兼容旧键：曾存 "0"/"1"
const KEY_VOLUME = "baize.sfx.volume";
const KEY_STYLE = "baize.chime.kind"; // 兼容旧键：dingdong/bright/soft
// FLUX 早期 signal 设置键：用户如果在别的面板调过，迁移到原版设置，避免「明明开了却没声」
const KEY_ENABLED_FLUX = "flux.signal.enabled";
const KEY_VOLUME_FLUX = "flux.signal.volume";

// ---------------- 开关 / 音量 / 风格 ----------------

export function isSfxEnabled(): boolean {
  const own = localStorage.getItem(KEY_ENABLED);
  if (own !== null) return own !== "0";
  const legacy = localStorage.getItem(KEY_ENABLED_FLUX);
  if (legacy !== null) return legacy !== "0";
  return true;
}

export function setSfxEnabled(on: boolean) {
  localStorage.setItem(KEY_ENABLED, on ? "1" : "0");
  if (!on) pending.length = 0;
}

export function getSfxVolume(): number {
  // 注意 getItem 缺失时是 null，Number(null) === 0——必须先判空，
  // 否则「从没设置过音量」会被当成静音 0%，所有音效都听不见。
  const own = localStorage.getItem(KEY_VOLUME);
  if (own !== null) {
    const v = Number(own);
    if (Number.isFinite(v) && v >= 0) return Math.min(v, 1);
  }
  const legacy = localStorage.getItem(KEY_VOLUME_FLUX);
  if (legacy !== null) {
    const v = Number(legacy);
    if (Number.isFinite(v) && v >= 0) return Math.min(v, 1);
  }
  return 0.9;
}

export function setSfxVolume(v: number) {
  const clamped = Math.max(0, Math.min(1, v));
  localStorage.setItem(KEY_VOLUME, String(clamped));
  // 已经建好的主增益也要跟着变，否则滑块只影响下次启动
  if (master && ctx) {
    try {
      master.gain.setTargetAtTime(clamped, ctx.currentTime, 0.01);
    } catch {
      master.gain.value = clamped;
    }
  }
}

export function getNotifyStyle(): NotifyStyle {
  const v = localStorage.getItem(KEY_STYLE);
  return v === "bright" || v === "arp" ? "arp" : v === "soft" ? "soft" : "windchime";
}

export function setNotifyStyle(s: NotifyStyle) {
  localStorage.setItem(KEY_STYLE, s);
}

// ---------------- 音频图：主链 + 伪混响 ----------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let spaceIn: GainNode | null = null; // 湿声发送总线
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();

      // 主链：master → 轻压限（叠音时防爆音）→ 输出
      master = ctx.createGain();
      master.gain.value = getSfxVolume();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 22;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.24;
      master.connect(comp);
      comp.connect(ctx.destination);

      // 伪混响：反馈延迟 + 低频滚降，给声音一点「房间感」，去掉生硬的干
      spaceIn = ctx.createGain();
      spaceIn.gain.value = 1;
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.107;
      const fb = ctx.createGain();
      fb.gain.value = 0.38;
      const damp = ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2600;
      const wet = ctx.createGain();
      wet.gain.value = 0.24;
      spaceIn.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(wet);
      wet.connect(master);

      // 噪声源缓存（敲击起音用）
      const len = Math.floor(ctx.sampleRate * 0.25);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function out(node: AudioNode, c: AudioContext, space = 0.15, pan = 0) {
  // 干声（可带声像）+ 湿声发送
  let tail: AudioNode = node;
  if (pan !== 0 && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    tail = p;
  }
  tail.connect(master!);
  if (space > 0 && spaceIn) {
    const send = c.createGain();
    send.gain.value = space;
    tail.connect(send);
    send.connect(spaceIn);
  }
}

// ---------------- 合成基元 ----------------

/** 人性化：每次播放 ±4 音分失谐、±10ms 起音抖动、±10% 力度，像手敲而非程序播放 */
const humCents = () => (Math.random() * 2 - 1) * 4;
const humTime = () => (Math.random() * 2 - 1) * 0.01;
const humGain = (g: number) => g * (0.9 + Math.random() * 0.2);

interface ToneOpts {
  freq: number;
  /** 相对现在推迟的秒数 */
  t?: number;
  dur?: number;
  gain?: number;
  type?: OscillatorType;
  /** 泛音列 [频率倍率, 增益比]，模拟真实琴体共鸣 */
  partials?: Array<[number, number]>;
  pan?: number;
  attack?: number;
  space?: number;
  /** 低通截止（柔化电子感） */
  lowpass?: number;
  /** 颤音：失谐 LFO */
  vibrato?: { rate: number; depth: number };
}

/** 钟琴音：基音 + 非谐泛音列 + 指数衰减，像玻璃风铃 / 电颤琴 */
function tone(c: AudioContext, o: ToneOpts) {
  const t0 = c.currentTime + (o.t ?? 0) + humTime();
  const dur = o.dur ?? 0.9;
  const peak = humGain(o.gain ?? 0.2);
  const attack = o.attack ?? 0.008;

  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  if (o.lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = o.lowpass;
    env.connect(lp);
    out(lp, c, o.space, o.pan);
  } else {
    out(env, c, o.space, o.pan);
  }

  const layers: Array<[number, number]> = [
    [1, 1],
    ...(o.partials ?? []),
  ];
  for (const [mult, g] of layers) {
    const osc = c.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.value = o.freq * mult;
    osc.detune.value = humCents();
    const lg = c.createGain();
    lg.gain.value = g;
    osc.connect(lg);
    lg.connect(env);
    if (o.vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = o.vibrato.rate;
      const depth = c.createGain();
      depth.gain.value = o.vibrato.depth;
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.1);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

/** 敲击起音：短噪声爆点 + 低频叩击，模拟琴槌 / 指关节接触的一瞬 */
function strike(c: AudioContext, o: { t?: number; freq?: number; gain?: number; q?: number; thump?: number }) {
  const t0 = c.currentTime + (o.t ?? 0);
  const gain = o.gain ?? 0.1;
  if (noiseBuf) {
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = o.freq ?? 1600;
    bp.Q.value = o.q ?? 1.4;
    const env = c.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
    src.connect(bp);
    bp.connect(env);
    out(env, c, 0.08);
    src.start(t0);
    src.stop(t0 + 0.08);
  }
  if (o.thump) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(o.thump, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, o.thump * 0.6), t0 + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(gain * 1.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(g);
    out(g, c, 0.05);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  }
}

/** 滑音泡泡：频率上扫的短促 pop，用于卡片弹出 */
function pop(c: AudioContext, o: { t?: number; from?: number; to?: number; dur?: number; gain?: number }) {
  const t0 = c.currentTime + (o.t ?? 0);
  const dur = o.dur ?? 0.09;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(o.from ?? 320, t0);
  osc.frequency.exponentialRampToValueAtTime(o.to ?? 660, t0 + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(o.gain ?? 0.12, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.06);
  osc.connect(env);
  out(env, c, 0.1);
  osc.start(t0);
  osc.stop(t0 + dur + 0.1);
}

/** 玻璃信号音：单振荡器 + 指数衰减，和 FLUX signal rail 的原始音色一致。
 *  直接进主链（不加混响/敲击起音），保持通知音干净、可辨。 */
function glass(
  c: AudioContext,
  freq: number,
  at: number,
  dur: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  out(g, c, 0);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 短促滑音：玻璃泡/触感反馈用，起音 8ms、指数衰减，不做混响 */
function blip(
  c: AudioContext,
  from: number,
  to: number,
  at: number,
  dur: number,
  gain: number,
) {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  out(g, c, 0);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 暖垫：慢起音的正弦和弦，铺在琶音下面，冲淡「电子提醒」的直白 */
function pad(c: AudioContext, freqs: number[], o: { t?: number; dur?: number; gain?: number }) {
  const t0 = c.currentTime + (o.t ?? 0);
  const dur = o.dur ?? 1.6;
  for (const f of freqs) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    osc.detune.value = humCents() * 2;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime((o.gain ?? 0.045) / freqs.length * 2, t0 + dur * 0.3);
    env.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1200;
    osc.connect(env);
    env.connect(lp);
    out(lp, c, 0.3);
    osc.start(t0);
    osc.stop(t0 + dur + 0.1);
  }
}

/** 木琴琴键：正弦主体 + 三倍频泛音 + 敲击起音，温润的完成感 */
function marimba(c: AudioContext, freq: number, t: number, gain = 0.22, dur = 1.1, pan = 0) {
  strike(c, { t, freq: freq * 3, gain: gain * 0.5, q: 2 });
  tone(c, {
    freq,
    t,
    dur,
    gain,
    partials: [
      [3.01, 0.18],
      [6.05, 0.05],
    ],
    pan,
    space: 0.2,
  });
}

/** 玻璃风铃：纯正弦基音 + 高频非谐泛音，长衰减带余韵 */
function chime(c: AudioContext, freq: number, t: number, gain = 0.18, dur = 1.5, pan = 0) {
  strike(c, { t, freq: freq * 2.4, gain: gain * 0.35, q: 3 });
  tone(c, {
    freq,
    t,
    dur,
    gain,
    partials: [
      [2.76, 0.22],
      [5.4, 0.07],
    ],
    pan,
    space: 0.28,
  });
}

// ---------------- 各事件的乐句 ----------------

// FLUX 音高表：以 C 大调五声/自然音为主，和 SIGNAL 三档共用同一套音区。
// 界面音效刻意避开「钟琴 + 木琴 + 噪声敲击」的白泽旧质感，统一成短玻璃音。
const N = {
  G3: 196,
  A3: 220,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392,
  A4: 440,
  B4: 493.88,
  C5: 523.25,
  Cs5: 554.37,
  D5: 587.33,
  E5: 659.26,
  F5: 698.46,
  G5: 783.99,
  A5: 880,
  B5: 987.77,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.5,
  G6: 1567.98,
};

const RECIPES: Record<SfxEvent, (c: AudioContext) => void> = {
  // 任务完成：C5→E5→G5→C6 四声玻璃上行，比 SIGNAL 更长、更松弛。
  "task-done": (c) => {
    const gap = 0.085 + Math.random() * 0.015;
    glass(c, N.C5, 0, 0.5, 0.07);
    glass(c, N.E5, gap, 0.55, 0.06);
    glass(c, N.G5, gap * 2, 0.6, 0.05);
    glass(c, N.C6, gap * 3, 0.9, 0.05);
    glass(c, N.G6, gap * 3 + 0.06, 0.7, 0.018);
  },

  // 普通提醒弹窗：与 SIGNAL 明确区分——更慢、更软、更短。
  notify: (c) => {
    const style = getNotifyStyle();
    if (style === "arp") {
      // 脉冲：三声短促上行，但音区/节奏与 attention 不同
      glass(c, N.C5, 0, 0.18, 0.052);
      glass(c, N.E5, 0.07, 0.18, 0.046);
      glass(c, N.G5, 0.14, 0.2, 0.04);
    } else if (style === "soft") {
      // 轻触：单声，带一点高频泛光
      glass(c, N.D5, 0, 0.7, 0.048);
      glass(c, N.A5, 0.02, 0.32, 0.016);
    } else {
      // 玻璃：A4→C#5 大三度，刻意避开 SIGNAL 的纯五度音程，听感更软
      glass(c, N.A4, 0, 0.5, 0.06);
      glass(c, N.Cs5, 0.12, 0.6, 0.044);
    }
  },

  // 审批请求：两声低音三角「叩」+ 一声高玻璃确认——像门铃，不像警报。
  permission: (c) => {
    glass(c, N.B3, 0, 0.14, 0.06, "triangle");
    glass(c, N.D4, 0.14, 0.14, 0.055, "triangle");
    glass(c, N.A5, 0.3, 0.55, 0.03);
  },

  // 卡片弹出：一声极短的上滑玻璃泡
  "card-pop": (c) => {
    blip(c, 520, 780, 0, 0.09, 0.05);
    glass(c, N.C6, 0.02, 0.22, 0.018);
  },

  // 出错：A4→F4 下行两音，三角波，干净不刺耳；不用颤音/低通，保持 FLUX 的克制
  error: (c) => {
    glass(c, N.A4, 0, 0.45, 0.065, "triangle");
    glass(c, N.F4, 0.14, 0.6, 0.06, "triangle");
    glass(c, N.G3, 0.3, 0.7, 0.028, "triangle");
  },

  // 通知升级：四拍低音脉冲 + 高频泛光，比 CRITICAL 更急，但仍是玻璃音不是蜂鸣
  escalation: (c) => {
    for (let i = 0; i < 4; i++) {
      glass(c, i % 2 === 0 ? N.G3 : N.B3, i * 0.16, 0.2, 0.055 + i * 0.006, "triangle");
      glass(c, N.A5, i * 0.16 + 0.04, 0.22, 0.015);
    }
    glass(c, N.G6, 0.66, 0.5, 0.022);
  },

  // 启动：C4→G4→C5 三声慢起玻璃，像一次很轻的呼吸
  startup: (c) => {
    glass(c, N.C4, 0, 1.5, 0.04);
    glass(c, N.G4, 0.35, 1.3, 0.035);
    glass(c, N.C5, 0.7, 1.6, 0.03);
    glass(c, N.G6, 1.0, 1.0, 0.014);
  },

  // 消息发出：一声很轻的高频 tick，几乎只是触感
  "message-sent": (c) => {
    glass(c, N.C6, 0, 0.12, 0.028);
    glass(c, N.E6, 0.03, 0.18, 0.018);
  },

  // 语音唤醒：G4→B4 大三度，比 SIGNAL/ATTENTION 少一声、音程也不同
  "voice-wake": (c) => {
    glass(c, N.G4, 0, 0.22, 0.06);
    glass(c, N.B4, 0.09, 0.3, 0.045);
  },

  // 问句交回：B4→G4 下行，正好是唤醒的镜像——「该你说了」
  "voice-handoff": (c) => {
    glass(c, N.B4, 0, 0.25, 0.05);
    glass(c, N.G4, 0.11, 0.35, 0.06);
  },

  // ── FLUX 原生通知信号 ─────────────────────────────────────────
  // 音量按旧 signal 默认 0.48 折算到主链 0.9，听感与原来一致。
  "signal-info": (c) => {
    glass(c, 528, 0, 0.34, 0.085);
    glass(c, 792, 0.055, 0.42, 0.048);
  },
  "signal-attention": (c) => {
    glass(c, 392, 0, 0.26, 0.08);
    glass(c, 587.33, 0.09, 0.32, 0.065);
    glass(c, 784, 0.18, 0.4, 0.043);
  },
  "signal-critical": (c) => {
    glass(c, 196, 0, 0.5, 0.075, "triangle");
    glass(c, 293.66, 0.08, 0.44, 0.053, "triangle");
    glass(c, 440, 0.16, 0.5, 0.037, "triangle");
  },
  "signal-send": (c) => {
    glass(c, 392, 0, 0.2, 0.053);
    glass(c, 523.25, 0.045, 0.26, 0.032);
  },
  "signal-complete": (c) => {
    glass(c, 523.25, 0, 0.34, 0.058);
    glass(c, 783.99, 0.085, 0.46, 0.037);
  },
};

// ---------------- 自动播放策略解锁 ----------------
//
// 背景（2026-10-19）：用户反馈「从来没听到过音效」。排查发现 localStorage 里
// 连音效开关的键都不存在，说明 playSfx 的调用大多在 resume() 那一步就被拦掉了。
//
// 根因：WebView2（同 Chromium）的自动播放策略要求 AudioContext 必须在**用户手势**
// 的同步调用栈里创建/恢复。而真正需要出声的场景几乎都是异步的：
//   · 模型回答返回后 → task-done
//   · 审批请求推送过来 → permission
//   · 主动通知到达 → notify
// 这些上下文里 resume() 会被拒绝，而旧代码的失败回调是空的，于是静默无声。
//
// 解法：在**任意一次**用户手势（点击/按键/触摸）时抢先解锁一次 AudioContext，
// 之后同一页面生命周期内它都保持 running，异步播放就能正常出声。
// 这是 WebAudio 的标准做法，也是唯一可靠的解法。

let unlocked = false;
let unlockInstalled = false;
/**
 * 解锁前到达的音效先排队，等用户第一次点/按键时补播。
 * 旧实现是直接 return——用户「启动后第一条通知」永远听不到，看起来就像功能没做。
 */
const pending: SfxEvent[] = [];
const PENDING_MAX = 3;

function queuePending(event: SfxEvent) {
  if (pending[pending.length - 1] === event) return;
  pending.push(event);
  if (pending.length > PENDING_MAX) pending.shift();
}

/** 静音 1 帧：某些 WebView/Chromium 版本要真正 start 一个 source 才把输出设备唤醒 */
function kickOutput(c: AudioContext) {
  try {
    const buf = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* 忽略：kick 只是提高兼容性，不影响后续音符 */
  }
}

/** 解锁成功后，把排队的第一条通知补播出来 */
function flushPending(c: AudioContext) {
  if (!pending.length) return;
  const events = pending.splice(0, pending.length);
  for (const event of events) {
    try {
      RECIPES[event](c);
    } catch {
      /* 静默忽略 */
    }
  }
}

/** 在用户手势里调用：创建并唤醒 AudioContext，解除自动播放限制 */
function unlockAudio() {
  if (unlocked) return;
  const c = ac();
  if (!c) return;
  if (c.state === "running") {
    unlocked = true;
    kickOutput(c);
    flushPending(c);
    return;
  }
  // 用户手势里 resume() 一定会成功（这是策略允许的唯一时机）
  void c.resume().then(
    () => {
      unlocked = true;
      kickOutput(c);
      flushPending(c);
    },
    () => {
      /* 非手势上下文，下次手势再试 */
    },
  );
}

/** 绑定全局一次性解锁：任何点击/按键/触摸都算用户手势 */
export function installAudioUnlock() {
  if (typeof window === "undefined" || unlockInstalled) return;
  unlockInstalled = true;
  const events = ["pointerdown", "mousedown", "keydown", "touchstart", "click"] as const;
  const handler = () => {
    unlockAudio();
    if (unlocked) {
      for (const name of events) window.removeEventListener(name, handler, true);
    }
  };
  for (const name of events) window.addEventListener(name, handler, true);

  // 系统休眠 / 切走设备后 AudioContext 可能变回 suspended；回到前台时再唤醒一次。
  // 这里不依赖用户手势：解锁过一次之后，resume 是允许的。
  const wake = () => {
    if (!unlocked) return;
    const c = ac();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });
  window.addEventListener("focus", wake);
}

// ---------------- 对外 API ----------------

/** 真正调度一段音效（调用方已确认 context 可用） */
function emit(c: AudioContext, event: SfxEvent) {
  try {
    RECIPES[event](c);
  } catch {
    /* 静默忽略：无音频环境时不报错 */
  }
}

/** 播放某事件音效（内部已处理开关与静默失败） */
export function playSfx(event: SfxEvent) {
  if (!isSfxEnabled()) return;
  const c = ac();
  if (!c || c.state === "closed") return;
  if (c.state === "running") {
    // context 可能被别的模块（TTS/语音）先唤醒了，这里同步记账
    if (!unlocked) unlocked = true;
    flushPending(c);
    emit(c, event);
    return;
  }
  if (c.state === "suspended") {
    // 还没解锁：如果用户其实已经交互过（监听器被其它窗口/早期事件漏掉），
    // 借「粘性激活」直接 resume 一次；否则排队等第一次手势补播。
    const sticky = typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive;
    if (!unlocked && !sticky) {
      queuePending(event);
      return;
    }
    // 已解锁却仍是 suspended：设备被切走/系统休眠，唤醒后再播
    void c.resume().then(
      () => {
        unlocked = true;
        flushPending(c);
        emit(c, event);
      },
      () => {
        if (!unlocked) queuePending(event);
      },
    );
    return;
  }
  // interrupted / 其它状态：先记下，回前台时再试
  queuePending(event);
}

// ---------------- 诊断 ----------------

/** 音效子系统当前状态（设置面板展示，帮助定位「听不到」的原因） */
export function sfxDiagnostics(): {
  supported: boolean;
  state: string;
  unlocked: boolean;
  enabled: boolean;
  volume: number;
  style: NotifyStyle;
  sampleRate: number;
  pending: number;
} {
  const c = ac();
  return {
    supported: Boolean(c),
    state: c ? c.state : 'unavailable',
    unlocked,
    enabled: isSfxEnabled(),
    volume: getSfxVolume(),
    style: getNotifyStyle(),
    sampleRate: c ? c.sampleRate : 0,
    pending: pending.length,
  };
}

/** 强制解锁（给「试听」按钮用：点击就是手势，一定能成功） */
export function forceUnlockAudio() {
  unlocked = false;
  unlockAudio();
}

/** 试听某种提醒风格（设置面板选风格时用，不受全局开关限制手感一致） */
export function previewNotify(style: NotifyStyle) {
  const c = ac();
  if (!c) return;
  // 试听一定发生在用户点击里，顺手把解锁也做了
  unlockAudio();
  const play = () => {
    try {
      if (style === "arp") {
        glass(c, N.C5, 0, 0.18, 0.052);
        glass(c, N.E5, 0.07, 0.18, 0.046);
        glass(c, N.G5, 0.14, 0.2, 0.04);
      } else if (style === "soft") {
        glass(c, N.D5, 0, 0.7, 0.048);
        glass(c, N.A5, 0.02, 0.32, 0.016);
      } else {
        glass(c, N.A4, 0, 0.5, 0.06);
        glass(c, N.Cs5, 0.12, 0.6, 0.044);
      }
    } catch {
      /* noop */
    }
  };
  // 首次点击时 resume 是异步的：等它真正进入 running 再调度音符，否则这一声会被吞掉。
  if (c.state === "running") {
    play();
  } else {
    void c.resume().then(
      () => {
        unlocked = true;
        play();
      },
      () => {},
    );
  }
}
