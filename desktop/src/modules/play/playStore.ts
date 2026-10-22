/**
 * FLUX PLAY 的本地状态。
 *
 * 玩法中心不依赖后端：经验、等级、连续天数、每日任务、成就、预测、
 * 专注记录都落在 localStorage（WebView2 跨会话保留）。赛事数据仍从
 * 现有 `getLolEsportsOverview` 拿。
 */

import { getPlayState, setPlayState } from '../../engine/api';

export type ScoreGame = 'reaction' | 'memory' | 'typing' | 'dodge';

export type PlayRecord = {
  game: ScoreGame;
  value: number;
  at: number;
};

export type PlayDaily = {
  date: string;
  games: number;
  focusMinutes: number;
  radio: number;
  predictions: number;
  claimed: string[];
  /** 今日每日挑战是否已领取 */
  challengeDone: boolean;
  /** 今日各游戏的最好成绩（反应力是毫秒，越低越好） */
  best: Partial<Record<ScoreGame, number>>;
};

export type PlayStats = {
  games: number;
  bestReaction: number;
  bestMemory: number;
  bestWpm: number;
  bestDodge: number;
  focusMinutes: number;
  radioMinutes: number;
  predictions: number;
  correct: number;
  challenges: number;
};

export type PlayProfile = {
  xp: number;
  level: number;
  streak: number;
  lastActive: string;
  daily: PlayDaily;
  stats: PlayStats;
  unlocked: string[];
  /** 每个游戏保留最近 5 个高分，用于本机排行榜 */
  records: PlayRecord[];
  /** SQLite / localStorage 合并时判断新旧 */
  updatedAt: number;
};

const KEY = 'flux.play.profile';
const TASKS_KEY = 'flux.play.tasks';
const PICKS_KEY = 'flux.play.picks';
const FOCUS_LOG_KEY = 'flux.play.focus.log';

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

export function levelInfo(xp: number) {
  const level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1);
  const floor = (level - 1) * (level - 1) * 100;
  const ceil = level * level * 100;
  return {
    level,
    into: Math.max(0, xp - floor),
    need: Math.max(1, ceil - floor),
    pct: Math.min(1, Math.max(0, (xp - floor) / Math.max(1, ceil - floor))),
  };
}

export function defaultProfile(): PlayProfile {
  return {
    xp: 0,
    level: 1,
    streak: 0,
    lastActive: '',
    daily: {
      date: todayKey(),
      games: 0,
      focusMinutes: 0,
      radio: 0,
      predictions: 0,
      claimed: [],
      challengeDone: false,
      best: {},
    },
    stats: {
      games: 0,
      bestReaction: 0,
      bestMemory: 0,
      bestWpm: 0,
      bestDodge: 0,
      focusMinutes: 0,
      radioMinutes: 0,
      predictions: 0,
      correct: 0,
      challenges: 0,
    },
    unlocked: [],
    records: [],
    updatedAt: 0,
  };
}

export function ensureDay(profile: PlayProfile): PlayProfile {
  const today = todayKey();
  if (profile.daily.date === today) {
    if (!profile.lastActive) profile.lastActive = today;
    return profile;
  }
  const next: PlayProfile = {
    ...profile,
    daily: {
      date: today,
      games: 0,
      focusMinutes: 0,
      radio: 0,
      predictions: 0,
      claimed: [],
      challengeDone: false,
      best: {},
    },
  };
  if (profile.lastActive !== today) {
    next.streak =
      profile.lastActive === yesterdayKey() ? Math.max(1, profile.streak + 1) : 1;
    next.lastActive = today;
  }
  return next;
}

function normalizeProfile(parsed: Partial<PlayProfile>): PlayProfile {
  const base = defaultProfile();
  const profile: PlayProfile = {
    ...base,
    ...parsed,
    daily: { ...base.daily, ...(parsed.daily || {}) },
    stats: { ...base.stats, ...(parsed.stats || {}) },
    unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked : [],
    records: Array.isArray(parsed.records) ? parsed.records : [],
    updatedAt: Number(parsed.updatedAt) || 0,
  };
  profile.daily.best =
    parsed.daily && typeof parsed.daily.best === 'object' && parsed.daily.best
      ? { ...parsed.daily.best }
      : {};
  profile.daily.claimed = Array.isArray(profile.daily.claimed) ? profile.daily.claimed : [];
  profile.level = levelInfo(profile.xp).level;
  return ensureDay(profile);
}

