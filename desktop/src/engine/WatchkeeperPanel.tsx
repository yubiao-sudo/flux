import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * 看护 Agent 面板（只读）。
 *
 * ## 为什么不许编辑
 *
 * 任务的增删改继续由 agent 通过对话完成。界面上能去改一个**正在跑**的任务，
 * 是最容易把自动化搞坏的动作（改一半、与正在执行的实例打架）。
 * 当前真正缺的是「看懂它在盯什么、跑过什么、为什么失败」——这块补上就够了。
 *
 * ## 为什么不改首页
 *
 * 复用现有 overlay（`EnginePanel` 的一个 panel），ESC 收起，
 * 首页仍是单页设计，不新增路由、不占布局。
 */

type Trigger = { kind: string; config: Record<string, unknown> };
type Action = { tool: string; args: Record<string, unknown> };
type Task = {
  id: string;
  name: string;
  enabled: boolean;
  dry_run: boolean;
  triggers: Trigger[];
  actions: Action[];
  retry_max: number;
  retry_backoff_secs: number;
  notify_on: string;
  created_at: number;
  last_run_at: number | null;
  last_result: string | null;
};
type Run = {
  id: string;
  task_id: string;
  task_name: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  result: string;
};
type TriggerKind = { kind: string; label: string; fields: string[]; hint: string };
type SubRun = {
  id: string;
  agent_type: string;
  started_at: number;
  task: string;
  summary: string;
  files_examined: string[];
  success: boolean;
  duration_ms: number;
};

const STATUS_TONE: Record<string, string> = {
  success: 'ok',
  dry_run: 'warn',
  failed: 'err',
};

