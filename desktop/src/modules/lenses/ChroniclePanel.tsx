import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Brain,
  CalendarDays,
  Gamepad2,
  History,
  MessageSquare,
  Radio,
  Timer,
  Wrench,
} from 'lucide-react';
import { SurfaceFrame } from './SurfaceFrame';
import {
  getMemoryGraph,
  getModelUsageDaily,
  getModelUsageReport,
  listConversations,
  queryAuditLog,
  type AuditRow,
  type ModelUsageDayRow,
  type ModelUsageRow,
} from '../../engine/api';
import type { Conversation, MemoryRow } from '../../engine/types';
import { loadFocusLog, loadProfile, SCORE_META } from '../play/playStore';

type Range = 'today' | 'week' | 'year';

type EventKind = 'tool' | 'conversation' | 'memory' | 'game' | 'focus' | 'radio' | 'model';

type Event = {
  id: string;
  at: number;
  kind: EventKind;
  title: string;
  detail: string;
  meta?: string;
};

type Data = {
  conversations: Conversation[];
  audit: AuditRow[];
  usageDaily: ModelUsageDayRow[];
  usageReport: ModelUsageRow[];
  memories: MemoryRow[];
};

const DAY = 86_400_000;

function toMs(value: number) {
  if (!Number.isFinite(value)) return 0;
  return value > 1e12 ? value : value * 1000;
}

