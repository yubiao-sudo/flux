import { Award, Check, Flame, Lock, Sparkles, Star, Trophy } from 'lucide-react';
import type { PlayProfile } from './playStore';
import { levelInfo } from './playStore';

export type Achievement = {
  id: string;
  title: string;
  desc: string;
  xp: number;
  progress: (profile: PlayProfile) => [number, number];
};

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'hello',
    title: '初次见面',
    desc: '打开 FLUX PLAY',
    xp: 20,
    progress: () => [1, 1],
  },
  {
    id: 'first-game',
    title: '第一局',
    desc: '完成任意一局小游戏',
    xp: 25,
    progress: (p) => [Math.min(1, p.stats.games), 1],
  },
  {
    id: 'gamer-10',
    title: '手热了',
    desc: '累计完成 10 局小游戏',
    xp: 60,
    progress: (p) => [Math.min(10, p.stats.games), 10],
  },
  {
    id: 'dodge-1',
    title: '第一次进轨道',
    desc: '完成一局轨道躲避',
    xp: 30,
    progress: (p) => [Math.min(1, p.stats.bestDodge ? 1 : 0), 1],
  },
  {
    id: 'dodge-900',
    title: '轨道老手',
    desc: '轨道躲避拿到 900 分',
    xp: 80,
    progress: (p) => [Math.min(900, p.stats.bestDodge), 900],
  },
  {
    id: 'daily-1',
    title: '今日信号',
    desc: '完成一次每日挑战',
    xp: 50,
    progress: (p) => [Math.min(1, p.stats.challenges), 1],
  },
  {
    id: 'focus-25',
    title: '一段完整时间',
    desc: '累计专注 25 分钟',
    xp: 35,
    progress: (p) => [Math.min(25, p.stats.focusMinutes), 25],
  },
  {
    id: 'focus-300',
    title: '深水区',
    desc: '累计专注 300 分钟',
    xp: 120,
    progress: (p) => [Math.min(300, p.stats.focusMinutes), 300],
  },
  {
    id: 'radio-1',
    title: '电台听众',
    desc: '听完一段 FLUX 电台',
    xp: 25,
    progress: (p) => [Math.min(1, p.stats.radioMinutes), 1],
  },
  {
    id: 'radio-30',
    title: '深夜常客',
    desc: '累计收听 30 段节目',
    xp: 80,
    progress: (p) => [Math.min(30, p.stats.radioMinutes), 30],
  },
  {
    id: 'predict-3',
    title: '赛前判断',
    desc: '完成 3 次赛事预测',
    xp: 40,
    progress: (p) => [Math.min(3, p.stats.predictions), 3],
  },
  {
    id: 'predict-correct',
    title: '眼光不错',
    desc: '猜中 1 场比赛',
    xp: 50,
    progress: (p) => [Math.min(1, p.stats.correct), 1],
  },
  {
    id: 'streak-3',
    title: '连续三天',
    desc: '连续 3 天打开玩法中心',
    xp: 70,
    progress: (p) => [Math.min(3, p.streak || 1), 3],
  },
  {
    id: 'all-rounder',
    title: '全能玩家',
    desc: '游戏、专注、电台、预测都试过一次',
    xp: 100,
    progress: (p) => {
      const done = [
        p.stats.games > 0,
        p.stats.focusMinutes > 0,
        p.stats.radioMinutes > 0,
        p.stats.predictions > 0,
      ].filter(Boolean).length;
      return [done, 4];
    },
  },
  {
    id: 'level-5',
    title: '核心升温',
    desc: '达到 LEVEL 5',
    xp: 90,
    progress: (p) => [Math.min(5, p.level), 5],
  },
];

export type Quest = {
  id: string;
  title: string;
  desc: string;
  target: number;
  xp: number;
  value: (profile: PlayProfile) => number;
};

export const QUESTS: Quest[] = [
  {
    id: 'daily-game',
    title: '玩一局',
    desc: '完成任意一局小游戏',
    target: 1,
    xp: 30,
    value: (p) => p.daily.games,
  },
  {
    id: 'daily-focus',
    title: '专注 25 分钟',
    desc: '在专注舱坐满一段',
    target: 25,
    xp: 40,
    value: (p) => p.daily.focusMinutes,
  },
  {
    id: 'daily-radio',
    title: '听一段电台',
    desc: '播放任意一段 FLUX 电台',
    target: 1,
    xp: 25,
    value: (p) => p.daily.radio,
  },
  {
    id: 'daily-predict',
    title: '预测三场',
    desc: '为三场未开赛比赛选胜者',
    target: 3,
    xp: 35,
    value: (p) => p.daily.predictions,
  },
];

