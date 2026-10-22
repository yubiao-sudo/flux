import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  Check,
  Cpu,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import type { FluxEngine } from './useFluxEngine';
import {
  ConnectorsTab,
  RuntimeTab,
  SecurityTab,
  SystemsPanel,
  SystemTab,
  type SystemsTabId,
} from './SystemsPanel';
import { WatchkeeperPanel } from './WatchkeeperPanel';
import type { LargeModuleId, AgentState, SettingsCategory } from '../types';
import JobHuntPanel from '../auxiliary/components/JobHuntPanel';
import type { ModelProfile, ProviderKind, ModelTier } from './types';

const panelSpring = {
  type: 'spring',
  stiffness: 105,
  damping: 22,
  mass: 1,
} as const;

const soft = [0.16, 1, 0.3, 1] as const;

type Props = {
  engine: FluxEngine;
  panel: Exclude<LargeModuleId, 'browser' | 'esports' | 'play' | 'chronicle' | 'atlas' | 'dossier'>;
  onClose: () => void;
  settingsCategory?: SettingsCategory;
  onSettingsCategory?: (category: SettingsCategory) => void;
  systemsTab?: SystemsTabId;
  state: AgentState;
};

const PANEL_META: Record<
  Exclude<LargeModuleId, 'browser' | 'esports' | 'play' | 'chronicle' | 'atlas' | 'dossier'>,
  { code: string; title: string; meta: string }
> = {
  settings: { code: 'CORE / SETTINGS', title: '配置甲板', meta: '配置 · 单页' },
  capabilities: { code: 'CORE / CAPABILITIES', title: 'Capability field', meta: 'ENGINE · TOOLS' },
  permission: { code: 'CORE / CONSENT', title: 'Consent required', meta: 'SECURITY · HITL' },
  signal: { code: 'CORE / SIGNAL', title: 'Capability output', meta: 'ACUI · SIGNAL' },
  memory: { code: 'CORE / MEMORY', title: 'Memory field', meta: 'LONG · TERM' },
  sessions: { code: 'CORE / SESSIONS', title: 'Session field', meta: 'HISTORY · LINKS' },
  systems: { code: 'CORE / SYSTEMS', title: 'Engine control', meta: 'FULL · SURFACE' },
  watchkeeper: { code: 'CORE / WATCH', title: '看护 Agent', meta: 'AUTONOMOUS · 只读' },
};

function PanelFrame({
  engine,
  panel,
  state,
  onClose,
  children,
}: Props & { children: React.ReactNode }) {
  const meta = PANEL_META[panel];
  return (
    <motion.section
      className={`chamber chamber--control chamber--${panel}`}
      role="region"
      aria-label={meta.title}
      initial={{ opacity: 0, scale: 0.965, x: 26, filter: 'blur(22px)' }}
      animate={{ opacity: 1, scale: 1, x: 0, filter: 'blur(0px)' }}
      exit={{
        opacity: 0,
        scale: 0.975,
        x: 18,
        filter: 'blur(16px)',
        pointerEvents: 'none',
        transition: { duration: 0.42, ease: soft },
      }}
      transition={panelSpring}
    >
      <header className="lens-bar control-bar">
        <div className="lens-brand">
          <span className="lens-mark">FLUX</span>
          <span className="lens-divider" />
          <span>CORE</span>
        </div>
        <div className="control-title">
          <span>{meta.code}</span>
          <i />
          <span>{meta.title}</span>
        </div>
        <div className="lens-bar-meta engine-meta">
          <span className={`engine-dot engine-dot--${engine.phase}`} />
          <span>{engine.available ? 'ENGINE / LIVE' : 'WEB / PREVIEW'}</span>
          <span>{meta.meta}</span>
        </div>
      </header>

      <div className="control-page">{children}</div>

      <footer className="lens-footer control-footer">
        <span>
          {engine.engineInfo
            ? `${engine.engineInfo.tool_count} CAPABILITIES / v${engine.engineInfo.version}`
            : 'CAPABILITY FIELD'}
        </span>
        <span>
          {panel === 'permission'
            ? 'APPROVE OR DENY TO CONTINUE'
            : `CORE ${state.toUpperCase()} / CLICK OUTSIDE OR ESC TO RETURN`}
        </span>
        <span>FLUX / 01</span>
      </footer>
    </motion.section>
  );
}

