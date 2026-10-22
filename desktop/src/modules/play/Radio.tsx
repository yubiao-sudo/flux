import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Loader2,
  Mic2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import type { LolEvent, LolOverview } from '../../engine/types';
import { createStreamingSpeech } from '../../engine/streamingSpeech';
import { generateRadioScript } from '../../engine/api';
import type { PlayProfile, PlayTask } from './playStore';

type Props = {
  profile: PlayProfile;
  overview: LolOverview | null;
  weather: { temp: number; code: number } | null;
  tasks: PlayTask[];
  onRecord: (
    kind: 'games' | 'focusMinutes' | 'radio' | 'predictions',
    amount: number,
    xp: number,
  ) => void;
};

type Channel = 'auto' | 'morning' | 'matchday' | 'night';
type Slot = Exclude<Channel, 'auto'>;
type Segment = { id: string; label: string; text: string; seconds: number };

const CHANNELS: Array<{ id: Channel; label: string; sub: string }> = [
  { id: 'auto', label: '自动', sub: 'AUTO' },
  { id: 'morning', label: '早间', sub: '06—12' },
  { id: 'matchday', label: '赛事', sub: '12—18' },
  { id: 'night', label: '深夜', sub: '18—06' },
];

const WEATHER_TEXT: Record<number, string> = {
  0: '晴',
  1: '大致晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '密毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  95: '雷暴',
};

function autoSlot(date = new Date()): Slot {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'matchday';
  return 'night';
}

function nextMatch(overview: LolOverview | null) {
  if (!overview) return null;
  return (
    overview.events
      .filter(
        (event) =>
          event.state === 'unstarted' &&
          event.teams.length >= 2 &&
          event.teams.every((team) => team.name && team.name !== 'TBD'),
      )
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0] ||
    null
  );
}

function recentMatch(overview: LolOverview | null) {
  if (!overview) return null;
  return (
    overview.events
      .filter((event) => event.state === 'completed')
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0] ||
    null
  );
}

function scoreLine(event: LolEvent | null) {
  if (!event) return '';
  const [a, b] = event.teams;
  return `${a?.name || '待定'} ${a?.score ?? 0} 比 ${b?.score ?? 0} ${b?.name || '待定'}`;
}

