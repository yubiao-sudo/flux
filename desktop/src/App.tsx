import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { OrbCanvas } from './orb/OrbCanvas';
import { Transcript } from './components/Transcript';
import { RainField } from './components/RainField';
import Clock from './components/Clock';
import { WindowChrome } from './components/WindowChrome';
import { CommandTrace } from './components/CommandTrace';
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { Guide } from './components/Guide';
import { PushCards } from './components/PushCards';
import { NoticeStack } from './components/NoticeStack';
import { ModuleLayer } from './modules/Modules';
import { EsportsPanel } from './modules/esports/EsportsPanel';
import { PlayPanel } from './modules/play/PlayPanel';
import { ChroniclePanel } from './modules/lenses/ChroniclePanel';
import { AtlasPanel } from './modules/lenses/AtlasPanel';
import { DossierPanel } from './modules/lenses/DossierPanel';
import { EnginePanel } from './engine/EnginePanels';
import type { SystemsTabId } from './engine/SystemsPanel';
import { useFluxEngine } from './engine/useFluxEngine';
import { jobHuntTaskPrompt, jobHuntWaitStart, jobHuntWaitStop, restartFlux } from './engine/api';
import { stopSpeaking } from './engine/voiceReactive';
import {
  isApplyCommand,
  isApproveWord,
  isDenyWord,
  isStopWaitCommand,
  isStopWord,
  isWaitCommand,
  panelCommand,
  wantsInspection,
  type PanelTarget,
} from './intents';
import { createStreamingSpeech } from './engine/streamingSpeech';
import { installAudioUnlock, playSfx } from './engine/utils/sound';
import { FluxAudio } from './audio';
import { demoScript, seedTurns } from './data';
import type {
  AgentState,
  LargeModuleId,
  SettingsCategory,
  SmallModuleId,
  Turn,
} from './types';
import { STATE_COPY } from './types';

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const makeTurn = (role: Turn['role'], text: string): Turn => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  role,
  text,
  at: Date.now(),
});

/** 语音打开面板后的提示语（面板判定在 intents.ts，文案是视图层的事） */
const PANEL_HINTS: Record<PanelTarget, string> = {
  settings: '核心设置 · 选择、编辑或测试模型',
  capabilities: '能力星图 · 引擎的全部工具已接入',
  memory: '记忆场 · 长期记忆与知识已接入',
  sessions: '会话历史 · 切换、导出或建立新的会话',
  systems: '引擎控制 · 自动化、审计、连接器、会议室',
};

const settingsCategoryForTab = (tab: string): SettingsCategory => {
  if (['model', 'models'].includes(tab)) return 'models';
  if (['runtime', 'workmode', 'voice', 'notify', 'tts'].includes(tab)) return 'runtime';
  if (
    ['connections', 'tools', 'gateway', 'knowledge', 'bots', 'im', 'bus', 'imlog'].includes(tab)
  ) {
    return 'connections';
  }
  if (['security', 'permission', 'policy'].includes(tab)) return 'security';
  if (['system', 'environment', 'about', 'update'].includes(tab)) return 'system';
  return 'models';
};

const detectIntent = (text: string): SmallModuleId | 'browser' | 'close' | null => {
  const normalized = text.toLowerCase();
  if (/关闭|收起|退出|算了|收回|close|dismiss/.test(normalized)) return 'close';
  if (/浏览器|网页|文章|磁流体|browser|article|web|shape of thought|lens/.test(normalized)) return 'browser';
  if (/天气|下雨|气温|雨|weather|rain/.test(normalized)) return 'weather';
  if (/日历|日程|安排|会议|calendar|schedule/.test(normalized)) return 'calendar';
  if (/计时|闹钟|专注|番茄|timer|alarm|focus/.test(normalized)) return 'timer';
  if (/音乐|声音|歌|共振|music|sound|track/.test(normalized)) return 'music';
  return null;
};

/** 浏览器内置语音的兜底音色：优先挑中文女声（Windows 的 Xiaoxiao/Huihui/Yaoyao，
 *  Edge 的 Natural 中文女声），并把音调抬高一点，避免默认的男声/低沉音色。 */
