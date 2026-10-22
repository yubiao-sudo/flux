import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, CloudRain, Droplet, Lock, Music2, Timer, Wind } from 'lucide-react';
import type { LargeModuleId, SmallModuleId } from '../types';
import type { BrowserState } from '../engine/types';
import { getBrowserState, onBrowserUpdate, openBrowserWindow } from '../engine/api';
import { clock } from '../data';

const spring = { type: 'spring', stiffness: 165, damping: 24, mass: 0.85 } as const;
const soft = [0.16, 1, 0.3, 1] as const;

const smallEntrance = {
  opacity: 0,
  scale: 0.78,
  filter: 'blur(18px)',
  y: 18,
} as const;

const smallRest = {
  opacity: 1,
  scale: 1,
  filter: 'blur(0px)',
  y: 0,
} as const;

const smallExit = {
  opacity: 0,
  scale: 0.9,
  filter: 'blur(12px)',
  y: 10,
  transition: { duration: 0.38, ease: soft },
} as const;

type SmallProps = {
  id: SmallModuleId;
};

type ModuleProps = {
  small: SmallModuleId[];
  large: LargeModuleId | null;
  overlay?: ReactNode;
  esports?: ReactNode;
  play?: ReactNode;
  chronicle?: ReactNode;
  atlas?: ReactNode;
  dossier?: ReactNode;
};

function ShardHead({
  index,
  title,
  icon,
}: {
  index: string;
  title: string;
  icon?: React.ReactNode;
}) {
  return (
    <header className="shard-head">
      <div className="shard-id">
        <span>{index}</span>
        <i />
        <span>{title}</span>
      </div>
      <span className="shard-icon">{icon}</span>
    </header>
  );
}

const SMALL_LABELS: Record<SmallModuleId, string> = {
  weather: '天气',
  calendar: '日历',
  timer: '专注计时',
  music: '氛围音乐',
};

export function SmallModule({ id }: SmallProps) {
  const spawn =
    id === 'weather' || id === 'timer' ? { x: -26, y: 12 } : { x: 26, y: 12 };

  return (
    <motion.section
      className={`shard shard--${id}`}
      role="region"
      aria-label={SMALL_LABELS[id]}
      initial={{ ...smallEntrance, x: spawn.x, y: spawn.y }}
      animate={{ ...smallRest, x: 0, y: 0 }}
      exit={smallExit}
      transition={spring}
      layout
    >
      {id === 'weather' && <WeatherWidget />}
      {id === 'calendar' && <CalendarWidget />}
      {id === 'timer' && <TimerWidget />}
      {id === 'music' && <MusicWidget />}
      <span className="shard-corner" aria-hidden="true" />
    </motion.section>
  );
}

function WeatherWidget() {
  return (
    <>
      <ShardHead index="01" title="ATMOSPHERE" icon={<CloudRain size={12} strokeWidth={1.4} />} />
      <div className="weather-main">
        <div className="weather-temp">
          17<span>°</span>
        </div>
        <div className="weather-place">
          <strong>小雨</strong>
          <span>杭州 · 西湖区</span>
        </div>
      </div>
      <div className="weather-now">
        <span>体感 16°</span>
        <span className="weather-stats">
          <Wind size={10} strokeWidth={1.4} /> 东南风 2级
        </span>
        <span className="weather-stats">
          <Droplet size={10} strokeWidth={1.4} /> 86%
        </span>
      </div>
      <div className="rain-chart" aria-hidden="true">
        {[22, 26, 31, 46, 38, 27, 20, 18].map((height, index) => (
          <i key={index} style={{ height: `${height}px` }} />
        ))}
        <span className="rain-chart-line" />
      </div>
      <footer className="shard-foot">
        <span>21:40 转急雨</span>
        <span className="foot-signal">+40 MIN</span>
      </footer>
    </>
  );
}

