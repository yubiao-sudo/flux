export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type Turn = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  at: number;
  fresh?: boolean;
};

export type SmallModuleId = 'weather' | 'calendar' | 'timer' | 'music';
export type LargeModuleId =
  | 'browser'
  | 'settings'
  | 'capabilities'
  | 'permission'
  | 'signal'
  | 'memory'
  | 'sessions'
  | 'systems'
  | 'watchkeeper'
  | 'esports'
  | 'play'
  | 'chronicle'
  | 'atlas'
  | 'dossier';

export type SettingsCategory = 'models' | 'runtime' | 'connections' | 'security' | 'system' | 'jobhunt';

export type ModuleId = SmallModuleId | LargeModuleId;

export const SMALL_MODULES: SmallModuleId[] = ['weather', 'calendar', 'timer', 'music'];

export const STATE_COPY: Record<AgentState, { zh: string; en: string }> = {
  idle: { zh: '静息', en: 'DORMANT' },
  listening: { zh: '聆听', en: 'LISTENING' },
  thinking: { zh: '推演', en: 'PROCESSING' },
  speaking: { zh: '回应', en: 'SPEAKING' },
};
