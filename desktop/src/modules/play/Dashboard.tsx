import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CloudSun,
  Flame,
  Gamepad2,
  Plus,
  Radio,
  Swords,
  Timer,
  Trophy,
  X,
} from 'lucide-react';
import type { LolOverview } from '../../engine/types';
import type { PlayProfile, PlayTask, FocusLog } from './playStore';
import { levelInfo, saveTasks } from './playStore';

type Props = {
  profile: PlayProfile;
  tasks: PlayTask[];
  setTasks: (tasks: PlayTask[]) => void;
  focusLog: FocusLog[];
  overview: LolOverview | null;
  weather: { temp: number; code: number } | null;
  onNavigate: (mode: 'arcade' | 'radio' | 'focus' | 'achievements' | 'predictions') => void;
};

const WEATHER_TEXT: Record<number, string> = {
  0: '晴',
  1: '大致晴朗',
  2: '多云',
  3: '阴',
  45: '有雾',
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

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function nextMatch(overview: LolOverview | null) {
  if (!overview) return null;
  const upcoming = overview.events
    .filter(
      (event) =>
        event.state === 'unstarted' &&
        event.teams.length >= 2 &&
        event.teams.every((team) => team.name && team.name !== 'TBD'),
    )
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return upcoming[0] || null;
}

function countdown(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return '即将开始';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.floor(hours / 24)} 天后`;
}

function lastSevenDays(log: FocusLog[]) {
  const map = new Map(log.map((item) => [item.date, item.minutes]));
  const out: Array<{ label: string; minutes: number }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    out.push({ label: '日一二三四五六'[d.getDay()], minutes: map.get(key) || 0 });
  }
  return out;
}

export function Dashboard({
  profile,
  tasks,
  setTasks,
  focusLog,
  overview,
  weather,
  onNavigate,
}: Props) {
  const [draft, setDraft] = useState('');
  const level = levelInfo(profile.xp);
  const week = useMemo(() => lastSevenDays(focusLog), [focusLog]);
  const maxWeek = Math.max(25, ...week.map((d) => d.minutes));
  const match = nextMatch(overview);
  const doneTasks = tasks.filter((task) => task.done).length;
  const focusToday = profile.daily.focusMinutes;

  const addTask = () => {
    const text = draft.trim();
    if (!text) return;
    const next = [
      ...tasks,
      { id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, done: false, at: Date.now() },
    ];
    setTasks(next);
    saveTasks(next);
    setDraft('');
  };

  const toggleTask = (id: string) => {
    const next = tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task));
    setTasks(next);
    saveTasks(next);
  };

  const removeTask = (id: string) => {
    const next = tasks.filter((task) => task.id !== id);
    setTasks(next);
    saveTasks(next);
  };

  return (
    <div className="play-dashboard">
      <section className="play-greeting">
        <div>
          <span className="play-eyebrow">TODAY / {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
          <h1>
            {timeGreeting()}，<em>欢迎回到 FLUX</em>
          </h1>
          <p>今天可以玩一局、听一段、专注一会儿，或者只是看看赛事。</p>
        </div>
        <div className="play-level-card">
          <span>LEVEL {level.level}</span>
          <strong>{profile.xp.toLocaleString()} XP</strong>
          <div className="play-level-bar">
            <i style={{ width: `${level.pct * 100}%` }} />
          </div>
          <small>
            再 {Math.max(0, level.need - level.into)} XP 升级 · 连续 {profile.streak || 1} 天
          </small>
        </div>
      </section>

      <div className="play-dash-grid">
        <button type="button" className="play-dash-card" onClick={() => onNavigate('arcade')}>
          <span className="play-card-icon"><Gamepad2 size={20} /></span>
          <em>ARCADE</em>
          <h3>反应力 / 记忆 / 打字 / 轨道</h3>
          <p>四局小游戏，刷新你的本机记录。</p>
          <span className="play-card-foot">
            已玩 {profile.stats.games} 局 <ArrowRight size={13} />
          </span>
        </button>

        <button type="button" className="play-dash-card" onClick={() => onNavigate('radio')}>
          <span className="play-card-icon"><Radio size={20} /></span>
          <em>RADIO</em>
          <h3>FLUX 电台</h3>
          <p>把日程、赛事和天气做成一段有声音的节目。</p>
          <span className="play-card-foot">
            今日 {profile.daily.radio} 段 <ArrowRight size={13} />
          </span>
        </button>

        <button type="button" className="play-dash-card" onClick={() => onNavigate('focus')}>
          <span className="play-card-icon"><Timer size={20} /></span>
          <em>FOCUS</em>
          <h3>专注舱</h3>
          <p>25 分钟，一段氛围声景，把世界调低。</p>
          <span className="play-card-foot">
            今日 {focusToday} 分钟 <ArrowRight size={13} />
          </span>
        </button>

        <button type="button" className="play-dash-card" onClick={() => onNavigate('predictions')}>
          <span className="play-card-icon"><Swords size={20} /></span>
          <em>PREDICT</em>
          <h3>赛事预测</h3>
          <p>用真实赛程做 Pick'em，猜中就有 XP。</p>
          <span className="play-card-foot">
            猜中 {profile.stats.correct} 场 <ArrowRight size={13} />
          </span>
        </button>
      </div>

      <div className="play-dash-row">
        <section className="play-panel play-weather">
          <header>
            <span>ATMOSPHERE</span>
            <CloudSun size={16} />
          </header>
          <div className="play-weather-main">
            <strong>{weather ? `${Math.round(weather.temp)}°` : '—'}</strong>
            <div>
              <em>{weather ? WEATHER_TEXT[weather.code] || '天气变化中' : '等待天气'}</em>
              <small>杭州 · 实时</small>
            </div>
          </div>
          <p>天气只作为氛围参考，出门前再看一眼窗外。</p>
        </section>

        <section className="play-panel play-next">
          <header>
            <span>NEXT MATCH</span>
            <Swords size={16} />
          </header>
          {match ? (
            <>
              <div className="play-next-teams">
                <span>{match.teams[0].code || match.teams[0].name}</span>
                <i>VS</i>
                <span>{match.teams[1].code || match.teams[1].name}</span>
              </div>
              <p>
                {match.league.name} · {match.tournament.name} · BO{match.bestOf}
              </p>
              <div className="play-next-foot">
                <em>{countdown(match.startTime)}</em>
                <button type="button" onClick={() => onNavigate('predictions')}>
                  去预测 <ArrowRight size={12} />
                </button>
              </div>
            </>
          ) : (
            <p className="play-muted">当前没有待开赛的比赛，去赛事面板看最近赛果。</p>
          )}
        </section>

        <section className="play-panel play-week">
          <header>
            <span>FOCUS / 7 DAYS</span>
            <Flame size={16} />
          </header>
          <div className="play-week-bars">
            {week.map((day, index) => (
              <div key={`${day.label}-${index}`}>
                <span style={{ height: `${Math.max(4, (day.minutes / maxWeek) * 56)}px` }} />
                <em>{day.label}</em>
              </div>
            ))}
          </div>
          <p>本周专注 {week.reduce((sum, day) => sum + day.minutes, 0)} 分钟。</p>
        </section>
      </div>

      <div className="play-dash-row play-dash-row--tasks">
        <section className="play-panel play-tasks">
          <header>
            <span>TODAY / 三件事</span>
            <CalendarDays size={16} />
          </header>
          <div className="play-task-progress">
            <i style={{ width: `${tasks.length ? (doneTasks / tasks.length) * 100 : 0}%` }} />
            <span>
              {doneTasks}/{tasks.length || 0} 完成
            </span>
          </div>
          <div className="play-task-list">
            {tasks.map((task) => (
              <div className={`play-task ${task.done ? 'is-done' : ''}`} key={task.id}>
                <button type="button" className="play-task-check" onClick={() => toggleTask(task.id)}>
                  {task.done ? <Check size={12} /> : null}
                </button>
                <span>{task.text}</span>
                <button type="button" className="play-task-x" onClick={() => removeTask(task.id)}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {tasks.length === 0 && <p className="play-muted">写下今天最重要的三件事。</p>}
          </div>
          <div className="play-task-add">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTask();
              }}
              placeholder="加一件今天要完成的事…"
            />
            <button type="button" onClick={addTask}>
              <Plus size={14} />
            </button>
          </div>
        </section>

        <section className="play-panel play-badges">
          <header>
            <span>ACHIEVEMENTS</span>
            <Trophy size={16} />
          </header>
          <div className="play-badge-count">
            <strong>{profile.unlocked.length}</strong>
            <span>枚徽章已解锁</span>
          </div>
          <div className="play-badge-row">
            {['初次见面', '第一局', '专注 25', '电台听众'].map((name, index) => (
              <span key={name} className={profile.unlocked.length > index ? 'is-on' : ''}>
                {name}
              </span>
            ))}
          </div>
          <button type="button" className="play-link" onClick={() => onNavigate('achievements')}>
            查看全部成就 <ArrowRight size={12} />
          </button>
        </section>
      </div>
    </div>
  );
}