type Props = {
  profile: PlayProfile;
  onClaim: (quest: Quest) => void;
};

export function Achievements({ profile, onClaim }: Props) {
  const level = levelInfo(profile.xp);
  const unlocked = new Set(profile.unlocked);
  const claimed = new Set(profile.daily.claimed);

  return (
    <div className="play-achievements">
      <header className="play-section-head">
        <div>
          <span>PROFILE / BADGES / QUESTS</span>
          <h1>你的核心，正在长成什么样。</h1>
          <p>每一次玩、专注、收听和判断，都会留下一点痕迹。</p>
        </div>
        <div className="play-achievements-stats">
          <span><Trophy size={13} /> {profile.unlocked.length} 徽章</span>
          <span><Flame size={13} /> {profile.streak || 1} 天连续</span>
        </div>
      </header>

      <div className="play-profile-row">
        <div className={`play-orb-stage level-${Math.min(8, Math.floor(level.level))}`}>
          <div className="play-orb-halo" />
          <div className="play-orb">
            <span>{level.level}</span>
          </div>
          <em>LEVEL {level.level}</em>
        </div>
        <div className="play-profile-copy">
          <span>FLUX PLAYER / CORE {String(level.level).padStart(2, '0')}</span>
          <h2>{profile.xp.toLocaleString()} XP</h2>
          <div className="play-level-bar is-large">
            <i style={{ width: `${level.pct * 100}%` }} />
          </div>
          <p>
            距离下一级还差 <strong>{Math.max(0, level.need - level.into)} XP</strong>。继续玩、专注或预测都可以。
          </p>
        </div>
        <div className="play-profile-numbers">
          <div><strong>{profile.stats.games}</strong><span>GAMES</span></div>
          <div><strong>{profile.stats.focusMinutes}</strong><span>FOCUS MIN</span></div>
          <div><strong>{profile.stats.correct}</strong><span>PICKS HIT</span></div>
        </div>
      </div>

      <section className="play-quests">
        <header>
          <div>
            <span>DAILY QUESTS</span>
            <h3>今天的小目标</h3>
          </div>
          <em>{claimed.size}/{QUESTS.length} 已领取</em>
        </header>
        <div className="play-quest-list">
          {QUESTS.map((quest) => {
            const value = Math.min(quest.target, quest.value(profile));
            const done = value >= quest.target;
            const isClaimed = claimed.has(quest.id);
            return (
              <div className={`play-quest ${done ? 'is-done' : ''}`} key={quest.id}>
                <span className="play-quest-icon">
                  {isClaimed ? <Check size={14} /> : done ? <Star size={14} /> : <Lock size={12} />}
                </span>
                <div>
                  <strong>{quest.title}</strong>
                  <small>{quest.desc}</small>
                  <div className="play-quest-bar">
                    <i style={{ width: `${(value / quest.target) * 100}%` }} />
                  </div>
                </div>
                <span className="play-quest-progress">
                  {value}/{quest.target}
                </span>
                <button
                  type="button"
                  className={`play-claim ${isClaimed ? 'is-claimed' : ''}`}
                  disabled={!done || isClaimed}
                  onClick={() => onClaim(quest)}
                >
                  {isClaimed ? '已领取' : `+${quest.xp} XP`}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="play-badges-section">
        <header>
          <div>
            <span>ACHIEVEMENTS</span>
            <h3>徽章墙</h3>
          </div>
          <em>{profile.unlocked.length}/{ACHIEVEMENTS.length}</em>
        </header>
        <div className="play-badge-grid">
          {ACHIEVEMENTS.map((achievement) => {
            const [value, target] = achievement.progress(profile);
            const isOn = unlocked.has(achievement.id);
            return (
              <article className={`play-achievement ${isOn ? 'is-unlocked' : ''}`} key={achievement.id}>
                <span className="play-achievement-mark">
                  {isOn ? <Award size={18} /> : <Lock size={14} />}
                </span>
                <div>
                  <strong>{achievement.title}</strong>
                  <small>{achievement.desc}</small>
                  <div className="play-quest-bar">
                    <i style={{ width: `${Math.min(100, (value / target) * 100)}%` }} />
                  </div>
                </div>
                <em>{isOn ? '已解锁' : `${Math.min(value, target)}/${target}`}</em>
                <span className="play-achievement-xp">+{achievement.xp}</span>
              </article>
            );
          })}
        </div>
      </section>

      <p className="play-achievements-note">
        <Sparkles size={13} /> 成就与等级保存在本机，不联网也不会上传。
      </p>
    </div>
  );
}
