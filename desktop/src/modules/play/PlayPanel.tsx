import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gamepad2,
  LayoutDashboard,
  Radio as RadioIcon,
  Swords,
  Timer,
  Trophy,
  X,
} from 'lucide-react';
import { getLolEsportsOverview } from '../../engine/api';
import type { LolOverview } from '../../engine/types';
import { Dashboard } from './Dashboard';
import { Arcade } from './Arcade';
import { RadioMode } from './Radio';
import { FocusMode } from './Focus';
import { Achievements, ACHIEVEMENTS, QUESTS, type Quest } from './Achievements';
import { Predictions } from './Predictions';
import {
  addXp,
  challengeMet,
  dailyChallenge,
  ensureDay,
  hydrateProfile,
  levelInfo,
  loadFocusLog,
  loadProfile,
  loadTasks,
  markChallengeDone,
  record,
  recordScore,
  saveFocusLog,
  saveProfile,
  saveTasks,
  type FocusLog,
  type PlayProfile,
  type PlayTask,
  type ScoreGame,
} from './playStore';
import './play.css';

type Mode = 'dashboard' | 'arcade' | 'radio' | 'focus' | 'achievements' | 'predictions';

const MODES: Array<{ id: Mode; label: string; sub: string; icon: typeof Gamepad2 }> = [
  { id: 'dashboard', label: '驾驶舱', sub: 'TODAY', icon: LayoutDashboard },
  { id: 'arcade', label: '游戏厅', sub: 'ARCADE', icon: Gamepad2 },
  { id: 'radio', label: '电台', sub: 'ON AIR', icon: RadioIcon },
  { id: 'focus', label: '专注舱', sub: 'FOCUS', icon: Timer },
  { id: 'achievements', label: '成就', sub: 'PROFILE', icon: Trophy },
  { id: 'predictions', label: '预测', sub: 'PICK\'EM', icon: Swords },
];