export function ModelsPanel({ engine }: { engine: FluxEngine }) {
  const config = engine.modelConfig;
  const profiles = config?.profiles ?? [];
  const [selectedId, setSelectedId] = useState<string>(engine.activeProfile?.id ?? profiles[0]?.id ?? '');
  const [draft, setDraft] = useState<ModelProfile | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    const id = engine.activeProfile?.id ?? config?.profiles?.[0]?.id ?? '';
    setSelectedId((current) => (current && config?.profiles.some((p) => p.id === current) ? current : id));
  }, [engine.activeProfile?.id, config]);

  const selected = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  useEffect(() => {
    if (isNew) return;
    if (selected) {
      setDraft({ ...selected, api_key: '' });
    } else {
      setDraft(null);
    }
  }, [selected?.id, isNew]);

  if (!engine.available) {
    return (
      <div className="control-empty">
        <span>ENGINE OFFLINE</span>
        <p>当前是浏览器设计预览。桌面版会在这里接入模型、权限和全部能力。</p>
      </div>
    );
  }

  const addPreset = (presetId: string) => {
    const preset = engine.vendorPresets.find((item) => item.id === presetId);
    if (!preset) return;
    const profile: ModelProfile = {
      id: `model-${Date.now()}`,
      name: preset.name,
      tier: preset.tier,
      kind: preset.kind,
      base_url: preset.base_url,
      api_key: '',
      model: preset.models[0] ?? '',
      enabled: true,
      has_key: false,
    };
    setIsNew(true);
    setSelectedId(profile.id);
    setDraft(profile);
  };

  const updateDraft = <K extends keyof ModelProfile>(key: K, value: ModelProfile[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = async () => {
    if (!draft) return;
    await engine.saveProfile(draft);
    setIsNew(false);
  };

  return (
    <div className="settings-layout">
      <aside className="control-rail">
        <div className="control-rail-head">
          <span>模型档案</span>
          <span>{String(profiles.length).padStart(2, '0')}</span>
        </div>
        <div className="profile-list">
          {profiles.map((profile) => {
            const active = config?.active === profile.id;
            return (
              <button
                type="button"
                key={profile.id}
                className={`profile-row ${profile.id === selectedId ? 'is-selected' : ''}`}
                onClick={() => {
                  setIsNew(false);
                  setSelectedId(profile.id);
                }}
              >
                <span className={`profile-orb ${active ? 'is-active' : ''}`} />
                <span className="profile-copy">
                  <strong>{profile.name}</strong>
                  <span>
                    {profile.model || '未命名模型'} · {profile.tier}
                  </span>
                </span>
                {active && <span className="profile-active">当前</span>}
              </button>
            );
          })}
          {profiles.length === 0 && <div className="control-empty-inline">还没有模型档案</div>}
        </div>

        <div className="control-rail-section">
          <span>从预设添加</span>
          <div className="preset-list">
            {engine.vendorPresets.slice(0, 6).map((preset) => (
              <button
                type="button"
                key={preset.id}
                className="preset-chip"
                onClick={() => addPreset(preset.id)}
              >
                {preset.name}
              </button>
            ))}
            {engine.vendorPresets.length === 0 && (
              <button type="button" className="preset-chip" onClick={() => addPreset('__blank__')}>
                custom
              </button>
            )}
          </div>
        </div>

        <div className="control-rail-section engine-facts">
          <span>ENGINE</span>
          <dl>
            <div>
              <dt>VERSION</dt>
              <dd>{engine.engineInfo?.version ?? '—'}</dd>
            </div>
            <div>
              <dt>TOOLS</dt>
              <dd>{engine.engineInfo?.tool_count ?? '—'}</dd>
            </div>
            <div>
              <dt>DATA</dt>
              <dd className="data-path" title={engine.engineInfo?.data_root}>
                {engine.engineInfo?.data_root ?? '—'}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="text-action"
            onClick={() => {
              void engine.refreshModels();
              void engine.refreshEngineInfo();
            }}
          >
            <RefreshCw size={11} /> refresh engine
          </button>
        </div>
      </aside>

      <section className="control-main">
        <div className="control-heading">
          <div>
            <span className="control-eyebrow">模型核心</span>
            <h2>{draft?.name || 'No model selected'}</h2>
          </div>
          {draft && (
            <div className="control-heading-meta">
              <span>{draft.tier.toUpperCase()}</span>
              <span>{draft.enabled ? 'ENABLED' : 'DISABLED'}</span>
              {draft.has_key && <span className="key-saved"><KeyRound size={10} /> KEY SAVED</span>}
            </div>
          )}
        </div>

        {draft ? (
          <div className="settings-form">
            <label>
              <span>档案名称</span>
              <input
                value={draft.name}
                onChange={(event) => updateDraft('name', event.target.value)}
                placeholder="例如 deepseek-main"
              />
            </label>
            <label>
              <span>供应商</span>
              <select
                value={draft.kind}
                onChange={(event) => updateDraft('kind', event.target.value as ProviderKind)}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
                <option value="ollama">Ollama / 本地</option>
              </select>
            </label>
            <label className="span-two">
              <span>基础 URL</span>
              <input
                value={draft.base_url}
                onChange={(event) => updateDraft('base_url', event.target.value)}
                placeholder="https://api.deepseek.com"
                spellCheck={false}
              />
            </label>
            <label>
              <span>模型</span>
              <input
                value={draft.model}
                onChange={(event) => updateDraft('model', event.target.value)}
                placeholder="deepseek-chat"
                spellCheck={false}
              />
            </label>
            <label>
              <span>层级</span>
              <select value={draft.tier} onChange={(event) => updateDraft('tier', event.target.value as ModelTier)}>
                <option value="cloud">云端</option>
                <option value="local">本地</option>
              </select>
            </label>
            <label className="span-two">
              <span>API 密钥</span>
              <input
                type="password"
                value={draft.api_key}
                onChange={(event) => updateDraft('api_key', event.target.value)}
                placeholder={draft.has_key ? '已保存 · 留空保持原密钥' : '粘贴 API Key'}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label>
              <span>视觉模型（可选）</span>
              <input
                value={draft.vision_model ?? ''}
                onChange={(event) => updateDraft('vision_model', event.target.value || null)}
                placeholder="复用主模型或填写视觉模型"
                spellCheck={false}
              />
            </label>
            <label>
              <span>向量模型（可选）</span>
              <input
                value={draft.embedding_model ?? ''}
                onChange={(event) => updateDraft('embedding_model', event.target.value || null)}
                placeholder="nomic-embed-text / text-embedding-…"
                spellCheck={false}
              />
            </label>
            <label className="toggle-row span-two">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => updateDraft('enabled', event.target.checked)}
              />
              <span>允许作为当前模型链的一员</span>
            </label>
            <label className="toggle-row span-two">
              <input
                type="checkbox"
                checked={Boolean(draft.multimodal)}
                onChange={(event) => updateDraft('multimodal', event.target.checked)}
              />
              <span>该模型支持图片输入（多模态）</span>
            </label>

            <div className="settings-actions span-two">
              <button
                type="button"
                className="control-button"
                onClick={() => void engine.activateModel(draft.id)}
                disabled={isNew || engine.modelBusy}
              >
                <Check size={12} /> 启用
              </button>
              <button
                type="button"
                className="control-button"
                onClick={() => void engine.testProfile(draft.id)}
                disabled={isNew || engine.modelBusy}
              >
                <ArrowUpRight size={12} /> 测试
              </button>
              <button type="button" className="control-button is-primary" onClick={() => void save()} disabled={engine.modelBusy}>
                {isNew ? '新建档案' : '保存档案'}
              </button>
            </div>
            <div className="settings-note span-two">
              {engine.modelBusy ? '正在与模型核对话…' : engine.modelNote || '密钥保存在本机 vault，不会离开这台机器。'}
            </div>
          </div>
        ) : (
          <div className="control-empty">
            <span>暂无模型档案</span>
            <p>从左侧预设创建一个模型档案，或点击下方按钮刷新引擎。</p>
            <button
              type="button"
              className="control-button"
              disabled={engine.modelBusy}
              onClick={() => void engine.refreshModels()}
            >
              <RefreshCw size={12} /> 刷新
            </button>
          </div>
        )}

        <div className="control-section-title">
          <span>能力引擎</span>
          <span>{engine.capabilities.length} TOOLS LINKED</span>
        </div>
        <div className="engine-info-grid">
          <div>
            <span>模型路由</span>
            <strong>{engine.activeProfile?.name ?? 'unbound'}</strong>
            <small>{engine.activeProfile?.model ?? 'configure a profile'}</small>
          </div>
          <div>
            <span>健康</span>
            <strong>
              {engine.activeProfile && engine.modelHealth[engine.activeProfile.id]?.ok
                ? 'nominal'
                : engine.activeProfile
                  ? 'unchecked'
                  : '—'}
            </strong>
            <small>{engine.modelHealth[engine.activeProfile?.id ?? '']?.detail ?? 'no probe yet'}</small>
          </div>
          <div>
            <span>CORE</span>
            <strong>{engine.phase}</strong>
            <small>{engine.error ?? 'FLUX runtime attached'}</small>
          </div>
        </div>
      </section>
    </div>
  );
}