function CalendarWidget() {
  const today = useMemo(() => new Date(), []);
  const weekdayZh = ['日', '一', '二', '三', '四', '五', '六'];
  const monday = new Date(today);
  const day = today.getDay();
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
  const todayIndex = (day + 6) % 7;

  return (
    <>
      <ShardHead index="03" title="RHYTHM" />
      <div className="calendar-head">
        <div className="calendar-date">
          {String(today.getDate()).padStart(2, '0')}
          <span>/ {String(today.getMonth() + 1).padStart(2, '0')}月</span>
        </div>
        <div className="calendar-week">
          {week.map((date, index) => (
            <div className={`week-cell ${index === todayIndex ? 'is-today' : ''}`} key={date.toISOString()}>
              <span>{weekdayZh[date.getDay()]}</span>
              <i>{date.getDate()}</i>
            </div>
          ))}
        </div>
      </div>
      <div className="calendar-events">
        <div className="calendar-event">
          <span className="event-time">09:00</span>
          <span className="event-line" />
          <div className="event-copy">
            <strong>北屿 · 空间叙事</strong>
            <span>未确认 · 需要回信</span>
          </div>
        </div>
        <div className="calendar-event">
          <span className="event-time">11:00</span>
          <span className="event-line" />
          <div className="event-copy">
            <strong>材料评审</strong>
            <span>线上 · 45 分钟</span>
          </div>
        </div>
        <div className="calendar-event is-muted">
          <span className="event-time">16:30</span>
          <span className="event-line" />
          <div className="event-copy">
            <strong>跑步 · 西溪</strong>
            <span>轻量日程</span>
          </div>
        </div>
      </div>
      <footer className="shard-foot">
        <span>2 个待确认</span>
        <span className="foot-signal">WEEK 42</span>
      </footer>
    </>
  );
}

function TimerWidget() {
  const total = 25 * 60;
  const [left, setLeft] = useState(total);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setLeft(Math.max(0, total - elapsed));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [total]);

  const minutes = String(Math.floor(left / 60)).padStart(2, '0');
  const seconds = String(left % 60).padStart(2, '0');
  const progress = left / total;
  const circumference = 2 * Math.PI * 76;

  return (
    <>
      <ShardHead index="04" title="FOCUS" icon={<Timer size={12} strokeWidth={1.4} />} />
      <div className="timer-body">
        <div className="timer-ring">
          <svg viewBox="0 0 180 180" aria-hidden="true">
            <circle className="timer-track" cx="90" cy="90" r="76" />
            <circle
              className="timer-progress"
              cx="90"
              cy="90"
              r="76"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
            />
          </svg>
          <div className="timer-readout">
            <strong>
              {minutes}
              <span>:</span>
              {seconds}
            </strong>
            <small>DEEP WORK</small>
          </div>
          <span className="timer-tick timer-tick--a" />
          <span className="timer-tick timer-tick--b" />
        </div>
      </div>
      <div className="timer-note">
        <span>预计 {clock(26)} 结束</span>
        <span className="foot-signal">LOW NOISE</span>
      </div>
    </>
  );
}

function MusicWidget() {
  const bars = useMemo(
    () => Array.from({ length: 32 }, (_, index) => 8 + Math.abs(Math.sin(index * 1.7 + 0.6)) * 28),
    [],
  );

  return (
    <>
      <ShardHead index="02" title="RESONANCE" icon={<Music2 size={12} strokeWidth={1.4} />} />
      <div className="music-body">
        <div className="music-art">
          <i />
          <span />
        </div>
        <div className="music-title">
          <strong>Weightless</strong>
          <span>Marconi Union</span>
          <small>AMBIENT / 08:11</small>
        </div>
      </div>
      <div className="music-wave" aria-hidden="true">
        {bars.map((height, index) => (
          <i
            key={index}
            style={{
              height: `${height}px`,
              animationDelay: `${(index % 8) * 0.13}s`,
            }}
          />
        ))}
      </div>
      <footer className="shard-foot">
        <span>正在为专注让路</span>
        <span className="foot-signal">-18 dB</span>
      </footer>
    </>
  );
}

/**
 * The main lens is a control surface, not a webpage renderer.
 *
 * FLUX's real browser is the dedicated `browser` WebView window. Keeping one
 * renderer avoids the old situation where a tool opened the external window
 * while this panel showed an unrelated static article.
 */