export function PlayPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('dashboard');
  const [profile, setProfile] = useState<PlayProfile>(() => loadProfile());
  const [tasks, setTasks] = useState<PlayTask[]>(() => loadTasks());
  const [focusLog, setFocusLog] = useState<FocusLog[]>(() => loadFocusLog());
  const [overview, setOverview] = useState<LolOverview | null>(null);
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [toast, setToast] = useState('');
  const [ready, setReady] = useState(false);
  const [arcadeKey, setArcadeKey] = useState(0);
  const level = levelInfo(profile.xp);
  const challenge = useMemo(() => dailyChallenge(), []);

  const updateProfile = useCallback((fn: (current: PlayProfile) => PlayProfile) => {
    setProfile((current) => {
      const safe = ensureDay({
        ...current,
        daily: { ...current.daily, best: { ...(current.daily.best || {}) } },
        stats: { ...current.stats },
        records: [...(current.records || [])],
      });
      return fn(safe);
    });
  }, []);

  // 桌面端从 SQLite 回读，浏览器预览里 hydrateProfile 返回 null。
  // 回读完成前不写盘，否则启动时那一次 save 会盖掉更完整的 SQLite 档案。
  useEffect(() => {
    let alive = true;
    void hydrateProfile().then((remote) => {
      if (!alive) return;
      if (remote && remote.updatedAt > loadProfile().updatedAt) setProfile(remote);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) saveProfile(profile);
  }, [profile, ready]);

  useEffect(() => {
    saveFocusLog(focusLog);
  }, [focusLog]);

  useEffect(() => {
    let alive = true;
    void getLolEsportsOverview()
      .then((data) => {
        if (alive) setOverview(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=30.2741&longitude=120.1551&current=temperature_2m,weather_code&timezone=Asia%2FShanghai',
    )
      .then((response) => response.json())
      .then((data: { current?: { temperature_2m?: number; weather_code?: number } }) => {
        if (!alive || !data.current) return;
        setWeather({
          temp: Number(data.current.temperature_2m ?? 0),
          code: Number(data.current.weather_code ?? 0),
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 解锁成就：只看进度，不依赖点击。加锁避免同一枚徽章重复发 XP。
  useEffect(() => {
    const freshly = ACHIEVEMENTS.filter((achievement) => {
      if (profile.unlocked.includes(achievement.id)) return false;
      const [value, target] = achievement.progress(profile);
      return value >= target;
    });
    if (freshly.length === 0) return;
    const ids = freshly.map((achievement) => achievement.id);
    const xp = freshly.reduce((sum, achievement) => sum + achievement.xp, 0);
    updateProfile((current) => addXp({ ...current, unlocked: [...current.unlocked, ...ids] }, xp));
    setToast(`解锁 ${freshly.map((achievement) => achievement.title).join(' / ')}  +${xp} XP`);
  }, [profile, updateProfile]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onRecord = useCallback(
    (kind: 'games' | 'focusMinutes' | 'radio' | 'predictions' | 'correct', amount: number, xp: number) => {
      updateProfile((current) => record(current, kind, amount, xp));
    },
    [updateProfile],
  );

  const onScore = useCallback(
    (game: ScoreGame, value: number, xp: number) => {
      updateProfile((current) => recordScore(record(current, 'games', 1, xp), game, value, 0));
    },
    [updateProfile],
  );

  useEffect(() => {
    if (profile.daily.challengeDone) return;
    if (!challengeMet(profile, challenge)) return;
    updateProfile((current) => {
      if (current.daily.challengeDone) return current;
      return addXp(markChallengeDone(current), challenge.xp);
    });
    setToast(`每日挑战完成 · ${challenge.title}  +${challenge.xp} XP`);
  }, [profile, challenge, updateProfile]);

  const onClaim = (quest: Quest) => {
    if (profile.daily.claimed.includes(quest.id)) return;
    if (quest.value(profile) < quest.target) return;
    updateProfile((current) => {
      if (current.daily.claimed.includes(quest.id)) return current;
      if (quest.value(current) < quest.target) return current;
      return addXp(
        {
          ...current,
          daily: { ...current.daily, claimed: [...current.daily.claimed, quest.id] },
        },
        quest.xp,
      );
    });
    setToast(`领取「${quest.title}」 +${quest.xp} XP`);
  };

  const onTasks = (next: PlayTask[]) => {
    setTasks(next);
    saveTasks(next);
  };

  const content = useMemo(() => {
    switch (mode) {
      case 'arcade':
        return (
          <Arcade
            key={arcadeKey}
            profile={profile}
            challenge={challenge}
            onRecord={onRecord}
            onScore={onScore}
          />
        );
      case 'radio':
        return (
          <RadioMode
            profile={profile}
            overview={overview}
            weather={weather}
            tasks={tasks}
            onRecord={onRecord}
          />
        );
      case 'focus':
        return (
          <FocusMode
            profile={profile}
            focusLog={focusLog}
            setFocusLog={setFocusLog}
            onRecord={onRecord}
            onComplete={(minutes) => setToast(`完成 ${minutes} 分钟专注，核心记录已更新`)}
          />
        );
      case 'achievements':
        return <Achievements profile={profile} onClaim={onClaim} />;
      case 'predictions':
        return <Predictions profile={profile} overview={overview} onRecord={onRecord} />;
      default:
        return (
          <Dashboard
            profile={profile}
            tasks={tasks}
            setTasks={onTasks}
            focusLog={focusLog}
            overview={overview}
            weather={weather}
            onNavigate={(next) => setMode(next)}
          />
        );
    }
  }, [mode, profile, overview, weather, tasks, focusLog, onRecord, onScore, onClaim, challenge, arcadeKey]);

  return (
    <section className="play-shell" aria-label="FLUX PLAY 玩法中心">
      <header className="play-topbar">
        <div className="play-brand">
          <span className="play-brand-mark">PLAY</span>
          <div>
            <strong>FLUX / 玩法中心</strong>
            <small>ARCADE · RADIO · FOCUS · PREDICT</small>
          </div>
        </div>
        <div className="play-topmeta">
          <span className="play-lv">LEVEL {level.level}</span>
          <div className="play-xp-bar"><i style={{ width: `${level.pct * 100}%` }} /></div>
          <span>{profile.xp.toLocaleString()} XP</span>
          <i />
          <span>连续 {profile.streak || 1} 天</span>
          <i />
          <span>{profile.unlocked.length} 徽章</span>
          <button type="button" className="play-icon-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="play-layout">
        <aside className="play-rail">
          <div className="play-rail-head">PLAY MODES</div>
          {MODES.map(({ id, label, sub, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`play-mode ${mode === id ? 'is-active' : ''}`}
              onClick={() => {
                if (id === 'arcade' && mode === 'arcade') setArcadeKey((value) => value + 1);
                setMode(id);
              }}
            >
              <span className="play-mode-icon"><Icon size={17} /></span>
              <span>
                <strong>{label}</strong>
                <small>{sub}</small>
              </span>
              <em>{id === 'dashboard' ? '01' : String(MODES.findIndex((item) => item.id === id) + 1).padStart(2, '0')}</em>
            </button>
          ))}
          <div className="play-rail-note">
            <span>LOCAL PROFILE</span>
            <p>等级、成就、预测与专注记录只保存在这台机器。</p>
          </div>
        </aside>

        <main className="play-main">{content}</main>
      </div>

      {toast && <div className="play-toast">{toast}</div>}
    </section>
  );
}