function timeLine(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间待定';
  return date.toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 模型返回的稿子可能带代码块或解释，只取最外层的 JSON 数组。 */
function parseScript(raw: string): Segment[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const items = JSON.parse(raw.slice(start, end + 1)) as Array<Record<string, unknown>>;
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => item && typeof item.text === 'string' && String(item.text).trim().length >= 8)
      .map((item, index) => ({
        id: String(item.id || `ai-${index}`).slice(0, 24),
        label: String(item.label || `SEGMENT ${index + 1}`).toUpperCase().slice(0, 18),
        text: String(item.text).trim().slice(0, 240),
        seconds: Math.min(30, Math.max(5, Number(item.seconds) || 9)),
      }))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function buildProgram(
  profile: PlayProfile,
  overview: LolOverview | null,
  weather: { temp: number; code: number } | null,
  tasks: PlayTask[],
  slot: Slot,
): { title: string; subtitle: string; segments: Segment[]; slot: Slot } {
  const upcoming = nextMatch(overview);
  const recent = recentMatch(overview);
  const openTasks = tasks.filter((task) => !task.done);
  const topRanks = (overview?.worldRank || []).slice(0, 3);
  const weatherLine = weather
    ? `杭州现在 ${Math.round(weather.temp)} 摄氏度，${WEATHER_TEXT[weather.code] || '天气在变化'}。`
    : '暂时没有拿到天气数据，不过窗外的光，应该比屏幕更真实。';
  const matchLine = upcoming
    ? `下一场是 ${upcoming.league.name} 的 ${upcoming.tournament.name}，${upcoming.teams[0]?.name} 对阵 ${upcoming.teams[1]?.name}，BO${upcoming.bestOf}，${timeLine(upcoming.startTime)}。`
    : recent
      ? `最近一场已经结束，${recent.league.name}，${scoreLine(recent)}。`
      : '赛事数据暂时没有更新，等下一轮赛程出来，我再告诉你。';

  const shared = {
    weather: { id: 'weather', label: 'ATMOSPHERE', text: weatherLine, seconds: 9 },
    tasks: {
      id: 'tasks',
      label: 'TODAY',
      text: openTasks.length
        ? `今天还有 ${openTasks.length} 件事：${openTasks.slice(0, 3).map((task) => task.text).join('；')}。不用一次做完，先挑一件。`
        : '今天的事情都处理完了。剩下的时间，可以留给一件没有用、但让你开心的事。',
      seconds: 10,
    },
    focus: {
      id: 'focus',
      label: 'FOCUS',
      text:
        profile.daily.focusMinutes > 0
          ? `今天你已经专注了 ${profile.daily.focusMinutes} 分钟。如果还想再来一段，去专注舱，选一个声景，二十五分钟就够。`
          : '如果今天还没有一段完整的专注，去专注舱坐二十五分钟。世界不会因此停转，但你会。',
      seconds: 9,
    },
  } as const;

  if (slot === 'morning') {
    return {
      slot,
      title: 'MORNING SIGNAL',
      subtitle: '把今天需要知道的事情，慢慢说给你听。',
      segments: [
        {
          id: 'open',
          label: 'OPENING',
          text: '早上好。这里是 FLUX 早间信号。先别急着看消息，让今天的事情按顺序进来。',
          seconds: 8,
        },
        shared.weather,
        shared.tasks,
        { id: 'esports', label: 'ESPORTS', text: matchLine, seconds: 12 },
        shared.focus,
        {
          id: 'close',
          label: 'SIGN OFF',
          text: '早间信号到这里。带上你需要的那一件，剩下的交给白天。',
          seconds: 6,
        },
      ],
    };
  }

  if (slot === 'matchday') {
    const rankLine = topRanks.length
      ? `目前世界排名前三：${topRanks
          .map((item) => `${item.rank} 名 ${item.team.name}`)
          .join('，')}。`
      : '';
    return {
      slot,
      title: 'MATCHDAY RADIO',
      subtitle: '赛程、比分和一点赛前情绪。',
      segments: [
        {
          id: 'open',
          label: 'OPENING',
          text: '这里是 FLUX 赛事电台。今天的赛程、最近的结果，和几支值得留意的队伍，已经整理好了。',
          seconds: 9,
        },
        { id: 'next', label: 'NEXT MATCH', text: matchLine, seconds: 13 },
        {
          id: 'recent',
          label: 'LAST RESULT',
          text: recent
            ? `最近一场已经结束：${recent.league.name}，${scoreLine(recent)}。`
            : '最近还没有可以复盘的比赛。等第一场结束，我把比分带回来。',
          seconds: 9,
        },
        {
          id: 'rank',
          label: 'WORLD RANK',
          text: rankLine || '世界排名暂时没有更新，等官方榜单刷新后我再读给你。',
          seconds: 9,
        },
        shared.tasks,
        {
          id: 'close',
          label: 'SIGN OFF',
          text: `今天你已经完成 ${profile.stats.predictions} 次预测，猜中 ${profile.stats.correct} 场。比赛开始前，记得回来。`,
          seconds: 8,
        },
      ],
    };
  }

  return {
    slot: 'night',
    title: 'NIGHT DRIVE',
    subtitle: '深夜频道，给还没睡的人。',
    segments: [
      {
        id: 'open',
        label: 'OPENING',
        text: '这里是 FLUX 深夜电台。城市安静下来了，核心还亮着。把声音调低，我们慢慢过一遍今天。',
        seconds: 10,
      },
      {
        id: 'rewind',
        label: 'REWIND',
        text: `今天你玩了 ${profile.daily.games} 局游戏，专注了 ${profile.daily.focusMinutes} 分钟，听了 ${profile.daily.radio} 段电台。${
          profile.stats.bestReaction
            ? `最快的一次反应是 ${profile.stats.bestReaction} 毫秒。`
            : ''
        }`,
        seconds: 11,
      },
      shared.tasks,
      {
        id: 'tomorrow',
        label: 'TOMORROW',
        text: upcoming
          ? `明天有一场比赛值得留意：${upcoming.teams[0]?.name} 对阵 ${upcoming.teams[1]?.name}，${timeLine(upcoming.startTime)}。`
          : '明天暂时没有排进赛程的比赛。可以把时间留给一件一直想做的事。',
        seconds: 9,
      },
      shared.focus,
      {
        id: 'close',
        label: 'SIGN OFF',
        text: '这里是 FLUX。声音先到这里，剩下的交给你。晚安。',
        seconds: 6,
      },
    ],
  };
}

/**
 * 电台的底噪床：全部用 WebAudio 现场合成，不加载音频文件。
 * 三个频道各有自己的音高、滤波和呼吸速度。
 */
class RadioBed {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private slot: Slot | null = null;

  private ensure() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  start(slot: Slot) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.stop();
    this.slot = slot;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(slot === 'night' ? 0.045 : 0.032, ctx.currentTime + 1.4);
    master.connect(ctx.destination);
    this.master = master;
    this.nodes.push(master);

    // 一段粉噪，给所有频道一点空气感。
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < noise.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.018 * white) / 1.018;
      noise[i] = last * 3.4;
    }
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = slot === 'morning' ? 'bandpass' : 'lowpass';
    airFilter.frequency.value = slot === 'morning' ? 1500 : slot === 'matchday' ? 720 : 460;
    airFilter.Q.value = 0.6;
    const airGain = ctx.createGain();
    airGain.gain.value = slot === 'night' ? 0.22 : 0.12;
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(master);
    air.start();
    this.sources.push(air);
    this.nodes.push(airFilter, airGain);

    const tones =
      slot === 'night'
        ? [55, 82.5, 110]
        : slot === 'matchday'
          ? [98, 146.83, 196]
          : [196, 293.66, 392];

    tones.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      osc.type = slot === 'matchday' && index === 0 ? 'triangle' : 'sine';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = (slot === 'matchday' ? 0.2 : 0.26) / (index + 1);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.045 + index * 0.021;
      const depth = ctx.createGain();
      depth.gain.value = 1.4 + index * 0.7;
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

  stop() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const master = this.master;
    const sources = this.sources;
    const nodes = this.nodes;
    this.master = null;
    this.sources = [];
    this.nodes = [];
    this.slot = null;
    try {
      if (master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      }
      const at = ctx.currentTime + 0.34;
      sources.forEach((source) => {
        try {
          source.stop(at);
        } catch {
          /* already stopped */
        }
      });
      window.setTimeout(() => {
        nodes.forEach((node) => {
          try {
            node.disconnect();
          } catch {
            /* noop */
          }
        });
      }, 420);
    } catch {
      /* audio unavailable */
    }
  }

  dispose() {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

export function RadioMode({ profile, overview, weather, tasks, onRecord }: Props) {
  const [channel, setChannel] = useState<Channel>('auto');
  const slot: Slot = channel === 'auto' ? autoSlot() : channel;
  const baseProgram = useMemo(
    () => buildProgram(profile, overview, weather, tasks, slot),
    [profile, overview, weather, tasks, slot],
  );
  const [generated, setGenerated] = useState<Segment[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const program = useMemo(
    () => (generated && generated.length ? { ...baseProgram, segments: generated } : baseProgram),
    [baseProgram, generated],
  );
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [muted, setMuted] = useState(false);
  const [bedOn, setBedOn] = useState(true);
  const [progress, setProgress] = useState(0);
  const indexRef = useRef(0);
  const statusRef = useRef<'idle' | 'playing' | 'paused'>('idle');
  const mutedRef = useRef(false);
  const bedOnRef = useRef(true);
  const slotRef = useRef<Slot>(slot);
  const programRef = useRef(program);
  const timerRef = useRef(0);
  const startedRef = useRef(false);
  const bedRef = useRef<RadioBed | null>(null);
  const playRef = useRef<(nextIndex: number) => void>(() => undefined);
  const advanceRef = useRef<() => void>(() => undefined);

  const speechRef = useRef<ReturnType<typeof createStreamingSpeech> | null>(null);
  if (!speechRef.current) {
    speechRef.current = createStreamingSpeech({
      onStart: () => {
        if (statusRef.current === 'playing') return;
        statusRef.current = 'playing';
        setStatus('playing');
      },
      onProgress: (chars) => setProgress(chars),
      onEnd: () => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          if (statusRef.current === 'playing') advanceRef.current();
        }, 420);
      },
    });
  }

  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    bedOnRef.current = bedOn;
  }, [bedOn]);
  useEffect(() => {
    slotRef.current = slot;
  }, [slot]);
  useEffect(() => {
    programRef.current = program;
  }, [program]);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
      try {
        speechRef.current?.reset();
      } catch {
        /* noop */
      }
      bedRef.current?.dispose();
      bedRef.current = null;
    },
    [],
  );

  const getBed = useCallback(() => {
    if (!bedRef.current) bedRef.current = new RadioBed();
    return bedRef.current;
  }, []);

  const stopAll = useCallback(() => {
    window.clearTimeout(timerRef.current);
    try {
      speechRef.current?.reset();
    } catch {
      /* noop */
    }
    bedRef.current?.stop();
    statusRef.current = 'idle';
    setStatus('idle');
    setProgress(0);
  }, []);

  const playSegment = (nextIndex: number) => {
    const next = programRef.current.segments[nextIndex];
    if (!next) return;
    window.clearTimeout(timerRef.current);
    speechRef.current?.reset();
    setIndex(nextIndex);
    indexRef.current = nextIndex;
    setProgress(0);
    statusRef.current = 'playing';
    setStatus('playing');
    if (!startedRef.current) {
      startedRef.current = true;
      onRecord('radio', 1, 20);
    }
    if (mutedRef.current) {
      bedRef.current?.stop();
      timerRef.current = window.setTimeout(() => {
        if (statusRef.current === 'playing') advanceRef.current();
      }, next.seconds * 1000);
      return;
    }
    if (bedOnRef.current) getBed().start(slotRef.current);
    speechRef.current?.begin();
    speechRef.current?.push(next.text);
    speechRef.current?.finish();
  };
  playRef.current = playSegment;

  advanceRef.current = () => {
    const segments = programRef.current.segments;
    const current = indexRef.current;
    if (current + 1 >= segments.length) {
      statusRef.current = 'idle';
      setStatus('idle');
      setProgress(0);
      setIndex(0);
      indexRef.current = 0;
      bedRef.current?.stop();
      return;
    }
    playRef.current(current + 1);
  };

  const toggle = () => {
    if (status === 'playing') {
      speechRef.current?.pause();
      bedRef.current?.stop();
      statusRef.current = 'paused';
      setStatus('paused');
      return;
    }
    if (status === 'paused') {
      statusRef.current = 'playing';
      setStatus('playing');
      if (muted) {
        timerRef.current = window.setTimeout(() => {
          if (statusRef.current === 'playing') advanceRef.current();
        }, 2500);
        return;
      }
      if (bedOn) getBed().start(slotRef.current);
      if (!speechRef.current?.isActive()) {
        advanceRef.current();
      } else {
        speechRef.current?.resume();
      }
      return;
    }
    playRef.current(index);
  };

  const nextSegment = () => {
    const next = Math.min(program.segments.length - 1, index + 1);
    playRef.current(next);
  };

  const restart = () => {
    stopAll();
    setIndex(0);
    indexRef.current = 0;
    startedRef.current = false;
  };

  const chooseChannel = (next: Channel) => {
    if (next === channel) return;
    stopAll();
    setGenerated(null);
    setChannel(next);
    setIndex(0);
    indexRef.current = 0;
    startedRef.current = false;
    setNotice('');
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setNotice('');
    stopAll();
    startedRef.current = false;
    try {
      const context = JSON.stringify({
        channel: slot,
        weather: weather ? `${Math.round(weather.temp)}°C / code ${weather.code}` : null,
        tasks: tasks.filter((task) => !task.done).slice(0, 5).map((task) => task.text),
        nextMatch: nextMatch(overview)
          ? {
              league: nextMatch(overview)?.league.name,
              tournament: nextMatch(overview)?.tournament.name,
              teams: nextMatch(overview)?.teams.map((team) => team.name),
              start: nextMatch(overview)?.startTime,
            }
          : null,
        recentMatch: recentMatch(overview) ? scoreLine(recentMatch(overview)) : null,
        today: {
          games: profile.daily.games,
          focusMinutes: profile.daily.focusMinutes,
          radio: profile.daily.radio,
          predictions: profile.stats.predictions,
          correct: profile.stats.correct,
          bestReaction: profile.stats.bestReaction,
          bestDodge: profile.stats.bestDodge,
        },
        player: { level: profile.level, streak: profile.streak, xp: profile.xp },
      });
      const raw = await generateRadioScript(slot, context);
      const segments = parseScript(raw);
      if (segments.length < 3) throw new Error('script unavailable');
      setGenerated(segments);
      setIndex(0);
      indexRef.current = 0;
      setProgress(0);
      setNotice('新的节目稿已经写好，点播放开始。');
    } catch {
      setNotice('模型暂时没有回应，继续使用本地编辑的节目单。');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    if (statusRef.current === 'playing') {
      playRef.current(indexRef.current);
    }
  };

  const toggleBed = () => {
    const next = !bedOn;
    setBedOn(next);
    bedOnRef.current = next;
    if (statusRef.current !== 'playing') {
      if (!next) bedRef.current?.stop();
      return;
    }
    if (next) getBed().start(slotRef.current);
    else bedRef.current?.stop();
  };

  const segment = program.segments[Math.min(index, program.segments.length - 1)];
  const visible = Math.max(0, Math.min(segment.text.length, progress));
  const pct = Math.min(1, visible / Math.max(1, segment.text.length));

  return (
    <div className="play-radio">
      <header className="play-section-head">
        <div>
          <span>FLUX RADIO / ON AIR</span>
          <h1>{program.title}</h1>
          <p>{program.subtitle}</p>
        </div>
        <div className="play-radio-signal">
          <span className={`play-onair ${status === 'playing' ? 'is-live' : ''}`} />
          {status === 'playing' ? 'ON AIR' : status === 'paused' ? 'PAUSED' : 'STANDBY'}
          <em>{profile.daily.radio} 段 / 今日</em>
        </div>
      </header>

      <div className="play-radio-channels" role="tablist" aria-label="电台频道">
        {CHANNELS.map((item) => (
          <button
            type="button"
            key={item.id}
            role="tab"
            aria-selected={channel === item.id}
            className={channel === item.id ? 'is-active' : ''}
            onClick={() => chooseChannel(item.id)}
          >
            <span>{item.label}</span>
            <em>{item.sub}</em>
          </button>
        ))}
        <span className="play-radio-channel-note">
          {channel === 'auto' ? `按照当前时间自动选择 · ${slot === 'morning' ? '早间' : slot === 'matchday' ? '赛事' : '深夜'}` : '手动频道'}
          {generated ? ' · AI 稿' : ''}
        </span>
        <button
          type="button"
          className="play-radio-aigen"
          onClick={() => void generate()}
          disabled={generating}
          title="让当前模型根据今天的数据重写节目单"
        >
          {generating ? <Loader2 size={12} className="is-spin" /> : <Sparkles size={12} />}
          {generating ? '写稿中…' : 'AI 写稿'}
        </button>
      </div>
      {notice && <p className="play-radio-notice">{notice}</p>}

      <div className="play-radio-stage">
        <div className={`play-radio-visual ${status === 'playing' ? 'is-playing' : ''} ${status === 'paused' ? 'is-paused' : ''}`}>
          <div className="play-radio-ring" />
          <div className="play-radio-ring is-inner" />
          <div className="play-radio-core">
            <Radio size={30} />
            <strong>{program.title.split(' ')[0]}</strong>
            <span>{index + 1}/{program.segments.length}</span>
          </div>
          <div className="play-wave">
            {Array.from({ length: 28 }).map((_, i) => (
              <i key={i} style={{ animationDelay: `${i * 0.055}s` }} />
            ))}
          </div>
        </div>

        <div className="play-radio-console">
          <div className="play-radio-now">
            <span>{segment.label}</span>
            <em>{status === 'playing' ? 'PLAYING' : status === 'paused' ? 'PAUSED' : 'READY'}</em>
          </div>
          <p>
            {segment.text.slice(0, visible)}
            <span className="play-radio-ghost">{segment.text.slice(visible)}</span>
          </p>
          <div className="play-radio-progress">
            <i style={{ width: `${pct * 100}%` }} />
          </div>
          <div className="play-radio-controls">
            <button type="button" className="play-round-btn" onClick={restart} title="重新开始">
              <RotateCcw size={15} />
            </button>
            <button type="button" className="play-radio-play" onClick={toggle}>
              {status === 'playing' ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <button type="button" className="play-round-btn" onClick={nextSegment} title="下一段">
              <SkipForward size={15} />
            </button>
            <button
              type="button"
              className={`play-round-btn ${muted ? 'is-on' : ''}`}
              onClick={toggleMute}
              title={muted ? '打开人声' : '静音人声'}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <button
              type="button"
              className={`play-round-btn ${bedOn ? 'is-on' : ''}`}
              onClick={toggleBed}
              title={bedOn ? '关闭背景声' : '打开背景声'}
            >
              {bedOn ? <Waves size={15} /> : <AudioLines size={15} />}
            </button>
          </div>
          <div className="play-radio-meta">
            <span><Mic2 size={12} /> FLUX 主播 / 已接入语音配置</span>
            <em>底噪由 WebAudio 实时合成</em>
          </div>
        </div>
      </div>

      <div className="play-radio-queue">
        {program.segments.map((item, i) => (
          <button
            type="button"
            key={item.id}
            className={`play-radio-segment ${i === index ? 'is-active' : ''} ${i < index ? 'is-done' : ''}`}
            onClick={() => playRef.current(i)}
          >
            <span>{String(i + 1).padStart(2, '0')}</span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.text.slice(0, 52)}…</small>
            </div>
            <em>{item.seconds}s</em>
          </button>
        ))}
      </div>
    </div>
  );
}