function BrowserHub() {
  const [state, setState] = useState<BrowserState | null>(null);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    getBrowserState()
      .then((next) => {
        if (alive) setState(next);
      })
      .catch(() => {
        /* preview / no engine */
      });
    onBrowserUpdate((next) => {
      if (alive) setState(next);
    })
      .then((off) => {
        unlisten = off;
      })
      .catch(() => {
        /* preview / no engine */
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const tabs = state?.tabs ?? [];
  const active = tabs.find((tab) => tab.active) ?? tabs[0];

  return (
    <motion.section
      className="chamber chamber--browser browser-hub"
      role="region"
      aria-label="FLUX LENS 浏览器控制台"
      initial={{ opacity: 0, scale: 0.965, x: 26, filter: 'blur(22px)' }}
      animate={{ opacity: 1, scale: 1, x: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.975, x: 18, filter: 'blur(16px)', pointerEvents: 'none' }}
      transition={{ type: 'spring', stiffness: 105, damping: 22, mass: 1 }}
    >
      <span className="chamber-trace chamber-trace--top" />
      <span className="chamber-trace chamber-trace--bottom" />
      <header className="lens-bar">
        <div className="lens-brand">
          <span className="lens-mark">FLUX</span>
          <span className="lens-divider" />
          <span>LENS</span>
        </div>
        <div className="lens-address">
          <span className={tabs.length ? 'browser-hub-live' : ''} />
          <span>ONE BROWSER / LIVE LINK</span>
        </div>
        <div className="lens-bar-meta">
          <span>{tabs.length} TABS</span>
          <i />
          <span>WEBVIEW</span>
        </div>
      </header>

      <div className="browser-hub-body">
        <div className="browser-hub-copy">
          <span className="browser-hub-kicker">ONE SURFACE / TWO VIEWS</span>
          <h1>
            网页在 <em>LENS</em> 里。
          </h1>
          <p>
            完整的网页由独立 LENS 窗口承载，登录态、Cookie 和跨域页面都在那里运行。主界面不伪装成浏览器，只负责把同一个浏览器的标签、搜索和当前页同步到这里。
          </p>
          <div className="browser-hub-actions">
            <button type="button" onClick={() => void openBrowserWindow().catch(() => undefined)}>
              打开 LENS <ArrowUpRight size={13} strokeWidth={1.4} />
            </button>
            <span>工具打开 / 手动打开，都是同一个窗口</span>
          </div>
          <div className="browser-hub-index" aria-label="FLUX 本地索引">
            <span className="browser-hub-index-label">LOCAL INDEX / 本地索引</span>
            <div className="browser-hub-index-items">
              <span>工具</span>
              <span>文档</span>
              <span>记忆</span>
              <span>会话</span>
              <span>邮件</span>
            </div>
            <p>统一搜索先查本地，再补多引擎网络检索；高频查询走本地缓存。</p>
          </div>
        </div>

        <div className="browser-hub-tabs">
          <div className="browser-hub-tabs-head">
            <span>ACTIVE TABS</span>
            <span>{String(tabs.length).padStart(2, '0')}</span>
          </div>
          {tabs.length === 0 ? (
            <p className="browser-hub-empty">
              还没有标签页。让 FLUX 搜索一个主题，或直接打开 LENS 输入网址；
              这里会同步显示它正在看的页面。
            </p>
          ) : (
            <ol>
              {tabs.slice(0, 6).map((tab) => (
                <li key={tab.id} className={tab.active ? 'is-active' : ''}>
                  <span>{tab.active ? '●' : '○'}</span>
                  <div>
                    <strong>{tab.title || tab.content || 'Untitled'}</strong>
                    <small>{tab.kind.toUpperCase()}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {active && (
            <footer className="browser-hub-current">
              <span>CURRENT</span>
              <strong>{active.title || active.content}</strong>
            </footer>
          )}
        </div>
      </div>

      <footer className="lens-footer">
        <span>THE BROWSER IS A WEBVIEW WINDOW</span>
        <span>THIS IS ITS CONTROL SURFACE</span>
        <span>ESC TO RETURN</span>
      </footer>
    </motion.section>
  );
}

export function ModuleLayer({
  small,
  large,
  overlay,
  esports,
  play,
  chronicle,
  atlas,
  dossier,
}: ModuleProps) {
  return (
    <div className="module-layer">
      <AnimatePresence mode="popLayout">
        {!large &&
          small.map((id) => <SmallModule key={id} id={id} />)}
        {large === 'browser' && <BrowserHub key="browser" />}
        {large === 'esports' && esports}
        {large === 'play' && play}
        {large === 'chronicle' && chronicle}
        {large === 'atlas' && atlas}
        {large === 'dossier' && dossier}
        {overlay}
      </AnimatePresence>
    </div>
  );
}
