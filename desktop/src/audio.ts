import type { AgentState } from './types';

export type AudioFrame = {
  bands: Float32Array;
  level: number;
  bass: number;
  mid: number;
  treble: number;
};

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const BAND_COUNT = 8;

/**
 * A tiny audio cortex. It prefers the microphone, and falls back to a
 * generative "breath" so the core is never a dead object.
 */
export class FluxAudio {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private smoothed = new Float32Array(BAND_COUNT);
  private frame: AudioFrame = {
    bands: new Float32Array(BAND_COUNT),
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
  };
  private micLevel = 0;
  micActive = false;
  micError: string | null = null;

  /* ---------- 真实朗读能量 ----------
   * 朗读时流体以前吃的是"合成包络"（正弦 + 随机颗粒），跟真正的声音没有关系。
   * 现在改为消费语音管线发来的 `baize:tts-pulse`：
   *   · 云 TTS —— voiceReactive / streamingSpeech 用 AnalyserNode 分析真实音频；
   *   · 浏览器语音 —— boundary 事件按词触发（真实语速，不是随机数）。
   * 每次脉冲把目标值抬高，帧间自然衰减，于是流体跟着"字的节奏"起伏。
   */
  private ttsSpeaking = false;
  private ttsTarget = 0;
  private ttsLevel = 0;
  private ttsSeen = false;

  private onTtsState = (event: Event) => {
    const detail = (event as CustomEvent<{ speaking?: boolean }>).detail;
    const speaking = detail?.speaking === true;
    this.ttsSpeaking = speaking;
    if (!speaking) {
      this.ttsTarget = 0;
      this.ttsSeen = false;
    }
  };

  private onTtsPulse = (event: Event) => {
    const detail = (event as CustomEvent<{ energy?: number }>).detail;
    const energy = detail?.energy;
    if (typeof energy !== 'number' || !Number.isFinite(energy)) return;
    this.ttsSeen = true;
    this.ttsTarget = Math.max(this.ttsTarget, clamp(energy));
  };

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('baize:tts-state', this.onTtsState as EventListener);
    window.addEventListener('baize:tts-pulse', this.onTtsPulse as EventListener);
  }

  async enableMic() {
    if (this.micActive) return true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('media devices unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const AudioCtor = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) throw new Error('web audio unavailable');
      const ctx = new AudioCtor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      this.ctx = ctx;
      this.analyser = analyser;
      this.stream = stream;
      this.data = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      this.micActive = true;
      this.micError = null;
      return true;
    } catch (error) {
      this.micError = error instanceof Error ? error.message : 'microphone unavailable';
      this.micActive = false;
      return false;
    }
  }

  disableMic() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.analyser?.disconnect();
    this.ctx?.close().catch(() => undefined);
    this.stream = null;
    this.analyser = null;
    this.ctx = null;
    this.data = null;
    this.micActive = false;
  }

  sample(time: number, state: AgentState): AudioFrame {
    const out = this.frame;
    const bands = out.bands;
    const isLive = this.micActive && this.analyser && this.data && state === 'listening';
    let liveBass = 0;
    let liveMid = 0;
    let liveTreble = 0;

    if (isLive && this.data) {
      this.analyser!.getByteFrequencyData(this.data);
      const bin = this.data.length;
      const boundaries = [2, 5, 9, 15, 24, 38, 58, 86, bin];
      for (let i = 0; i < BAND_COUNT; i += 1) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        let sum = 0;
        for (let j = start; j < end; j += 1) sum += this.data[j];
        const average = sum / Math.max(1, end - start) / 255;
        bands[i] = average;
      }
      liveBass = (bands[0] + bands[1]) * 0.5;
      liveMid = (bands[2] + bands[3] + bands[4]) / 3;
      liveTreble = (bands[5] + bands[6] + bands[7]) / 3;
    } else if (state === 'speaking' && this.ttsSeen) {
      // 真实语音：脉冲抬升目标，帧间衰减。能量按频谱倾斜分配，
      // 低频占比更高（人声基频集中在中低频），读数才像在说话。
      this.ttsLevel += (Math.max(this.ttsTarget, this.ttsLevel * 0.92) - this.ttsLevel) * 0.45;
      this.ttsTarget *= 0.82;
      const energy = clamp(this.ttsLevel);
      for (let i = 0; i < BAND_COUNT; i += 1) {
        const tilt = 0.58 + 0.42 * Math.cos((i / BAND_COUNT) * Math.PI);
        bands[i] = clamp(energy * tilt);
      }
      liveBass = clamp(energy * 1.08);
      liveMid = clamp(energy * 0.82);
      liveTreble = clamp(energy * 0.52);
    } else {
      const energy =
        state === 'speaking' ? 0.88 : state === 'listening' ? 0.42 : state === 'thinking' ? 0.3 : 0.17;
      const cadence = state === 'speaking' ? 5.4 : state === 'listening' ? 1.8 : 0.7;
      const breath = 0.48 + 0.52 * Math.sin(time * 0.72 - 0.4);
      for (let i = 0; i < BAND_COUNT; i += 1) {
        const phase = time * (cadence + i * 0.22) + i * 1.41;
        const wave = 0.5 + 0.5 * Math.sin(phase);
        const grain = 0.72 + hash(i + Math.floor(time * 2.2)) * 0.28;
        const lobe = Math.pow(Math.sin(time * 0.27 + i * 0.7) * 0.5 + 0.5, 1.5);
        bands[i] = clamp((wave * 0.55 + breath * 0.2 + lobe * 0.25) * energy * grain);
      }
      liveBass = state === 'idle' ? (bands[0] + bands[1]) * 0.55 : (bands[0] + bands[1]) * 0.7;
      liveMid = (bands[2] + bands[3] + bands[4]) / 3;
      liveTreble = (bands[5] + bands[6] + bands[7]) / 3;
    }

    for (let i = 0; i < BAND_COUNT; i += 1) {
      const target = bands[i];
      const ease = isLive ? 0.35 : 0.16;
      this.smoothed[i] += (target - this.smoothed[i]) * ease;
      bands[i] = this.smoothed[i];
    }

    const smoothing = isLive ? 0.32 : 0.12;
    this.micLevel += (Math.max(...bands) - this.micLevel) * smoothing;
    out.level = this.micLevel;
    out.bass = liveBass;
    out.mid = liveMid;
    out.treble = liveTreble;
    return out;
  }
}