export function loadProfile(): PlayProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return ensureDay(defaultProfile());
    return normalizeProfile(JSON.parse(raw) as Partial<PlayProfile>);
  } catch {
    return ensureDay(defaultProfile());
  }
}

export function saveProfile(profile: PlayProfile) {
  const stamped = { ...profile, updatedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(stamped));
  } catch {
    /* storage unavailable */
  }
  // 桌面端同时写进 SQLite 的 settings 表；浏览器预览里 invoke 会 reject，静默回退。
  void setPlayState('profile', JSON.stringify(stamped)).catch(() => undefined);
}

/** 桌面端启动时从 SQLite 读回档案；没有 Tauri 或没有记录时返回 null。 */
export async function hydrateProfile(): Promise<PlayProfile | null> {
  try {
    const raw = await getPlayState('profile');
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw) as Partial<PlayProfile>);
  } catch {
    return null;
  }
}

export function addXp(profile: PlayProfile, amount: number): PlayProfile {
  const next = { ...profile, xp: Math.max(0, profile.xp + amount) };
  next.level = levelInfo(next.xp).level;
  return next;
}

/** 记录一次玩法行为：daily + stats + XP。 */
export function record(
  profile: PlayProfile,
  kind: 'games' | 'focusMinutes' | 'radio' | 'predictions' | 'correct',
  amount: number,
  xp: number,
): PlayProfile {
  const next = ensureDay({ ...profile, daily: { ...profile.daily }, stats: { ...profile.stats } });
  if (kind === 'correct') {
    next.stats.correct += amount;
  } else if (kind === 'radio') {
    next.daily.radio += amount;
    next.stats.radioMinutes += amount;
  } else if (kind === 'focusMinutes') {
    next.daily.focusMinutes += amount;
    next.stats.focusMinutes += amount;
  } else if (kind === 'predictions') {
    next.daily.predictions += amount;
    next.stats.predictions += amount;
  } else if (kind === 'games') {
    next.daily.games += amount;
    next.stats.games += amount;
  }
  return addXp(next, xp);
}

const LOWER_IS_BETTER: Record<ScoreGame, boolean> = {
  reaction: true,
  memory: false,
  typing: false,
  dodge: false,
};

export const SCORE_META: Record<
  ScoreGame,
  { label: string; short: string; unit: string; lower: boolean; icon: string }
> = {
  reaction: { label: '反应力', short: 'REFLEX', unit: 'ms', lower: true, icon: '⚡' },
  memory: { label: '记忆序列', short: 'MEMORY', unit: '阶', lower: false, icon: '◉' },
  typing: { label: '打字竞速', short: 'TYPE', unit: 'WPM', lower: false, icon: '⌨' },
  dodge: { label: '轨道躲避', short: 'ORBIT', unit: 'pts', lower: false, icon: '◌' },
};

export function formatScore(game: ScoreGame, value: number) {
  if (!value) return '—';
  return `${Math.round(value)} ${SCORE_META[game].unit}`;
}

/**
 * 写入一局成绩：更新今日最好、历史最好和本机排行榜。
 * 反应力越低越好，其余越高越好。
 */
export function recordScore(
  profile: PlayProfile,
  game: ScoreGame,
  value: number,
  xp = 0,
): PlayProfile {
  const clean = Math.max(game === 'reaction' ? 1 : 0, Math.round(value));
  const next = ensureDay({
    ...profile,
    daily: { ...profile.daily, best: { ...profile.daily.best } },
    stats: { ...profile.stats },
    records: [...(profile.records || [])],
  });
  const lower = LOWER_IS_BETTER[game];
  const previous = next.daily.best[game];
  next.daily.best[game] =
    previous == null ? clean : lower ? Math.min(previous, clean) : Math.max(previous, clean);

  if (game === 'reaction') {
    next.stats.bestReaction =
      next.stats.bestReaction === 0 ? clean : Math.min(next.stats.bestReaction, clean);
  } else if (game === 'memory') {
    next.stats.bestMemory = Math.max(next.stats.bestMemory, clean);
  } else if (game === 'typing') {
    next.stats.bestWpm = Math.max(next.stats.bestWpm, clean);
  } else {
    next.stats.bestDodge = Math.max(next.stats.bestDodge, clean);
  }

  const sameGame = [...next.records, { game, value: clean, at: Date.now() }]
    .filter((item) => item.game === game)
    .sort((a, b) => (lower ? a.value - b.value : b.value - a.value))
    .slice(0, 5);
  next.records = [...next.records.filter((item) => item.game !== game), ...sameGame].sort(
    (a, b) => b.at - a.at,
  );
  return addXp(next, xp);
}

