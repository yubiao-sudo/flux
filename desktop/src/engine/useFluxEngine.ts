import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  addMemory,
  chat,
  createConversation,
  deleteConversation as deleteConversationApi,
  deleteMemoryById,
  exportConversation as exportConversationApi,
  getMemoryGraph,
  getMessages,
  getModelConfig,
  getModelHealth,
  getPendingPermissions,
  getVendorPresets,
  listConversations,
  listMemoriesPanel,
  onAcuiCard,
  onChatRoundReset,
  onChatToken,
  onEscalationLevel,
  onNotifyUserRequest,
  onFluxNotifyMessage,
  onPanelControl,
  onPermissionRequest,
  onProactive,
  onThought,
  onTodoUpdate,
  pinMemoryById,
  resolvePermission,
  setActiveModel,
  setModelConfig,
  stopChat,
  testModelProfile,
} from './api';
import type { ModelHealth } from './api';
import type {
  AcuiCardData,
  ChatMsg,
  Conversation,
  MemoryGraph,
  MemoryRow,
  MessageRow,
  ModelConfig,
  ModelProfile,
  PermissionRequest,
  ProactiveCard,
  ThoughtEvent,
  Todo,
  VendorPreset,
} from './types';
import type { Turn } from '../types';

export type EnginePhase = 'browser' | 'boot' | 'ready' | 'no-model' | 'error';

export type EngineCapability = {
  name: string;
  description: string;
  class: string;
};

export type EngineInfo = {
  name: string;
  version: string;
  tool_count: number;
  data_root: string;
  fallback_data: boolean;
};

export type EnginePanelRequest = {
  action: 'open' | 'close';
  panel?: string;
  tab?: string;
};

export type EngineSendResult = {
  ok: boolean;
  reply?: string;
  error?: string;
};

export type ChatCardData = {
  id: string;
  title: string;
  html: string;
  width: string;
  height: string;
};

export type FluxNotice = {
  id: string;
  tone: 'info' | 'attention' | 'critical';
  title: string;
  body: string;
  detail: string;
  at: number;
  persistent: boolean;
};

/**
 * chat_card 是附加在回复末尾的 ```chat_card JSON``` 围栏块。
 * 它属于推送卡片，不属于聊天正文；在进入 transcript 前剥离。
 */
function extractChatCards(text: string): { text: string; cards: ChatCardData[] } {
  const cards: ChatCardData[] = [];
  const cleaned = text.replace(/```chat_card\s*\n?([\s\S]*?)```/g, (_all, body: string) => {
    try {
      const parsed = JSON.parse(body.trim()) as {
        title?: string;
        html?: string;
        width?: string;
        height?: string;
      };
      const html = String(parsed.html ?? '').trim();
      if (html) {
        cards.push({
          id: `chat-card-${Date.now()}-${cards.length}-${Math.random().toString(36).slice(2, 6)}`,
          title: String(parsed.title ?? ''),
          html,
          width: String(parsed.width ?? '100%'),
          height: String(parsed.height ?? ''),
        });
      }
    } catch {
      // Malformed card is discarded; the transcript must stay clean.
    }
    return '';
  });
  return {
    text: cleaned.replace(/\n{3,}/g, '\n\n').trim(),
    cards,
  };
}

const FLUX_CONVERSATION_TITLE = 'FLUX / 流形';

function describeError(raw: unknown): { message: string; detail: string } {
  const detail = String(raw ?? '')
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
  const probe = detail.toLowerCase();
  if (/timeout|timed out|超时/.test(probe)) {
    return { message: '模型响应超时了。网络或本地模型可能正忙，稍后重试。', detail };
  }
  if (/401|403|unauthor|forbidden|api key|密钥|鉴权/.test(probe)) {
    return { message: '模型密钥没有通过验证。去设置 › 运行 › 模型核心检查。', detail };
  }
  if (/econnrefused|connection refused|network|网络|dns/.test(probe)) {
    return { message: '模型服务没有响应。检查服务地址或本地模型是否已启动。', detail };
  }
  if (/busy|正在处理|上一轮/.test(probe)) {
    return { message: '内核还在处理上一条消息。稍等一下，或先打断它。', detail };
  }
  if (!detail) {
    return { message: '这次请求没有完成。可以直接重试，或查看设置里的引擎状态。', detail: '' };
  }
  return { message: '这次请求没有完成。可以直接重试，或查看设置里的引擎状态。', detail };
}
const ACTIVE_CONVERSATION_KEY = 'flux.active_conversation';

