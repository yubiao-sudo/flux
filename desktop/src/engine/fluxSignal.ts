/**
 * FLUX signal chimes（兼容入口）。
 *
 * 音色本身已经搬进 `utils/sound.ts` 的共享音频链（signal-info / signal-attention /
 * signal-critical / signal-send / signal-complete）——那套有用户手势解锁、解锁前
 * 队列补播和统一音量，异步通知才真正出得了声。
 *
 * 这里保留 `playSignal(tone)` 的旧 API，避免旧代码/热重载残留引用时又退回到
 * 一个独立的、永远 suspended 的 AudioContext。
 */
import { playSfx } from './utils/sound';

export type FluxSignalTone = 'info' | 'attention' | 'critical' | 'send' | 'complete';

const TONE_EVENT = {
  info: 'signal-info',
  attention: 'signal-attention',
  critical: 'signal-critical',
  send: 'signal-send',
  complete: 'signal-complete',
} as const;

export function playSignal(tone: FluxSignalTone) {
  playSfx(TONE_EVENT[tone]);
}