function startOfDay(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function clockOf(at: number) {
  return new Date(at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function whenOf(at: number, range: Range) {
  if (range === 'today') return clockOf(at);
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return range === 'week' ? `${month}/${day} ${clockOf(at)}` : `${month}/${day}`;
}

function short(text: string, max = 110) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function eventIcon(kind: EventKind) {
  if (kind === 'tool') return <Wrench size={12} />;
  if (kind === 'conversation') return <MessageSquare size={12} />;
  if (kind === 'memory') return <Brain size={12} />;
  if (kind === 'game') return <Gamepad2 size={12} />;
  if (kind === 'focus') return <Timer size={12} />;
  if (kind === 'radio') return <Radio size={12} />;
  return <BarChart3 size={12} />;
}

function rangeStart(range: Range, now: number) {
  if (range === 'today') return startOfDay(now);
  if (range === 'week') return startOfDay(now) - 6 * DAY;
  return new Date(new Date(now).getFullYear(), 0, 1).getTime();
}

export function ChroniclePanel({ onClose }: { onClose: () => void }) {
  const [range, setRange] = useState<Range>('today');
  const [data, setData] = useState<Data>({
    conversations: [],
    audit: [],
    usageDaily: [],
    usageReport: [],
    memories: [],
  });
  const [loading, setLoading] = useState(true);
  const profile = useMemo(() => loadProfile(), []);
  const focusLog = useMemo(() => loadFocusLog(), []);
  const now = Date.now();

  useEffect(() => {
    let alive = true;
    const settle = <T,>(result: PromiseSettledResult<T>, fallback: T): T =>
      result.status === 'fulfilled' ? result.value : fallback;
    void Promise.allSettled([
      listConversations(),
      queryAuditLog(240),
      getModelUsageDaily(30),
      getModelUsageReport(30),
      getMemoryGraph(),
    ]).then((results) => {
      if (!alive) return;
      setData({
        conversations: settle(results[0] as PromiseSettledResult<Conversation[]>, []),
        audit: settle(results[1] as PromiseSettledResult<AuditRow[]>, []),
        usageDaily: settle(results[2] as PromiseSettledResult<ModelUsageDayRow[]>, []),
        usageReport: settle(results[3] as PromiseSettledResult<ModelUsageRow[]>, []),
        memories: settle(
          results[4] as PromiseSettledResult<{ nodes: MemoryRow[]; edges: unknown[] }>,
          { nodes: [], edges: [] },
        ).nodes,
      });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const events = useMemo(() => {
    const list: Event[] = [];
    data.audit.forEach((row, index) => {
      list.push({
        id: `audit-${row.ts}-${index}`,
        at: toMs(row.ts),
        kind: 'tool',
        title: row.tool || '工具调用',
        detail: short(row.result || row.args || '已执行'),
        meta: row.decision || 'AUTO',
      });
    });
    data.conversations.forEach((conversation) => {
      list.push({
        id: `conv-${conversation.id}`,
        at: toMs(conversation.created_at),
        kind: 'conversation',
        title: conversation.title || '未命名会话',
        detail: '新建了一段对话',
        meta: 'SESSION',
      });
    });
    data.memories.forEach((memory, index) => {
      list.push({
        id: `memory-${memory.mem_id || index}`,
        at: 0,
        kind: 'memory',
        title: memory.kind || '记忆',
        detail: short(memory.content, 90),
        meta: 'MEMORY',
      });
    });
    profile.records.forEach((record, index) => {
      list.push({
        id: `game-${record.at}-${index}`,
        at: record.at,
        kind: 'game',
        title: SCORE_META[record.game].label,
        detail: `${SCORE_META[record.game].label} · ${Math.round(record.value)} ${
          SCORE_META[record.game].unit
        }`,
        meta: 'PLAY',
      });
    });
    focusLog.forEach((entry) => {
      list.push({
        id: `focus-${entry.date}`,
        at: new Date(`${entry.date}T12:00:00`).getTime(),
        kind: 'focus',
        title: '专注一段完整时间',
        detail: `${entry.minutes} 分钟没有被打断`,
        meta: 'FOCUS',
      });
    });
    data.usageDaily.forEach((day) => {
      if (!day.calls) return;
      const at = new Date(`${day.day}T23:00:00`).getTime();
      list.push({
        id: `usage-${day.day}`,
        at: Math.min(at, now),
        kind: 'model',
        title: `${day.calls} 次模型调用`,
        detail: `${(day.prompt_tokens + day.completion_tokens).toLocaleString()} tokens`,
        meta: 'MODEL',
      });
    });
    return list.filter((event) => event.at > 0).sort((a, b) => b.at - a.at);
  }, [data, focusLog, profile.records, now]);

  const start = rangeStart(range, now);
  const inRange = useMemo(() => events.filter((event) => event.at >= start), [events, start]);
  const weekEvents = useMemo(() => events.filter((event) => event.at >= rangeStart('week', now)), [events, now]);

  const stats = useMemo(() => {
    const tools = inRange.filter((event) => event.kind === 'tool').length;
    const conversations = inRange.filter((event) => event.kind === 'conversation').length;
    const games =
      range === 'today'
        ? profile.daily.games
        : range === 'year'
          ? profile.stats.games
          : inRange.filter((event) => event.kind === 'game').length;
    const focus =
      range === 'year'
        ? profile.stats.focusMinutes
        : focusLog
            .filter((entry) => new Date(`${entry.date}T12:00:00`).getTime() >= start)
            .reduce((sum, entry) => sum + entry.minutes, 0);
    const modelCalls = data.usageDaily
      .filter((day) => new Date(`${day.day}T23:00:00`).getTime() >= start)
      .reduce((sum, day) => sum + day.calls, 0);
    return { tools, conversations, games, focus, modelCalls, memories: data.memories.length };
  }, [inRange, focusLog, start, data.usageDaily, data.memories.length, range, profile]);

  const week = useMemo(() => {
    const base = startOfDay(now);
    return Array.from({ length: 7 }, (_, index) => {
      const day = base - (6 - index) * DAY;
      const key = dayKey(day);
      const count = weekEvents.filter((event) => dayKey(event.at) === key).length;
      return {
        key,
        label: '日一二三四五六'[new Date(day).getDay()],
        date: new Date(day).getDate(),
        count,
        isToday: key === dayKey(now),
      };
    });
  }, [weekEvents, now]);

  const topTools = useMemo(() => {
    const map = new Map<string, number>();
    data.audit.forEach((row) => {
      map.set(row.tool || 'unknown', (map.get(row.tool || 'unknown') || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [data.audit]);

  const topModels = useMemo(
    () =>
      [...data.usageReport]
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 4)
        .map((row) => `${row.provider}/${row.model}`),
    [data.usageReport],
  );

  const letter = useMemo(() => {
    const tools = weekEvents.filter((event) => event.kind === 'tool').length;
    const games = weekEvents.filter((event) => event.kind === 'game').length;
    const focus = focusLog
      .filter((entry) => new Date(`${entry.date}T12:00:00`).getTime() >= rangeStart('week', now))
      .reduce((sum, entry) => sum + entry.minutes, 0);
    const parts: string[] = [];
    if (tools) parts.push(`${tools} 次工具调用`);
    if (games) parts.push(`${games} 局游戏`);
    if (focus) parts.push(`${focus} 分钟专注`);
    if (parts.length === 0) {
      return '这一周还没有留下太多痕迹。先和 FLUX 说一句话，或者去游戏厅坐一会儿。';
    }
    const tail = topTools[0] ? `最常出现的工具是 ${topTools[0][0]}。` : '';
    return `本周你留下了 ${parts.join('、')}。${tail}下一条记录，可能就在今天。`;
  }, [weekEvents, focusLog, now, topTools]);

  const bars = useMemo(() => {
    const source = data.usageDaily.slice(-14);
    const max = Math.max(1, ...source.map((day) => day.calls));
    return source.map((day) => ({
      key: day.day,
      pct: Math.max(3, (day.calls / max) * 100),
    }));
  }, [data.usageDaily]);

  const viewTitle =
    range === 'today' ? '今天，你留下了这些。' : range === 'week' ? '这一周，事情连成了线。' : '这一年，你走了多远。';

  return (
    <SurfaceFrame
      id="chronicle"
      mark="CHR"
      title="FLUX / 编年史"
      sub="CHRONICLE · LOCAL MEMORY TIMELINE"
      meta={
        <>
          <span>{loading ? 'READING LOCAL DB' : 'SQLITE · LOCAL'}</span>
          <i />
          <span>{inRange.length} EVENTS</span>
        </>
      }
      onClose={onClose}
    >
      <div className="chronicle">
        <main className="chronicle-main">
          <header className="chronicle-head">
            <div>
              <span className="lens-eyebrow">CHRONICLE / {range.toUpperCase()}</span>
              <h1 className="lens-title">{viewTitle}</h1>
              <p className="lens-copy">
                对话、工具、专注、游戏和模型调用，都从本机数据库里来。没有记录的日子，也值得被留下。
              </p>
            </div>
            <div className="chronicle-range">
              <button type="button" className={range === 'today' ? 'is-active' : ''} onClick={() => setRange('today')}>
                今天
              </button>
              <button type="button" className={range === 'week' ? 'is-active' : ''} onClick={() => setRange('week')}>
                本周
              </button>
              <button type="button" className={range === 'year' ? 'is-active' : ''} onClick={() => setRange('year')}>
                今年
              </button>
            </div>
          </header>

          <div className="chronicle-summary">
            <div className="chronicle-stat">
              <span>TOOL CALLS</span>
              <strong>{stats.tools}</strong>
              <em>{range === 'today' ? '今天' : range === 'week' ? '最近 7 天' : '今年'}</em>
            </div>
            <div className="chronicle-stat">
              <span>FOCUS</span>
              <strong>{stats.focus}</strong>
              <em>分钟</em>
            </div>
            <div className="chronicle-stat">
              <span>PLAY</span>
              <strong>{stats.games}</strong>
              <em>局游戏</em>
            </div>
            <div className="chronicle-stat">
              <span>MODEL</span>
              <strong>{stats.modelCalls}</strong>
              <em>次调用</em>
            </div>
          </div>

          <div className="chronicle-days">
            {week.map((day) => (
              <div className={`chronicle-day ${day.isToday ? 'is-today' : ''}`} key={day.key}>
                <span>周{day.label}</span>
                <strong>{String(day.date).padStart(2, '0')}</strong>
                <i><b style={{ width: `${Math.min(100, day.count * 12)}%` }} /></i>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="lens-empty">
              <History size={24} />
              <strong>正在读取本机记录…</strong>
              <p>会话、审计、模型用量和记忆会从 SQLite 里汇到一起。</p>
            </div>
          ) : inRange.length === 0 ? (
            <div className="lens-empty">
              <CalendarDays size={24} />
              <strong>这一段时间还没有记录</strong>
              <p>和 FLUX 说一句话，跑一个工具，或者去 PLAY 玩一局，时间线会自动长出来。</p>
            </div>
          ) : (
            <ol className="chronicle-feed">
              {inRange.slice(0, 120).map((event) => (
                <li className={`chronicle-event ${event.kind === 'tool' ? 'is-live' : ''}`} key={event.id}>
                  <time className="chronicle-time">{whenOf(event.at, range)}</time>
                  <span className="chronicle-icon">{eventIcon(event.kind)}</span>
                  <div className="chronicle-event-copy">
                    <header>
                      <strong>{event.title}</strong>
                      {event.meta && <em>{event.meta}</em>}
                    </header>
                    <p>{event.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </main>

        <aside className="chronicle-rail">
          <section className="chronicle-letter">
            <header>
              <span>WEEKLY LETTER</span>
              <span>{new Date(now).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>
            </header>
            <h3>给这一周的你</h3>
            <p>{letter}</p>
          </section>

          <section className="chronicle-rail-section">
            <header><span>TOP TOOLS</span><em>最近 240 条审计</em></header>
            {topTools.length === 0 ? (
              <p className="lens-muted">还没有工具调用记录。</p>
            ) : (
              topTools.map(([tool, count]) => (
                <div className="chronicle-tool-row" key={tool}>
                  <span>{tool}</span>
                  <i><b style={{ width: `${Math.min(100, count * 5)}%` }} /></i>
                  <em>{count}</em>
                </div>
              ))
            )}
          </section>

          <section className="chronicle-rail-section">
            <header><span>TOP MODELS</span><em>30 DAYS</em></header>
            {topModels.length === 0 ? (
              <p className="lens-muted">还没有模型用量记录。</p>
            ) : (
              topModels.map((model) => (
                <div className="chronicle-tool-row" key={model}>
                  <span>{model}</span>
                </div>
              ))
            )}
          </section>

          <section className="chronicle-year">
            <h3>YEAR IN FLUX</h3>
            <div className="chronicle-year-grid">
              <div><span>CONVERSATIONS</span><strong>{data.conversations.length}</strong></div>
              <div><span>MEMORIES</span><strong>{data.memories.length}</strong></div>
              <div><span>XP</span><strong>{profile.xp.toLocaleString()}</strong></div>
              <div><span>BADGES</span><strong>{profile.unlocked.length}</strong></div>
            </div>
            <div className="chronicle-bars" aria-label="最近 14 天模型调用">
              {bars.length === 0
                ? <span className="lens-muted">没有用量数据</span>
                : bars.map((bar) => <i key={bar.key} style={{ height: `${bar.pct}%` }} />)}
            </div>
            <p className="lens-muted" style={{ marginTop: 8 }}>最近 14 天 · 模型调用</p>
          </section>
        </aside>
      </div>
    </SurfaceFrame>
  );
}
