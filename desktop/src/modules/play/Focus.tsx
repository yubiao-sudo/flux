import { useEffect, useRef, useState } from 'react';
import { Coffee, Moon, Pause, Play, RotateCcw, Sparkles, Timer, Waves, Wind } from 'lucide-react';
import { playSfx } from '../../engine/utils/sound';
import type { FocusLog, PlayProfile } from './playStore';
import { todayKey } from './playStore';

type Props = {
  profile: PlayProfile;
  focusLog: FocusLog[];
  setFocusLog: (log: FocusLog[]) => void;
  onRecord: (kind: 'games' | 'focusMinutes' | 'radio' | 'predictions', amount: number, xp: number) => void;
  onComplete: (minutes: number) => void;
};

type Soundscape = 'silence' | 'rain' | 'cafe' | 'space' | 'deep';

const SOUNDSCAPES: Array<{ id: Soundscape; label: string; icon: typeof Waves }> = [
  { id: 'silence', label: '静音', icon: Moon },
  { id: 'rain', label: '雨', icon: Waves },
  { id: 'cafe', label: '咖啡馆', icon: Coffee },
  { id: 'space', label: '太空', icon: Sparkles },
  { id: 'deep', label: '深潜', icon: Wind },
];

const MODES = [25, 45, 60];

/** 低成本的 WebAudio 氛围声；不依赖音频文件。 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private sources: Array<AudioBufferSourceNode | OscillatorNode> = [];
  current: Soundscape = 'silence';

  start(kind: Soundscape) {
    if (kind === 'silence') {
      this.stop();
      return;
    }
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      const ctx = this.ctx;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      this.stop();
      this.current = kind;

      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      master.gain.exponentialRampToValueAtTime(kind === 'space' || kind === 'deep' ? 0.05 : 0.055, ctx.currentTime + 1.2);
      this.nodes.push(master);

      if (kind === 'rain' || kind === 'cafe') {
        const seconds = 2;
        const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i += 1) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.2;
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = kind === 'rain' ? 2600 : 900;
        filter.Q.value = 0.7;
        src.connect(filter);
        filter.connect(master);
        src.start();
        this.sources.push(src);
        this.nodes.push(filter);
        if (kind === 'rain') {
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = 280;
          filter.disconnect();
          filter.connect(hp);
          hp.connect(master);
          this.nodes.push(hp);
        }
      } else {
        const freqs = kind === 'space' ? [55, 82.5, 110] : [49, 65.4, 98];
        freqs.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const gain = ctx.createGain();
          gain.gain.value = 0.28 / (index + 1);
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 0.06 + index * 0.017;
          const depth = ctx.createGain();
          depth.gain.value = 1.8;
          lfo.connect(depth);
          depth.connect(osc.detune);
          osc.connect(gain);
          gain.connect(master);
          osc.start();
          lfo.start();
          this.sources.push(osc, lfo);
          this.nodes.push(gain, depth);
        });
      }
    } catch {
      /* audio unavailable */
    }
  }

  stop() {
    this.sources.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    });
    this.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        /* noop */
      }
    });
    this.sources = [];
    this.nodes = [];
    this.current = 'silence';
  }

  dispose() {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

export function FocusMode({ profile, focusLog, setFocusLog, onRecord, onComplete }: Props) {
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [sound, setSound] = useState<Soundscape>('silence');
  const engine = useRef(new SoundEngine());
  const completedRef = useRef(false);

  const total = minutes * 60;
  const progress = Math.max(0, Math.min(1, 1 - remaining / total));

  useEffect(() => () => engine.current.dispose(), []);

  const complete = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setRunning(false);
    engine.current.stop();
    setSound('silence');
    playSfx('task-done');
    onRecord('focusMinutes', minutes, minutes * 2);
    const today = todayKey();
    const next = [...focusLog];
    const existing = next.find((item) => item.date === today);
    if (existing) existing.minutes += minutes;
    else next.push({ date: today, minutes });
    setFocusLog(next);
    onComplete(minutes);
  };

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          complete();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const start = () => {
    if (remaining <= 0) setRemaining(minutes * 60);
    completedRef.current = false;
    setRunning(true);
    playSfx('signal-info');
  };

  const pause = () => {
    setRunning(false);
    engine.current.stop();
    setSound('silence');
  };

  const chooseMinutes = (value: number) => {
    if (running) return;
    setMinutes(value);
    setRemaining(value * 60);
    completedRef.current = false;
  };

  const chooseSound = (value: Soundscape) => {
    setSound(value);
    if (value === 'silence') {
      engine.current.stop();
    } else {
      engine.current.start(value);
      if (!running) start();
    }
  };

  const reset = () => {
    setRunning(false);
    setRemaining(minutes * 60);
    completedRef.current = false;
    engine.current.stop();
    setSound('silence');
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const circumference = 2 * Math.PI * 88;

  return (
    <div className="play-focus">
      <header className="play-section-head">
        <div>
          <span>FOCUS POD / {minutes} MIN</span>
          <h1>把世界调低，只剩一个动作。</h1>
          <p>选一个声景，坐一段完整的时间。结束后会写进专注记录。</p>
        </div>
        <div className="play-focus-stats">
          <span>TODAY <strong>{profile.daily.focusMinutes}</strong> min</span>
          <span>TOTAL <strong>{profile.stats.focusMinutes}</strong> min</span>
        </div>
      </header>

      <div className="play-focus-stage">
        <div className="play-focus-ring">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="88" className="play-focus-track" />
            <circle
              cx="100"
              cy="100"
              r="88"
              className="play-focus-progress"
              style={{
                strokeDasharray: circumference,
                strokeDashoffset: circumference * (1 - progress),
              }}
            />
          </svg>
          <div className="play-focus-time">
            <strong>{mm}:{ss}</strong>
            <span>{running ? 'FOCUSING' : remaining === 0 ? 'DONE' : 'READY'}</span>
          </div>
        </div>

        <div className="play-focus-console">
          <div className="play-focus-modes">
            {MODES.map((value) => (
              <button
                type="button"
                key={value}
                className={minutes === value ? 'is-active' : ''}
                onClick={() => chooseMinutes(value)}
                disabled={running}
              >
                {value} min
              </button>
            ))}
          </div>

          <div className="play-focus-controls">
            <button type="button" className="play-focus-main" onClick={running ? pause : start}>
              {running ? <Pause size={22} /> : <Play size={22} />}
              {running ? '暂停' : remaining === 0 ? '再来一段' : '开始专注'}
            </button>
            <button type="button" className="play-round-btn" onClick={reset} title="重置">
              <RotateCcw size={15} />
            </button>
          </div>

          <div className="play-sound-list">
            {SOUNDSCAPES.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                className={`play-sound ${sound === id ? 'is-active' : ''}`}
                onClick={() => chooseSound(id)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          <p className="play-focus-note">
            <Timer size={12} /> 建议 25 分钟起步；中途暂停不会记录完整一段。
          </p>
        </div>
      </div>

      <div className="play-focus-history">
        <header>
          <span>RECENT FOCUS</span>
          <em>{focusLog.length} sessions</em>
        </header>
        <div className="play-focus-bars">
          {focusLog.slice(-14).map((entry) => (
            <div key={entry.date}>
              <span style={{ height: `${Math.max(4, Math.min(80, entry.minutes * 1.6))}px` }} />
              <em>{entry.date.slice(5)}</em>
            </div>
          ))}
          {focusLog.length === 0 && <p className="play-muted">还没有记录。第一段专注会出现在这里。</p>}
        </div>
      </div>
    </div>
  );
}