function readActiveConversation(): string {
  try {
    return window.localStorage.getItem(ACTIVE_CONVERSATION_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberActiveConversation(id: string) {
  try {
    window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
  } catch {
    /* private mode / storage disabled */
  }
}

function isTauriRuntime() {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

let turnSeq = 0;
const makeTurn = (role: Turn['role'], text: string, at = Date.now()): Turn => ({
  id: `engine-${Date.now()}-${turnSeq++}`,
  role,
  text,
  at,
});

const hydrate = (rows: MessageRow[]): Turn[] =>
  rows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) =>
      makeTurn(
        row.role === 'assistant' ? 'agent' : 'user',
        row.role === 'assistant' ? extractChatCards(row.content).text : row.content,
        row.created_at || Date.now(),
      ),
    )
    .filter((turn) => turn.text.trim().length > 0);

const welcomeTurn = (): Turn => ({
  id: 'engine-welcome',
  role: 'agent',
  text: '晚上好。内核已经接上。全部能力现在都在这里。',
  at: Date.now(),
});

const toHistory = (turns: Turn[]): ChatMsg[] =>
  turns
    .filter((turn) => turn.text.trim().length > 0)
    .map((turn) => ({
      role: turn.role === 'user' ? 'user' : 'assistant',
      content: turn.text,
    }));

export function useFluxEngine() {
  const available = useMemo(isTauriRuntime, []);
  const [phase, setPhase] = useState<EnginePhase>(available ? 'boot' : 'browser');
  const [error, setError] = useState<string | null>(null);
  const [convId, setConvId] = useState<string>('');
  const [turns, setTurns] = useState<Turn[]>([]);
  /**
   * 历史整体切换的版本号：初次恢复会话、切换会话、新建会话时 +1。
   * App 用它区分「从数据库加载出来的最后一条」和「本轮刚生成的新回复」——
   * 前者必须整段直接显示，不能走逐字 reveal（否则重启后会把最后一条长回复
   * 按 16 字/秒重新打一遍）。
   */
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [thoughts, setThoughts] = useState<ThoughtEvent[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [cards, setCards] = useState<AcuiCardData[]>([]);
  const [chatCards, setChatCards] = useState<ChatCardData[]>([]);
  const [notices, setNotices] = useState<FluxNotice[]>([]);
  const noticeSeq = useRef(0);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [panelRequest, setPanelRequest] = useState<EnginePanelRequest | null>(null);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [capabilities, setCapabilities] = useState<EngineCapability[]>([]);
  const [modelConfig, setModelConfigState] = useState<ModelConfig | null>(null);
  const [modelHealth, setModelHealth] = useState<Record<string, ModelHealth>>({});
  const [vendorPresets, setVendorPresets] = useState<VendorPreset[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelNote, setModelNote] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionNote, setSessionNote] = useState('');
  const [memoryGraph, setMemoryGraph] = useState<MemoryGraph | null>(null);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryNote, setMemoryNote] = useState('');

  const initRef = useRef(false);
  const aliveRef = useRef(true);
  // Only tokens belonging to a chat initiated by this surface may enter the
  // transcript. Background engine work (warmups, proactive tasks, other tool
  // windows) can emit chat-token events too; they must not masquerade as FLUX's
  // answer.
  const chatBusyRef = useRef(false);

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const pushNotice = useCallback(
    (notice: Omit<FluxNotice, 'id' | 'at'>) => {
      const now = Date.now();
      setNotices((current) => {
        const duplicate = current.some(
          (item) =>
            item.title === notice.title &&
            item.body === notice.body &&
            now - item.at < 2500,
        );
        if (duplicate) return current;
        const next: FluxNotice = {
          ...notice,
          id: `flux-notice-${now}-${noticeSeq.current++}`,
          at: now,
        };
        return [...current.slice(-4), next];
      });
    },
    [],
  );

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const activeProfile = useMemo<ModelProfile | null>(() => {
    if (!modelConfig) return null;
    const byId = modelConfig.profiles?.find((profile) => profile.id === modelConfig.active);
    return byId ?? modelConfig.profiles?.[0] ?? null;
  }, [modelConfig]);

  const refreshEngineInfo = useCallback(async () => {
    if (!available) return;
    const [info, tools] = await Promise.all([
      invoke<EngineInfo>('flux_engine_info'),
      invoke<EngineCapability[]>('flux_capabilities'),
    ]);
    if (!aliveRef.current) return;
    setEngineInfo(info);
    setCapabilities(tools);
  }, [available]);

  const refreshModels = useCallback(async () => {
    if (!available) return;
    setModelBusy(true);
    try {
      const [config, health, presets] = await Promise.all([
        getModelConfig(),
        getModelHealth().catch(() => ({})),
        getVendorPresets().catch(() => []),
      ]);
      if (!aliveRef.current) return;
      setModelConfigState(config);
      setModelHealth(health);
      setVendorPresets(presets);
      const hasUsable = (config.profiles?.length ?? 0) > 0 || config.local_enabled || config.cloud_enabled;
      setPhase((current) => (current === 'error' ? current : hasUsable ? 'ready' : 'no-model'));
      setModelNote('');
    } catch (e) {
      if (!aliveRef.current) return;
      setModelNote(String(e));
    } finally {
      if (aliveRef.current) setModelBusy(false);
    }
  }, [available]);

  const refreshPermissions = useCallback(async () => {
    if (!available) return;
    try {
      const pending = await getPendingPermissions();
      if (!aliveRef.current) return;
      setPermissions((current) => {
        const merged = [...current];
        for (const request of pending) {
          if (!merged.some((item) => item.id === request.id)) merged.push(request);
        }
        return merged;
      });
    } catch {
      // Permission bridge may be unavailable during boot.
    }
  }, [available]);

  const refreshConversations = useCallback(async () => {
    if (!available) return;
    try {
      const list = await listConversations();
      if (aliveRef.current) setConversations(list);
    } catch (e) {
      if (aliveRef.current) setSessionNote(String(e));
    }
  }, [available]);

  const refreshMemories = useCallback(async () => {
    if (!available) return;
    setMemoryBusy(true);
    try {
      const [graph, list] = await Promise.all([
        getMemoryGraph(),
        listMemoriesPanel(undefined, 400),
      ]);
      if (!aliveRef.current) return;
      setMemoryGraph(graph);
      setMemories(list);
      setMemoryNote('');
    } catch (e) {
      if (aliveRef.current) setMemoryNote(String(e));
    } finally {
      if (aliveRef.current) setMemoryBusy(false);
    }
  }, [available]);

  const bootstrapConversation = useCallback(async () => {
    if (!available) return;
    const conversations = await listConversations();
    if (aliveRef.current) setConversations(conversations);

    // The backend renames a conversation to its first topic. Matching the old
    // fixed title therefore missed the previous thread on every launch and
    // silently opened a fresh empty one. Prefer the last explicitly selected
    // id, then the newest conversation that actually contains messages.
    let conversation = conversations.find(
      (item) => item.id === readActiveConversation(),
    );
    let rows: MessageRow[] = [];

    if (conversation) {
      try {
        const storedRows = await getMessages(conversation.id);
        if (storedRows.some((row) => row.role === 'user' || row.role === 'assistant')) {
          rows = storedRows;
        } else {
          conversation = undefined;
        }
      } catch {
        conversation = undefined;
      }
    }

    if (!conversation) {
      for (const candidate of conversations) {
        try {
          const candidateRows = await getMessages(candidate.id);
          if (candidateRows.some((row) => row.role === 'user' || row.role === 'assistant')) {
            conversation = candidate;
            rows = candidateRows;
            break;
          }
        } catch {
          /* skip unreadable conversations and keep looking */
        }
      }
    }

    if (!conversation) {
      conversation = conversations[0] ?? (await createConversation(FLUX_CONVERSATION_TITLE, null));
    }
    if (!aliveRef.current) return;

    rememberActiveConversation(conversation.id);
    setConvId(conversation.id);
    if (rows.length === 0) rows = await getMessages(conversation.id);
    if (!aliveRef.current) return;
    setTurns(rows.length > 0 ? hydrate(rows) : [welcomeTurn()]);
    setHistoryEpoch((epoch) => epoch + 1);
  }, [available]);

  useEffect(() => {
    if (!available || initRef.current) return;
    initRef.current = true;
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const add = async (promise: Promise<() => void>) => {
      try {
        const fn = await promise;
        if (disposed) fn();
        else unlisteners.push(fn);
      } catch {
        // The engine may start before all event channels are ready.
      }
    };

    void (async () => {
      await Promise.all([
        add(
          onChatToken((token) => {
            if (!aliveRef.current || !chatBusyRef.current) return;
            setStreaming((current) => current + token);
          }),
        ),
        add(
          onChatRoundReset(() => {
            if (!aliveRef.current || !chatBusyRef.current) return;
            setStreaming('');
          }),
        ),
        add(
          onThought((thought) => {
            if (!aliveRef.current || !chatBusyRef.current) return;
            setThoughts((current) => [...current.slice(-39), thought]);
          }),
        ),
        add(
          onPermissionRequest((request) => {
            if (!aliveRef.current) return;
            setPermissions((current) =>
              current.some((item) => item.id === request.id) ? current : [...current, request],
            );
          }),
        ),
        add(
          onAcuiCard((card) => {
            if (!aliveRef.current) return;
            setCards((current) => {
              const rest = current.filter((item) => item.id !== card.id);
              return [...rest.slice(-7), card];
            });
          }),
        ),
        add(
          onProactive((card) => {
            if (!aliveRef.current) return;
            const signal: AcuiCardData = {
              id: `proactive-${card.id}`,
              kind: 'confirm',
              title: card.title,
              body: card.body,
              data: card.action,
            };
            setCards((current) => [...current.slice(-7), signal]);
          }),
        ),
        add(
          onTodoUpdate((nextTodos) => {
            if (!aliveRef.current) return;
            setTodos(nextTodos);
          }),
        ),
        add(
          onPanelControl((request) => {
            if (!aliveRef.current) return;
            setPanelRequest(request);
          }),
        ),
        add(
          onNotifyUserRequest((request) => {
            if (!aliveRef.current) return;
            const level = (request.level || '').toLowerCase();
            pushNotice({
              tone: level === 'critical' ? 'critical' : 'attention',
              title: request.title || '需要你的回应',
              body: request.body || '',
              detail: '',
              persistent: true,
            });
          }),
        ),
        add(
          onFluxNotifyMessage((event) => {
            if (!aliveRef.current) return;
            const level = (event.level || '').toLowerCase();
            pushNotice({
              tone: level === 'critical' ? 'critical' : level === 'warning' ? 'attention' : 'info',
              title: event.title || 'FLUX',
              body: event.body || '',
              detail: '',
              persistent: false,
            });
          }),
        ),
        add(
          onEscalationLevel((event) => {
            if (!aliveRef.current || event.level < 1) return;
            // `speak` reuses level 2 for ordinary speech; it is not a notice.
            if (event.title === 'FLUX语音') return;
            const body = event.body || event.detail || '';
            const detail = event.detail && event.detail !== body ? event.detail : '';
            pushNotice({
              tone: event.level >= 2 ? 'critical' : 'attention',
              title: event.title.replace(/^FLUX\s*·\s*/, ''),
              body,
              detail,
              persistent: event.level >= 2,
            });
          }),
        ),
      ]);

      try {
        await Promise.all([
          refreshModels(),
          refreshEngineInfo(),
          refreshPermissions(),
          bootstrapConversation(),
        ]);
        if (aliveRef.current) setPhase((current) => (current === 'error' ? current : current));
      } catch (e) {
        if (!aliveRef.current) return;
        const friendly = describeError(e);
        setError(friendly.detail || friendly.message);
        setPhase('error');
        pushNotice({
          tone: 'critical',
          title: '内核没有正常启动',
          body: friendly.message,
          detail: friendly.detail,
          persistent: true,
        });
        setTurns((current) =>
          current.length > 0
            ? current
            : [makeTurn('agent', '内核没有正常醒来。你的数据还在，重启 FLUX 或查看设置里的引擎状态。')],
        );
        setHistoryEpoch((epoch) => epoch + 1);
      }
    })();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [
    available,
    bootstrapConversation,
    refreshEngineInfo,
    refreshModels,
    refreshPermissions,
    pushNotice,
  ]);

  useEffect(() => {
    if (!available) return;
    if (!modelConfig) setPhase((current) => (current === 'boot' ? 'no-model' : current));
    else if ((modelConfig.profiles?.length ?? 0) > 0) {
      setPhase((current) => (current === 'error' ? current : 'ready'));
    }
  }, [available, modelConfig]);

  // MCP servers register a little after the native toolset. Refresh the
  // capability field while the engine settles so the surface reports the full
  // live registry rather than a boot-time snapshot.
  useEffect(() => {
    if (!available) return;
    const timers = [3500, 8000, 16000].map((delay) =>
      window.setTimeout(() => {
        void refreshEngineInfo();
      }, delay),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [available, refreshEngineInfo]);

  const send = useCallback(
    async (text: string): Promise<EngineSendResult> => {
      const message = text.trim();
      if (!available || !message) return { ok: false, error: 'engine unavailable' };
      if (busy) return { ok: false, error: 'engine busy' };

      let targetConv = convId;
      try {
        if (!targetConv) {
          const conversation = await createConversation(FLUX_CONVERSATION_TITLE, null);
          targetConv = conversation.id;
          rememberActiveConversation(conversation.id);
          setConvId(conversation.id);
        }
      } catch (e) {
        return { ok: false, error: String(e) };
      }

      const history = toHistory(turns);
      setThoughts([]);
      setStreaming('');
      chatBusyRef.current = true;
      setBusy(true);
      setTurns((current) => [...current, makeTurn('user', message)]);

      try {
        const rawReply = await chat(targetConv, message, history, []);
        const parsed = extractChatCards(rawReply);
        const reply = parsed.text;
        if (parsed.cards.length > 0) {
          setChatCards((current) => [...current, ...parsed.cards].slice(-3));
        }
        if (!aliveRef.current) return { ok: true, reply };
        try {
          const rows = await getMessages(targetConv);
          if (aliveRef.current && rows.length > 0) setTurns(hydrate(rows));
        } catch {
          if (aliveRef.current && reply) {
            setTurns((current) => [...current, makeTurn('agent', reply)]);
          }
        }
        setStreaming('');
        return { ok: true, reply };
      } catch (e) {
        const errorText = String(e);
        if (aliveRef.current) {
          const friendly = describeError(e);
          pushNotice({
            tone: 'critical',
            title: '请求没有完成',
            body: friendly.message,
            detail: friendly.detail,
            persistent: false,
          });
        }
        return { ok: false, error: errorText };
      } finally {
        chatBusyRef.current = false;
        if (aliveRef.current) {
          setBusy(false);
          setStreaming('');
        }
      }
    },
    [available, busy, convId, pushNotice, turns],
  );

  const stop = useCallback(async () => {
    if (!available) return;
    chatBusyRef.current = false;
    try {
      await stopChat();
    } catch {
      // ignore
    }
    setBusy(false);
    setStreaming('');
  }, [available]);

  const switchConversation = useCallback(
    async (id: string) => {
      if (!available || sessionBusy) return;
      if (busy) {
        setSessionNote('先停止当前回答，再切换会话');
        return;
      }
      setSessionBusy(true);
      try {
        const rows = await getMessages(id);
        if (!aliveRef.current) return;
        rememberActiveConversation(id);
        setConvId(id);
        setTurns(rows.length > 0 ? hydrate(rows) : [welcomeTurn()]);
        setHistoryEpoch((epoch) => epoch + 1);
        setStreaming('');
        setThoughts([]);
        setChatCards([]);
        setSessionNote('');
      } catch (e) {
        setSessionNote(String(e));
      } finally {
        if (aliveRef.current) setSessionBusy(false);
      }
    },
    [available, busy, sessionBusy],
  );

  const newConversation = useCallback(async () => {
    if (!available || sessionBusy || busy) return;
    setSessionBusy(true);
    try {
      const conversation = await createConversation(FLUX_CONVERSATION_TITLE, null);
      if (!aliveRef.current) return;
      rememberActiveConversation(conversation.id);
      setConvId(conversation.id);
      setTurns([welcomeTurn()]);
      setHistoryEpoch((epoch) => epoch + 1);
      setStreaming('');
      setThoughts([]);
      setChatCards([]);
      setSessionNote('新的会话');
      await refreshConversations();
    } catch (e) {
      setSessionNote(String(e));
    } finally {
      if (aliveRef.current) setSessionBusy(false);
    }
  }, [available, busy, refreshConversations, sessionBusy]);

  const deleteConversationById = useCallback(
    async (id: string) => {
      if (!available || sessionBusy) return;
      if (id === convId && busy) {
        setSessionNote('先停止当前回答，再删除会话');
        return;
      }
      setSessionBusy(true);
      try {
        await deleteConversationApi(id);
        if (id === convId) {
          const conversation = await createConversation(FLUX_CONVERSATION_TITLE, null);
          rememberActiveConversation(conversation.id);
          setConvId(conversation.id);
          setTurns([welcomeTurn()]);
          setHistoryEpoch((epoch) => epoch + 1);
          setSessionNote('已删除，建立新会话');
        } else {
          setSessionNote('已删除会话');
        }
        await refreshConversations();
      } catch (e) {
        setSessionNote(String(e));
      } finally {
        if (aliveRef.current) setSessionBusy(false);
      }
    },
    [available, busy, convId, refreshConversations, sessionBusy],
  );

  const exportCurrentConversation = useCallback(async () => {
    if (!available || !convId) return;
    try {
      const path = await exportConversationApi(convId);
      setSessionNote(path ? `已导出：${path}` : '已取消导出');
    } catch (e) {
      setSessionNote(String(e));
    }
  }, [available, convId]);

  const addMemoryEntry = useCallback(
    async (content: string, kind = 'note') => {
      const text = content.trim();
      if (!available || !text) return;
      try {
        await addMemory(text, kind);
        setMemoryNote('已写入长期记忆');
        await refreshMemories();
      } catch (e) {
        setMemoryNote(String(e));
      }
    },
    [available, refreshMemories],
  );

  const pinMemoryEntry = useCallback(
    async (id: string) => {
      if (!available) return;
      try {
        await pinMemoryById(id);
        setMemoryNote('已置顶');
        await refreshMemories();
      } catch (e) {
        setMemoryNote(String(e));
      }
    },
    [available, refreshMemories],
  );

  const deleteMemoryEntry = useCallback(
    async (id: string) => {
      if (!available) return;
      try {
        await deleteMemoryById(id);
        setMemoryNote('已删除记忆');
        await refreshMemories();
      } catch (e) {
        setMemoryNote(String(e));
      }
    },
    [available, refreshMemories],
  );

  const activateModel = useCallback(
    async (id: string) => {
      if (!available) return;
      setModelBusy(true);
      try {
        const config = await setActiveModel(id);
        setModelConfigState(config);
        setPhase('ready');
        setModelNote('已切换');
      } catch (e) {
        setModelNote(String(e));
      } finally {
        setModelBusy(false);
      }
    },
    [available],
  );

  const saveConfig = useCallback(
    async (next: ModelConfig) => {
      if (!available) return;
      setModelBusy(true);
      try {
        const config = await setModelConfig(next);
        setModelConfigState(config);
        setPhase('ready');
        setModelNote('配置已保存');
        await refreshModels();
      } catch (e) {
        setModelNote(String(e));
      } finally {
        setModelBusy(false);
      }
    },
    [available, refreshModels],
  );

  const saveProfile = useCallback(
    async (profile: ModelProfile) => {
      if (!available || !modelConfig) return;
      const profiles = modelConfig.profiles.some((item) => item.id === profile.id)
        ? modelConfig.profiles.map((item) => (item.id === profile.id ? profile : item))
        : [...modelConfig.profiles, profile];
      const next: ModelConfig = {
        ...modelConfig,
        profiles,
        active: modelConfig.active || profile.id,
        cloud_enabled: modelConfig.cloud_enabled || profile.tier === 'cloud',
        local_enabled: modelConfig.local_enabled || profile.tier === 'local',
      };
      await saveConfig(next);
    },
    [available, modelConfig, saveConfig],
  );

  const testProfile = useCallback(
    async (id: string) => {
      if (!available) return;
      setModelBusy(true);
      setModelNote('测试中…');
      try {
        const reply = await testModelProfile(id);
        setModelNote(`连接正常 · ${reply.slice(0, 80)}`);
      } catch (e) {
        setModelNote(`连接失败 · ${String(e)}`);
      } finally {
        setModelBusy(false);
      }
    },
    [available],
  );

  const resolveRequest = useCallback(
    async (id: string, approved: boolean, remember = false) => {
      if (!available) return;
      try {
        await resolvePermission(id, approved, remember);
      } finally {
        setPermissions((current) => current.filter((item) => item.id !== id));
      }
    },
    [available],
  );

  const dismissCard = useCallback((id: string) => {
    setCards((current) => current.filter((card) => card.id !== id));
  }, []);

  const dismissChatCard = useCallback((id: string) => {
    setChatCards((current) => current.filter((card) => card.id !== id));
  }, []);

  const clearPanelRequest = useCallback(() => setPanelRequest(null), []);

  return {
    available,
    phase,
    error,
    convId,
    turns,
    historyEpoch,
    busy,
    streaming,
    thoughts,
    latestThought: thoughts[thoughts.length - 1] ?? null,
    permissions,
    cards,
    chatCards,
    notices,
    todos,
    panelRequest,
    engineInfo,
    capabilities,
    modelConfig,
    activeProfile,
    modelHealth,
    vendorPresets,
    modelBusy,
    modelNote,
    conversations,
    sessionBusy,
    sessionNote,
    memoryGraph,
    memories,
    memoryBusy,
    memoryNote,
    send,
    stop,
    refreshModels,
    refreshEngineInfo,
    activateModel,
    saveConfig,
    saveProfile,
    testProfile,
    resolveRequest,
    dismissCard,
    dismissChatCard,
    dismissNotice,
    clearPanelRequest,
    setTurns,
    refreshConversations,
    switchConversation,
    newConversation,
    deleteConversationById,
    exportCurrentConversation,
    refreshMemories,
    addMemoryEntry,
    pinMemoryEntry,
    deleteMemoryEntry,
  };
}

export type FluxEngine = ReturnType<typeof useFluxEngine>;