function categorize(name: string, description: string) {
  const text = `${name} ${description}`.toLowerCase();
  if (/browser|web|cdp|tab|url|search_web|navigate/.test(text)) return '浏览器 / 网络';
  if (/screen|som|click|mouse|keyboard|window|app|desktop|computer|ocr|vision|screenshot/.test(text))
    return '屏幕 / Computer Use';
  if (/memory|rag|kb_|knowledge|embedding|remember|forget/.test(text)) return '记忆 / 知识';
  if (/file|document|docx|excel|sheet|pdf|office|clipboard|markdown|spreadsheet/.test(text))
    return '文件 / 文档';
  if (/mail|email|wechat|feishu|im_|message|notify|webhook|gateway/.test(text)) return '通信 / 消息';
  if (/workflow|schedule|cron|job|task|timer|calendar|todo/.test(text)) return '自动化 / 时间';
  if (/shell|command|terminal|process|software|install|registry|env|system/.test(text))
    return '系统 / 软件';
  if (/image|audio|video|tts|voice|speech|media/.test(text)) return '媒体 / 感知';
  if (/agent|meeting|team|subagent|test|replay/.test(text)) return '多智能体 / 测试';
  if (/model|config|mcp|plugin|token|audit|permission|security/.test(text)) return '内核 / 配置';
  return '其他能力';
}

