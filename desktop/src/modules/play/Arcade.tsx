import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Crosshair,
  Keyboard,
  Orbit,
  RotateCcw,
  Sparkles,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react';
import { playSfx } from '../../engine/utils/sound';
import type { DailyChallenge, PlayProfile, ScoreGame } from './playStore';
import { beep, formatScore, SCORE_META } from './playStore';

type Props = {
  profile: PlayProfile;
  challenge: DailyChallenge;
  onRecord: (
    kind: 'games' | 'focusMinutes' | 'radio' | 'predictions',
    amount: number,
    xp: number,
  ) => void;
  onScore: (game: ScoreGame, value: number, xp: number) => void;
};

type Game = 'menu' | 'reaction' | 'memory' | 'typing' | 'dodge';

type GameProps = {
  profile: PlayProfile;
  onScore: (game: ScoreGame, value: number, xp: number) => void;
  onRecord: Props['onRecord'];
};

const PHRASE_SETS = {
  zh: {
    label: '中文',
    phrases: [
      '星光穿过城市，落在正在运行的核心里。',
      '把复杂的事情拆成一小步，再一小步。',
      '好的工具应该安静地待在旁边，需要时再出现。',
      '先确认事实，再表达观点，最后才给出判断。',
      '今天的比赛会在晚上八点开始，记得提前十分钟回来。',
      '深夜的城市像一块缓慢冷却的金属，而核心还亮着。',
    ],
  },
  en: {
    label: 'English',
    phrases: [
      'FLUX is a formless ambient intelligence that stays out of the way.',
      'A good interface disappears until the moment you need it.',
      'The core listens, bends, and grows sharp peaks with the audio spectrum.',
      'Memory is not a list of facts, it is a shape that keeps changing.',
      'Ship the smallest thing that can be felt, then let it grow.',
      'At night the city cools like metal, and the core is still awake.',
    ],
  },
  code: {
    label: '代码',
    phrases: [
      'const next = await engine.send(prompt);',
      'if (!response.ok) throw new Error("engine offline");',
      'memory.filter((item) => item.pinned).map((item) => item.text);',
      'for (let i = 0; i < frames.length; i += 1) draw(frames[i]);',
      'export function levelInfo(xp: number) { return Math.floor(Math.sqrt(xp / 100)) + 1; }',
      'await Promise.all([syncCalendar(), syncMatches(), syncTasks()]);',
    ],
  },
} as const;

type PhraseLang = keyof typeof PHRASE_SETS;

const DAILY_GAMES: ScoreGame[] = ['reaction', 'memory', 'typing', 'dodge'];