export type DailyChallenge = {
  id: string;
  game: ScoreGame;
  target: number;
  lower: boolean;
  title: string;
  desc: string;
  xp: number;
};

const CHALLENGE_POOL: Array<Omit<DailyChallenge, 'id'>> = [
  {
    game: 'reaction',
    target: 300,
    lower: true,
    title: '把反应压进 300ms',
    desc: '完成五轮反应力测试，平均值不超过 300 毫秒。',
    xp: 45,
  },
  {
    game: 'memory',
    target: 6,
    lower: false,
    title: '记住六阶',
    desc: '在记忆序列里复现到第 6 阶。',
    xp: 50,
  },
  {
    game: 'typing',
    target: 45,
    lower: false,
    title: '打字到 45 WPM',
    desc: '30 秒打字竞速达到 45 WPM，准确率不低于 80%。',
    xp: 45,
  },
  {
    game: 'dodge',
    target: 900,
    lower: false,
    title: '在轨道上活下来',
    desc: '轨道躲避拿到 900 分。拖拽星核，别碰碎片。',
    xp: 55,
  },
];

/** 每日挑战按日期轮换，同一天所有人拿到同一项。 */
export function dailyChallenge(date = new Date()): DailyChallenge {
  const key = todayKey(date);
  const seed = [...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 17);
  const pick = CHALLENGE_POOL[seed % CHALLENGE_POOL.length];
  return { ...pick, id: `${key}:${pick.game}` };
}

export function challengeValue(profile: PlayProfile, challenge: DailyChallenge) {
  return profile.daily.best[challenge.game] ?? 0;
}

export function challengeMet(profile: PlayProfile, challenge: DailyChallenge) {
  const value = challengeValue(profile, challenge);
  if (!value) return false;
  return challenge.lower ? value <= challenge.target : value >= challenge.target;
}

export function markChallengeDone(profile: PlayProfile): PlayProfile {
  const next = ensureDay({
    ...profile,
    daily: { ...profile.daily, challengeDone: true },
    stats: { ...profile.stats, challenges: profile.stats.challenges + 1 },
  });
  return next;
}

export type PlayTask = { id: string; text: string; done: boolean; at: number };

export function loadTasks(): PlayTask[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    return raw ? (JSON.parse(raw) as PlayTask[]) : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: PlayTask[]) {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch {
    /* noop */
  }
}

export type Pick = {
  eventId: string;
  pick: string;
  team: string;
  at: number;
  settled?: boolean;
  correct?: boolean;
};

export function loadPicks(): Record<string, Pick> {
  try {
    const raw = localStorage.getItem(PICKS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Pick>) : {};
  } catch {
    return {};
  }
}

export function savePicks(picks: Record<string, Pick>) {
  try {
    localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
  } catch {
    /* noop */
  }
}

export type FocusLog = { date: string; minutes: number };

export function loadFocusLog(): FocusLog[] {
  try {
    const raw = localStorage.getItem(FOCUS_LOG_KEY);
    return raw ? (JSON.parse(raw) as FocusLog[]) : [];
  } catch {
    return [];
  }
}

export function saveFocusLog(log: FocusLog[]) {
  try {
    localStorage.setItem(FOCUS_LOG_KEY, JSON.stringify(log.slice(-30)));
  } catch {
    /* noop */
  }
}

let toneContext: AudioContext | null = null;

/** 小游戏/记忆序列的短音；第一次调用必须发生在用户手势里。 */
export function beep(freq = 620, dur = 0.12, gain = 0.05, type: OscillatorType = 'sine') {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!toneContext) toneContext = new Ctor();
    if (toneContext.state === 'suspended') void toneContext.resume().catch(() => undefined);
    const ctx = toneContext;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch {
    /* noop */
  }
}