function CapabilityPanel({ engine }: { engine: FluxEngine }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof engine.capabilities>();
    for (const tool of engine.capabilities) {
      const key = categorize(tool.name, tool.description ?? '');
      const bucket = map.get(key) ?? [];
      bucket.push(tool);
      map.set(key, bucket);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [engine.capabilities]);

  return (
    <div className="capability-page">
      <div className="capability-hero">
        <div>
          <span className="control-eyebrow">FORMERLY BAIZE · NOW FLUX</span>
          <h2>
            Every ability,
            <br />
            one surface.
          </h2>
          <p>
            底层引擎的全部工具注册表已经完整接入。你现在可以用自然语言或声音调用它们；危险动作会经过同一套审批。
          </p>
        </div>
        <div className="capability-stat">
          <strong>{engine.capabilities.length || '—'}</strong>
          <span>LIVE TOOLS</span>
          <small>{groups.length} capability families</small>
        </div>
        <div className="capability-stat">
          <strong>{engine.engineInfo?.version ?? '—'}</strong>
          <span>ENGINE</span>
          <small>{engine.engineInfo?.fallback_data ? 'fallback data dir' : 'local data dir'}</small>
        </div>
      </div>

      <div className="capability-actions">
        <span>REGISTRY / READ-TIME</span>
        <button type="button" className="text-action" onClick={() => void engine.refreshEngineInfo()}>
          <RefreshCw size={11} /> rescan
        </button>
      </div>

      <div className="capability-groups">
        {groups.map(([title, tools]) => (
          <section className="capability-group" key={title}>
            <header>
              <span>{title}</span>
              <strong>{String(tools.length).padStart(2, '0')}</strong>
            </header>
            <div className="capability-list">
              {tools.map((tool) => (
                <div className="capability-row" key={tool.name} title={tool.description}>
                  <span className={`cap-class cap-class--${(tool.class || 'readonly').toLowerCase()}`}>
                    {tool.class || 'ReadOnly'}
                  </span>
                  <span className="cap-name">{tool.name}</span>
                  <span className="cap-desc">{tool.description}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <div className="control-empty">
            <span>READING TOOL REGISTRY</span>
            <p>引擎正在启动，能力列表会在工具注册完成后出现。</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionPanel({ engine, onClose }: { engine: FluxEngine; onClose: () => void }) {
  const request = engine.permissions[0];
  if (!request) {
    return (
      <div className="control-empty">
        <span>NO PENDING CONSENT</span>
        <p>没有等待审批的动作。</p>
        <button type="button" className="control-button" onClick={onClose}>
          return to core
        </button>
      </div>
    );
  }

  const classLabel = request.class === 'HighRisk' ? 'HIGH RISK' : request.class === 'Write' ? 'WRITE' : 'READ ONLY';
  const classText = request.class === 'HighRisk' ? '高风险' : request.class === 'Write' ? '写入' : '只读';
  return (
    <div className="consent-layout">
      <div className="consent-mark">
        <ShieldAlert size={25} strokeWidth={1.1} />
        <span>{String(engine.permissions.length).padStart(2, '0')} PENDING</span>
      </div>
      <div className="consent-copy">
        <span className="control-eyebrow">ACTION INTERCEPTED</span>
        <h2>I need your consent.</h2>
        <p>
          引擎准备调用 <strong>{request.tool}</strong>。这是一个 {classText} 动作。
          你可以逐次批准，或将它加入长期规则。
        </p>
        <div className="consent-meta">
          <span className={`cap-class cap-class--${request.class.toLowerCase()}`}>{classLabel}</span>
          <span>{request.id.slice(0, 18)}</span>
        </div>
        <pre className="consent-args">{JSON.stringify(request.args ?? {}, null, 2)}</pre>
        <div className="consent-actions">
          <button
            type="button"
            className="control-button"
            onClick={() => {
              void engine.resolveRequest(request.id, false);
              onClose();
            }}
          >
            <X size={12} /> deny
          </button>
          <button
            type="button"
            className="control-button"
            onClick={() => void engine.resolveRequest(request.id, true, false)}
          >
            <Check size={12} /> allow once
          </button>
          <button
            type="button"
            className="control-button is-primary"
            onClick={() => void engine.resolveRequest(request.id, true, true)}
          >
            allow + remember
          </button>
        </div>
        <div className="consent-hint">也可以用声音说「允许」或「拒绝」。</div>
      </div>
    </div>
  );
}

function SignalPanel({ engine }: { engine: FluxEngine }) {
  const card = engine.cards[engine.cards.length - 1];
  if (!card) {
    return (
      <div className="control-empty">
        <span>NO ACTIVE SIGNAL</span>
        <p>当引擎生成可交互卡片、进度或结构化结果时，它会在这里展开。</p>
      </div>
    );
  }

  return (
    <div className="signal-layout">
      <div className="signal-head">
        <div>
          <span className="control-eyebrow">{card.kind.toUpperCase()} SIGNAL</span>
          <h2>{card.title || 'Untitled signal'}</h2>
        </div>
        <div className="signal-actions">
          {engine.cards.length > 1 && <span>{engine.cards.length} IN QUEUE</span>}
          <button type="button" className="text-action" onClick={() => engine.dismissCard(card.id)}>
            <X size={11} /> dismiss
          </button>
        </div>
      </div>
      {typeof card.progress === 'number' && (
        <div className="signal-progress">
          <span style={{ width: `${Math.max(0, Math.min(100, card.progress))}%` }} />
        </div>
      )}
      <div className="signal-body">
        {card.body && <p>{card.body}</p>}
        {card.data && <pre>{card.data}</pre>}
        {!card.body && !card.data && <p>这个信号没有附带正文。</p>}
      </div>
      <footer className="signal-foot">
        <span>SIGNAL / {card.id.slice(0, 24)}</span>
        <span><Sparkles size={11} /> GENERATED BY THE CORE</span>
      </footer>
    </div>
  );
}

function MemoryPanel({ engine }: { engine: FluxEngine }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (engine.available) void engine.refreshMemories();
  }, [engine.available, engine.refreshMemories]);

  const kinds = useMemo(
    () => [...new Set(engine.memories.map((memory) => memory.kind))].sort(),
    [engine.memories],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return engine.memories.filter((memory) => {
      if (kind !== 'all' && memory.kind !== kind) return false;
      if (!needle) return true;
      return memory.content.toLowerCase().includes(needle) || memory.kind.toLowerCase().includes(needle);
    });
  }, [engine.memories, kind, query]);

  const selected =
    engine.memories.find((memory) => memory.mem_id === selectedId) ??
    filtered[0] ??
    null;

  const positions = useMemo(() => {
    const nodes = engine.memoryGraph?.nodes ?? [];
    const map = new Map<string, { x: number; y: number; r: number }>();
    nodes.forEach((node, index) => {
      const angle = index * 2.399963229728653;
      const radius = 18 + Math.sqrt((index + 1) / Math.max(nodes.length, 1)) * 166;
      map.set(node.mem_id, {
        x: 310 + Math.cos(angle) * radius,
        y: 205 + Math.sin(angle) * radius,
        r: 2.4 + Math.min(6.5, Math.max(0, node.salience) * 0.55),
      });
    });
    return map;
  }, [engine.memoryGraph]);

  const edges = engine.memoryGraph?.edges ?? [];
  const nodes = engine.memoryGraph?.nodes ?? [];

  return (
    <div className="memory-layout">
      <div className="memory-hero">
        <div>
          <span className="control-eyebrow">LONG-TERM FIELD · LOCAL SQLITE</span>
          <h2>
            What the core
            <br />
            remembers.
          </h2>
          <p>
            记忆不是聊天记录。它会被召回、合并、衰减，并在下一次对话里改变回答。这里是引擎真实持有的长期场。
          </p>
        </div>
        <div className="memory-stat">
          <strong>{engine.memories.length || '—'}</strong>
          <span>MEMORIES</span>
          <small>{engine.memoryGraph?.edges.length ?? 0} semantic links</small>
        </div>
        <div className="memory-stat">
          <strong>{kinds.length || '—'}</strong>
          <span>KINDS</span>
          <small>{engine.memoryBusy ? 'reading field…' : 'live store'}</small>
        </div>
      </div>

      <div className="memory-body">
        <section className="memory-map">
          <header>
            <span>SEMANTIC MAP / {nodes.length} NODES</span>
            <button
              type="button"
              className="text-action"
              disabled={engine.memoryBusy}
              onClick={() => void engine.refreshMemories()}
            >
              <RefreshCw size={11} /> rescan
            </button>
          </header>
          <div className="memory-map-stage">
            <svg viewBox="0 0 620 410" className="memory-svg" role="img" aria-label="记忆图谱">
              <defs>
                <radialGradient id="memory-core" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(178,220,216,0.11)" />
                  <stop offset="100%" stopColor="rgba(178,220,216,0)" />
                </radialGradient>
              </defs>
              <circle cx="310" cy="205" r="190" fill="url(#memory-core)" />
              <circle cx="310" cy="205" r="186" className="memory-orbit" />
              <circle cx="310" cy="205" r="124" className="memory-orbit" />
              <circle cx="310" cy="205" r="62" className="memory-orbit" />
              {edges.map((edge, index) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${edge.from}-${edge.to}-${index}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className="memory-edge"
                    style={{ opacity: 0.05 + Math.min(0.34, Math.max(0, edge.weight) * 0.25) }}
                  />
                );
              })}
              {nodes.map((node) => {
                const point = positions.get(node.mem_id);
                if (!point) return null;
                const active = selected?.mem_id === node.mem_id;
                return (
                  <circle
                    key={node.mem_id}
                    cx={point.x}
                    cy={point.y}
                    r={active ? point.r + 2.4 : point.r}
                    className={`memory-node ${active ? 'is-selected' : ''}`}
                    data-kind={node.kind}
                    onClick={() => setSelectedId(node.mem_id)}
                  >
                    <title>{node.content.slice(0, 120)}</title>
                  </circle>
                );
              })}
              {nodes.length === 0 && (
                <text x="310" y="205" textAnchor="middle" className="memory-empty-label">
                  NO SEMANTIC LINKS YET
                </text>
              )}
            </svg>
            <div className="memory-legend">
              {kinds.slice(0, 6).map((item) => (
                <span key={item}>
                  <i data-kind={item} /> {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="memory-side">
          <div className="memory-tools">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索记忆…"
              aria-label="搜索记忆"
            />
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="all">全部类型</option>
              {kinds.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <form
            className="memory-add"
            onSubmit={(event) => {
              event.preventDefault();
              void engine.addMemoryEntry(draft);
              setDraft('');
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="写入一条会被长期记住的事…"
              aria-label="新增记忆"
            />
            <button type="submit" className="control-button" disabled={!draft.trim()}>
              remember
            </button>
          </form>

          <div className="memory-list">
            {filtered.map((memory) => (
              <button
                type="button"
                key={memory.mem_id}
                className={`memory-row ${selected?.mem_id === memory.mem_id ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(memory.mem_id)}
              >
                <span className="memory-kind">{memory.kind}</span>
                <span className="memory-content">{memory.content}</span>
                <span className="memory-salience">{Math.round(memory.salience * 10) / 10}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="control-empty-inline">没有匹配的记忆</div>}
          </div>

          {selected && (
            <div className="memory-detail">
              <span>{selected.kind} / {selected.mem_id.slice(0, 12)}</span>
              <p>{selected.content}</p>
              <div>
                <button type="button" className="text-action" onClick={() => void engine.pinMemoryEntry(selected.mem_id)}>
                  <Check size={11} /> pin
                </button>
                <button type="button" className="text-action" onClick={() => void engine.deleteMemoryEntry(selected.mem_id)}>
                  <X size={11} /> forget
                </button>
              </div>
            </div>
          )}
          <div className="memory-note">{engine.memoryNote || '记忆保存在本机，不会上传。'}</div>
        </section>
      </div>
    </div>
  );
}

function SessionsPanel({ engine, onClose }: { engine: FluxEngine; onClose: () => void }) {
  useEffect(() => {
    if (engine.available) void engine.refreshConversations();
  }, [engine.available, engine.refreshConversations]);

  return (
    <div className="sessions-layout">
      <div className="control-heading">
        <div>
          <span className="control-eyebrow">CONVERSATION HISTORY · LOCAL</span>
          <h2>
            Threads of
            <br />
            thought.
          </h2>
        </div>
        <div className="sessions-head">
          <strong>{engine.conversations.length}</strong>
          <span>SESSIONS</span>
          <button
            type="button"
            className="control-button"
            disabled={engine.sessionBusy || engine.busy}
            onClick={async () => {
              await engine.newConversation();
              onClose();
            }}
          >
            new session
          </button>
        </div>
      </div>

      <div className="sessions-list">
        {engine.conversations.map((conversation) => {
          const current = conversation.id === engine.convId;
          return (
            <div className={`session-row ${current ? 'is-current' : ''}`} key={conversation.id}>
              <button
                type="button"
                className="session-main"
                onClick={async () => {
                  if (current) {
                    onClose();
                    return;
                  }
                  await engine.switchConversation(conversation.id);
                  onClose();
                }}
              >
                <span className="session-orb" />
                <span className="session-copy">
                  <strong>{conversation.title || '未命名会话'}</strong>
                  <span>
                    {new Date(conversation.created_at).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {conversation.project_id ? ` · ${conversation.project_id.slice(0, 8)}` : ''}
                  </span>
                </span>
                {current && <span className="session-live">LIVE</span>}
              </button>
              <button
                type="button"
                className="session-remove"
                aria-label="删除会话"
                disabled={engine.sessionBusy}
                onClick={() => void engine.deleteConversationById(conversation.id)}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        {engine.conversations.length === 0 && (
          <div className="control-empty-inline">还没有会话。新的会话会从这里开始。</div>
        )}
      </div>

      <div className="sessions-footer">
        <button type="button" className="control-button" onClick={() => void engine.exportCurrentConversation()}>
          export current
        </button>
        <button
          type="button"
          className="control-button"
          disabled={engine.sessionBusy || engine.busy}
          onClick={() => void engine.deleteConversationById(engine.convId)}
        >
          delete current
        </button>
        <span>{engine.sessionNote || '切换会话不会丢失任何一条记忆。'}</span>
      </div>
    </div>
  );
}

const SETTINGS_CATEGORIES: Array<{
  id: SettingsCategory;
  label: string;
  meta: string;
  title: string;
  description: string;
  chips: string[];
}> = [
  {
    id: 'models',
    label: '模型',
    meta: '档案 · API · 视觉',
    title: '模型与思维',
    description:
      '模型档案、云端/本地供应商、视觉与向量模型、多模态。这里是 FLUX 推理的来源。',
    chips: ['档案', '视觉', '向量', '多模态'],
  },
  {
    id: 'runtime',
    label: '运行',
    meta: '模式 · 用量 · 通知',
    title: '它如何行动',
    description:
      '工作模式、语音音色、模型用量、Token 节省、L0–L4 通知与夜间记忆整理。决定 FLUX 说话和行动的方式。',
    chips: ['工作模式', '语音', '用量', 'Token 节省', 'L0–L4'],
  },
  {
    id: 'connections',
    label: '连接',
    meta: 'MCP · 机器人 · 知识',
    title: '它能触达什么',
    description:
      'MCP 工具、本地网关、微信二维码/飞书、消息总线、数据库、远程知识库与本地 RAG。',
    chips: ['MCP', '二维码', '消息总线', '知识库'],
  },
  {
    id: 'security',
    label: '安全',
    meta: '规则 · 策略 · 审计',
    title: '什么被允许',
    description:
      '长期权限规则、细粒度 Permission Policy、审计记录，以及危险动作的同意边界。',
    chips: ['规则', '策略', '审计'],
  },
  {
    id: 'system',
    label: '系统',
    meta: '环境 · 文档 · 更新',
    title: '运行它的机器',
    description:
      '运行环境、文档解析依赖、磁盘、系统配置、更新与数据目录。FLUX 的身体。',
    chips: ['环境', '文档解析', '更新'],
  },
  {
    id: 'jobhunt',
    label: '求职',
    meta: '简历 · 平台 · 筛选',
    title: '替你去投简历',
    description:
      '配置目标岗位、城市、薪资、排除关键词、多份简历与投递平台。配好后在对话里说「投递简历」，FLUX 会按这份要求搜索、筛选、投递并回复 HR。',
    chips: ['简历', '平台', '筛选', '自动回复'],
  },
];

export function SettingsDeck({
  engine,
  category,
  onCategory,
}: {
  engine: FluxEngine;
  category: SettingsCategory;
  onCategory: (category: SettingsCategory) => void;
}) {
  const active = SETTINGS_CATEGORIES.find((item) => item.id === category) ?? SETTINGS_CATEGORIES[0];
  const index = SETTINGS_CATEGORIES.findIndex((item) => item.id === active.id) + 1;

  useEffect(() => {
    document.querySelector('.control-page')?.scrollTo({ top: 0 });
  }, [category]);

  return (
    <div className="settings-deck">
      <nav className="settings-deck-nav" aria-label="设置分类">
        {SETTINGS_CATEGORIES.map((item, i) => (
          <button
            type="button"
            key={item.id}
            className={item.id === active.id ? 'is-active' : ''}
            onClick={() => onCategory(item.id)}
            aria-pressed={item.id === active.id}
          >
            <span>{String(i + 1).padStart(2, '0')}</span>
            <strong>{item.label}</strong>
            <small>{item.meta}</small>
          </button>
        ))}
      </nav>

      <header className="settings-deck-hero">
        <div>
          <span>配置 / {String(index).padStart(2, '0')}</span>
          <h2>{active.title}</h2>
          <p>{active.description}</p>
        </div>
        <div className="settings-deck-chips">
          {active.chips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      </header>

      <div className="settings-deck-body">
        {active.id === 'models' && <ModelsPanel engine={engine} />}
        {active.id === 'runtime' && <RuntimeTab />}
        {active.id === 'connections' && <ConnectorsTab engine={engine} />}
        {active.id === 'security' && <SecurityTab />}
        {active.id === 'system' && <SystemTab />}
        {active.id === 'jobhunt' && <JobHuntPanel />}
      </div>
    </div>
  );
}

export function EnginePanel({
  engine,
  panel,
  state,
  onClose,
  settingsCategory = 'models',
  onSettingsCategory,
  systemsTab,
}: Props) {
  return (
    <PanelFrame engine={engine} panel={panel} state={state} onClose={onClose}>
      {panel === 'settings' && (
        <SettingsDeck
          engine={engine}
          category={settingsCategory}
          onCategory={onSettingsCategory ?? (() => undefined)}
        />
      )}
      {panel === 'capabilities' && <CapabilityPanel engine={engine} />}
      {panel === 'permission' && <PermissionPanel engine={engine} onClose={onClose} />}
      {panel === 'signal' && <SignalPanel engine={engine} />}
      {panel === 'memory' && <MemoryPanel engine={engine} />}
      {panel === 'sessions' && <SessionsPanel engine={engine} onClose={onClose} />}
      {panel === 'watchkeeper' && <WatchkeeperPanel />}
      {panel === 'systems' && (
        <SystemsPanel engine={engine} onClose={onClose} initialTab={systemsTab} />
      )}
    </PanelFrame>
  );
}