function stamp(ms?: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 把触发器 config 渲染成人能读的一行 */
function triggerText(t: Trigger): string {
  const cfg = t.config || {};
  const pick = (k: string) => {
    const v = cfg[k];
    return v === undefined || v === null ? '' : String(v);
  };
  switch (t.kind) {
    case 'cron':
      return pick('expr') || '(未设置)';
    case 'interval': {
      const secs = Number(cfg['every_secs'] ?? 0);
      if (!secs) return '(未设置)';
      if (secs % 3600 === 0) return `每 ${secs / 3600} 小时`;
      if (secs % 60 === 0) return `每 ${secs / 60} 分钟`;
      return `每 ${secs} 秒`;
    }
    case 'fs':
      return pick('path') || '(未设置)';
    case 'process':
      return `${pick('name') || '(未设置)'}${pick('state') ? ` · ${pick('state')}` : ''}`;
    case 'threshold': {
      const parts = [pick('source'), pick('op'), pick('value')].filter(Boolean);
      return parts.length ? parts.join(' ') : '(未设置)';
    }
    default:
      return JSON.stringify(cfg).slice(0, 60);
  }
}

export function WatchkeeperPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [kinds, setKinds] = useState<TriggerKind[]>([]);
  const [subRuns, setSubRuns] = useState<SubRun[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (taskId: string) => {
    setBusy(true);
    setError('');
    try {
      const [t, k] = await Promise.all([
        invoke<{ count: number; items: Task[] }>('watchdog_tasks'),
        invoke<TriggerKind[]>('watchdog_trigger_kinds'),
      ]);
      setTasks(t.items ?? []);
      setKinds(k ?? []);
      const focus = taskId || t.items?.[0]?.id || '';
      setSelected(focus);
      const [r, s] = await Promise.all([
        invoke<{ count: number; items: Run[] }>('watchdog_runs', {
          task_id: focus,
          limit: 80,
        }),
        // 子代理记录与看护任务无关，是另一条链路：它回答"我让它查东西时，
        // 它到底搜了什么、读了哪些文件"。放在同一面板是因为都属于"后台在干什么"。
        invoke<{ count: number; items: SubRun[] }>('subagent_runs', { limit: 40 }),
      ]);
      setRuns(r.items ?? []);
      setSubRuns(s.items ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const pick = useCallback(
    async (id: string) => {
      setSelected(id);
      try {
        const r = await invoke<{ count: number; items: Run[] }>('watchdog_runs', {
          task_id: id,
          limit: 80,
        });
        setRuns(r.items ?? []);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  const hintOf = useMemo(() => {
    const map = new Map<string, string>();
    kinds.forEach((k) => map.set(k.kind, k.hint));
    return map;
  }, [kinds]);
  const labelOf = useMemo(() => {
    const map = new Map<string, string>();
    kinds.forEach((k) => map.set(k.kind, k.label));
    return map;
  }, [kinds]);

  const enabledCount = tasks.filter((t) => t.enabled).length;
  const failedCount = runs.filter((r) => r.status === 'failed').length;

  return (
    <div className="watchkeeper">
      <div className="watchkeeper-head">
        <div>
          <span className="watchkeeper-kicker">AUTONOMOUS WATCH</span>
          <h2>看护 Agent</h2>
          <p>
            它在替你盯着：任务满足条件时自动执行动作，失败会按退避重试。
            这里只做查看——新建与修改请直接告诉 FLUX。
          </p>
        </div>
        <div className="watchkeeper-stats">
          <div>
            <b>{tasks.length}</b>
            <span>任务</span>
          </div>
          <div>
            <b>{enabledCount}</b>
            <span>启用中</span>
          </div>
          <div>
            <b className={failedCount ? 'is-bad' : ''}>{failedCount}</b>
            <span>近期失败</span>
          </div>
          <button
            type="button"
            className="ghost sm"
            disabled={busy}
            onClick={() => void load(selected)}
          >
            {busy ? '读取中…' : '刷新'}
          </button>
        </div>
      </div>

      {error && <div className="note err">{error}</div>}

      {tasks.length === 0 ? (
        <div className="watchkeeper-empty">
          <p>还没有看护任务。</p>
          <p className="hint">
            试试对它说：「每 30 分钟检查一次 D:\logs 有没有新错误文件，有就通知我」
            或者「work.exe 退出时提醒我」。
          </p>
        </div>
      ) : (
        <div className="watchkeeper-body">
          <aside className="watchkeeper-list">
            {tasks.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`watchkeeper-task ${selected === t.id ? 'is-selected' : ''}`}
                onClick={() => void pick(t.id)}
              >
                <div className="watchkeeper-task-top">
                  <span className={`wk-dot ${t.enabled ? 'is-on' : ''}`} />
                  <strong>{t.name || t.id}</strong>
                  {t.dry_run && <span className="chip warn">预览</span>}
                </div>
                <div className="watchkeeper-task-meta">
                  {t.triggers.slice(0, 3).map((tr, i) => (
                    <span className="chip" key={i}>
                      {labelOf.get(tr.kind) || tr.kind} · {triggerText(tr)}
                    </span>
                  ))}
                  {t.triggers.length === 0 && <span className="chip err">无触发器</span>}
                </div>
                <div className="watchkeeper-task-foot">
                  <span>{t.actions.length} 个动作</span>
                  <span>{t.last_run_at ? stamp(t.last_run_at) : '未运行'}</span>
                </div>
              </button>
            ))}
          </aside>

          <section className="watchkeeper-detail">
            {(() => {
              const t = tasks.find((x) => x.id === selected);
              if (!t) return <div className="watchkeeper-empty"><p>选择左侧一个任务</p></div>;
              return (
                <>
                  <div className="watchkeeper-detail-head">
                    <h3>{t.name || t.id}</h3>
                    <span className={`chip ${t.enabled ? 'ok' : ''}`}>
                      {t.enabled ? '启用中' : '已暂停'}
                    </span>
                    {t.dry_run && <span className="chip warn">预览模式</span>}
                    <span className="chip">失败重试 {t.retry_max} 次</span>
                    <span className="chip">退避 {t.retry_backoff_secs}s</span>
                    <span className="chip">通知 {t.notify_on}</span>
                  </div>

                  <div className="watchkeeper-section">
                    <h4>触发条件</h4>
                    {t.triggers.length === 0 ? (
                      <p className="hint">无——这个任务永远不会自动运行。</p>
                    ) : (
                      <ul className="watchkeeper-triggers">
                        {t.triggers.map((tr, i) => (
                          <li key={i}>
                            <span className="chip">{labelOf.get(tr.kind) || tr.kind}</span>
                            <code>{triggerText(tr)}</code>
                            {hintOf.get(tr.kind) && (
                              <span className="hint">{hintOf.get(tr.kind)}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="watchkeeper-section">
                    <h4>满足条件后执行</h4>
                    {t.actions.length === 0 ? (
                      <p className="hint">无动作。</p>
                    ) : (
                      <ol className="watchkeeper-actions">
                        {t.actions.map((a, i) => (
                          <li key={i}>
                            <span className="chip violet">{a.tool}</span>
                            <code>{JSON.stringify(a.args).slice(0, 120)}</code>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  {t.last_result && (
                    <div className="watchkeeper-section">
                      <h4>上次结果</h4>
                      <pre className="watchkeeper-result">{t.last_result}</pre>
                    </div>
                  )}

                  <div className="watchkeeper-section">
                    <h4>执行记录（最近 {runs.length} 条）</h4>
                    {runs.length === 0 ? (
                      <p className="hint">还没有运行记录。</p>
                    ) : (
                      <div className="watchkeeper-runs">
                        {runs.map((r) => (
                          <div className="watchkeeper-run" key={r.id}>
                            <span className={`chip ${STATUS_TONE[r.status] || ''}`}>
                              {r.status}
                            </span>
                            <span className="mono">{stamp(r.started_at)}</span>
                            {r.finished_at && (
                              <span className="hint">
                                耗时 {Math.max(0, Math.round((r.finished_at - r.started_at) / 1000))}s
                              </span>
                            )}
                            <pre>{r.result || '(无输出)'}</pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* 子代理记录：回答"我让它查东西时，它到底搜了什么、读了哪些文件"。
                与上面的看护任务无关，是另一条后台链路，所以单独一栏。 */}
            <div className="watchkeeper-section">
              <h4>子代理记录（最近 {subRuns.length} 条）</h4>
              {subRuns.length === 0 ? (
                <p className="hint">
                  还没有子代理运行记录。当任务需要大范围搜索或并行探查时，
                  FLUX 会派子代理去做，这里能看到每一次的结论与翻过的文件。
                </p>
              ) : (
                <div className="watchkeeper-runs">
                  {subRuns.map((s) => (
                    <div className="watchkeeper-run" key={s.id}>
                      <span className={`chip ${s.success ? 'ok' : 'err'}`}>
                        {s.success ? '完成' : '失败'}
                      </span>
                      <span className="chip violet">{s.agent_type}</span>
                      <span className="mono">{stamp(s.started_at)}</span>
                      <span className="hint">{Math.round(s.duration_ms / 1000)}s</span>
                      <pre>{String(s.summary || '').slice(0, 400)}</pre>
                      {Array.isArray(s.files_examined) && s.files_examined.length > 0 && (
                        <div className="hint" style={{ flexBasis: '100%', marginTop: 2 }}>
                          翻过 {s.files_examined.length} 个位置：
                          <span className="mono"> {s.files_examined.slice(0, 8).join(' · ')}</span>
                          {s.files_examined.length > 8 ? ' …' : ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
