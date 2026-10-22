import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  FolderPlus,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import * as api from './api';
import { reactiveSpeak, speakWithCloud } from './voiceReactive';
import {
  forceUnlockAudio,
  getNotifyStyle,
  getSfxVolume,
  isSfxEnabled,
  playSfx,
  previewNotify,
  setNotifyStyle,
  setSfxEnabled,
  setSfxVolume,
  sfxDiagnostics,
  type NotifyStyle,
  type SfxEvent,
} from './utils/sound';
import type {
  AuditRow,
  ModelUsageDayRow,
  ModelUsageRow,
  QuickCommand,
  TtsConfig,
  UpdateInfo,
} from './api';
import type { FluxEngine } from './useFluxEngine';
import type {
  DbConnection,
  DiskInfo,
  DocumentDepsReport,
  EnvCheckResult,
  EnvItem,
  ImChannelInfo,
  ImLogEntry,
  ExecutionRecord,
  FeishuStatus,
  GenerateTestCasesResult,
  GatewayConfig,
  GatewayStatus,
  ImageCapability,
  KbConfig,
  KbMeta,
  McpConfig,
  MeetingParticipant,
  NotifyConfig,
  MeetingUtterance,
  ModelAnswer,
  PlazaItem,
  Project,
  ProjectProfile,
  RagAnswer,
  RagDoc,
  RuntimeConfig,
  ScheduledJob,
  SoftwarePackage,
  SoftwareSearchResult,
  SystemConfig,
  TeamEntry,
  TestRunSelectedResult,
  TokenSaverConfig,
  WeChatStatus,
  Workflow,
  WorkModeInfo,
  WorkModeState,
} from './types';

type TabId = 'automation' | 'studio' | 'projects' | 'tests' | 'software';

export type SystemsTabId = TabId;

/**
 * Engine Control is the operation surface only.
 *
 * Configuration lives in the Settings Deck (one page, five categories). These
 * tabs used to duplicate Security / Connectors / Runtime / System, which made
 * the app look like it had two independent settings pages with two copies of
 * the same persisted values.
 */
const TABS: Array<{ id: TabId; label: string; meta: string }> = [
  { id: 'automation', label: 'AUTOMATION', meta: 'SCHEDULE · WORKFLOW · PLAZA' },
  { id: 'studio', label: 'STUDIO', meta: 'COMPARE · MEETING · TEAM' },
  { id: 'projects', label: 'PROJECTS', meta: 'WORKSPACE · COMMANDS' },
  { id: 'tests', label: 'TEST LAB', meta: 'CASES · RUN · RECORDS' },
  { id: 'software', label: 'SOFTWARE', meta: 'SEARCH · INSTALL · REMOVE' },
];