const pickFeminineZhVoice = (): SpeechSynthesisVoice | null => {
  if (typeof window.speechSynthesis === 'undefined') return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const zh = voices.filter((v) => /zh|cmn|chinese/i.test(`${v.lang} ${v.name}`));
  const pool = zh.length ? zh : voices;
  const preferred = [
    /xiaoxiao/i,
    /xiaoyi/i,
    /huihui/i,
    /yaoyao/i,
    /natural/i,
    /女|female/i,
  ];
  for (const re of preferred) {
    const hit = pool.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return pool[0] ?? null;
};

const speakReply = (text: string) => {
  if (typeof window.speechSynthesis === 'undefined') return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  // 甜美向：语速略快、音调略高（默认 0.86 是压低的男声感）
  utterance.rate = 1.02;
  utterance.pitch = 1.12;
  utterance.volume = 0.8;
  const voice = pickFeminineZhVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
};

const replyForIntent = (intent: ReturnType<typeof detectIntent>) => {
  switch (intent) {
    case 'browser':
      return '找到了。《The Shape of Thought》，六分钟阅读。';
    case 'weather':
      return '会有一阵急雨。21:40 开始，持续约四十分钟。';
    case 'calendar':
      return '明天有两个节点：九点与「北屿」的会面，十一点的材料评审。';
    case 'timer':
      return '二十五分钟。我把其他声音放低了。';
    case 'music':
      return '换成了一段没有节拍的音乐。';
    case 'close':
      return '好，都收回来了。';
    default:
      return '我把它折进记忆里了。还在学着更像你一点。';
  }
};

export function App() {
  const audio = useMemo(() => new FluxAudio(), []);
  const engine = useFluxEngine();
  const [voiceState, setVoiceState] = useState<AgentState>('idle');
  const [turns, setTurns] = useState<Turn[]>(() => seedTurns());
  const [small, setSmall] = useState<SmallModuleId[]>([]);
  const [large, setLarge] = useState<LargeModuleId | null>(null);
  const [systemsTab, setSystemsTab] = useState<SystemsTabId>('automation');
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('models');
  const [micActive, setMicActive] = useState(false);
  const [micNote, setMicNote] = useState('STANDBY');
  const [entered, setEntered] = useState(false);
  /**
   * 启动动画遮罩是否已经撤掉（false 时显示 boot 层）。
   *
   * 初始值就按「减少动态效果」判断：否则会先渲染一帧遮罩、等 effect 再撤，
   * 那一帧对开了无障碍设置的用户来说就是一次无谓的闪现。
   */
  const [booted, setBooted] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  const [hint, setHint] = useState('轻触星核说话 · 按 1—5 预览能力');
  const [demoRunning, setDemoRunning] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const sequenceRef = useRef(0);
  /**
   * 逐字生成的显示进度（字符数）。
   *
   * 目的：让文字**跟着声音**出来，而不是流式一到就整段铺开、
   * 让语音在后面追。两个驱动源取较大值：
   *   · 语音进度（voiceCharsRef）—— 云 TTS 按音频播放比例、浏览器语音按
   *     boundary 的 charIndex，由 streamingSpeech 回调上来；
   *   · 兜底节奏（cadenceRef）—— 没有语音或语音失败时按中文语速慢慢推进，
   *     保证文字不会卡死。
   */
  const [revealChars, setRevealChars] = useState(0);
  const voiceCharsRef = useRef(0);
  const cadenceRef = useRef({ at: 0, chars: 0 });
  const streamSourceRef = useRef('');

  const speechRef = useRef<ReturnType<typeof createStreamingSpeech>>(null!);
  if (!speechRef.current) {
    speechRef.current = createStreamingSpeech({
      onStart: () => setVoiceState('speaking'),
      onEnd: () => setVoiceState('idle'),
      onAckEnd: () => setVoiceState('thinking'),
      onProgress: (chars) => {
        voiceCharsRef.current = chars;
      },
    });
  }

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** 后端录音模式：WebView2 无 Web Speech 识别时，麦克风由 Rust 侧 ffmpeg 录制 */
  const backendMicRef = useRef(false);
  const docked = large !== null;
  const activeState = STATE_COPY[voiceState];
  const online = engine.available;
  const displayTurns = online ? engine.turns : turns;
  // 转录区只显示一行「现在在干什么」的状态，不把执行流细节原样铺出来：
  // - saying 是模型在工具调用之间的过渡旁白，正文已进入执行日志，这里只给状态；
  // - tool_call/tool_result 的 detail 是参数/结果 JSON，转录区只保留标签；
  // - 其余 thought 也裁到 80 字，完整内容仍在执行流面板里。
  const thinkingLine = (() => {
    const thought = engine.latestThought;
    if (!thought) return undefined;
    if (thought.kind === 'saying') return '正在组织语言…';
    if (thought.kind === 'tool_call' || thought.kind === 'tool_result') {
      return thought.label || '正在执行';
    }
    const detail = (thought.detail || '').replace(/\s+/g, ' ').trim();
    if (!detail) return thought.label;
    const short = detail.length > 80 ? `${detail.slice(0, 80)}…` : detail;
    return `${thought.label} · ${short}`;
  })();

  // 音效解锁：WebView2 的自动播放策略要求 AudioContext 必须在用户手势里唤醒。
  // 不装这个，所有「模型回答完 / 审批到达 / 通知推送」这类异步场景的音效都会被静默拦掉。
  useEffect(() => {
    installAudioUnlock();
  }, []);

  useEffect(() => {
    // 启动动画：先让遮罩上的品牌字成形（约 1s），再揭开场景。
    // 星核与 HUD 在揭开后才淡入，避免"黑底上突然出现"。
    // 减少动态效果（prefers-reduced-motion）时直接跳过。
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const enterTimer = window.setTimeout(() => setEntered(true), reduce ? 0 : 1000);
    const bootTimer = window.setTimeout(() => setBooted(true), reduce ? 0 : 2050);
    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(bootTimer);
      audio.disableMic();
      recognitionRef.current?.abort();
    };
  }, [audio]);

  const addTurn = useCallback((role: Turn['role'], text: string) => {
    setTurns((previous) => [...previous, makeTurn(role, text)]);
  }, []);

  const openSmall = useCallback((id: SmallModuleId) => {
    setLarge(null);
    setSmall((previous) => (previous.includes(id) ? previous : [...previous, id]));
    setHint('轻触星核继续 · ESC 收回界面');
  }, []);

  const openLarge = useCallback((id: LargeModuleId = 'browser', tab?: SystemsTabId) => {
    if (tab) setSystemsTab(tab);
    if (id === 'settings') setSettingsCategory('models');
    setSmall([]);
    setLarge(id);
    setHint('ESC 收回界面');
  }, []);

  const closeAll = useCallback(
    (note?: string) => {
      setLarge(null);
      setSmall([]);
      setHint(
        note ??
          (online
            ? '轻触星核说话 · S 设置 · G 能力 · H 会话'
            : '轻触星核说话 · 按 1—5 预览能力'),
      );
    },
    [online],
  );

  useEffect(() => {
    if (!engine.available) return;
    if (engine.permissions.length > 0) {
      if (large !== 'permission') {
        setSmall([]);
        setLarge('permission');
        setHint('需要你的许可 · 说「允许」或「拒绝」');
        // 审批请求是最该被听见的一类通知：用户可能正在别处，没看屏幕
        playSfx('permission');
      }
      return;
    }
    if (large === 'permission') {
      setLarge(null);
      setHint('已记录你的选择 · 继续对话');
    }
  }, [engine.available, engine.permissions.length, large]);

  // 通知音由 NoticeStack 按 tone 统一播放（info/attention→notify，critical→escalation）。
  // 这里不再按 notice 数量加一声，否则同一条通知会响两遍。

  useEffect(() => {
    if (!engine.available) return;
    // 卡片只作为右侧推送存在，不再自动抢走主界面打开 Signal。
    // 旧逻辑会在每张卡到达时 setLarge('signal')，用户正在看别的面板时也会被切走。
    if (large === 'signal' && engine.cards.length === 0) {
      setLarge(null);
      setHint('轻触星核继续 · ESC 收回界面');
    }
  }, [engine.available, engine.cards, large]);

  // 推送卡片：空闲 18s 后自动收起；任务进行中保持，便于边看边操作。
  useEffect(() => {
    if (!engine.chatCards.length || engine.busy) return;
    const timer = window.setTimeout(() => {
      engine.chatCards.forEach((card) => engine.dismissChatCard(card.id));
    }, 18_000);
    return () => window.clearTimeout(timer);
  }, [engine.chatCards, engine.busy]);

  // 任何主界面模块/浮层被打开时，卡片自动让位（检查其它组件时不挡视线）。
  useEffect(() => {
    if (!engine.chatCards.length) return;
    if (!large && !paletteOpen && !guideOpen) return;
    const timer = window.setTimeout(() => {
      engine.chatCards.forEach((card) => engine.dismissChatCard(card.id));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [large, paletteOpen, guideOpen, engine.chatCards]);

  useEffect(() => {
    if (!engine.available || !engine.panelRequest) return;
    const request = engine.panelRequest;
    if (request.action === 'open') {
      const panel = (request.panel ?? '').toLowerCase();
      const tab = (request.tab ?? '').toLowerCase();
      let target: LargeModuleId | null = null;
      let nextTab: SystemsTabId | undefined;

      if (panel === 'palette') {
        setPaletteOpen(true);
        engine.clearPanelRequest();
        return;
      }

      if (panel === 'settings') {
        target = 'settings';
        setSettingsCategory(settingsCategoryForTab(tab));
      } else if (panel === 'butler') {
        target = 'systems';
        nextTab = 'software';
      } else if (['schedule', 'workflow', 'plaza'].includes(panel)) {
        target = 'systems';
        nextTab = 'automation';
      } else if (['imlog', 'messages'].includes(panel)) {
        target = 'settings';
        setSettingsCategory('connections');
      } else if (panel === 'test') {
        target = 'systems';
        nextTab = 'tests';
      } else if (panel === 'meeting') {
        target = 'systems';
        nextTab = 'studio';
      } else if (['watchkeeper', 'watch', 'watchdog'].includes(panel)) {
        target = 'watchkeeper';
      } else if (panel === 'memory' || panel === 'galaxy') {
        target = 'memory';
      } else if (panel === 'esports') {
        target = 'esports';
      } else if (/browser|chrome/.test(panel)) {
        target = 'browser';
      } else if (/capab|tool|skill/.test(panel)) {
        target = 'capabilities';
      }

      if (target) {
        setSmall([]);
        if (nextTab) setSystemsTab(nextTab);
        setLarge(target);
        setHint(
          nextTab
            ? `引擎已打开 · ${nextTab.toUpperCase()}`
            : target === 'settings'
              ? `引擎已打开 · ${settingsCategoryForTab(tab).toUpperCase()}`
              : '引擎已接管这个界面 · ESC 收回',
        );
      }
    } else if (large && large !== 'browser') {
      setLarge(null);
    }
    engine.clearPanelRequest();
  }, [engine.available, engine.panelRequest, engine.clearPanelRequest, large]);

  useEffect(() => {
    if (!engine.available) return;
    if (engine.busy) {
      // 即时确认语可能在 busy 置位后的下一帧才开始播放；不要把 speaking 抢回 thinking。
      setVoiceState((current) => (current === 'speaking' ? current : 'thinking'));
      return;
    }
    if (large !== null) return;
    if (engine.phase === 'no-model') {
      setHint('还没有连接模型 · 按 S 打开核心设置');
    } else if (engine.phase === 'error') {
      setHint('引擎未接通 · 按 S 检查内核');
    } else if (engine.phase === 'ready') {
      setHint('轻触星核说话 · S 设置 · G 能力 · H 会话');
    }
  }, [engine.available, engine.phase, engine.busy, large]);

  // 模型旁白：后端在每次工具执行前推一句「我先查一下…」。
  // 它走独立的插话队列，和提交确认语按顺序播放，正式回复继续排在它们后面。
  // 放在正式回复 effect 前面：同一帧里如果旁白和首句 token 一起到，
  // 必须先把旁白排进队列，push() 才不会抢先开口。
  useEffect(() => {
    if (!engine.available || !engine.busy || !engine.narration) return;
    speechRef.current.narrate(engine.narration);
  }, [engine.available, engine.busy, engine.narration]);

  // Speech follows the same token stream as the transcript. It starts on the
  // first complete sentence instead of waiting for the whole reply.
  useEffect(() => {
    if (!engine.available) return;
    if (engine.busy) {
      if (engine.streaming) speechRef.current.push(engine.streaming);
      return;
    }
    speechRef.current.finish();
  }, [engine.available, engine.busy, engine.streaming]);

  /* ------------------------------------------------------------------
     逐字生成：文字跟着声音走。

     之前的实现只对 `engine.streaming` 做切片，但回复一旦生成完就落进
     `engine.turns`，流式缓冲被清空 —— 于是新的那条消息**整段**出现在
     记录里，语音才开始读。用户看到的就是「字先说完了，声音才来」。

     现在分两个阶段，用同一套进度：
       · 生成中 —— 显示 streaming 的前 N 字；
       · 落地后 —— 继续显示这条 turn 的前 N 字，直到语音读完。
     进度 N 取 max(语音已读字数, 兜底节奏)。语音结束时兜底提速收尾，
     不会让文字永远追不上。
     ------------------------------------------------------------------ */
  const liveText = online ? engine.streaming : '';

  const lastAgentTurn = useMemo(() => {
    for (let i = displayTurns.length - 1; i >= 0; i -= 1) {
      if (displayTurns[i].role === 'agent') return displayTurns[i];
    }
    return null;
  }, [displayTurns]);

  /** 生成结束、消息落进 turns 后接管显示的那条 id */
  const [syncTurnId, setSyncTurnId] = useState('');
  const lastAgentIdRef = useRef('');
  /** 已经处理过的历史版本号：用于区分「从数据库恢复的最后一条」和「本轮新生成的回复」 */
  const historyEpochRef = useRef(-1);

  useEffect(() => {
    if (!online) return;
    const id = lastAgentTurn?.id ?? '';

    // 初次恢复会话 / 切换会话 / 新建会话：这是历史内容，必须整段直接显示。
    // 旧逻辑会把恢复出来的最后一条 agent 消息当成「刚生成完」，从第 0 字开始
    // 按 16 字/秒逐字打印——长回复重启后要打好几分钟，看起来像卡住了。
    if (historyEpochRef.current !== engine.historyEpoch) {
      historyEpochRef.current = engine.historyEpoch;
      lastAgentIdRef.current = id;
      setSyncTurnId('');
      setRevealChars(0);
      return;
    }

    if (!id || id === lastAgentIdRef.current) return;
    lastAgentIdRef.current = id;
    if (liveText) return; // 还在流式，等它清空再接管
    setSyncTurnId(id);
  }, [online, engine.historyEpoch, lastAgentTurn, liveText]);

  const syncText = liveText
    ? liveText
    : syncTurnId
      ? (displayTurns.find((turn) => turn.id === syncTurnId)?.text ?? '')
      : '';

  // 计时器每 80ms 读 ref：文本增长不必重建计时器，否则节奏会被反复重置
  streamSourceRef.current = syncText;
  /** 本轮流式开始时间：给语音一个很短的启动宽限期，避免 TTS 还没开始就整段砸出来 */
  const syncStartedAtRef = useRef(0);

  // 新一轮生成开始（流式从空变非空）→ 从 0 重新数
  useEffect(() => {
    if (!liveText) return;
    syncStartedAtRef.current = performance.now();
    voiceCharsRef.current = 0;
    cadenceRef.current = { at: performance.now(), chars: 0 };
    setRevealChars(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(liveText)]);

  useEffect(() => {
    if (!syncText) {
      setRevealChars(0);
      return;
    }
    const id = window.setInterval(() => {
      const text = streamSourceRef.current;
      if (!text) return;
      const now = performance.now();
      const cadence = cadenceRef.current;
      if (cadence.at === 0) cadence.at = now;
      // 语音跟读只用于「短回复 + 语音真的已经开始」。
      //
      // 三个分支：
      // 1) 语音已开始且回复不超过 360 字：按中文语速跟读，保留「字随声音出来」的效果；
      // 2) 语音还没开始，但距离本轮流式开始不足 1.5s：给 TTS 配置/首句合成一个宽限期，
      //    先用 24 字/秒往前走，不会整段砸出来，也不会像旧实现那样一直等；
      // 3) 其余情况（没有语音、语音启动太慢、或长回复）：直接显示已收到的全部 token。
      //    长回复不再按 4.6 字/秒打几分钟——这是用户明确反馈的「浪费很长时间」。
      const speechActive = speechRef.current.isActive();
      const inSpeechGrace =
        !speechActive && now - syncStartedAtRef.current < 1500;
      if (speechActive && text.length <= 360) {
        const rate = 4.6;
        cadence.chars = Math.min(
          text.length,
          cadence.chars + ((now - cadence.at) / 1000) * rate,
        );
        cadence.at = now;
        const shown = Math.min(text.length, Math.max(cadence.chars, voiceCharsRef.current));
        setRevealChars((prev) => (shown > prev ? Math.floor(shown) : prev));
        return;
      }
      if (inSpeechGrace) {
        cadence.chars = Math.min(text.length, cadence.chars + ((now - cadence.at) / 1000) * 24);
        cadence.at = now;
        setRevealChars((prev) =>
          cadence.chars > prev ? Math.floor(cadence.chars) : prev,
        );
        return;
      }
      cadence.chars = text.length;
      cadence.at = now;
      setRevealChars((prev) => (prev === text.length ? prev : text.length));
    }, 80);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(syncText)]);

  // 显示完 → 交还给正常渲染（此后整段显示）
  useEffect(() => {
    if (!syncTurnId) return;
    const text = displayTurns.find((turn) => turn.id === syncTurnId)?.text ?? '';
    if (!text || revealChars < text.length) return;
    const id = window.setTimeout(() => setSyncTurnId(''), 400);
    return () => window.clearTimeout(id);
  }, [syncTurnId, revealChars, displayTurns]);

  useEffect(
    () => () => {
      speechRef.current.reset();
    },
    [],
  );

  const releaseMic = useCallback(() => {
    recognitionRef.current = null;
    audio.disableMic();
    setMicActive(false);
    setMicNote('STANDBY');
  }, [audio]);

  const respond = useCallback(
    async (input: string) => {
      const seq = ++sequenceRef.current;
      setDemoRunning(false);

      if (engine.available) {
        // 意图模式匹配在 src/intents.ts（纯函数）；这里只负责执行动作。
        // 求职投递命令：/投递、/投简历、投递简历 —— 把用户配置组装成任务提示词再下发，
        // 保证「命令触发」和「面板开始投递」走同一份配置、同一段任务描述。
        if (isApplyCommand(input)) {
          try {
            const prompt = await jobHuntTaskPrompt();
            setVoiceState('thinking');
            setHint('正在按你的求职配置投递…');
            const r = await engine.send(prompt);
            setVoiceState('idle');
            setHint(r.ok ? '投递任务已完成 · ESC 收回' : '投递任务没有完成 · 检查配置');
          } catch (e) {
            setVoiceState('idle');
            setHint(`无法开始投递：${String(e)}`);
          }
          return;
        }

        // 等待回复命令：/等回复、/等待回复、wait —— 进入 30 分钟后台监控
        if (isWaitCommand(input)) {
          try {
            await jobHuntWaitStart(30);
            setVoiceState('idle');
            setHint('已开始等待 HR 回复（30 分钟）· 说「停止等待」可提前结束');
          } catch (e) {
            setVoiceState('idle');
            setHint(`无法开始等待：${String(e)}`);
          }
          return;
        }

        // 停止等待
        if (isStopWaitCommand(input)) {
          try {
            await jobHuntWaitStop();
            setVoiceState('idle');
            setHint('已停止等待回复');
          } catch (e) {
            setVoiceState('idle');
            setHint(`停止失败：${String(e)}`);
          }
          return;
        }

        if (engine.permissions.length > 0) {
          if (isApproveWord(input)) {
            const request = engine.permissions[0];
            await engine.resolveRequest(request.id, true, false);
            setVoiceState('idle');
            setHint('已允许本次动作 · 引擎继续');
          } else if (isDenyWord(input)) {
            const request = engine.permissions[0];
            await engine.resolveRequest(request.id, false, false);
            setVoiceState('idle');
            setHint('已拒绝本次动作');
          } else {
            setVoiceState('idle');
            setHint('请先对这次动作说「允许」或「拒绝」');
          }
          return;
        }

        if (isStopWord(input)) {
          await engine.stop();
          closeAll();
          setVoiceState('idle');
          return;
        }
        const panel = panelCommand(input);
        if (panel) {
          openLarge(panel);
          setHint(PANEL_HINTS[panel]);
          setVoiceState('idle');
          return;
        }

        if (engine.busy) {
          await engine.stop();
          setVoiceState('idle');
          setHint('已打断上一轮推演 · 再轻触一次星核');
          return;
        }

        if (engine.phase === 'no-model') {
          openLarge('settings');
          setVoiceState('idle');
          setHint('还没有可用模型 · 在核心里选择一个模型档案');
          return;
        }

        setVoiceState('thinking');
        setHint('内核推演中 · 再次轻触星核可打断');
        playSfx('message-sent');
        speechRef.current.begin();
        // 任务一提交就先开口，不等模型首 token。只做一句本地确认，
        // 不预测具体步骤，避免在还不知道工具结果时说过头。
        speechRef.current.ack(
          wantsInspection(input) ? '好的，我先看一下。' : '好的，我先处理一下。',
        );
        const result = await engine.send(input);
        if (seq !== sequenceRef.current) {
          speechRef.current.reset();
          return;
        }
        if (result.ok && result.reply) {
          playSfx('task-done');
          setHint('ESC 收回 · S 设置 · G 能力 · H 会话');
        } else {
          playSfx('error');
          speechRef.current.reset();
          setVoiceState('idle');
          setHint('引擎没有接通 · 按 S 检查模型');
        }
        return;
      }

      setVoiceState('thinking');
      addTurn('user', input);
      await wait(1050);
      if (seq !== sequenceRef.current) return;

      const intent = detectIntent(input);
      const reply = replyForIntent(intent);
      addTurn('agent', reply);
      speakReply(reply);
      setVoiceState('speaking');

      await wait(620);
      if (seq !== sequenceRef.current) return;
      if (intent === 'close') {
        closeAll();
      } else if (intent === 'browser') {
        openLarge('browser');
      } else if (intent) {
        openSmall(intent);
      }

      await wait(1650);
      if (seq !== sequenceRef.current) return;
      setVoiceState('idle');
      if (intent && intent !== 'close') {
        setHint(
          intent === 'browser'
            ? 'ESC 收回界面 · D 重播序列'
            : '轻触星核继续 · ESC 收回界面',
        );
      } else {
        setHint('轻触星核说话 · 按 1—5 预览能力');
      }
    },
    [addTurn, closeAll, engine, openLarge, openSmall],
  );

  const stopListening = useCallback(async () => {
    // 后端录音模式（WebView2 没有 Web Speech 识别时走这条）
    if (backendMicRef.current) {
      backendMicRef.current = false;
      setVoiceState('thinking');
      setHint('正在识别刚才那句话…');
      try {
        const res = await invoke<{ text: string }>('voice_stop');
        const text = (res?.text ?? '').trim();
        releaseMic();
        if (text) {
          void respond(text);
        } else {
          setVoiceState('idle');
          setHint('没有听到内容 · 再轻触一次星核');
        }
      } catch (e) {
        releaseMic();
        setVoiceState('idle');
        setHint(`语音识别失败：${String(e)}`);
      }
      return;
    }
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopSpeaking();
    speechRef.current.reset();
    releaseMic();
    setVoiceState('idle');
    setHint(
      engine.available
        ? '轻触星核继续 · S 设置 · G 能力 · H 会话'
        : '轻触星核说话 · 按 1—5 预览能力',
    );
  }, [engine.available, releaseMic, respond]);

  const startListening = useCallback(async () => {
    sequenceRef.current += 1;
    setDemoRunning(false);
    stopSpeaking();
    speechRef.current.reset();
    if (engine.available && engine.busy) {
      void engine.stop();
      setVoiceState('idle');
      setHint('已打断上一轮 · 再轻触一次星核');
      return;
    }
    setVoiceState('listening');
    setHint('正在聆听 · 再次轻触结束');

    const micOk = await audio.enableMic();
    setMicActive(micOk);
    setMicNote(micOk ? 'LIVE' : 'OFFLINE');

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      // WebView2 不提供 Web Speech 识别：改用后端「ffmpeg 录音 + 本地 Whisper」
      try {
        await invoke('voice_start');
        backendMicRef.current = true;
        setVoiceState('listening');
        setMicNote('LIVE');
        setHint('正在聆听 · 说完再轻触星核结束');
      } catch (e) {
        releaseMic();
        setVoiceState('idle');
        setHint(`麦克风不可用：${String(e)}`);
      }
      return;
    }

    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (!text) return;
      recognitionRef.current = null;
      releaseMic();
      void respond(text);
    };
    recognition.onerror = () => {
      if (recognitionRef.current !== recognition) return;
      releaseMic();
      setVoiceState('idle');
      setHint('没有听清 · 再轻触一次星核');
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        releaseMic();
        setVoiceState((current) => (current === 'listening' ? 'idle' : current));
      }
    };

    try {
      recognition.start();
    } catch {
      releaseMic();
      setVoiceState('idle');
      setHint('麦克风还没有准备好');
    }
  }, [audio, engine, releaseMic, respond]);

  const toggleListening = useCallback(() => {
    if (voiceState === 'listening') {
      stopListening();
    } else {
      void startListening();
    }
  }, [startListening, stopListening, voiceState]);

  const runDemo = useCallback(async () => {
    if (engine.available) {
      setSmall([]);
      setLarge('capabilities');
      setHint('引擎已接管 · G 重开能力星图 · S 设置模型');
      return;
    }
    const seq = ++sequenceRef.current;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    releaseMic();
    stopSpeaking();
    speechRef.current.reset();
    setDemoRunning(true);
    setVoiceState('idle');
    closeAll('启动序列 · 正在接管');
    setTurns([]);
    await wait(500);
    if (seq !== sequenceRef.current) return;

    addTurn('agent', '晚上好。雨刚到，城市安静了一点。');
    setVoiceState('speaking');
    await wait(1750);
    if (seq !== sequenceRef.current) return;
    setVoiceState('idle');
    await wait(550);
    if (seq !== sequenceRef.current) return;

    addTurn('user', demoScript.requestA);
    setVoiceState('thinking');
    await wait(1150);
    if (seq !== sequenceRef.current) return;
    addTurn('agent', demoScript.replyA);
    setVoiceState('speaking');
    openSmall('weather');
    await wait(1150);
    if (seq !== sequenceRef.current) return;
    addTurn('agent', demoScript.replyB);
    openSmall('calendar');
    await wait(2100);
    if (seq !== sequenceRef.current) return;
    setVoiceState('idle');
    await wait(850);
    if (seq !== sequenceRef.current) return;

    addTurn('user', demoScript.requestB);
    setVoiceState('thinking');
    await wait(1250);
    if (seq !== sequenceRef.current) return;
    addTurn('agent', demoScript.replyC);
    setVoiceState('speaking');
    openLarge('browser');
    await wait(2600);
    if (seq !== sequenceRef.current) return;
    setVoiceState('idle');
    setHint('ESC 收回界面 · D 重播序列');
    setDemoRunning(false);
  }, [addTurn, closeAll, engine.available, openLarge, openSmall, releaseMic]);

  const cancelAndClose = useCallback(() => {
    if (engine.available && engine.permissions.length > 0) {
      setHint('请先批准或拒绝这次动作');
      return;
    }
    sequenceRef.current += 1;
    setDemoRunning(false);
    stopSpeaking();
    speechRef.current.reset();
    if (engine.available && engine.busy) {
      void engine.stop();
    }
    if (voiceState === 'listening') {
      stopListening();
      return;
    }
    closeAll();
    setVoiceState('idle');
  }, [closeAll, engine, stopListening, voiceState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;

      // Esc is global: it must be able to exit the core settings overlays even
      // while a model input has focus.
      if (event.key === 'Escape') {
        event.preventDefault();
        if (guideOpen) {
          setGuideOpen(false);
          return;
        }
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (composerOpen) {
          setComposerOpen(false);
          return;
        }
        cancelAndClose();
        return;
      }

      if (target && /input|textarea|select/i.test(target.tagName)) return;

      // PLAY and the new lenses are full surfaces: Space / letters belong to
      // the surface, not to the voice core behind it. C / A / I / P still
      // switch between lenses.
      if (['play', 'chronicle', 'atlas', 'dossier'].includes(large ?? '')) {
        if (!['p', 'c', 'a', 'i'].includes(event.key.toLowerCase())) return;
      }

      if (event.key === '?' && !composerOpen) {
        event.preventDefault();
        setGuideOpen(true);
        return;
      }

      if (event.key === '/' && !composerOpen) {
        event.preventDefault();
        setComposerOpen(true);
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        toggleListening();
        return;
      }
      if (event.key.toLowerCase() === 'd') {
        event.preventDefault();
        void runDemo();
        return;
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        openLarge('settings');
        setHint('核心设置 · 选择、编辑或测试模型');
        return;
      }
      if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        openLarge('esports');
        setHint('英雄联盟赛事观察版 · 赛程 / 比分 / 高光');
        return;
      }
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        openLarge('play');
        setHint('FLUX PLAY · 游戏厅 / 电台 / 专注 / 成就');
        return;
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        openLarge('chronicle');
        setHint('编年史 · 本机时间线 / 周报 / 年度');
        return;
      }
      if (event.key.toLowerCase() === 'a') {
        event.preventDefault();
        openLarge('atlas');
        setHint('知识地图 · 记忆 / 会话 / 文档');
        return;
      }
      if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        openLarge('dossier');
        setHint('调查板 · 本机证据与时间线');
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        openLarge('capabilities');
        setHint('能力星图 · 引擎的全部工具已接入');
        return;
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        openLarge('memory');
        setHint('记忆场 · 长期记忆与知识已接入');
        return;
      }
      if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        openLarge('sessions');
        setHint('会话历史 · 切换、导出或建立新的会话');
        return;
      }
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        openLarge('systems');
        setHint('引擎控制 · 自动化、审计、连接器、会议室');
        return;
      }
      if (event.key >= '1' && event.key <= '5') {
        sequenceRef.current += 1;
        setDemoRunning(false);
        stopSpeaking();
        speechRef.current.reset();
        recognitionRef.current?.abort();
        recognitionRef.current = null;
        releaseMic();
        setVoiceState('idle');
      }
      if (event.key === '1') {
        openLarge('browser');
        setHint('ESC 收回界面 · D 重播序列');
      } else if (event.key === '2') {
        openSmall('weather');
      } else if (event.key === '3') {
        openSmall('calendar');
      } else if (event.key === '4') {
        openSmall('timer');
      } else if (event.key === '5') {
        openSmall('music');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    cancelAndClose,
    openLarge,
    openSmall,
    composerOpen,
    guideOpen,
    paletteOpen,
    releaseMic,
    runDemo,
    toggleListening,
    voiceState,
    large,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const api = {
      setVoiceState,
      setTurns,
      addTurn,
      openSmall,
      openLarge,
      closeAll,
      runDemo,
      setHint,
    };
    (window as unknown as { __FLUX__?: typeof api }).__FLUX__ = api;
    (window as unknown as { __FLUX_ENGINE__?: unknown }).__FLUX_ENGINE__ = {
      send: engine.send,
      stop: engine.stop,
      resolve: engine.resolveRequest,
      openPanel: openLarge,
      close: closeAll,
      engine,
    };
  }, [addTurn, closeAll, engine, openLarge, openSmall, runDemo]);

  // HUD 时钟拆成 <Clock/> 叶子组件：每秒跳一次的状态只重渲染两个 span，
  // 不再让整棵 App 树跟着走。见 components/Clock.tsx。

  const paletteActions: PaletteAction[] = [
    {
      id: 'settings',
      label: 'Core settings',
      detail: 'Models, profiles, MCP and engine health',
      run: () => openLarge('settings'),
    },
    {
      id: 'capabilities',
      label: 'Capability field',
      detail: 'Every live tool in the engine registry',
      run: () => openLarge('capabilities'),
    },
    {
      id: 'esports',
      label: 'LOL 赛事观察版',
      detail: '赛季、赛程、比分、高光与预告 · 实时数据',
      run: () => openLarge('esports'),
    },
    {
      id: 'play',
      label: 'FLUX PLAY / 玩法中心',
      detail: '游戏厅、电台、专注舱、预测与成就 · P',
      run: () => openLarge('play'),
    },
    {
      id: 'chronicle',
      label: 'CHRONICLE / 编年史',
      detail: '本机时间线、周报与年度影像 · C',
      run: () => openLarge('chronicle'),
    },
    {
      id: 'atlas',
      label: 'ATLAS / 知识地图',
      detail: '记忆、会话与已索引文档的关系图 · A',
      run: () => openLarge('atlas'),
    },
    {
      id: 'dossier',
      label: 'DOSSIER / 调查板',
      detail: '把一个问题摊成来源、主张与时间线 · I',
      run: () => openLarge('dossier'),
    },
    {
      id: 'memory',
      label: 'Memory field',
      detail: 'SQLite memory graph, add / pin / forget',
      run: () => openLarge('memory'),
    },
    {
      id: 'sessions',
      label: 'Session history',
      detail: 'Switch, create, export or delete conversations',
      run: () => openLarge('sessions'),
    },
    {
      id: 'systems',
      label: 'Engine control',
      detail: 'Automation, security, connectors, studio, runtime',
      run: () => openLarge('systems'),
    },
    {
      id: 'new-session',
      label: 'New session',
      detail: 'Start a clean conversation thread',
      run: () => {
        void engine.newConversation();
        closeAll('新的会话 · 直接说话就好');
      },
    },
    {
      id: 'stop',
      label: 'Stop current task',
      detail: 'Interrupt the engine and return to the orbital core',
      run: () => {
        void engine.stop();
        closeAll('已停止 · 轻触星核继续');
      },
    },
    {
      id: 'guide',
      label: 'Quick guide',
      detail: 'How to speak, open lenses and approve actions',
      run: () => setGuideOpen(true),
    },
    {
      id: 'input',
      label: 'Keyboard input',
      detail: 'Open the hidden command trace',
      run: () => setComposerOpen(true),
    },
    {
      id: 'voice',
      label: 'Start / stop voice',
      detail: 'Toggle the microphone without the orb',
      run: () => toggleListening(),
    },
    {
      id: 'close',
      label: 'Close every lens',
      detail: 'Return the core to the centre',
      run: () => closeAll(),
    },
    {
      id: 'restart',
      label: 'Restart FLUX / 硬重启',
      detail: 'Restart the desktop app when a surface or the engine hangs',
      run: () => {
        void restartFlux().catch(() => undefined);
      },
    },
  ];

  const enginePanel =
    large &&
    large !== 'browser' &&
    large !== 'esports' &&
    large !== 'play' &&
    large !== 'chronicle' &&
    large !== 'atlas' &&
    large !== 'dossier' ? (
      <EnginePanel
        key={`${large}:${systemsTab}`}
        engine={engine}
        panel={large}
        systemsTab={systemsTab}
        settingsCategory={settingsCategory}
        onSettingsCategory={setSettingsCategory}
        state={voiceState}
        onClose={() => closeAll()}
      />
    ) : undefined;

  const esportsPanel =
    large === 'esports' ? <EsportsPanel key="esports" onClose={() => closeAll()} /> : undefined;

  const playPanel =
    large === 'play' ? <PlayPanel key="play" onClose={() => closeAll()} /> : undefined;

  const chroniclePanel =
    large === 'chronicle' ? <ChroniclePanel key="chronicle" onClose={() => closeAll()} /> : undefined;

  const atlasPanel =
    large === 'atlas' ? <AtlasPanel key="atlas" onClose={() => closeAll()} /> : undefined;

  const dossierPanel =
    large === 'dossier' ? <DossierPanel key="dossier" onClose={() => closeAll()} /> : undefined;

  return (
    <div
      className={`app ${entered ? 'is-entered' : ''}`}
      data-docked={docked}
      data-state={voiceState}
      data-demo={demoRunning}
      data-panel={large ?? 'core'}
    >
      <WindowChrome />

      <div className="atmosphere" aria-hidden="true">
        <span className="atmosphere-glow" />
        <span className="atmosphere-horizon" />
        <span className="atmosphere-grain" />
      </div>

      {/* 两侧数字雨：越靠近中线越淡（中线上为零），鼠标移到两侧出现"玻璃"放大效果 */}
      <RainField />

      <header className="hud hud--top">
        {/* 品牌字（FLUX / 流形）从水晶球下方移到左上角，作为页面标识 */}
        <div className="brand-sigil brand-sigil--lockup">
          <span className="signal-dot" />
          <span className="brand-en">FLUX</span>
          <span className="brand-cn">流形</span>
          <i />
          <span className="brand-sub">AMBIENT INTELLIGENCE</span>
          {online && (
            <>
              <span className="brand-split">/</span>
              <span className={`brand-engine brand-engine--${engine.phase}`}>
                CORE LINKED · {engine.engineInfo?.tool_count ?? '—'} TOOLS
              </span>
            </>
          )}
        </div>
        {/* 当前状态（静息 / DORMANT）：放在最顶部正中，是页面级状态而不是球体附注 */}
        <div className="hud-state">
          <div className="state-line">
            <span className={`state-dot state-dot--${voiceState}`} />
            <span className="state-zh">{activeState.zh}</span>
            <span className="state-divider" />
            <span className="state-en">{activeState.en}</span>
          </div>
        </div>
        <div className="hud-clock">
          <span className="hud-place">HANGZHOU · 30.27°N</span>
          <Clock />
        </div>
      </header>

      <div className="side-note side-note--left" aria-hidden="true">
        FORM FOLLOWS INTENT
      </div>
      <div className="side-note side-note--right" aria-hidden="true">
        {docked
          ? `PHASE 02 / ${
              large === 'browser'
                ? 'LENS'
                : large === 'esports'
                  ? 'ESPORTS'
                  : large === 'play'
                    ? 'PLAY'
                    : large === 'chronicle'
                      ? 'CHRONICLE'
                      : large === 'atlas'
                        ? 'ATLAS'
                        : large === 'dossier'
                          ? 'DOSSIER'
                          : 'CORE CONTROL'
            } OPEN`
          : `PHASE 01 / ${online ? `ENGINE ${engine.phase.toUpperCase()}` : `CORE ${activeState.en}`}`}
      </div>

      <main
        className="stage"
        onClick={(event) => {
          if (!docked && small.length === 0) return;
          if (engine.available && engine.permissions.length > 0) return;
          const target = event.target as HTMLElement | null;
          if (
            target?.closest(
              '.chamber, .shard, .core, .lol-shell, .play-shell, .lens-shell',
            )
          ) {
            return;
          }
          sequenceRef.current += 1;
          setDemoRunning(false);
          stopSpeaking();
          speechRef.current.reset();
          if (voiceState === 'listening') stopListening();
          closeAll();
          setVoiceState((current) =>
            current === 'listening' || current === 'thinking' || current === 'speaking'
              ? 'idle'
              : current,
          );
        }}
      >
        <div className="core" data-docked={docked}>
          <div
            className="orb-stage"
            role="button"
            tabIndex={0}
            aria-label={voiceState === 'listening' ? '结束聆听' : '开始对话'}
            onClick={toggleListening}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                toggleListening();
              }
            }}
          >
            <span className="orb-aura" aria-hidden="true" />
            <OrbCanvas state={voiceState} audio={audio} />
            <span className="orb-floor" aria-hidden="true" />
            <span className="orb-state-aura" aria-hidden="true" />
          </div>

          <Transcript
            turns={displayTurns}
            thinking={online ? engine.busy || voiceState === 'thinking' : voiceState === 'thinking'}
            docked={docked}
            streaming={online ? liveText.slice(0, revealChars) : ''}
            narration={online ? engine.narration : ''}
            revealTurn={
              online && !liveText && syncTurnId
                ? { id: syncTurnId, chars: revealChars }
                : null
            }
            thinkingText={thinkingLine}
          />
        </div>

        <ModuleLayer
          small={small}
          large={large}
          overlay={enginePanel}
          esports={esportsPanel}
          play={playPanel}
          chronicle={chroniclePanel}
          atlas={atlasPanel}
          dossier={dossierPanel}
        />

        <AnimatePresence>
          {docked && (
            <motion.div
              className="tether"
              initial={{ opacity: 0, scaleX: 0.2 }}
              animate={{ opacity: 1, scaleX: 1 }}
              exit={{ opacity: 0, scaleX: 0.2 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              aria-hidden="true"
            >
              <span className="tether-pulse" />
              <span className="tether-label">
                {large === 'browser'
                  ? 'LENS / LINK'
                  : large === 'esports'
                    ? 'LOL / LINK'
                    : large === 'play'
                      ? 'PLAY / LINK'
                      : large === 'chronicle'
                        ? 'TIME / LINK'
                        : large === 'atlas'
                          ? 'MAP / LINK'
                          : large === 'dossier'
                            ? 'CASE / LINK'
                            : 'CORE / LINK'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      <PushCards cards={engine.chatCards} onDismiss={engine.dismissChatCard} />
      <NoticeStack notices={engine.notices} onDismiss={engine.dismissNotice} />

      <AnimatePresence>
        {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}
        {paletteOpen && (
          <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />
        )}
        {composerOpen && (
          <CommandTrace
            onSubmit={(text) => {
              void respond(text);
            }}
            onClose={() => setComposerOpen(false)}
          />
        )}
      </AnimatePresence>

      <footer className="hud hud--bottom">
        <div className="hud-left">
          <div className={`mic-status ${micActive ? 'is-live' : ''}`}>
            <span className="signal-dot" />
            <span>MIC · {micNote}</span>
          </div>
          <span className="hud-sep" />
          <span>SYS 1.0.0</span>
          <button
            type="button"
            className="hud-restart"
            onClick={() => {
              void restartFlux().catch(() => undefined);
            }}
            title="重启 FLUX（卡死恢复）"
          >
            RESTART
          </button>
          {online && (
            <>
              <span className="hud-sep" />
              <span className={`engine-hud engine-hud--${engine.phase}`}>
                ENGINE {engine.phase.toUpperCase()}
              </span>
            </>
          )}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            className="interaction-hint"
            key={hint}
            initial={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -4, filter: 'blur(4px)' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="hint-line" />
            <span>{hint}</span>
            <span className="hint-line" />
          </motion.div>
        </AnimatePresence>
        <div className="hud-right">
          <span>P · PLAY</span>
          <span className="hud-sep" />
          <span>01—05 PREVIEW</span>
          <span className="hud-sep" />
          <span>D · DEMO</span>
          {online && (
            <>
              <span className="hud-sep" />
              <span>/ · INPUT</span>
            </>
          )}
        </div>
      </footer>

      <div className="screen-wash" aria-hidden="true" />

      {/* 启动动画：一整块更暗的底 + 品牌字与一根横向细线。
          底色比页面背景（#050607）更暗，撤场时背景会"微微亮起"，
          比单纯淡出更有呼吸感。全程不拦截点击。 */}
      {!booted && (
        <div className="boot" aria-hidden="true">
          <div className="boot-inner">
            <div className="boot-lockup">
              <span className="boot-en">FLUX</span>
              <span className="boot-cn">流形</span>
            </div>
            <span className="boot-rule" />
            <span className="boot-micro">INITIALISING SURFACE</span>
          </div>
        </div>
      )}
    </div>
  );
}