function relativeDate(at: number) {
  const date = new Date(at);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function challengeProgress(profile: PlayProfile, challenge: DailyChallenge) {
  const value = profile.daily.best[challenge.game] ?? 0;
  if (!value) return 0;
  return challenge.lower
    ? Math.min(1, challenge.target / value)
    : Math.min(1, value / challenge.target);
}

export function Arcade({ profile, challenge, onRecord, onScore }: Props) {
  const [game, setGame] = useState<Game>('menu');
  const challengeDone = profile.daily.challengeDone;
  const challengeValue = profile.daily.best[challenge.game] ?? 0;
  const progress = challengeProgress(profile, challenge);

  return (
    <div className="play-arcade">
      {game === 'menu' && (
        <>
          <header className="play-section-head">
            <div>
              <span>FLUX ARCADE / LOCAL TRAINING GROUND</span>
              <h1>玩一局，给核心一点温度。</h1>
              <p>四局本地小游戏，成绩写进你的 FLUX 档案与本机排行榜。</p>
            </div>
            <div className="play-arcade-stats">
              <span>GAMES <strong>{profile.stats.games}</strong></span>
              <span>REFLEX <strong>{profile.stats.bestReaction ? `${profile.stats.bestReaction}ms` : '—'}</strong></span>
              <span>TYPE <strong>{profile.stats.bestWpm ? `${profile.stats.bestWpm}wpm` : '—'}</strong></span>
              <span>ORBIT <strong>{profile.stats.bestDodge || '—'}</strong></span>
            </div>
          </header>

          <div className="play-game-grid">
            <button type="button" className="play-game-card is-reaction" onClick={() => setGame('reaction')}>
              <span className="play-game-mark"><Zap size={24} /></span>
              <em>01 / REFLEX</em>
              <h3>反应力</h3>
              <p>核心亮起时点击，五轮取平均。测的是手，也是注意力。</p>
              <span className="play-game-best">最佳 {profile.stats.bestReaction ? `${profile.stats.bestReaction}ms` : '—'}</span>
            </button>
            <button type="button" className="play-game-card is-memory" onClick={() => setGame('memory')}>
              <span className="play-game-mark"><Brain size={24} /></span>
              <em>02 / MEMORY</em>
              <h3>记忆序列</h3>
              <p>看核心依次亮起，按同样的顺序复现。每过一关，多一个音。</p>
              <span className="play-game-best">最高 {profile.stats.bestMemory || '—'} 阶</span>
            </button>
            <button type="button" className="play-game-card is-typing" onClick={() => setGame('typing')}>
              <span className="play-game-mark"><Keyboard size={24} /></span>
              <em>03 / TYPE</em>
              <h3>打字竞速</h3>
              <p>30 秒，中文 / 英文 / 代码三套词库。算 WPM 和准确率。</p>
              <span className="play-game-best">最佳 {profile.stats.bestWpm || '—'} WPM</span>
            </button>
            <button type="button" className="play-game-card is-dodge" onClick={() => setGame('dodge')}>
              <span className="play-game-mark"><Orbit size={24} /></span>
              <em>04 / ORBIT</em>
              <h3>轨道躲避</h3>
              <p>拖拽星核在碎片之间穿行。活得越久，分数越高。</p>
              <span className="play-game-best">最高 {profile.stats.bestDodge || '—'} 分</span>
            </button>
          </div>

          <div className="play-arcade-bottom">
            <section className={`play-daily ${challengeDone ? 'is-done' : ''}`}>
              <header>
                <div>
                  <span>DAILY CHALLENGE</span>
                  <h3>{challengeDone ? '今天的挑战已经完成' : challenge.title}</h3>
                </div>
                <em>+{challenge.xp} XP</em>
              </header>
              <p>{challenge.desc}</p>
              <div className="play-daily-progress">
                <i style={{ width: `${Math.max(progress, challengeDone ? 1 : 0) * 100}%` }} />
                <span>
                  今日最好 {challengeValue ? formatScore(challenge.game, challengeValue) : '—'} · 目标{' '}
                  {formatScore(challenge.game, challenge.target)}
                </span>
              </div>
              <div className="play-daily-foot">
                <span>
                  <Sparkles size={12} /> {challengeDone ? '奖励已入账' : '完成后自动领取，不需要手动点'}
                </span>
                <button type="button" onClick={() => setGame(challenge.game)}>
                  {challengeDone ? '再练一次' : '去挑战'} <ArrowRight size={12} />
                </button>
              </div>
            </section>

            <section className="play-board">
              <header>
                <div>
                  <span>LOCAL LEADERBOARD</span>
                  <h3>本机排行榜</h3>
                </div>
                <Trophy size={16} />
              </header>
              <div className="play-board-grid">
                {DAILY_GAMES.map((id) => {
                  const meta = SCORE_META[id];
                  const records = profile.records
                    .filter((item) => item.game === id)
                    .sort((a, b) => (meta.lower ? a.value - b.value : b.value - a.value))
                    .slice(0, 3);
                  return (
                    <div className="play-board-col" key={id}>
                      <div className="play-board-head">
                        <span>{meta.short}</span>
                        <em>{meta.label}</em>
                      </div>
                      {records.length === 0 ? (
                        <p className="play-board-empty">还没有成绩</p>
                      ) : (
                        <ol>
                          {records.map((record, index) => (
                            <li key={`${record.at}-${index}`}>
                              <i>{index + 1}</i>
                              <strong>{formatScore(id, record.value)}</strong>
                              <span>{relativeDate(record.at)}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <p className="play-arcade-note">
            <Timer size={13} /> 每局结束都会给 XP；每日挑战与徽章会自动结算。所有记录只保存在本机。
          </p>

          <section className="play-recent">
            <header>
              <span>RECENT RUNS</span>
              <em>{profile.records.length} 条本机记录</em>
            </header>
            {profile.records.length === 0 ? (
              <p className="play-muted">还没有训练记录。选一局开始，第一条成绩会出现在这里。</p>
            ) : (
              <div className="play-recent-list">
                {[...profile.records]
                  .sort((a, b) => b.at - a.at)
                  .slice(0, 6)
                  .map((record, index) => (
                    <div className="play-recent-item" key={`${record.at}-${index}`}>
                      <span>{SCORE_META[record.game].icon}</span>
                      <div>
                        <strong>{SCORE_META[record.game].label}</strong>
                        <small>{relativeDate(record.at)}</small>
                      </div>
                      <em>{formatScore(record.game, record.value)}</em>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </>
      )}
      {game !== 'menu' && (
        <button type="button" className="play-back" onClick={() => setGame('menu')}>
          <ArrowLeft size={14} /> 返回游戏厅
        </button>
      )}
      {game === 'reaction' && <ReactionGame profile={profile} onScore={onScore} onRecord={onRecord} />}
      {game === 'memory' && <MemoryGame profile={profile} onScore={onScore} onRecord={onRecord} />}
      {game === 'typing' && <TypingGame profile={profile} onScore={onScore} onRecord={onRecord} />}
      {game === 'dodge' && <DodgeGame profile={profile} onScore={onScore} onRecord={onRecord} />}
    </div>
  );
}

function ReactionGame({ profile, onScore }: GameProps) {
  const [phase, setPhase] = useState<'idle' | 'wait' | 'go' | 'done'>('idle');
  const [times, setTimes] = useState<number[]>([]);
  const [message, setMessage] = useState('点击开始，等核心亮起再点。');
  const timer = useRef(0);
  const litAt = useRef(0);
  const recorded = useRef(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = () => {
    setPhase('wait');
    setMessage('等待核心亮起…');
    recorded.current = false;
    const delay = 900 + Math.random() * 1600;
    timer.current = window.setTimeout(() => {
      litAt.current = performance.now();
      setPhase('go');
      setMessage('现在！');
      playSfx('signal-send');
    }, delay);
  };

  const hit = () => {
    if (phase === 'idle' || phase === 'done') {
      start();
      return;
    }
    if (phase === 'wait') {
      window.clearTimeout(timer.current);
      setPhase('done');
      setMessage('太早了，核心还没亮。');
      playSfx('error');
      return;
    }
    if (phase === 'go') {
      const ms = Math.max(1, Math.round(performance.now() - litAt.current));
      const next = [...times, ms];
      setTimes(next);
      if (next.length >= 5) {
        const avg = Math.round(next.reduce((sum, value) => sum + value, 0) / next.length);
        setPhase('done');
        setMessage(`平均 ${avg}ms`);
        if (!recorded.current) {
          recorded.current = true;
          onScore('reaction', avg, 25 + Math.max(0, 60 - Math.floor(avg / 8)));
        }
        playSfx('task-done');
      } else {
        start();
      }
    }
  };

  const avg = times.length
    ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length)
    : 0;
  const pb = profile.stats.bestReaction;

  return (
    <section className="play-game-stage">
      <header>
        <span>01 / REFLEX</span>
        <em>{times.length}/5</em>
      </header>
      <div
        className={`play-reaction-core is-${phase}`}
        onClick={hit}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') hit();
        }}
      >
        <div className="play-reaction-halo" />
        <strong>{phase === 'go' ? 'HIT' : phase === 'wait' ? 'WAIT' : phase === 'done' ? avg || '—' : 'READY'}</strong>
        <span>{phase === 'done' ? 'ms' : 'CORE'}</span>
      </div>
      <p className="play-game-message">{message}</p>
      <div className="play-game-actions">
        {phase === 'done' || phase === 'idle' ? (
          <button type="button" className="play-btn is-primary" onClick={() => { setTimes([]); start(); }}>
            <RotateCcw size={14} /> {times.length ? '再来一次' : '开始'}
          </button>
        ) : (
          <button type="button" className="play-btn" onClick={hit}>
            点击 / 空格
          </button>
        )}
      </div>
      <div className="play-run-line">
        {times.map((value, index) => (
          <span key={`${value}-${index}`}>{value}ms</span>
        ))}
        {times.length === 0 && <span className="play-muted">最佳 {pb ? `${pb}ms` : '—'}</span>}
        {phase === 'done' && avg > 0 && pb > 0 && (
          <span className={avg <= pb ? 'play-run-pb' : 'play-muted'}>
            {avg <= pb ? '新纪录' : `距最佳 ${avg - pb}ms`}
          </span>
        )}
      </div>
    </section>
  );
}

const PAD_FREQ = [392, 440, 494, 523.25, 587.33, 659.25, 698.46, 783.99, 880];

function MemoryGame({ profile, onScore }: GameProps) {
  const [sequence, setSequence] = useState<number[]>([]);
  const [input, setInput] = useState<number[]>([]);
  const [level, setLevel] = useState(0);
  const [showing, setShowing] = useState(false);
  const [activePad, setActivePad] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'showing' | 'input' | 'done'>('idle');
  const [message, setMessage] = useState('记住核心亮起的顺序。');
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  const playSequence = (next: number[]) => {
    clearTimers();
    setShowing(true);
    setPhase('showing');
    setMessage('看好了…');
    next.forEach((pad, index) => {
      timers.current.push(
        window.setTimeout(() => {
          setActivePad(pad);
          beep(PAD_FREQ[pad], 0.16, 0.06, 'sine');
          timers.current.push(window.setTimeout(() => setActivePad(null), 260));
        }, index * 520),
      );
    });
    timers.current.push(
      window.setTimeout(() => {
        setShowing(false);
        setPhase('input');
        setMessage('轮到你了。');
      }, next.length * 520 + 120),
    );
  };

  const start = () => {
    clearTimers();
    const next = Array.from({ length: 3 }, () => Math.floor(Math.random() * 9));
    setSequence(next);
    setInput([]);
    setLevel(next.length);
    setPhase('showing');
    setMessage('看好了…');
    timers.current.push(window.setTimeout(() => playSequence(next), 250));
  };

  const finish = (reached: number) => {
    setPhase('done');
    setMessage(`记错了。你走到了第 ${reached} 阶。`);
    playSfx('error');
    onScore('memory', Math.max(0, reached - 1), 15 + reached * 2);
  };

  const tap = (pad: number) => {
    if (showing || phase !== 'input') return;
    beep(PAD_FREQ[pad], 0.1, 0.05, 'triangle');
    const nextInput = [...input, pad];
    setInput(nextInput);
    const expected = sequence[nextInput.length - 1];
    if (expected !== pad) {
      finish(level);
      return;
    }
    if (nextInput.length === sequence.length) {
      const next = [...sequence, Math.floor(Math.random() * 9)];
      setSequence(next);
      setInput([]);
      setLevel(next.length);
      setMessage('答对了，下一阶。');
      playSfx('signal-info');
      timers.current.push(window.setTimeout(() => playSequence(next), 620));
    }
  };

  return (
    <section className="play-game-stage">
      <header>
        <span>02 / MEMORY</span>
        <em>{level ? `${level} 阶` : '未开始'}</em>
      </header>
      <div className="play-memory-grid">
        {Array.from({ length: 9 }).map((_, index) => (
          <button
            type="button"
            key={index}
            className={`play-pad ${activePad === index ? 'is-lit' : ''} ${
              input.includes(index) ? 'is-pressed' : ''
            }`}
            onClick={() => tap(index)}
            aria-label={`音格 ${index + 1}`}
          />
        ))}
      </div>
      <p className="play-game-message">{message}</p>
      <div className="play-game-actions">
        <button type="button" className="play-btn is-primary" onClick={start}>
          <RotateCcw size={14} /> {phase === 'idle' ? '开始' : '重新开始'}
        </button>
        <span className="play-muted">最高 {profile.stats.bestMemory || '—'} 阶</span>
      </div>
    </section>
  );
}

function TypingGame({ profile, onScore, onRecord }: GameProps) {
  const [lang, setLang] = useState<PhraseLang>('zh');
  const [target, setTarget] = useState<string>(PHRASE_SETS.zh.phrases[0]);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(30);
  const [result, setResult] = useState<{ wpm: number; accuracy: number; chars: number } | null>(null);
  const typedRef = useRef('');
  const targetRef = useRef(target);
  const finished = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    typedRef.current = typed;
  }, [typed]);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    const text = typedRef.current;
    const goal = targetRef.current;
    const chars = text.length;
    const correct = [...text].filter((char, index) => char === goal[index]).length;
    const accuracy = chars ? Math.round((correct / chars) * 100) : 0;
    const wpm = Math.round((chars / 5) * 2);
    setResult({ wpm, accuracy, chars });
    setRunning(false);
    playSfx('task-done');
    if (accuracy >= 80 && chars > 0) {
      onScore('typing', wpm, 20 + Math.round(wpm / 2));
    } else if (chars > 0) {
      onRecord('games', 1, 8);
    }
  };

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          finish();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const start = () => {
    const set = PHRASE_SETS[lang];
    const phrase = set.phrases[Math.floor(Math.random() * set.phrases.length)];
    setTarget(phrase);
    targetRef.current = phrase;
    setTyped('');
    typedRef.current = '';
    setResult(null);
    setRemaining(30);
    setRunning(true);
    finished.current = false;
    playSfx('signal-info');
    window.setTimeout(() => inputRef.current?.focus(), 30);
  };

  const chooseLang = (next: PhraseLang) => {
    if (running) return;
    setLang(next);
    const phrase = PHRASE_SETS[next].phrases[0];
    setTarget(phrase);
    targetRef.current = phrase;
    setTyped('');
    setResult(null);
  };

  return (
    <section className="play-game-stage play-type-stage">
      <header>
        <span>03 / TYPE</span>
        <em>{running ? `${remaining}s` : result ? '完成' : '30 秒'}</em>
      </header>
      <div className="play-type-langs" role="tablist" aria-label="词库">
        {(Object.keys(PHRASE_SETS) as PhraseLang[]).map((key) => (
          <button
            type="button"
            key={key}
            role="tab"
            aria-selected={lang === key}
            className={lang === key ? 'is-active' : ''}
            onClick={() => chooseLang(key)}
            disabled={running}
          >
            {PHRASE_SETS[key].label}
          </button>
        ))}
      </div>
      <div className={`play-type-target ${running ? 'is-running' : ''}`}>
        {[...target].map((char, index) => {
          const state = index < typed.length ? (typed[index] === char ? 'is-ok' : 'is-bad') : '';
          return (
            <span key={`${char}-${index}`} className={state}>
              {char}
            </span>
          );
        })}
      </div>
      <textarea
        ref={inputRef}
        className="play-type-input"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        disabled={!running}
        placeholder={running ? '开始输入…' : '点击开始，30 秒计时'}
        spellCheck={false}
      />
      {result && (
        <div className="play-type-result">
          <span><strong>{result.wpm}</strong> WPM</span>
          <span><strong>{result.accuracy}%</strong> 准确率</span>
          <span><strong>{result.chars}</strong> 字符</span>
        </div>
      )}
      <div className="play-game-actions">
        <button type="button" className="play-btn is-primary" onClick={start}>
          {result ? <RotateCcw size={14} /> : null} {result ? '再来一次' : '开始'}
        </button>
        <span className="play-muted">最佳 {profile.stats.bestWpm || '—'} WPM</span>
      </div>
    </section>
  );
}

type DodgeState = {
  running: boolean;
  over: boolean;
  lives: number;
  score: number;
  elapsed: number;
  spawn: number;
  passed: number;
  shake: number;
  player: { x: number; y: number; tx: number; ty: number };
  trail: Array<{ x: number; y: number }>;
  obstacles: Array<{ x: number; y: number; vx: number; vy: number; r: number; spin: number }>;
  particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; hue: number }>;
  stars: Array<{ x: number; y: number; z: number }>;
  lastHud: number;
};

const emptyDodge = (w: number, h: number): DodgeState => ({
  running: false,
  over: false,
  lives: 3,
  score: 0,
  elapsed: 0,
  spawn: 0.5,
  passed: 0,
  shake: 0,
  player: { x: w / 2, y: h * 0.68, tx: w / 2, ty: h * 0.68 },
  trail: [],
  obstacles: [],
  particles: [],
  stars: Array.from({ length: 48 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    z: 0.3 + Math.random() * 0.7,
  })),
  lastHud: 0,
});

function DodgeGame({ profile, onScore }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 900, h: 430 });
  const stateRef = useRef<DodgeState>(emptyDodge(900, 430));
  const bestRef = useRef(profile.stats.bestDodge);
  const scoreRef = useRef(onScore);
  const [phase, setPhase] = useState<'idle' | 'playing' | 'over'>('idle');
  const [hud, setHud] = useState({ score: 0, lives: 3, time: 0 });
  const [result, setResult] = useState<{ score: number; time: number; best: boolean } | null>(null);
  const [dragHint, setDragHint] = useState(true);

  useEffect(() => {
    bestRef.current = profile.stats.bestDodge;
  }, [profile.stats.bestDodge]);
  useEffect(() => {
    scoreRef.current = onScore;
  }, [onScore]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const apply = () => {
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(320, rect.width);
      const h = Math.max(260, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const prev = sizeRef.current;
      sizeRef.current = { w, h };
      const s = stateRef.current;
      if (!s.running) {
        s.player = { x: w / 2, y: h * 0.68, tx: w / 2, ty: h * 0.68 };
        s.stars = Array.from({ length: 48 }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          z: 0.3 + Math.random() * 0.7,
        }));
      } else if (prev.w !== w || prev.h !== h) {
        s.player.x = Math.min(s.player.x, w - 14);
        s.player.y = Math.min(s.player.y, h - 14);
        s.player.tx = Math.min(s.player.tx, w - 14);
        s.player.ty = Math.min(s.player.ty, h - 14);
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let last = performance.now();
    const ctx = canvas.getContext('2d');

    const end = () => {
      const s = stateRef.current;
      if (!s.running) return;
      s.running = false;
      s.over = true;
      const score = Math.round(s.score);
      const best = score > bestRef.current;
      setPhase('over');
      setResult({ score, time: s.elapsed, best });
      setHud({ score, lives: s.lives, time: s.elapsed });
      scoreRef.current('dodge', score, 25 + Math.min(80, Math.round(score / 30)));
      playSfx('task-done');
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      const s = stateRef.current;
      const { w, h } = sizeRef.current;

      if (s.running) {
        s.elapsed += dt;
        s.spawn -= dt;
        if (s.spawn <= 0) {
          const r = 7 + Math.random() * 9;
          s.obstacles.push({
            x: 24 + Math.random() * Math.max(1, w - 48),
            y: -r - 4,
            vx: (Math.random() - 0.5) * 42,
            vy: 118 + Math.random() * 90 + Math.min(160, s.elapsed * 5),
            r,
            spin: Math.random() * Math.PI * 2,
          });
          s.spawn = Math.max(0.22, 0.62 - s.elapsed * 0.006);
        }

        // 指针目标 + 键盘：两者都能移动星核，优先跟随指针。
        const dx = s.player.tx - s.player.x;
        const dy = s.player.ty - s.player.y;
        s.player.x += dx * Math.min(1, dt * 14);
        s.player.y += dy * Math.min(1, dt * 14);
        s.player.x = Math.max(14, Math.min(w - 14, s.player.x));
        s.player.y = Math.max(14, Math.min(h - 14, s.player.y));
        s.trail.push({ x: s.player.x, y: s.player.y });
        if (s.trail.length > 12) s.trail.shift();

        s.obstacles.forEach((ob) => {
          ob.x += ob.vx * dt;
          ob.y += ob.vy * dt;
          ob.spin += dt * 2.2;
          const distance = Math.hypot(ob.x - s.player.x, ob.y - s.player.y);
          if (distance < ob.r + 11) {
            ob.y = h + 200;
            s.lives -= 1;
            s.shake = 9;
            s.score = Math.max(0, s.score - 20);
            for (let i = 0; i < 14; i += 1) {
              const angle = Math.random() * Math.PI * 2;
              const speed = 40 + Math.random() * 140;
              s.particles.push({
                x: s.player.x,
                y: s.player.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.6 + Math.random() * 0.5,
                hue: 8 + Math.random() * 22,
              });
            }
            beep(96, 0.22, 0.09, 'sawtooth');
            if (s.lives <= 0) end();
          }
        });
        s.obstacles = s.obstacles.filter((ob) => {
          if (ob.y > h + 40) {
            s.passed += 1;
            s.score += 5;
            return false;
          }
          return true;
        });
        s.score += dt * 12;
        s.particles.forEach((p) => {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.98;
          p.vy *= 0.98;
          p.life -= dt;
        });
        s.particles = s.particles.filter((p) => p.life > 0);
        s.shake *= 0.9;

        if (now - s.lastHud > 90) {
          s.lastHud = now;
          setHud({ score: Math.round(s.score), lives: s.lives, time: s.elapsed });
        }
      }

      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.45, w * 0.75);
      bg.addColorStop(0, 'rgba(32, 54, 55, 0.32)');
      bg.addColorStop(0.55, 'rgba(9, 14, 16, 0.22)');
      bg.addColorStop(1, 'rgba(3, 5, 6, 0.7)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      s.stars.forEach((star) => {
        const pulse = 0.35 + 0.65 * Math.abs(Math.sin(now * 0.0007 + star.z * 9));
        ctx.fillStyle = `rgba(190, 220, 214, ${0.06 + star.z * 0.14 * pulse})`;
        ctx.fillRect(star.x, star.y, 1.2 * star.z, 1.2 * star.z);
      });

      const cx = w / 2;
      const cy = h / 2;
      [0.24, 0.4, 0.56].forEach((ratio, index) => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(184, 213, 208, ${0.05 + index * 0.02})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 9]);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(w, h) * ratio, now * 0.00004 * (index + 1), Math.PI * 1.4 + now * 0.00004);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      ctx.save();
      if (s.shake > 0.2) {
        ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
      }

      s.particles.forEach((p) => {
        ctx.fillStyle = `hsla(${p.hue}, 46%, 62%, ${Math.max(0, p.life) * 0.5})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6 + p.life * 2.4, 0, Math.PI * 2);
        ctx.fill();
      });

      s.obstacles.forEach((ob) => {
        ctx.save();
        ctx.translate(ob.x, ob.y);
        ctx.rotate(ob.spin);
        ctx.beginPath();
        for (let i = 0; i < 3; i += 1) {
          const angle = (Math.PI * 2 * i) / 3 - Math.PI / 2;
          const px = Math.cos(angle) * ob.r;
          const py = Math.sin(angle) * ob.r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(196, 116, 104, 0.2)';
        ctx.strokeStyle = 'rgba(212, 143, 124, 0.82)';
        ctx.lineWidth = 1.2;
        ctx.shadowColor = 'rgba(212, 127, 114, 0.65)';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });

      // 星核：拖尾 + 光晕 + 内核。待机时只留下深色轨道，避免和开场文案抢焦点。
      if (s.running || s.over) {
        s.trail.forEach((point, index) => {
          const alpha = (index / s.trail.length) * 0.28;
          ctx.fillStyle = `rgba(184, 213, 208, ${alpha})`;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3 + index * 0.55, 0, Math.PI * 2);
          ctx.fill();
        });
        const px = s.player.x;
        const py = s.player.y;
        const halo = ctx.createRadialGradient(px, py, 2, px, py, 30);
        halo.addColorStop(0, 'rgba(231, 240, 232, 0.95)');
        halo.addColorStop(0.28, 'rgba(184, 213, 208, 0.5)');
        halo.addColorStop(1, 'rgba(184, 213, 208, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(px, py, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = '#eff4ee';
        ctx.shadowColor = 'rgba(220, 240, 234, 0.8)';
        ctx.shadowBlur = 18;
        ctx.arc(px, py, 8.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(184, 213, 208, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 15 + Math.sin(now * 0.004) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      if (!s.running && s.over) {
        ctx.fillStyle = 'rgba(3, 5, 6, 0.35)';
        ctx.fillRect(0, 0, w, h);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = () => {
    const { w, h } = sizeRef.current;
    stateRef.current = {
      ...emptyDodge(w, h),
      running: true,
    };
    stateRef.current.stars = Array.from({ length: 48 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: 0.3 + Math.random() * 0.7,
    }));
    setHud({ score: 0, lives: 3, time: 0 });
    setResult(null);
    setPhase('playing');
    setDragHint(true);
    playSfx('signal-info');
  };

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const s = stateRef.current;
    s.player.tx = ((event.clientX - rect.left) / rect.width) * sizeRef.current.w;
    s.player.ty = ((event.clientY - rect.top) / rect.height) * sizeRef.current.h;
    setDragHint(false);
  };

  const keyboard = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = 26;
    const s = stateRef.current;
    let moved = false;
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      s.player.tx -= step;
      moved = true;
    } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      s.player.tx += step;
      moved = true;
    } else if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
      s.player.ty -= step;
      moved = true;
    } else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
      s.player.ty += step;
      moved = true;
    }
    if (moved) {
      event.preventDefault();
      setDragHint(false);
      const { w, h } = sizeRef.current;
      s.player.tx = Math.max(14, Math.min(w - 14, s.player.tx));
      s.player.ty = Math.max(14, Math.min(h - 14, s.player.ty));
    }
  };

  return (
    <section className="play-game-stage play-dodge-stage">
      <header>
        <span>04 / ORBIT</span>
        <em>{phase === 'playing' ? `${hud.time.toFixed(1)}s` : phase === 'over' ? '结束' : '拖拽星核'}</em>
      </header>
      <div className="play-dodge-hud">
        <span>SCORE <strong>{hud.score}</strong></span>
        <span>LIVES <strong>{'●'.repeat(Math.max(0, hud.lives))}{'○'.repeat(Math.max(0, 3 - hud.lives))}</strong></span>
        <span>BEST <strong>{profile.stats.bestDodge || '—'}</strong></span>
      </div>
      <div className="play-dodge-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="play-dodge-canvas"
          tabIndex={0}
          onPointerDown={(event) => {
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* synthetic pointer events have no capture target */
            }
            event.currentTarget.focus();
            point(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons || event.pointerType === 'touch') point(event);
          }}
          onKeyDown={keyboard}
          aria-label="轨道躲避游戏区域"
        />
        {phase === 'idle' && (
          <div className="play-dodge-overlay">
            <Orbit size={30} />
            <strong>拖拽星核，避开碎片。</strong>
            <p>按住鼠标或手指拖动；也可以使用 WASD / 方向键。撞到三次结束。</p>
            <button type="button" className="play-btn is-primary" onClick={start}>
              <Crosshair size={14} /> 进入轨道
            </button>
          </div>
        )}
        {phase === 'playing' && dragHint && (
          <div className="play-dodge-tip">按住并拖动星核</div>
        )}
        {phase === 'over' && result && (
          <div className="play-dodge-overlay is-over">
            <span className="play-dodge-kicker">{result.best ? 'NEW RECORD' : 'RUN COMPLETE'}</span>
            <strong>{result.score} 分</strong>
            <p>
              存活 {result.time.toFixed(1)} 秒
              {result.best ? ' · 刷新了本机纪录' : ` · 最佳 ${profile.stats.bestDodge || '—'}`}
            </p>
            <button type="button" className="play-btn is-primary" onClick={start}>
              <RotateCcw size={14} /> 再来一局
            </button>
          </div>
        )}
      </div>
      <div className="play-game-actions">
        <span className="play-muted">每躲过一个碎片 +5 分，每秒 +12 分。</span>
        <span className="play-muted">最高 {profile.stats.bestDodge || '—'} 分</span>
      </div>
    </section>
  );
}