const fmtDate = (value: number | null | undefined) => {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fmtImTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const SECTION_TITLES: Record<string, string> = {
  'AUDIT LOG': '审计日志',
  'BACKGROUND TASKS': '后台任务',
  'BOT QR': '机器人二维码',
  CHANNELS: '消息通道',
  'CONTROLLED BROWSER': '受控浏览器',
  'DATABASE LINKS': '数据库连接',
  'DOCUMENT PARSERS': '文档解析',
  'ENVIRONMENT CHECK': '环境检测',
  ENVIRONMENT: '运行环境',
  'ESCALATION NOTIFY': '升级通知',
  'GENERATE CASES': '生成用例',
  'IMAGE / UPDATE': '图像 / 更新',
  'IMAGE GENERATION': '图片生成',
  'INSTALLED SOFTWARE': '已安装软件',
  'KNOWLEDGE / RAG': '知识 / RAG',
  'LOCAL GATEWAY': '本地网关',
  MACHINE: '机器',
  'MCP SERVER': 'MCP 服务器',
  'MESSAGE BUS': '消息总线',
  'MODEL COMPARE': '模型对比',
  'MODEL USAGE': '模型用量',
  'NIGHTLY MEMORY DIGEST': '夜间记忆整理',
  'PERMISSION POLICY': '权限策略',
  'PERMISSION RULES': '权限规则',
  PLAZA: '任务广场',
  PROJECTS: '项目',
  'QUICK COMMANDS': '快捷指令',
  'REMOTE KNOWLEDGE BASE': '远程知识库',
  'RUN RESULT': '执行结果',
  SCHEDULES: '定时任务',
  'SOFTWARE SEARCH': '软件搜索',
  'TEST PROJECT': '测试项目',
  'TOKEN SAVER': 'Token 节省',
  'VISION / EMBEDDING': '视觉 / 向量',
  'VOICE / TTS': '语音朗读',
  'WORK MODE': '工作模式',
  WORKFLOWS: '工作流',
  'MEETING ROOM': '会议室',
  TEAMWORK: '协作',
};

function SectionHead({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <header className="systems-section-head">
      <div>
        <span>{SECTION_TITLES[title] ?? title}</span>
        {meta && <small>{meta}</small>}
      </div>
      {action}
    </header>
  );
}

/**
 * 界面音效设置。
 *
 * 主界面此前完全没有音效入口：设置页里那套「提示音」控件只存在于未被引用的
 * SettingsModal（死代码），而主界面走的是 EnginePanels，所以用户既听不到声音、
 * 也找不到开关。这里把音效真正接到用户能看见的地方：
 * 开关、音量、三种质感、逐事件试听。
 */
function SoundSettingsSection() {
  const [on, setOn] = useState(isSfxEnabled);
  const [vol, setVol] = useState(getSfxVolume);
  const [style, setStyle] = useState<NotifyStyle>(getNotifyStyle);
  const [diag, setDiag] = useState(sfxDiagnostics);

  // 定时刷新诊断，用户点完试听能立刻看到状态变化
  useEffect(() => {
    const t = setInterval(() => setDiag(sfxDiagnostics()), 1000);
    return () => clearInterval(t);
  }, []);

  const samples: Array<{ k: SfxEvent; label: string }> = [
    { k: 'message-sent', label: '发出消息' },
    { k: 'task-done', label: '任务完成' },
    { k: 'signal-attention', label: '通知信号' },
    { k: 'notify', label: '提醒弹窗' },
    { k: 'permission', label: '等待审批' },
    { k: 'error', label: '出错' },
    { k: 'voice-wake', label: '语音唤醒' },
  ];

  return (
    <section className="systems-section">
      <SectionHead title="INTERFACE SOUND" meta="CHIME · VOLUME · STYLE" />
      <div className="systems-checks">
        <label className="systems-check">
          <input
            type="checkbox"
            checked={on}
            onChange={(event) => {
              const next = event.target.checked;
              setOn(next);
              setSfxEnabled(next);
              if (next) playSfx('notify');
            }}
          />
          启用界面音效
        </label>
      </div>

      <div className="systems-field">
        <label>
          音量 · {Math.round(vol * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(vol * 100)}
            onChange={(event) => {
              const v = Number(event.target.value) / 100;
              setVol(v);
              setSfxVolume(v);
            }}
            onMouseUp={() => playSfx('notify')}
            onTouchEnd={() => playSfx('notify')}
          />
        </label>
      </div>

      <div className="systems-checks">
        {(['windchime', 'arp', 'soft'] as NotifyStyle[]).map((s) => (
          <label className="systems-check" key={s}>
            <input
              type="radio"
              name="sfx-style"
              checked={style === s}
              onChange={() => {
                setStyle(s);
                setNotifyStyle(s);
                previewNotify(s);
              }}
            />
            {s === 'windchime' ? '玻璃' : s === 'arp' ? '脉冲' : '轻触'}
          </label>
        ))}
      </div>

      <div className="systems-checks">
        {samples.map((s) => (
          <button
            key={s.k}
            type="button"
            className="control-button"
            onClick={() => {
              // 点击本身就是用户手势：先强制解锁，再播放
              forceUnlockAudio();
              playSfx(s.k);
              setTimeout(() => setDiag(sfxDiagnostics()), 120);
            }}
          >
            <Play size={11} /> {s.label}
          </button>
        ))}
      </div>

      {/* 诊断：一眼看出「听不到」卡在哪一层 */}
      <p className="systems-note">
        状态：{diag.supported ? 'AudioContext 可用' : '不可用'} · {diag.state}
        {diag.unlocked ? ' · 已解锁' : ' · 未解锁（点任意按钮即可解锁）'}
        {diag.pending > 0 ? ` · 待补播 ${diag.pending}` : ''}
        {diag.sampleRate ? ` · ${diag.sampleRate}Hz` : ''}
        {' · '}音量 {Math.round(diag.volume * 100)}%{' · '}
        {diag.enabled ? '开关已开' : '开关已关'}
        <br />
        听不到声音时先点上面的按钮试听；仍无声请检查系统音量与输出设备。
        通知到达时使用 FLUX SIGNAL 音（INFO / ATTENTION / CRITICAL 三档），
        上面的「玻璃/脉冲/轻触」只影响普通提醒弹窗。界面音效全部由 FLUX 玻璃音合成，
        不需要额外音频文件。
      </p>
    </section>
  );
}

function AutomationTab() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [plaza, setPlaza] = useState<PlazaItem[]>([]);
  const [tasks, setTasks] = useState<
    Array<{
      id: string;
      description: string;
      status: string;
      error?: string | null;
      retries?: number;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [schedule, setSchedule] = useState({
    title: '',
    cron: '0 9 * * *',
    type: 'agent',
    task: '',
  });
  const [workflowInput, setWorkflowInput] = useState('');
  const [workflowOutput, setWorkflowOutput] = useState('');

  const load = async () => {
    setBusy(true);
    try {
      const [nextJobs, nextWorkflows, nextPlaza, nextTasks] = await Promise.all([
        api.scheduleListJobs(),
        api.workflowList(),
        api.plazaList(),
        invoke<Array<{ id: string; description: string; status: string; error?: string | null; retries?: number }>>(
          'list_tasks',
        ).catch(() => []),
      ]);
      setJobs(nextJobs);
      setWorkflows(nextWorkflows);
      setPlaza(nextPlaza);
      setTasks(nextTasks);
      setNote('');
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead
          title="SCHEDULES"
          meta={`${jobs.length} TIMED JOBS`}
          action={
            <button type="button" className="text-action" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={11} /> rescan
            </button>
          }
        />
        <div className="systems-table">
          {jobs.map((job) => (
            <div className="systems-row" key={job.id}>
              <button
                type="button"
                className={`systems-toggle ${job.enabled ? 'is-on' : ''}`}
                onClick={async () => {
                  await api.scheduleSetEnabled(job.id, !job.enabled);
                  await load();
                }}
                aria-label={job.enabled ? '暂停任务' : '启用任务'}
              >
                {job.enabled ? <Check size={10} /> : <X size={10} />}
              </button>
              <span className="systems-main">
                <strong>{job.title}</strong>
                <small>
                  {job.cron_expr} · {job.task_type} · last {fmtDate(job.last_run_at)}
                </small>
              </span>
              <button
                type="button"
                className="systems-icon"
                onClick={async () => {
                  await api.scheduleDeleteJob(job.id);
                  await load();
                }}
                aria-label="删除定时任务"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {jobs.length === 0 && <div className="systems-empty-inline">没有定时任务</div>}
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!schedule.title.trim() || !schedule.task.trim()) return;
            setBusy(true);
            try {
              await api.scheduleAddJob(
                schedule.cron,
                schedule.title,
                schedule.type,
                schedule.task,
              );
              setSchedule({ ...schedule, title: '', task: '' });
              await load();
              setNote('已创建定时任务');
            } catch (e) {
              setNote(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            value={schedule.title}
            onChange={(event) => setSchedule({ ...schedule, title: event.target.value })}
            placeholder="任务名"
            aria-label="定时任务名称"
          />
          <input
            value={schedule.cron}
            onChange={(event) => setSchedule({ ...schedule, cron: event.target.value })}
            placeholder="cron 0 9 * * *"
            aria-label="cron 表达式"
            spellCheck={false}
          />
          <select
            value={schedule.type}
            onChange={(event) => setSchedule({ ...schedule, type: event.target.value })}
            aria-label="任务类型"
          >
            <option value="agent">agent</option>
            <option value="command">command</option>
          </select>
          <input
            className="span-two"
            value={schedule.task}
            onChange={(event) => setSchedule({ ...schedule, task: event.target.value })}
            placeholder="自然语言任务或 PowerShell 命令"
            aria-label="任务内容"
          />
          <button type="submit" className="control-button" disabled={busy}>
            <Plus size={11} /> add job
          </button>
        </form>
      </section>

      <section className="systems-section">
        <SectionHead title="WORKFLOWS" meta={`${workflows.length} ORCHESTRATIONS`} />
        <div className="systems-table">
          {workflows.map((workflow) => (
            <div className="systems-row" key={workflow.id}>
              <span className="systems-badge">{workflow.stages.length} STAGES</span>
              <span className="systems-main">
                <strong>{workflow.name}</strong>
                <small>{workflow.description || '没有描述'}</small>
              </span>
              <button
                type="button"
                className="systems-action"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await api.workflowRun(workflow.id, workflowInput);
                    setWorkflowOutput(result);
                    setNote(`工作流 ${workflow.name} 已完成`);
                  } catch (e) {
                    setNote(errText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                <Play size={10} /> run
              </button>
            </div>
          ))}
          {workflows.length === 0 && (
            <div className="systems-empty-inline">还没有工作流。可以用 Agent 创建，或从广场安装。</div>
          )}
        </div>
        <div className="systems-runbar">
          <input
            value={workflowInput}
            onChange={(event) => setWorkflowInput(event.target.value)}
            placeholder="传给工作流的输入 / 主题…"
            aria-label="工作流输入"
          />
        </div>
        {workflowOutput && <pre className="systems-output">{workflowOutput}</pre>}
      </section>

      <section className="systems-section">
        <SectionHead title="PLAZA" meta={`${plaza.length} CAPABILITY ITEMS`} />
        <div className="systems-table">
          {plaza.slice(0, 30).map((item) => (
            <div className="systems-row" key={item.id}>
              <span className="systems-badge">{item.kind}</span>
              <span className="systems-main">
                <strong>{item.name}</strong>
                <small>
                  {item.source} · {item.trust} · {item.description || '没有描述'}
                </small>
              </span>
              {item.callable && (
                <button
                  type="button"
                  className="systems-action"
                  onClick={async () => {
                    try {
                      const result = await api.plazaRun(item.name, {});
                      setWorkflowOutput(
                        typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                      );
                      setNote(`已运行 ${item.name}`);
                    } catch (e) {
                      setNote(errText(e));
                    }
                  }}
                >
                  <Play size={10} /> run
                </button>
              )}
            </div>
          ))}
          {plaza.length === 0 && <div className="systems-empty-inline">广场为空</div>}
        </div>
      </section>
      <section className="systems-section">
        <SectionHead title="BACKGROUND TASKS" meta={`${tasks.length} QUEUED / RETRYABLE`} />
        <div className="systems-table">
          {tasks.map((task) => (
            <div className="systems-row" key={task.id}>
              <span className="systems-badge">{task.status}</span>
              <span className="systems-main">
                <strong>{task.description}</strong>
                <small>
                  {task.id.slice(0, 12)}
                  {task.error ? ` · ${task.error}` : ''}
                  {task.retries ? ` · retry ${task.retries}` : ''}
                </small>
              </span>
              {['pending', 'running', 'retrying'].includes(task.status) && (
                <button
                  type="button"
                  className="systems-action"
                  onClick={async () => {
                    await invoke('cancel_task', { id: task.id });
                    await load();
                  }}
                >
                  <X size={10} /> cancel
                </button>
              )}
            </div>
          ))}
          {tasks.length === 0 && (
            <div className="systems-empty-inline">没有后台任务。Agent 可以把长任务放进队列。</div>
          )}
        </div>
      </section>
      <div className="systems-note">{note || '所有自动化都留在本机执行。'}</div>
    </div>
  );
}

export function SecurityTab() {
  const [rules, setRules] = useState<Array<[string, boolean]>>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [ruleKey, setRuleKey] = useState('');
  const [allowed, setAllowed] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [policyText, setPolicyText] = useState('');
  const [policyBusy, setPolicyBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const [nextRules, nextAudit, nextPolicy] = await Promise.all([
        api.listPermissionRules(),
        api.queryAuditLog(80),
        invoke<unknown>('permission_policy_get').catch(() => null),
      ]);
      setRules(nextRules);
      setAudit(nextAudit);
      if (nextPolicy) setPolicyText(JSON.stringify(nextPolicy, null, 2));
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead
          title="PERMISSION RULES"
          meta={`${rules.length} LONG-LIVED DECISIONS`}
          action={
            <button type="button" className="text-action" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={11} /> rescan
            </button>
          }
        />
        <div className="systems-table">
          {rules.map(([key, isAllowed]) => (
            <div className="systems-row" key={key}>
              <span className={`systems-badge ${isAllowed ? 'is-allow' : 'is-deny'}`}>
                {isAllowed ? 'ALLOW' : 'DENY'}
              </span>
              <span className="systems-main">
                <strong className="mono-key">{key}</strong>
              </span>
              <button
                type="button"
                className="systems-icon"
                onClick={async () => {
                  await api.deletePermissionRule(key);
                  await load();
                }}
                aria-label="删除权限规则"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {rules.length === 0 && <div className="systems-empty-inline">还没有长期规则</div>}
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!ruleKey.trim()) return;
            await api.setPermissionRule(ruleKey.trim(), allowed);
            setRuleKey('');
            await load();
            setNote('已保存权限规则');
          }}
        >
          <input
            value={ruleKey}
            onChange={(event) => setRuleKey(event.target.value)}
            placeholder="工具名或 工具|参数指纹"
            aria-label="权限规则 key"
          />
          <select
            value={allowed ? 'allow' : 'deny'}
            onChange={(event) => setAllowed(event.target.value === 'allow')}
            aria-label="权限规则动作"
          >
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>
          <button type="submit" className="control-button" disabled={busy}>
            <Plus size={11} /> add rule
          </button>
        </form>
      </section>

      <section className="systems-section">
        <SectionHead
          title="PERMISSION POLICY"
          meta="ADVANCED JSON · TOOL / CLASS / DEFAULT"
          action={
            <button
              type="button"
              className="text-action"
              onClick={async () => {
                setPolicyBusy(true);
                try {
                  await invoke('permission_policy_set', {
                    policy: JSON.parse(policyText),
                  });
                  setNote('权限策略已保存');
                } catch (e) {
                  setNote(errText(e));
                } finally {
                  setPolicyBusy(false);
                }
              }}
              disabled={policyBusy}
            >
              save policy
            </button>
          }
        />
        <textarea
          className="systems-policy"
          value={policyText}
          onChange={(event) => setPolicyText(event.target.value)}
          placeholder={'{\n  "tool_rules": {},\n  "class_rules": {},\n  "default": "ask"\n}'}
          spellCheck={false}
          aria-label="权限策略 JSON"
        />
      </section>

      <section className="systems-section">
        <SectionHead title="AUDIT LOG" meta={`${audit.length} RECENT EVENTS`} />
        <div className="systems-audit">
          {audit.map((row, index) => (
            <div className="systems-audit-row" key={`${row.ts}-${index}`}>
              <span className="systems-time">{fmtDate(row.ts)}</span>
              <span className={`systems-badge ${row.decision === 'allowed' ? 'is-allow' : 'is-deny'}`}>
                {row.decision}
              </span>
              <strong>{row.tool}</strong>
              <small>{row.args}</small>
            </div>
          ))}
          {audit.length === 0 && <div className="systems-empty-inline">审计日志为空</div>}
        </div>
      </section>
      <div className="systems-note">{note || '危险动作会在这里留下不可篡改的本地记录。'}</div>
    </div>
  );
}

export function ConnectorsTab({ engine }: { engine: FluxEngine }) {
  const [mcp, setMcp] = useState<McpConfig | null>(null);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [gatewayConfig, setGatewayConfig] = useState<GatewayConfig>({
    enabled: false,
    port: 11436,
    token: '',
  });
  const [imChannels, setImChannels] = useState<ImChannelInfo[]>([]);
  const [imLog, setImLog] = useState<ImLogEntry[]>([]);
  const [imBusy, setImBusy] = useState(false);
  const [rag, setRag] = useState<RagDoc[]>([]);
  const [wechat, setWechat] = useState<WeChatStatus | null>(null);
  const [feishu, setFeishu] = useState<FeishuStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [args, setArgs] = useState('');
  const [ragQuery, setRagQuery] = useState('');
  const [ragAnswer, setRagAnswer] = useState<RagAnswer | null>(null);
  const [wechatQr, setWechatQr] = useState('');
  const [wechatBusy, setWechatBusy] = useState(false);
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuSecret, setFeishuSecret] = useState('');
  const [feishuBusy, setFeishuBusy] = useState(false);
  const [browserPath, setBrowserPath] = useState<{
    custom: string | null;
    resolved: string | null;
    found: boolean;
  } | null>(null);
  const [browserInput, setBrowserInput] = useState('');
  const [dbConnections, setDbConnections] = useState<DbConnection[]>([]);
  const [dbName, setDbName] = useState('');
  const [dbConn, setDbConn] = useState('');
  const [kb, setKb] = useState<KbConfig | null>(null);
  const [kbItems, setKbItems] = useState<KbMeta[]>([]);
  const [kbCode, setKbCode] = useState('');
  const [kbBusy, setKbBusy] = useState(false);

  const load = () => {
    // Probe each connector independently: a slow MCP/KB/network endpoint must
    // never leave the entire Connectors tab stuck in a loading state.
    void api
      .getMcpConfig()
      .then((next) => {
        setMcp(next);
        setArgs(next.args.join(' '));
      })
      .catch((e) => setNote(errText(e)));
    void api
      .getGatewayStatus()
      .then((next) => {
        setGateway(next);
        setGatewayConfig({ enabled: next.enabled, port: next.port, token: '' });
      })
      .catch(() => undefined);
    void api.getRagState().then(setRag).catch(() => undefined);
    void api.getImChannels().then(setImChannels).catch(() => undefined);
    void api.getImLog().then(setImLog).catch(() => undefined);
    void api.getWechatStatus().then(setWechat).catch(() => undefined);
    void api
      .getFeishuStatus()
      .then((next) => {
        setFeishu(next);
        setFeishuAppId(next?.app_id || '');
      })
      .catch(() => undefined);
    void api
      .getBrowserPathSetting()
      .then((next) => {
        setBrowserPath(next);
        setBrowserInput(next?.custom || '');
      })
      .catch(() => undefined);
    void api.getDbConnections().then(setDbConnections).catch(() => undefined);
    void api.kbConfigGet().then(setKb).catch(() => undefined);
    void api
      .kbList()
      .then((next) => setKbItems(next?.items ?? []))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void api
      .onWechatQr((url) => {
        if (!disposed) setWechatQr(url);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead
          title="MCP SERVER"
          meta="MODEL CONTEXT PROTOCOL"
          action={
            <button type="button" className="text-action" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={11} /> rescan
            </button>
          }
        />
        {mcp && (
          <form
            className="systems-form systems-form--mcp"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                const saved = await api.setMcpConfig({
                  ...mcp,
                  args: args.split(/\s+/).filter(Boolean),
                });
                setMcp(saved);
                setArgs(saved.args.join(' '));
                await engine.refreshEngineInfo();
                setNote('MCP 已更新，能力列表已刷新');
              } catch (e) {
                setNote(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="systems-check">
              <input
                type="checkbox"
                checked={mcp.enabled}
                onChange={(event) => setMcp({ ...mcp, enabled: event.target.checked })}
              />
              enabled
            </label>
            <input
              value={mcp.command}
              onChange={(event) => setMcp({ ...mcp, command: event.target.value })}
              placeholder="npx"
              aria-label="MCP 命令"
              spellCheck={false}
            />
            <input
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem C:\\"
              aria-label="MCP 参数"
              spellCheck={false}
            />
            <button type="submit" className="control-button" disabled={busy}>
              save mcp
            </button>
          </form>
        )}
        {!mcp && <div className="systems-empty-inline">读取 MCP 配置中…</div>}
      </section>

      <section className="systems-section">
        <SectionHead title="LOCAL GATEWAY" meta="OPENAI-COMPATIBLE ENDPOINT" />
        <div className="systems-status-grid">
          <div>
            <span>STATE</span>
            <strong>{gateway?.enabled ? 'RUNNING' : 'STOPPED'}</strong>
            <small>{gateway?.base_url || 'not configured'}</small>
          </div>
          <div>
            <span>PORT</span>
            <strong>{gateway?.port ?? '—'}</strong>
            <small>{gateway?.has_token ? 'token enabled' : 'no token'}</small>
          </div>
          <div className="systems-status-actions">
            <button
              type="button"
              className="control-button"
              disabled={busy}
              onClick={async () => {
                try {
                  const next = gateway?.enabled ? await api.gatewayStop() : await api.gatewayStart();
                  setGateway(next);
                } catch (e) {
                  setNote(errText(e));
                }
              }}
            >
              {gateway?.enabled ? 'stop' : 'start'}
            </button>
          </div>
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const next = await api.setGatewayConfig({
                ...gatewayConfig,
                enabled: gateway?.enabled ?? gatewayConfig.enabled,
              });
              setGateway(next);
              setNote('网关配置已保存');
            } catch (e) {
              setNote(errText(e));
            }
          }}
        >
          <label className="systems-field">
            <span>PORT</span>
            <input
              type="number"
              min={1024}
              max={65535}
              value={gatewayConfig.port}
              onChange={(event) =>
                setGatewayConfig({
                  ...gatewayConfig,
                  port: Number(event.target.value) || 0,
                })
              }
              aria-label="网关端口"
            />
          </label>
          <label className="systems-field">
            <span>ACCESS TOKEN</span>
            <input
              type="password"
              value={gatewayConfig.token}
              onChange={(event) =>
                setGatewayConfig({ ...gatewayConfig, token: event.target.value })
              }
              placeholder={gateway?.has_token ? '留空会清除现有 token' : '不校验可留空'}
              aria-label="网关 token"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="control-button" disabled={busy}>
            save gateway
          </button>
        </form>
      </section>

      <section className="systems-section">
        <SectionHead title="CHANNELS" meta="WECHAT · FEISHU" />
        <div className="systems-channel-grid">
          <div className="systems-channel-card">
            <span>WECHAT</span>
            <strong>{wechat?.status || 'unknown'}</strong>
            <small>{wechat?.connected ? 'connected' : 'scan the QR to connect'}</small>
            <div className="systems-inline-actions">
              {!wechat?.connected ? (
                <button
                  type="button"
                  className="control-button"
                  disabled={wechatBusy}
                  onClick={async () => {
                    setWechatBusy(true);
                    setWechatQr('');
                    try {
                      const next = await api.wechatLogin();
                      setWechat(next);
                      setWechatQr('');
                      setNote(next.connected ? '微信已连接' : '微信登录未完成');
                    } catch (e) {
                      setNote(errText(e));
                    } finally {
                      setWechatBusy(false);
                    }
                  }}
                >
                  {wechatBusy ? 'waiting for scan…' : 'connect wechat'}
                </button>
              ) : (
                <button
                  type="button"
                  className="control-button"
                  onClick={async () => setWechat(await api.wechatStop())}
                >
                  disconnect
                </button>
              )}
            </div>
            {wechatQr && (
              <img
                className="systems-qr"
                src={wechatQr}
                alt="WeChat login QR"
                draggable={false}
              />
            )}
          </div>

          <div className="systems-channel-card">
            <span>FEISHU</span>
            <strong>{feishu?.status || 'unknown'}</strong>
            <small>{feishu?.app_id ? `app ${feishu.app_id}` : 'no credentials'}</small>
            <form
              className="systems-feishu"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!feishuAppId.trim() || !feishuSecret.trim()) return;
                setFeishuBusy(true);
                try {
                  const saved = await api.feishuSaveCredentials(feishuAppId.trim(), feishuSecret);
                  setFeishu(saved);
                  setFeishuSecret('');
                  const started = await api.feishuStart();
                  setFeishu(started);
                  setNote('飞书连接已启动');
                } catch (e) {
                  setNote(errText(e));
                } finally {
                  setFeishuBusy(false);
                }
              }}
            >
              <input
                value={feishuAppId}
                onChange={(event) => setFeishuAppId(event.target.value)}
                placeholder="app_id"
                aria-label="飞书 app_id"
                spellCheck={false}
              />
              <input
                type="password"
                value={feishuSecret}
                onChange={(event) => setFeishuSecret(event.target.value)}
                placeholder="app_secret"
                aria-label="飞书 app_secret"
                spellCheck={false}
              />
              <div className="systems-inline-actions">
                <button type="submit" className="control-button" disabled={feishuBusy}>
                  save + start
                </button>
                {feishu?.connected && (
                  <button
                    type="button"
                    className="control-button"
                    onClick={async () => setFeishu(await api.feishuStop())}
                  >
                    stop
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className="systems-section">
        <SectionHead title="BOT QR" meta="WECHAT · SCAN TO COMMAND" />
        <div className="systems-qr-panel">
          <div>
            <span>WECHAT BOT</span>
            <strong>{wechat?.connected ? 'CONNECTED' : wechat?.status || 'NOT CONNECTED'}</strong>
            <small>
              {wechat?.connected
                ? '已连接。扫码登录会复用同一账号，不需要重复扫码。'
                : '用手机微信扫码后，可以直接在微信里给 FLUX 发指令。'}
            </small>
            <div className="systems-inline-actions">
              {!wechat?.connected ? (
                <button
                  type="button"
                  className="control-button"
                  disabled={wechatBusy}
                  onClick={async () => {
                    setWechatBusy(true);
                    setWechatQr('');
                    try {
                      const next = await api.wechatLogin();
                      setWechat(next);
                      setWechatQr('');
                    } catch (e) {
                      setNote(errText(e));
                    } finally {
                      setWechatBusy(false);
                    }
                  }}
                >
                  {wechatBusy ? 'waiting for scan…' : 'generate login QR'}
                </button>
              ) : (
                <button
                  type="button"
                  className="control-button"
                  onClick={async () => {
                    setWechat(await api.wechatLogout());
                    setWechatQr('');
                  }}
                >
                  logout bot
                </button>
              )}
            </div>
          </div>
          <div className="systems-qr-frame">
            {wechatQr ? (
              <img
                className="systems-qr systems-qr--large"
                src={wechatQr}
                alt="WeChat bot login QR"
                draggable={false}
              />
            ) : (
              <div className="systems-qr-placeholder">
                <QrCode size={30} />
                <span>{wechat?.connected ? 'CONNECTED' : 'QR APPEARS HERE'}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="systems-section">
        <SectionHead
          title="MESSAGE BUS"
          meta={`${imLog.filter((item) => item.direction === 'in').length} IN · ${imLog.filter((item) => item.direction === 'out').length} OUT`}
          action={
            <button
              type="button"
              className="text-action"
              disabled={imBusy}
              onClick={async () => {
                setImBusy(true);
                try {
                  const [channels, log] = await Promise.all([
                    api.getImChannels(),
                    api.getImLog(),
                  ]);
                  setImChannels(channels);
                  setImLog(log);
                } catch (e) {
                  setNote(errText(e));
                } finally {
                  setImBusy(false);
                }
              }}
            >
              <RefreshCw size={11} /> refresh bus
            </button>
          }
        />
        <div className="systems-channel-grid">
          {imChannels.map((channel) => (
            <div className="systems-channel-card" key={channel.id}>
              <span>{channel.label.toUpperCase()}</span>
              <strong>{channel.connected ? 'CONNECTED' : 'OFFLINE'}</strong>
              <small>{channel.status || 'no runtime state'}</small>
            </div>
          ))}
          {imChannels.length === 0 && (
            <div className="systems-empty-inline">消息总线没有可用通道。</div>
          )}
        </div>
        <div className="systems-table systems-im-log">
          {[...imLog].reverse().slice(0, 40).map((entry, index) => (
            <div className="systems-row" key={`${entry.ts}-${index}`}>
              <span
                className={`systems-badge ${entry.direction === 'in' ? 'is-allow' : ''}`}
              >
                {entry.direction === 'in' ? 'IN' : 'OUT'}
              </span>
              <span className="systems-main">
                <strong>{entry.text}</strong>
                <small>
                  {entry.channel_label} · {entry.peer || 'unknown peer'}
                </small>
              </span>
              <span className="systems-im-time">{fmtImTime(entry.ts)}</span>
            </div>
          ))}
          {imLog.length === 0 && (
            <div className="systems-empty-inline">暂无 IM 收发记录。微信/飞书收到指令或回传结果后会出现在这里。</div>
          )}
        </div>
      </section>

      <section className="systems-section">
        <SectionHead title="CONTROLLED BROWSER" meta="CHROME / EDGE EXECUTABLE" />
        <div className="systems-status-grid">
          <div>
            <span>RESOLVED</span>
            <strong>{browserPath?.found ? 'FOUND' : 'NOT FOUND'}</strong>
            <small>{browserPath?.resolved || 'auto-detect has not found a browser'}</small>
          </div>
          <div>
            <span>OVERRIDE</span>
            <strong>{browserPath?.custom ? 'CUSTOM' : 'AUTO'}</strong>
            <small>{browserPath?.custom || 'using auto detection'}</small>
          </div>
          <div className="systems-status-actions">
            <button
              type="button"
              className="control-button"
              onClick={async () => {
                const result = await api.setBrowserPathSetting(browserInput.trim());
                setBrowserPath({
                  custom: browserInput.trim() || null,
                  resolved: result.resolved,
                  found: Boolean(result.resolved),
                });
                setNote(result.ok ? '浏览器路径已保存' : result.error || result.note || '路径无效');
              }}
            >
              save browser
            </button>
          </div>
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await api.setBrowserPathSetting(browserInput.trim());
            setBrowserPath({
              custom: browserInput.trim() || null,
              resolved: result.resolved,
              found: Boolean(result.resolved),
            });
            setNote(result.ok ? '浏览器路径已保存' : result.error || result.note || '路径无效');
          }}
        >
          <input
            className="span-two"
            value={browserInput}
            onChange={(event) => setBrowserInput(event.target.value)}
            placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe（留空自动探测）"
            aria-label="浏览器路径"
            spellCheck={false}
          />
          <button type="submit" className="control-button">
            set path
          </button>
        </form>
      </section>

      <section className="systems-section">
        <SectionHead title="DATABASE LINKS" meta={`${dbConnections.length} SAVED CONNECTIONS`} />
        <div className="systems-table">
          {dbConnections.map((item) => (
            <div className="systems-row" key={item.name}>
              <span className="systems-badge">DB</span>
              <span className="systems-main">
                <strong>{item.name}</strong>
                <small>{item.connection}</small>
              </span>
              <button
                type="button"
                className="systems-icon"
                onClick={async () => {
                  const next = dbConnections.filter((entry) => entry.name !== item.name);
                  await api.saveDbConnections(next);
                  setDbConnections(next);
                  setNote('数据库连接已删除');
                }}
                aria-label="删除数据库连接"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {dbConnections.length === 0 && (
            <div className="systems-empty-inline">还没有数据库连接</div>
          )}
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!dbName.trim() || !dbConn.trim()) return;
            const next = [
              ...dbConnections.filter((entry) => entry.name !== dbName.trim()),
              { name: dbName.trim(), connection: dbConn.trim() },
            ];
            await api.saveDbConnections(next);
            setDbConnections(next);
            setDbName('');
            setDbConn('');
            setNote('数据库连接已保存');
          }}
        >
          <input
            value={dbName}
            onChange={(event) => setDbName(event.target.value)}
            placeholder="连接名"
            aria-label="数据库连接名"
          />
          <input
            className="span-two"
            value={dbConn}
            onChange={(event) => setDbConn(event.target.value)}
            placeholder="sqlite:///path.db 或 postgres://…"
            aria-label="数据库连接串"
            spellCheck={false}
          />
          <button type="submit" className="control-button">
            <Plus size={11} /> add db
          </button>
        </form>
      </section>

      <section className="systems-section">
        <SectionHead
          title="REMOTE KNOWLEDGE BASE"
          meta={kb ? `${kb.mode} · ${kb.base_url || 'not configured'}` : 'NOT CONNECTED'}
          action={
            kb && (
              <div className="systems-inline-actions">
                <button
                  type="button"
                  className="text-action"
                  onClick={async () => {
                    setKbBusy(true);
                    try {
                      const result = await api.kbTest();
                      setKb(result.config);
                      setNote(result.ok ? '知识库连接正常' : result.note || result.kb_error || '连接异常');
                    } catch (e) {
                      setNote(errText(e));
                    } finally {
                      setKbBusy(false);
                    }
                  }}
                >
                  test
                </button>
                <button
                  type="button"
                  className="text-action"
                  onClick={async () => {
                    await api.kbDisconnect();
                    setKb(await api.kbConfigGet());
                    setKbItems([]);
                    setNote('已断开远程知识库');
                  }}
                >
                  disconnect
                </button>
              </div>
            )
          }
        />
        {kb && (
          <>
            <form
              className="systems-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setKbBusy(true);
                try {
                  const { has_token: _hasToken, ...rest } = kb;
                  setKb(await api.kbConfigSet(rest));
                  setNote('远程知识库配置已保存');
                } catch (e) {
                  setNote(errText(e));
                } finally {
                  setKbBusy(false);
                }
              }}
            >
              <select
                value={kb.mode}
                onChange={(event) =>
                  setKb({ ...kb, mode: event.target.value as KbConfig['mode'] })
                }
                aria-label="知识库模式"
              >
                <option value="off">off</option>
                <option value="local">local</option>
                <option value="remote">remote</option>
                <option value="hybrid">hybrid</option>
              </select>
              <input
                value={kb.base_url}
                onChange={(event) => setKb({ ...kb, base_url: event.target.value })}
                placeholder="检索 base_url"
                aria-label="知识库 base_url"
                spellCheck={false}
              />
              <input
                value={kb.ingest_url}
                onChange={(event) => setKb({ ...kb, ingest_url: event.target.value })}
                placeholder="摄入 ingest_url"
                aria-label="知识库 ingest_url"
                spellCheck={false}
              />
              <select
                value={kb.tenant}
                onChange={(event) => setKb({ ...kb, tenant: event.target.value })}
                aria-label="知识库 tenant"
              >
                {kb.tenant && !kbItems.some((item) => item.tenant === kb.tenant) && (
                  <option value={kb.tenant}>{kb.tenant}</option>
                )}
                {[...new Set(kbItems.map((item) => item.tenant).filter(Boolean))].map((tenant) => (
                  <option key={`tenant-${tenant}`} value={tenant}>
                    {tenant}
                  </option>
                ))}
              </select>
              <select
                value={kb.kb}
                onChange={(event) => setKb({ ...kb, kb: event.target.value })}
                aria-label="知识库 kb"
              >
                {kb.kb && !kbItems.some((item) => item.kb === kb.kb) && (
                  <option value={kb.kb}>{kb.kb}</option>
                )}
                {[...new Set(kbItems.map((item) => item.kb).filter(Boolean))].map((name) => (
                  <option key={`kb-${name}`} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={kb.profile}
                onChange={(event) => setKb({ ...kb, profile: event.target.value })}
                aria-label="知识库 profile"
              >
                {['hybrid_rerank', 'dense', 'bm25', 'hybrid'].map((profile) => (
                  <option key={profile} value={profile}>
                    {profile}
                  </option>
                ))}
                {kb.profile && !['hybrid_rerank', 'dense', 'bm25', 'hybrid'].includes(kb.profile) && (
                  <option value={kb.profile}>{kb.profile}</option>
                )}
              </select>
              <input
                type="number"
                min={1}
                value={kb.top_k}
                onChange={(event) =>
                  setKb({ ...kb, top_k: Math.max(1, Number(event.target.value) || 0) })
                }
                placeholder="top_k"
                aria-label="知识库 top_k"
              />
              <input
                type="number"
                min={1000}
                value={kb.timeout_ms}
                onChange={(event) =>
                  setKb({ ...kb, timeout_ms: Math.max(1000, Number(event.target.value) || 0) })
                }
                placeholder="timeout_ms"
                aria-label="知识库超时"
              />
              <label className="systems-check">
                <input
                  type="checkbox"
                  checked={kb.fallback_local}
                  onChange={(event) => setKb({ ...kb, fallback_local: event.target.checked })}
                />
                fallback local
              </label>
              <button type="submit" className="control-button" disabled={kbBusy}>
                save kb
              </button>
              <datalist id="kb-tenant-options">
                {[...new Set(kbItems.map((item) => item.tenant).filter(Boolean))].map((tenant) => (
                  <option key={`tenant-${tenant}`} value={tenant} />
                ))}
              </datalist>
              <datalist id="kb-name-options">
                {[...new Set(kbItems.map((item) => item.kb).filter(Boolean))].map((name) => (
                  <option key={`kb-${name}`} value={name} />
                ))}
              </datalist>
              <datalist id="kb-profile-options">
                <option value="hybrid_rerank" />
                <option value="dense" />
                <option value="bm25" />
                <option value="hybrid" />
              </datalist>
            </form>
            <form
              className="systems-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!kbCode.trim()) return;
                setKbBusy(true);
                try {
                  await api.kbExchangeCode(kb.base_url, kbCode.trim());
                  setKb(await api.kbConfigGet());
                  const list = await api.kbList().catch(() => null);
                  setKbItems(list?.items ?? []);
                  setKbCode('');
                  setNote('接入码已兑换，远程知识库已连接');
                } catch (e) {
                  setNote(errText(e));
                } finally {
                  setKbBusy(false);
                }
              }}
            >
              <input
                className="span-two"
                value={kbCode}
                onChange={(event) => setKbCode(event.target.value)}
                placeholder="粘贴接入码（连接远程底座时使用）"
                aria-label="知识库接入码"
                spellCheck={false}
              />
              <button type="submit" className="control-button" disabled={kbBusy}>
                exchange code
              </button>
            </form>
            {kbItems.length > 0 && (
              <div className="systems-table">
                {kbItems.map((item) => (
                  <div className="systems-row" key={`${item.tenant}/${item.kb}`}>
                    <span className="systems-badge">{item.documents} DOCS</span>
                    <span className="systems-main">
                      <strong>
                        {item.tenant} / {item.kb}
                      </strong>
                      <small>{item.chunks} chunks · dense {Math.round(item.dense_ratio * 100)}%</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {!kb && <div className="systems-empty-inline">远程知识库未配置</div>}
      </section>

      <section className="systems-section">
        <SectionHead
          title="KNOWLEDGE / RAG"
          meta={`${rag.length} INDEXED SOURCES`}
          action={
            <div className="systems-inline-actions">
              <button
                type="button"
                className="text-action"
                onClick={async () => {
                  const folder = await api.pickFolder();
                  if (!folder) return;
                  setBusy(true);
                  try {
                    await api.indexRagDir(folder);
                    await load();
                    setNote('已建立索引');
                  } catch (e) {
                    setNote(errText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <FolderPlus size={11} /> index folder
              </button>
              <button
                type="button"
                className="text-action"
                onClick={async () => {
                  await api.clearRag();
                  await load();
                  setNote('知识索引已清空');
                }}
              >
                clear
              </button>
            </div>
          }
        />
        <div className="systems-table">
          {rag.map((doc) => (
            <div className="systems-row" key={doc.path}>
              <span className="systems-badge">{doc.chunks} CHUNKS</span>
              <span className="systems-main">
                <strong>{doc.path}</strong>
              </span>
            </div>
          ))}
          {rag.length === 0 && <div className="systems-empty-inline">还没有索引目录</div>}
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!ragQuery.trim()) return;
            setBusy(true);
            try {
              setRagAnswer(await api.searchRag(ragQuery.trim()));
            } catch (e) {
              setNote(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            className="span-two"
            value={ragQuery}
            onChange={(event) => setRagQuery(event.target.value)}
            placeholder="检索知识库…"
            aria-label="检索知识库"
          />
          <button type="submit" className="control-button" disabled={busy}>
            search rag
          </button>
        </form>
        {ragAnswer && (
          <div className="systems-rag-answer">
            <span>
              {ragAnswer.count} HITS · {ragAnswer.source || 'local'}
              {ragAnswer.refused ? ' · REFUSED' : ''}
            </span>
            {ragAnswer.hits.slice(0, 5).map((hit, index) => (
              <div key={`${hit.path}-${index}`}>
                <strong>{hit.citation || hit.path}</strong>
                <p>{hit.content}</p>
              </div>
            ))}
            {ragAnswer.hits.length === 0 && <small>没有命中</small>}
          </div>
        )}
      </section>
      <div className="systems-note">{note || '连接器配置保存在本机。'}</div>
    </div>
  );
}

function StudioTab({ engine }: { engine: FluxEngine }) {
  const [prompt, setPrompt] = useState('');
  const [answers, setAnswers] = useState<ModelAnswer[]>([]);
  const [topic, setTopic] = useState('');
  const [rounds, setRounds] = useState(1);
  const [mode, setMode] = useState<'meeting' | 'teamwork'>('meeting');
  const [utterances, setUtterances] = useState<MeetingUtterance[]>([]);
  const [entries, setEntries] = useState<TeamEntry[]>([]);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [imageCap, setImageCap] = useState<ImageCapability | null>(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageSize, setImageSize] = useState('1024x1024');
  const [imagePath, setImagePath] = useState('');
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    void api
      .detectImageModel()
      .then(setImageCap)
      .catch(() => undefined);
  }, []);

  const participants = useMemo<MeetingParticipant[]>(() => {
    const profiles = engine.modelConfig?.profiles ?? [];
    return profiles
      .filter((profile) => profile.enabled)
      .slice(0, 4)
      .map((profile, index) => ({
        id: profile.id,
        name: profile.name,
        role: index === 0 ? '协调者' : '成员',
        profile_id: profile.id,
      }));
  }, [engine.modelConfig]);

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead title="MODEL COMPARE" meta="PARALLEL ANSWERS, ONE PROMPT" />
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!prompt.trim()) return;
            setBusy(true);
            setAnswers([]);
            try {
              const result = await api.compareModels(prompt, []);
              setAnswers(result);
            } catch (e) {
              setNote(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            className="span-two"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="问一个值得对比的问题…"
            aria-label="模型对比问题"
          />
          <button type="submit" className="control-button" disabled={busy || !prompt.trim()}>
            <Play size={11} /> compare
          </button>
        </form>
        <div className="systems-answers">
          {answers.map((answer) => (
            <article key={`${answer.name}-${answer.model}`}>
              <header>
                <strong>{answer.name}</strong>
                <span>{answer.model} · {answer.tier}</span>
              </header>
              <div className="systems-answer-body">
                {answer.error ? `错误：${answer.error}` : answer.content || '（空回答）'}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="systems-section">
        <SectionHead
          title={mode === 'meeting' ? 'MEETING ROOM' : 'TEAMWORK'}
          meta={`${participants.length} ENGINE PARTICIPANTS`}
        />
        <div className="systems-modebar">
          <button
            type="button"
            className={mode === 'meeting' ? 'is-active' : ''}
            onClick={() => setMode('meeting')}
          >
            meeting
          </button>
          <button
            type="button"
            className={mode === 'teamwork' ? 'is-active' : ''}
            onClick={() => setMode('teamwork')}
          >
            teamwork
          </button>
          <span>{participants.map((p) => p.name).join(' · ') || '先配置模型档案'}</span>
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!topic.trim() || participants.length === 0) return;
            setBusy(true);
            setUtterances([]);
            setEntries([]);
            setSummary('');
            try {
              if (mode === 'meeting') {
                const result = await api.runMeeting(topic, participants, rounds);
                setUtterances(result);
                const nextSummary = await api.summarizeMeeting(topic, result).catch(() => '');
                setSummary(nextSummary);
              } else {
                const result = await api.runTeamwork(topic, participants);
                setEntries(result);
              }
            } catch (e) {
              setNote(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            className="span-two"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="会议 / 协作主题…"
            aria-label="会议主题"
          />
          <select
            value={rounds}
            onChange={(event) => setRounds(Number(event.target.value))}
            aria-label="会议轮数"
          >
            <option value={1}>1 round</option>
            <option value={2}>2 rounds</option>
            <option value={3}>3 rounds</option>
          </select>
          <button
            type="submit"
            className="control-button"
            disabled={busy || !topic.trim() || participants.length === 0}
          >
            <Play size={11} /> {mode}
          </button>
        </form>

        <div className="systems-meeting">
          {utterances.map((item, index) => (
            <article key={`${item.speaker_id}-${index}`}>
              <header>
                <strong>{item.speaker_name}</strong>
                <span>round {item.round}</span>
              </header>
              <p>{item.content}</p>
            </article>
          ))}
          {entries.map((entry, index) => (
            <article key={`${entry.speaker_name}-${index}`}>
              <header>
                <strong>{entry.speaker_name}</strong>
                <span>{entry.kind}</span>
              </header>
              <p>{entry.title}</p>
              <pre>{entry.content}</pre>
            </article>
          ))}
          {summary && (
            <div className="systems-summary">
              <span>SUMMARY</span>
              <p>{summary}</p>
            </div>
          )}
        </div>
      </section>
      <section className="systems-section">
        <SectionHead
          title="IMAGE GENERATION"
          meta={imageCap?.supported ? `${imageCap.model} · ${imageCap.tier}` : 'NO IMAGE MODEL'}
        />
        {imageCap?.supported ? (
          <form
            className="systems-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!imagePrompt.trim()) return;
              setImageBusy(true);
              try {
                setImagePath(await api.generateImage(imagePrompt.trim(), imageSize));
              } catch (e) {
                setNote(errText(e));
              } finally {
                setImageBusy(false);
              }
            }}
          >
            <input
              className="span-two"
              value={imagePrompt}
              onChange={(event) => setImagePrompt(event.target.value)}
              placeholder="描述要生成的图像…"
              aria-label="图像提示词"
            />
            <select
              value={imageSize}
              onChange={(event) => setImageSize(event.target.value)}
              aria-label="图像尺寸"
            >
              <option value="1024x1024">1024²</option>
              <option value="512x512">512²</option>
              <option value="1536x1024">1536×1024</option>
            </select>
            <button type="submit" className="control-button" disabled={imageBusy}>
              {imageBusy ? 'generating…' : 'generate'}
            </button>
          </form>
        ) : (
          <div className="systems-empty-inline">
            {imageCap?.hint || '当前没有支持图像生成的模型。配置后会在这里出现入口。'}
          </div>
        )}
        {imagePath && (
          <div className="systems-inline-actions systems-image-result">
            <span>{imagePath}</span>
            <button type="button" className="text-action" onClick={() => void api.openPath(imagePath)}>
              open image
            </button>
          </div>
        )}
      </section>

      <div className="systems-note">
        {note || '会议与协作会消耗多次模型调用，但不会离开本机 API 配置。'}
      </div>
    </div>
  );
}

const TTS_PROVIDERS = [
  { id: 'local', label: '本机浏览器语音', note: '零配置，直接使用系统朗读；可选系统音色。' },
  { id: 'cloud', label: '云端 OpenAI 兼容', note: '填写 base_url、模型和 voice id，由后端合成音频。' },
  { id: 'doubao', label: '豆包语音 2.0', note: '需要火山引擎 App ID、Access Token 和 speaker id。' },
  { id: 'kokoro', label: '本地 Kokoro', note: '免费离线中文音色；首次启动本地服务较慢。' },
] as const;

const DOUBAO_VOICES = [
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何 · 女声（豆包 2.0）' },
  { id: 'zh_male_yunzhou_jupiter_bigtts', name: '云舟 · 男声（豆包 2.0）' },
  { id: 'zh_female_vv_jupiter_bigtts', name: 'VV · 女声（豆包 2.0）' },
  { id: 'zh_male_lengyue_moon_bigtts', name: '冷月 · 男声（豆包 2.0）' },
];

function ttsVoiceChoices(
  provider: string,
  browserVoices: SpeechSynthesisVoice[],
  kokoroVoices: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  if (provider === 'local') {
    return browserVoices.map((voice) => ({
      id: voice.name,
      name: `${voice.name} · ${voice.lang}${voice.default ? ' · 默认' : ''}`,
    }));
  }
  if (provider === 'kokoro') {
    return kokoroVoices.length ? kokoroVoices : api.KOKORO_VOICES;
  }
  if (provider === 'doubao') return DOUBAO_VOICES;
  return [];
}

export function RuntimeTab() {
  const [modes, setModes] = useState<WorkModeInfo[]>([]);
  const [modeState, setModeState] = useState<WorkModeState | null>(null);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [tts, setTts] = useState<TtsConfig | null>(null);
  const [token, setToken] = useState<TokenSaverConfig | null>(null);
  const [notify, setNotify] = useState<NotifyConfig | null>(null);
  const [usage, setUsage] = useState<ModelUsageRow[]>([]);
  const [daily, setDaily] = useState<ModelUsageDayRow[]>([]);
  const [digest, setDigest] = useState<{ enabled: boolean; time: string } | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [kokoroVoices, setKokoroVoices] = useState<Array<{ id: string; name: string }>>([]);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    const loadBrowserVoices = () => {
      if (typeof window.speechSynthesis === 'undefined') return;
      const all = window.speechSynthesis.getVoices();
      const chinese = all.filter((voice) => voice.lang.toLowerCase().startsWith('zh'));
      setBrowserVoices(chinese.length ? chinese : all);
    };
    loadBrowserVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadBrowserVoices);
    void api
      .getKokoroVoices()
      .then((list) => {
        if (list?.length) setKokoroVoices(list);
      })
      .catch(() => undefined);
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', loadBrowserVoices);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      setBusy(true);
      try {
        const [nextModes, nextMode, nextRuntime, nextTts, nextToken, nextNotify, nextUsage, nextDaily] =
          await Promise.all([
            api.getWorkModes(),
            api.getWorkMode(),
            api.getRuntimeConfig(),
            api.getTtsConfig(),
            api.getTokenSaverConfig(),
            api.getNotifyConfig(),
            api.getModelUsageReport(7).catch(() => []),
            api.getModelUsageDaily(14).catch(() => []),
          ]);
        setModes(nextModes);
        setModeState(nextMode);
        setRuntime(nextRuntime);
        setTts(nextTts);
        setToken(nextToken);
        setNotify(nextNotify);
        setUsage(nextUsage);
        setDaily(nextDaily);
        void invoke<{ enabled: boolean; time: string }>('nightly_digest_config')
          .then(setDigest)
          .catch(() => undefined);
      } catch (e) {
        setNote(errText(e));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const voiceChoices = tts ? ttsVoiceChoices(tts.provider, browserVoices, kokoroVoices) : [];

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead title="WORK MODE" meta="TOOLSET · PROMPT · TEMPLATES" />
        <div className="systems-modes">
          <button
            type="button"
            className={!modeState?.current ? 'is-active' : ''}
            onClick={async () => {
              await api.setWorkMode('');
              setModeState(await api.getWorkMode());
              setNote('已回到通用模式');
            }}
          >
            <strong>通用</strong>
            <small>full toolset</small>
          </button>
          {modes.map((item) => (
            <button
              type="button"
              key={item.id}
              className={modeState?.current === item.id ? 'is-active' : ''}
              onClick={async () => {
                await api.setWorkMode(item.id);
                setModeState(await api.getWorkMode());
                setNote(`当前模式：${item.label}`);
              }}
            >
              <strong>{item.label}</strong>
              <small>{item.description || item.id}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="systems-section">
        <SectionHead
          title="MODEL USAGE"
          meta={`${usage.reduce((sum, item) => sum + item.calls, 0)} CALLS · 7 DAYS`}
        />
        <div className="systems-usage">
          <div className="systems-usage-bars">
            {daily.slice(-14).map((day) => {
              const max = Math.max(
                1,
                ...daily.map((item) => item.prompt_tokens + item.completion_tokens),
              );
              const value = day.prompt_tokens + day.completion_tokens;
              return (
                <span
                  key={day.day}
                  title={`${day.day} · ${value} tokens · ${day.calls} calls`}
                  style={{ height: `${Math.max(3, (value / max) * 100)}%` }}
                />
              );
            })}
          </div>
          <div className="systems-table">
            {usage.map((row) => (
              <div className="systems-row" key={`${row.provider}-${row.model}`}>
                <span className="systems-badge">{row.calls} CALLS</span>
                <span className="systems-main">
                  <strong>{row.model}</strong>
                  <small>
                    {row.provider} · {row.prompt_tokens} in / {row.completion_tokens} out
                  </small>
                </span>
              </div>
            ))}
            {usage.length === 0 && <div className="systems-empty-inline">还没有模型用量记录</div>}
          </div>
        </div>
      </section>

      {runtime && (
        <section className="systems-section">
          <SectionHead title="VISION / EMBEDDING" meta="MODEL RUNTIME" />
          <form
            className="systems-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await api.setRuntimeConfig(runtime);
                setNote('运行时配置已保存');
              } catch (e) {
                setNote(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              value={runtime.embed_model}
              onChange={(event) => setRuntime({ ...runtime, embed_model: event.target.value })}
              placeholder="embedding model"
              aria-label="嵌入模型"
            />
            <select
              value={runtime.vision_provider}
              onChange={(event) => setRuntime({ ...runtime, vision_provider: event.target.value })}
              aria-label="视觉提供方"
            >
              <option value="ollama">ollama</option>
              <option value="deepseek">deepseek</option>
            </select>
            <input
              value={runtime.vision_model}
              onChange={(event) => setRuntime({ ...runtime, vision_model: event.target.value })}
              placeholder="vision model"
              aria-label="视觉模型"
            />
            <label className="systems-check">
              <input
                type="checkbox"
                checked={runtime.vision_enabled}
                onChange={(event) =>
                  setRuntime({ ...runtime, vision_enabled: event.target.checked })
                }
              />
              vision
            </label>
            <button type="submit" className="control-button" disabled={busy}>
              save runtime
            </button>
          </form>
        </section>
      )}

      {tts && (
        <section className="systems-section">
          <SectionHead
            title="VOICE / TTS"
            meta={`${TTS_PROVIDERS.find((item) => item.id === tts.provider)?.label ?? tts.provider} · ${
              tts.provider === 'local' ? 'system voice' : tts.model || tts.db_speaker || 'default voice'
            }`}
          />
          <form
            className="systems-form systems-voice-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await api.setTtsConfig(tts);
                await api.setVoice(tts.voice);
                setNote('语音配置已保存；下一次回答会按新配置朗读。');
              } catch (e) {
                setNote(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="systems-field systems-field--wide">
              <span>PROVIDER / 语音后端</span>
              <select
                value={tts.provider}
                onChange={(event) => {
                  const provider = event.target.value;
                  let nextVoice = tts.voice;
                  if (provider === 'doubao') {
                    nextVoice = tts.db_speaker || DOUBAO_VOICES[0].id;
                  } else if (provider === 'kokoro') {
                    const known = kokoroVoices.length
                      ? kokoroVoices
                      : api.KOKORO_VOICES;
                    nextVoice = known.some((voice) => voice.id === tts.voice)
                      ? tts.voice
                      : known[0].id;
                  } else if (provider === 'local') {
                    // Browser voices are identified by name, not by Kokoro / Doubao ids.
                    nextVoice = browserVoices.some((voice) => voice.name === tts.voice)
                      ? tts.voice
                      : '';
                  }
                  setTts({ ...tts, provider, voice: nextVoice });
                }}
                aria-label="语音提供方"
              >
                {TTS_PROVIDERS.map((provider) => (
                  <option value={provider.id} key={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <small className="systems-field-note">
                {TTS_PROVIDERS.find((item) => item.id === tts.provider)?.note}
              </small>
            </label>

            {tts.provider !== 'doubao' && (
              <label className="systems-field systems-field--wide">
                <span>VOICE / 音色</span>
                {tts.provider === 'cloud' ? (
                  <input
                    value={tts.voice}
                    onChange={(event) => setTts({ ...tts, voice: event.target.value })}
                    placeholder="voice id（例如 alloy / zh_female_xiaohe_uranus_bigtts）"
                    aria-label="音色"
                    spellCheck={false}
                  />
                ) : (
                  <select
                    value={tts.voice}
                    onChange={(event) => setTts({ ...tts, voice: event.target.value })}
                    aria-label="音色"
                  >
                    {tts.provider === 'local' && (
                      <option value="">系统默认（自动选择中文音色）</option>
                    )}
                    {!voiceChoices.some((choice) => choice.id === tts.voice) && tts.voice && (
                      <option value={tts.voice}>{tts.voice}（当前）</option>
                    )}
                    {voiceChoices.map((choice) => (
                      <option value={choice.id} key={choice.id}>
                        {choice.name}
                      </option>
                    ))}
                  </select>
                )}
                <small className="systems-field-note">
                  {tts.provider === 'local'
                    ? browserVoices.length
                      ? '列出系统已安装的朗读音色。若为空，先安装中文语音包。'
                      : '系统尚未提供可枚举音色；仍会使用浏览器默认中文声音。'
                    : tts.provider === 'kokoro'
                      ? 'Kokoro 首次启动会加载本地模型；不可用音色会自动回退默认女声。'
                      : 'voice id 由云端语音服务决定；保存前可先试听。'}
                </small>
              </label>
            )}

            {tts.provider === 'doubao' && (
              <>
                <label className="systems-field">
                  <span>APP ID</span>
                  <input
                    value={tts.db_app_id ?? ''}
                    onChange={(event) => setTts({ ...tts, db_app_id: event.target.value })}
                    placeholder="火山引擎 App ID"
                    aria-label="豆包 app id"
                    spellCheck={false}
                  />
                </label>
                <label className="systems-field">
                  <span>ACCESS TOKEN</span>
                  <input
                    type="password"
                    value={tts.db_token ?? ''}
                    onChange={(event) => setTts({ ...tts, db_token: event.target.value })}
                    placeholder="Access Token（不是 IAM 密钥）"
                    aria-label="豆包 token"
                    autoComplete="off"
                  />
                </label>
                <label className="systems-field">
                  <span>SPEAKER / 音色</span>
                  <select
                    value={tts.db_speaker ?? DOUBAO_VOICES[0].id}
                    onChange={(event) =>
                      setTts({ ...tts, db_speaker: event.target.value, voice: event.target.value })
                    }
                    aria-label="豆包 speaker"
                  >
                    {!DOUBAO_VOICES.some((voice) => voice.id === tts.db_speaker) && tts.db_speaker && (
                      <option value={tts.db_speaker}>{tts.db_speaker}（当前）</option>
                    )}
                    {DOUBAO_VOICES.map((voice) => (
                      <option value={voice.id} key={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="systems-field">
                  <span>SPEECH RATE</span>
                  <input
                    type="number"
                    min={-50}
                    max={100}
                    value={String(tts.db_speech_rate ?? 0)}
                    onChange={(event) =>
                      setTts({ ...tts, db_speech_rate: Number(event.target.value) || 0 })
                    }
                    placeholder="0（-50 ~ 100）"
                    aria-label="豆包语速"
                  />
                </label>
              </>
            )}

            {(tts.provider === 'cloud' || tts.provider === 'kokoro') && (
              <label className="systems-field systems-field--wide">
                <span>{tts.provider === 'kokoro' ? 'LOCAL BASE URL（可选）' : 'BASE URL'}</span>
                <input
                  value={tts.base_url}
                  onChange={(event) => setTts({ ...tts, base_url: event.target.value })}
                  placeholder={
                    tts.provider === 'kokoro'
                      ? 'http://127.0.0.1:9800/v1（留空使用默认）'
                      : 'https://api.openai.com/v1'
                  }
                  aria-label="TTS base_url"
                  spellCheck={false}
                />
              </label>
            )}

            {tts.provider === 'cloud' && (
              <>
                <label className="systems-field">
                  <span>MODEL</span>
                  <input
                    value={tts.model}
                    onChange={(event) => setTts({ ...tts, model: event.target.value })}
                    placeholder="tts-1 / gpt-4o-mini-tts"
                    aria-label="语音模型"
                  />
                </label>
                <label className="systems-field">
                  <span>API KEY</span>
                  <input
                    type="password"
                    value={tts.api_key}
                    onChange={(event) => setTts({ ...tts, api_key: event.target.value })}
                    placeholder="留空保留原密钥"
                    aria-label="TTS api key"
                    autoComplete="off"
                  />
                </label>
              </>
            )}

            <div className="settings-actions systems-voice-actions">
              <button
                type="button"
                className="control-button control-button--ghost"
                disabled={previewing || busy}
                onClick={async () => {
                  setPreviewing(true);
                  setNote('正在按当前配置试听…');
                  try {
                    await api.setTtsConfig(tts);
                    await api.setVoice(tts.voice);
                    if (tts.provider === 'local') {
                      const voice = browserVoices.find((item) => item.name === tts.voice) ?? null;
                      reactiveSpeak('你好，我是 FLUX。这是当前的语音配置。', {
                        lang: 'zh-CN',
                        voice,
                      });
                      setNote(`正在用本机语音试听${voice ? ` · ${voice.name}` : ''}`);
                    } else {
                      await speakWithCloud('你好，我是 FLUX。这是当前的语音配置。');
                      setNote('试听完成，语音配置已保存。');
                    }
                  } catch (e) {
                    setNote(`试听失败：${errText(e)}`);
                  } finally {
                    setPreviewing(false);
                  }
                }}
              >
                {previewing ? '试听中…' : '试听 / PREVIEW'}
              </button>
              <button type="submit" className="control-button" disabled={busy || previewing}>
                保存语音配置
              </button>
            </div>
          </form>
        </section>
      )}

      {token && (
        <section className="systems-section">
          <SectionHead title="TOKEN SAVER" meta="CONTEXT COMPRESSION" />
          <div className="systems-checks">
            {(
              [
                ['enabled', 'enabled'],
                ['auto_compress', 'auto compress'],
                ['local_only_compress', 'local only'],
                ['concise_reply', 'concise reply'],
              ] as const
            ).map(([key, label]) => (
              <label className="systems-check" key={key}>
                <input
                  type="checkbox"
                  checked={token[key]}
                  onChange={(event) => setToken({ ...token, [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
            <button
              type="button"
              className="control-button"
              disabled={busy}
              onClick={async () => {
                await api.setTokenSaverConfig(token);
                setNote('Token saver 配置已保存');
              }}
            >
              save token saver
            </button>
          </div>
          <div className="systems-form systems-token-form">
            <label className="systems-field">
              <span>COMPRESS THRESHOLD</span>
              <input
                type="number"
                min={2000}
                value={token.compress_threshold_chars}
                onChange={(event) =>
                  setToken({
                    ...token,
                    compress_threshold_chars: Math.max(2000, Number(event.target.value) || 0),
                  })
                }
                aria-label="压缩阈值"
              />
            </label>
            <label className="systems-field">
              <span>KEEP RECENT</span>
              <input
                type="number"
                min={500}
                value={token.keep_recent_chars}
                onChange={(event) =>
                  setToken({
                    ...token,
                    keep_recent_chars: Math.max(500, Number(event.target.value) || 0),
                  })
                }
                aria-label="保留最近字符"
              />
            </label>
            <label className="systems-field">
              <span>MAX TOOL RESULT</span>
              <input
                type="number"
                min={0}
                value={token.max_tool_result_chars}
                onChange={(event) =>
                  setToken({
                    ...token,
                    max_tool_result_chars: Math.max(0, Number(event.target.value) || 0),
                  })
                }
                aria-label="工具结果上限"
              />
            </label>
          </div>
        </section>
      )}

      {digest && (
        <section className="systems-section">
          <SectionHead title="NIGHTLY MEMORY DIGEST" meta="MEMORY CONSOLIDATION" />
          <div className="systems-checks">
            <label className="systems-check">
              <input
                type="checkbox"
                checked={digest.enabled}
                onChange={(event) => setDigest({ ...digest, enabled: event.target.checked })}
              />
              enabled
            </label>
            <label className="systems-field">
              <span>LOCAL TIME</span>
              <input
                type="time"
                value={digest.time}
                onChange={(event) => setDigest({ ...digest, time: event.target.value })}
                aria-label="夜间整理时间"
              />
            </label>
            <button
              type="button"
              className="control-button"
              disabled={digestBusy}
              onClick={async () => {
                setDigestBusy(true);
                try {
                  const next = await invoke<{ enabled: boolean; time: string }>(
                    'nightly_digest_set_config',
                    { enabled: digest.enabled, time: digest.time },
                  );
                  setDigest(next);
                  setNote('夜间整理配置已保存');
                } catch (e) {
                  setNote(errText(e));
                } finally {
                  setDigestBusy(false);
                }
              }}
            >
              save digest
            </button>
            <button
              type="button"
              className="text-action"
              disabled={digestBusy}
              onClick={async () => {
                setDigestBusy(true);
                try {
                  await invoke('nightly_digest_run');
                  setNote('夜间整理已运行，记忆已合并');
                } catch (e) {
                  setNote(errText(e));
                } finally {
                  setDigestBusy(false);
                }
              }}
            >
              run now
            </button>
          </div>
        </section>
      )}

      {/* 界面音效：主界面自己的一套提示音（与上面的「升级通知」不同——
          那套是审批超时后逐级外发，这套是操作时给耳朵的即时反馈） */}
      <SoundSettingsSection />

      {notify && (
        <section className="systems-section">
          <SectionHead title="ESCALATION NOTIFY" meta="TIMEOUT · EMAIL · WEBHOOK" />
          <div className="systems-checks">
            <label className="systems-check">
              <input
                type="checkbox"
                checked={notify.enabled}
                onChange={(event) => setNotify({ ...notify, enabled: event.target.checked })}
              />
              enabled
            </label>
            <label className="systems-check">
              <input
                type="checkbox"
                checked={Boolean(notify.email)}
                onChange={(event) =>
                  setNotify({
                    ...notify,
                    email: event.target.checked
                      ? {
                          smtp_host: '',
                          smtp_port: 587,
                          username: '',
                          password: '',
                          from: '',
                          to: '',
                        }
                      : null,
                  })
                }
              />
              email
            </label>
            <input
              value={notify.webhook?.url || ''}
              onChange={(event) =>
                setNotify({
                  ...notify,
                  webhook: event.target.value
                    ? { url: event.target.value, headers: notify.webhook?.headers ?? null }
                    : null,
                })
              }
              placeholder="webhook URL（可选）"
              aria-label="通知 webhook"
              spellCheck={false}
            />
            <button
              type="button"
              className="control-button"
              disabled={busy}
              onClick={async () => {
                await api.setNotifyConfig(notify);
                setNote('通知配置已保存');
              }}
            >
              save notify
            </button>
          </div>
          {notify.email && (
            <div className="systems-form systems-email-form">
              <input
                value={notify.email.smtp_host}
                onChange={(event) =>
                  setNotify({
                    ...notify,
                    email: { ...notify.email!, smtp_host: event.target.value },
                  })
                }
                placeholder="SMTP host"
                aria-label="SMTP host"
                spellCheck={false}
              />
              <input
                value={String(notify.email.smtp_port)}
                onChange={(event) =>
                  setNotify({
                    ...notify,
                    email: {
                      ...notify.email!,
                      smtp_port: Number(event.target.value) || 0,
                    },
                  })
                }
                placeholder="port"
                aria-label="SMTP port"
              />
              <input
                value={notify.email.username}
                onChange={(event) =>
                  setNotify({
                    ...notify,
                    email: { ...notify.email!, username: event.target.value },
                  })
                }
                placeholder="username"
                aria-label="SMTP username"
                spellCheck={false}
              />
              <input
                type="password"
                value={notify.email.password}
                onChange={(event) =>
                  setNotify({
                    ...notify,
                    email: { ...notify.email!, password: event.target.value },
                  })
                }
                placeholder="password"
                aria-label="SMTP password"
                spellCheck={false}
              />
              <input
                value={notify.email.from}
                onChange={(event) =>
                  setNotify({
                    ...notify,
                    email: { ...notify.email!, from: event.target.value },
                  })
                }
                placeholder="from"
                aria-label="邮件 from"
                spellCheck={false}
              />
              <input
                value={notify.email.to}
                onChange={(event) =>
                  setNotify({
                    ...notify,
                    email: { ...notify.email!, to: event.target.value },
                  })
                }
                placeholder="to"
                aria-label="邮件 to"
                spellCheck={false}
              />
            </div>
          )}
          <div className="systems-levels">
            <span>ESCALATION LEVELS · L0 → L4</span>
            <div className="systems-level-grid">
              {['L0 弹窗', 'L1 通知', 'L2 语音', 'L3 邮件', 'L4 Webhook'].map((label, index) => (
                <label className="systems-check" key={label}>
                  <input
                    type="checkbox"
                    checked={Boolean(notify.levels_enabled[index])}
                    onChange={(event) => {
                      const next = [...notify.levels_enabled];
                      next[index] = event.target.checked;
                      setNotify({ ...notify, levels_enabled: next });
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="systems-level-grid systems-level-grid--timeouts">
              {['L0', 'L1', 'L2', 'L3', 'L4'].map((label, index) => (
                <label className="systems-field" key={label}>
                  <span>{label} TIMEOUT / SEC</span>
                  <input
                    type="number"
                    min={0}
                    value={notify.timeouts_sec[index] ?? 0}
                    onChange={(event) => {
                      const next = [...notify.timeouts_sec];
                      next[index] = Math.max(0, Number(event.target.value) || 0);
                      setNotify({ ...notify, timeouts_sec: next });
                    }}
                    aria-label={`${label} 超时秒数`}
                  />
                </label>
              ))}
            </div>
            <input
              className="systems-voice-text"
              value={notify.voice_text || ''}
              onChange={(event) => setNotify({ ...notify, voice_text: event.target.value || null })}
              placeholder="语音升级播报文本（可选）"
              aria-label="语音升级播报文本"
            />
          </div>
        </section>
      )}
      <div className="systems-note">{note || '运行时配置在下次对话时生效。'}</div>
    </div>
  );
}

function ProjectsTab({ engine }: { engine: FluxEngine }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [cmd, setCmd] = useState<QuickCommand>({ name: '', template: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const currentConversation = engine.conversations.find((item) => item.id === engine.convId);
  const currentProject = currentConversation?.project_id ?? '';

  const load = async () => {
    setBusy(true);
    try {
      const [nextProjects, nextCommands] = await Promise.all([
        api.listProjects(),
        api.listQuickCommands(),
      ]);
      setProjects(nextProjects);
      setCommands(nextCommands);
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead
          title="PROJECTS"
          meta={`${projects.length} WORKSPACES`}
          action={
            <button type="button" className="text-action" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={11} /> rescan
            </button>
          }
        />
        <div className="systems-table">
          {projects.map((project) => (
            <div className="systems-row" key={project.id}>
              <span className="systems-badge">{project.name.slice(0, 1).toUpperCase()}</span>
              <span className="systems-main">
                <strong>{project.name}</strong>
                <small>{project.path || 'no path'}</small>
              </span>
              <button
                type="button"
                className="systems-icon"
                onClick={async () => {
                  await api.deleteProject(project.id);
                  await load();
                  await engine.refreshConversations();
                }}
                aria-label="删除项目"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {projects.length === 0 && <div className="systems-empty-inline">还没有项目</div>}
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            try {
              await api.addProject(name.trim(), path.trim());
              setName('');
              setPath('');
              await load();
              setNote('项目已创建');
            } catch (e) {
              setNote(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="项目名"
            aria-label="项目名"
          />
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="工作目录（可选）"
            aria-label="项目路径"
          />
          <button
            type="button"
            className="text-action"
            onClick={async () => {
              const folder = await api.pickFolder();
              if (folder) setPath(folder);
            }}
          >
            pick folder
          </button>
          <button type="submit" className="control-button" disabled={busy}>
            <Plus size={11} /> add project
          </button>
        </form>
        <div className="systems-assign">
          <span>CURRENT SESSION PROJECT</span>
          <select
            value={currentProject}
            onChange={async (event) => {
              const projectId = event.target.value || null;
              await api.setConversationProject(engine.convId, projectId);
              await engine.refreshConversations();
              setNote('会话归属已更新');
            }}
            aria-label="当前会话项目"
          >
            <option value="">未分组</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="systems-section">
        <SectionHead title="QUICK COMMANDS" meta={`${commands.length} TEMPLATES`} />
        <div className="systems-table">
          {commands.map((command) => (
            <div className="systems-row" key={command.name}>
              <span className="systems-badge">/{command.name}</span>
              <span className="systems-main">
                <strong>{command.template}</strong>
                <small>{command.description || 'no description'}</small>
              </span>
              <button
                type="button"
                className="systems-icon"
                onClick={async () => {
                  await api.deleteQuickCommand(command.name);
                  await load();
                }}
                aria-label="删除快捷指令"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {commands.length === 0 && <div className="systems-empty-inline">还没有快捷指令</div>}
        </div>
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!cmd.name.trim() || !cmd.template.trim()) return;
            setBusy(true);
            try {
              await api.saveQuickCommand(cmd);
              setCmd({ name: '', template: '', description: '' });
              await load();
              setNote('快捷指令已保存');
            } catch (e) {
              setNote(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            value={cmd.name}
            onChange={(event) => setCmd({ ...cmd, name: event.target.value })}
            placeholder="名称（不带 /）"
            aria-label="快捷指令名称"
          />
          <input
            value={cmd.template}
            onChange={(event) => setCmd({ ...cmd, template: event.target.value })}
            placeholder="模板，例如 总结这篇文档：{args}"
            aria-label="快捷指令模板"
          />
          <input
            value={cmd.description}
            onChange={(event) => setCmd({ ...cmd, description: event.target.value })}
            placeholder="描述"
            aria-label="快捷指令描述"
          />
          <button type="submit" className="control-button" disabled={busy}>
            <Plus size={11} /> add command
          </button>
        </form>
      </section>
      <div className="systems-note">{note || '项目和快捷指令都属于本机工作区。'}</div>
    </div>
  );
}

export function SystemTab() {
  const [env, setEnv] = useState<EnvCheckResult | null>(null);
  const [system, setSystem] = useState<SystemConfig | null>(null);
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [image, setImage] = useState<ImageCapability | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [envItems, setEnvItems] = useState<EnvItem[]>([]);
  const [docDeps, setDocDeps] = useState<DocumentDepsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    // system_get enumerates the full environment and can be slow on some
    // machines. Load the other probes independently so one slow snapshot never
    // leaves the whole tab in a reading state.
    const loadEnv = () =>
      void api.envCheck().then(setEnv).catch((e) => setNote(errText(e)));
    const loadDisk = () =>
      void api.diskInfo().then(setDisk).catch((e) => setNote(errText(e)));

    loadEnv();
    loadDisk();
    void api.detectImageModel().then(setImage).catch(() => undefined);

    // First-run package-manager probes can take several seconds; a single quiet
    // retry makes the tab settle without the user having to press rescan.
    const retry = window.setTimeout(() => {
      loadEnv();
      loadDisk();
    }, 3200);
    return () => window.clearTimeout(retry);
  }, []);

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead title="ENVIRONMENT" meta="WINDOWS · RUNTIMES · PACKAGE MANAGERS" />
        <div className="systems-status-grid">
          <div>
            <span>OS</span>
            <strong>{env?.os || '—'}</strong>
            <small>{env?.is_admin ? 'elevated' : 'standard user'}</small>
          </div>
          <div>
            <span>RUNTIMES</span>
            <strong>{env ? Object.values(env.runtimes).filter(Boolean).length : '—'}</strong>
            <small>
              {env
                ? Object.entries(env.runtimes)
                    .filter(([, value]) => Boolean(value))
                    .map(([key]) => key)
                    .join(' · ')
                : 'reading'}
            </small>
          </div>
          <div>
            <span>PACKAGE MANAGERS</span>
            <strong>{env ? env.package_managers.filter((item) => item.available).length : '—'}</strong>
            <small>
              {env
                ? env.package_managers
                    .filter((item) => item.available)
                    .map((item) => item.id)
                    .join(' · ')
                : 'reading'}
            </small>
          </div>
        </div>
      </section>

      <section className="systems-section">
        <SectionHead
          title="ENVIRONMENT CHECK"
          meta={`${envItems.length} CHECKS`}
          action={
            <button
              type="button"
              className="text-action"
              onClick={async () => {
                setBusy(true);
                try {
                  setEnvItems(await api.envDetectAll());
                  setNote('环境检测完成');
                } catch (e) {
                  setNote(errText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw size={11} /> run full check
            </button>
          }
        />
        <div className="systems-table">
          {envItems.map((item) => (
            <div className="systems-row" key={item.id}>
              <span className={`systems-badge ${item.status === 'ok' ? 'is-allow' : item.status === 'missing' ? 'is-deny' : ''}`}>
                {item.status}
              </span>
              <span className="systems-main">
                <strong>{item.name}</strong>
                <small>
                  {item.version || 'version unknown'}
                  {item.fix_cmd ? ` · ${item.fix_cmd}` : ''}
                </small>
              </span>
            </div>
          ))}
          {envItems.length === 0 && (
            <div className="systems-empty-inline">运行一次完整环境检测，找出缺失的运行时和工具。</div>
          )}
        </div>
      </section>

      <section className="systems-section">
        <SectionHead
          title="DOCUMENT PARSERS"
          meta={docDeps ? (docDeps.ready ? 'READY' : `${docDeps.missing.length} MISSING`) : 'NOT CHECKED'}
          action={
            <div className="systems-inline-actions">
              <button
                type="button"
                className="text-action"
                onClick={async () => {
                  setBusy(true);
                  try {
                    setDocDeps(await api.checkDocumentDeps());
                  } catch (e) {
                    setNote(errText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                check
              </button>
              <button
                type="button"
                className="text-action"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await api.installDocumentDeps();
                    setDocDeps(result.report);
                    setNote(result.ok ? '文档解析依赖已安装' : result.output_tail);
                  } catch (e) {
                    setNote(errText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                install
              </button>
            </div>
          }
        />
        <div className="systems-table">
          {docDeps && (
            <div className="systems-row">
              <span className={`systems-badge ${docDeps.ready ? 'is-allow' : 'is-deny'}`}>
                {docDeps.ready ? 'READY' : 'DEPS'}
              </span>
              <span className="systems-main">
                <strong>Python {docDeps.python || 'not found'}</strong>
                <small>
                  {docDeps.ready
                    ? 'PDF / Word / Excel / PPT parsing ready'
                    : `missing: ${docDeps.missing.join(', ') || 'unknown'}`}
                </small>
              </span>
            </div>
          )}
          {!docDeps && <div className="systems-empty-inline">检查文档解析依赖。</div>}
        </div>
      </section>

      <section className="systems-section">
        <SectionHead
          title="MACHINE"
          meta="SYSTEM CONFIG · DISKS"
          action={
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setBusy(true);
                void api
                  .systemGet()
                  .then(setSystem)
                  .catch((e) => setNote(errText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <RefreshCw size={11} /> read config
            </button>
          }
        />
        <div className="systems-status-grid">
          <div>
            <span>PLATFORM</span>
            <strong>{system?.os || disk?.os || '—'}</strong>
            <small>{system?.os_version || 'version unknown'}</small>
          </div>
          <div>
            <span>ENV / PATH</span>
            <strong>{system ? Object.keys(system.env).length : '—'}</strong>
            <small>{system ? `${system.path.length} path entries` : 'reading'}</small>
          </div>
          <div>
            <span>STARTUP</span>
            <strong>{system ? Object.keys(system.startup).length : '—'}</strong>
            <small>user startup entries</small>
          </div>
        </div>
        <div className="systems-table systems-disk-table">
          {(disk?.disks ?? []).map((item) => (
            <div className="systems-row" key={item.drive}>
              <span className="systems-badge">{item.drive}</span>
              <span className="systems-main">
                <strong>{item.label || 'local disk'}</strong>
                <small>
                  {item.free_gb ?? '—'} GB free / {item.total_gb ?? '—'} GB
                </small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="systems-section">
        <SectionHead title="IMAGE / UPDATE" meta="CAPABILITIES · RELEASES" />
        <div className="systems-status-grid">
          <div>
            <span>IMAGE MODEL</span>
            <strong>{image?.supported ? image.model : 'unavailable'}</strong>
            <small>{image?.hint || 'no image capability probe'}</small>
          </div>
          <div>
            <span>CURRENT VERSION</span>
            <strong>{update?.current || '1.0.0'}</strong>
            <small>{update ? (update.has_update ? `latest ${update.latest}` : 'up to date') : 'not checked'}</small>
          </div>
          <div className="systems-status-actions">
            <div className="systems-inline-actions">
              <button
                type="button"
                className="control-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setUpdate(await api.updateCheck());
                  } catch (e) {
                    setNote(errText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                check update
              </button>
              {update?.has_update && (
                <button
                  type="button"
                  className="control-button is-primary"
                  onClick={() => {
                    void api.updateInstall().catch((e) => setNote(errText(e)));
                  }}
                >
                  install update
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="systems-inline-actions">
        <button type="button" className="text-action" onClick={() => void api.openDataFolder()}>
          open data folder
        </button>
        <button
          type="button"
          className="text-action"
          onClick={() => {
            void api.envCheck().then(setEnv).catch((e) => setNote(errText(e)));
          }}
        >
          <RefreshCw size={11} /> rescan environment
        </button>
      </div>
      <div className="systems-note">{note || '所有诊断都在本机完成。'}</div>
    </div>
  );
}

function TestLabTab() {
  const [projects, setProjects] = useState<ProjectProfile[]>([]);
  const [projectId, setProjectId] = useState('');
  const [requirement, setRequirement] = useState('');
  const [generated, setGenerated] = useState<GenerateTestCasesResult | null>(null);
  const [result, setResult] = useState<TestRunSelectedResult | null>(null);
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const selected = projects.find((item) => item.id === projectId) ?? null;

  useEffect(() => {
    void api
      .testLoadProjects()
      .then(setProjects)
      .catch((e) => setNote(errText(e)));
  }, []);

  useEffect(() => {
    if (!selected) {
      setRecords([]);
      return;
    }
    void api
      .testListRecords(selected.name, selected.id, selected.report_dir)
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [selected?.id]);

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead title="TEST PROJECT" meta={`${projects.length} BASELINES`} />
        <div className="systems-form">
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            aria-label="被测项目"
          >
            <option value="">不绑定项目</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {selected && (
            <span className="systems-inline-note">
              {selected.project_type} · {selected.env_tag} · {selected.ui_entry || selected.api_base || 'no entry'}
            </span>
          )}
        </div>
        <div className="systems-table">
          {records.slice(0, 8).map((record) => (
            <div className="systems-row" key={record.stem}>
              <span className="systems-badge">REPORT</span>
              <span className="systems-main">
                <strong>{record.title}</strong>
                <small>{record.ts || record.stem}</small>
              </span>
            </div>
          ))}
          {records.length === 0 && <div className="systems-empty-inline">该项目还没有执行记录</div>}
        </div>
      </section>

      <section className="systems-section">
        <SectionHead title="GENERATE CASES" meta="REQUIREMENT → CASES" />
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!requirement.trim()) return;
            setBusy(true);
            setGenerated(null);
            setResult(null);
            try {
              setGenerated(await api.testGenerateCases(requirement.trim(), undefined, undefined, 1));
              setNote('用例已生成');
            } catch (e) {
              setNote(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            className="span-two"
            value={requirement}
            onChange={(event) => setRequirement(event.target.value)}
            placeholder="需求 / 页面 / 接口描述…"
            aria-label="测试需求"
          />
          <button type="submit" className="control-button" disabled={busy}>
            generate
          </button>
        </form>
        {generated && (
          <>
            <div className="systems-status-grid">
              <div>
                <span>CASES</span>
                <strong>{generated.test_cases}</strong>
                <small>{generated.requirements} requirements</small>
              </div>
              <div>
                <span>COVERAGE</span>
                <strong>{generated.coverage || '—'}</strong>
                <small>generated by the engine</small>
              </div>
              <div className="systems-status-actions">
                <button
                  type="button"
                  className="control-button is-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const next = await api.testRunSelected(
                        `FLUX test ${new Date().toLocaleTimeString('zh-CN')}`,
                        generated.cases ?? [],
                        selected,
                      );
                      setResult(next);
                      setNote(next.ok ? '测试通过' : '测试存在失败项');
                      if (selected) {
                        setRecords(
                          await api.testListRecords(selected.name, selected.id, selected.report_dir),
                        );
                      }
                    } catch (e) {
                      setNote(errText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  run cases
                </button>
              </div>
            </div>
            <div className="systems-table">
              {(generated.cases ?? []).slice(0, 12).map((item, index) => (
                <div className="systems-row" key={index}>
                  <span className="systems-badge">CASE</span>
                  <span className="systems-main">
                    <strong>{item.title || `case ${index + 1}`}</strong>
                    <small>{item.case_type || 'test'}</small>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {result && (
        <section className="systems-section">
          <SectionHead title="RUN RESULT" meta={`${result.passed}/${result.total} PASSED`} />
          <div className="systems-status-grid">
            <div>
              <span>PASSED</span>
              <strong>{result.passed}</strong>
              <small>{result.failed} failed</small>
            </div>
            <div>
              <span>EVIDENCE</span>
              <strong>{result.evidence_count ?? 0}</strong>
              <small>screenshots</small>
            </div>
            <div>
              <span>REPORT</span>
              <strong>{result.report_md ? 'SAVED' : '—'}</strong>
              <small>{result.report_md || 'no report path'}</small>
            </div>
          </div>
          <div className="systems-table">
            {result.results.slice(0, 12).map((item, index) => (
              <div className="systems-row" key={index}>
                <span className={`systems-badge ${item.ok ? 'is-allow' : 'is-deny'}`}>
                  {item.ok ? 'PASS' : 'FAIL'}
                </span>
                <span className="systems-main">
                  <strong>{item.title || `case ${index + 1}`}</strong>
                  <small>{item.reason || item.kind || ''}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="systems-note">{note || '测试执行会按项目基线隔离环境，并留下报告。'}</div>
    </div>
  );
}

function SoftwareTab({
  engine,
  onClose,
}: {
  engine: FluxEngine;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SoftwareSearchResult | null>(null);
  const [installed, setInstalled] = useState<SoftwarePackage[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const loadInstalled = () => {
    setBusy(true);
    void api
      .softwareList()
      .then((next) => setInstalled(next.packages))
      .catch((e) => setNote(errText(e)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    loadInstalled();
  }, []);

  const ask = (message: string) => {
    if (engine.busy) {
      setNote('引擎正在执行另一轮任务，请先停止它');
      return;
    }
    onClose();
    void engine.send(message);
  };

  return (
    <div className="systems-stack">
      <section className="systems-section">
        <SectionHead title="SOFTWARE SEARCH" meta={result ? `${result.pm} · ${result.packages.length} RESULTS` : 'WINGET / CHOCO / SCOOP'} />
        <form
          className="systems-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!query.trim()) return;
            setBusy(true);
            try {
              setResult(await api.softwareSearch(query.trim()));
            } catch (e) {
              setNote(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            className="span-two"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索软件，例如 Chrome / 7zip / VSCode…"
            aria-label="搜索软件"
          />
          <button type="submit" className="control-button" disabled={busy}>
            search
          </button>
        </form>
        <div className="systems-table">
          {(result?.packages ?? []).slice(0, 30).map((pkg) => (
            <div className="systems-row" key={`${pkg.id}-${pkg.name}`}>
              <span className="systems-badge">{pkg.source || 'PKG'}</span>
              <span className="systems-main">
                <strong>{pkg.name}</strong>
                <small>{pkg.id}{pkg.version ? ` · ${pkg.version}` : ''}</small>
              </span>
              <button
                type="button"
                className="systems-action"
                onClick={() => ask(`请用软件管家安装 ${pkg.name}（id: ${pkg.id}）。安装前先检查是否已安装。`)}
              >
                install
              </button>
            </div>
          ))}
          {result && result.packages.length === 0 && (
            <div className="systems-empty-inline">没有搜索结果</div>
          )}
        </div>
        {result?.raw && <pre className="systems-output">{result.raw}</pre>}
      </section>

      <section className="systems-section">
        <SectionHead
          title="INSTALLED SOFTWARE"
          meta={`${installed.length} PACKAGES`}
          action={
            <button type="button" className="text-action" onClick={loadInstalled}>
              <RefreshCw size={11} /> rescan
            </button>
          }
        />
        <div className="systems-table">
          {installed.slice(0, 60).map((pkg) => (
            <div className="systems-row" key={`${pkg.id}-${pkg.name}`}>
              <span className="systems-badge">INSTALLED</span>
              <span className="systems-main">
                <strong>{pkg.name}</strong>
                <small>{pkg.publisher || pkg.id}{pkg.version ? ` · ${pkg.version}` : ''}</small>
              </span>
              <button
                type="button"
                className="systems-action"
                onClick={() => ask(`请用软件管家卸载 ${pkg.name}（id: ${pkg.id}）。`)}
              >
                remove
              </button>
            </div>
          ))}
          {installed.length === 0 && <div className="systems-empty-inline">没有读取到已安装软件</div>}
        </div>
      </section>
      <div className="systems-note">
        {note || '安装/卸载交给 Agent 规划和执行；危险动作仍会先请求你的同意。'}
      </div>
    </div>
  );
}

export function SystemsPanel({
  engine,
  onClose,
  initialTab = 'automation',
}: {
  engine: FluxEngine;
  onClose: () => void;
  initialTab?: SystemsTabId;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  return (
    <div className="systems-layout">
      <div className="systems-heading">
        <div>
          <span className="control-eyebrow">ENGINE CONTROL · FULL SURFACE</span>
          <h2>
            Everything
            <br />
            else.
          </h2>
        </div>
        <p>
          自动化、模型对比、多 Agent 会议室、项目、测试和软件管家都在这一页里。模型、语音、连接、
          权限与系统配置已统一收进「设置 · 配置甲板」，这里只保留真正会运行东西的操作面。
        </p>
      </div>

      <div className="systems-tabs" role="tablist" aria-label="引擎控制">
        {TABS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? 'is-active' : ''}
            onClick={() => setTab(item.id)}
            role="tab"
            aria-selected={tab === item.id}
          >
            <span>{item.label}</span>
            <small>{item.meta}</small>
          </button>
        ))}
      </div>

      <div className="systems-body">
        {tab === 'automation' && <AutomationTab />}
        {tab === 'studio' && <StudioTab engine={engine} />}
        {tab === 'projects' && <ProjectsTab engine={engine} />}
        {tab === 'tests' && <TestLabTab />}
        {tab === 'software' && <SoftwareTab engine={engine} onClose={onClose} />}
      </div>
    </div>
  );
}
