/**
 * 语音 / 文本指令的意图识别（纯函数，无 UI 依赖）。
 *
 * 从 App.tsx 的 respond() 抽出：模式匹配集中在这里，视图层只负责执行动作。
 * 所有匹配器接收**原始输入**并在内部做 toLowerCase——调用方不需要预先归一化。
 * 模式与判定顺序保持与抽出前逐字一致；改动任何一条前先想清楚它会改变
 * 哪句口语指令的走向。
 */

/** 引擎路径可语音打开的面板 */
export type PanelTarget = 'settings' | 'capabilities' | 'memory' | 'sessions' | 'systems';

/** 求职投递命令：/投递、/投简历、投递简历、apply */
export const isApplyCommand = (input: string): boolean =>
  /^\/?(投递|投简历|投递简历|apply)(\s|$)/.test(input.toLowerCase().trim());

/** 等待 HR 回复命令：/等回复、/等待回复、等消息、wait */
export const isWaitCommand = (input: string): boolean =>
  /^\/?(等回复|等待回复|等消息|wait)(\s|$)/.test(input.toLowerCase().trim());

/** 停止等待 */
export const isStopWaitCommand = (input: string): boolean =>
  /^\/?(停止等待|停止等回复|stop\s*wait)(\s|$)/.test(input.toLowerCase().trim());

/** 审批卡在弹着时的放行词 */
export const isApproveWord = (input: string): boolean =>
  /允许|同意|可以|批准|allow|yes/.test(input.toLowerCase());

/** 审批卡在弹着时的拒绝词 */
export const isDenyWord = (input: string): boolean =>
  /拒绝|不允许|不要|deny|no/.test(input.toLowerCase());

/** 打断 / 收起：引擎忙时打断、界面开时收回 */
export const isStopWord = (input: string): boolean =>
  /关闭|收起|停止|退出|取消|stop|cancel/.test(input.toLowerCase());

/** 引擎控制台（无长度限制、无前缀动词要求） */
export const isEngineControlCommand = (input: string): boolean =>
  /控制台|引擎控制|系统面板|engine control|systems panel/.test(input.toLowerCase());

/**
 * 面板打开命令。前四个面板要求整句 ≤24 字——「打开设置」是命令，
 * 「帮我把设置里的模型换成本地的」不是，得走引擎正常推演；
 * 引擎控制台没有长度限制（保持原实现）。
 * 按声明的顺序匹配，先命中先得。
 */
export function panelCommand(input: string): PanelTarget | null {
  const s = input.toLowerCase();
  if (s.length <= 24) {
    if (/^(打开|看看|查看|显示|进入|回到|切换)?\s*(设置|模型|配置|model|setting|config)/.test(s)) {
      return 'settings';
    }
    if (/^(打开|看看|查看|显示|进入|回到|切换)?\s*(能力|工具|星图|capab|tool)/.test(s)) {
      return 'capabilities';
    }
    if (/^(打开|看看|查看|显示|进入|回到|切换)?\s*(记忆|memory)/.test(s)) {
      return 'memory';
    }
    if (/^(打开|看看|查看|显示|进入|回到|切换)?\s*(会话|历史|对话记录|conversation|history)/.test(s)) {
      return 'sessions';
    }
  }
  if (isEngineControlCommand(input)) {
    return 'systems';
  }
  return null;
}

/** 任务确认语气的分支：句子里带「看/查/搜」类动词时，先应「我先看一下」 */
export const wantsInspection = (input: string): boolean =>
  /看|查|找|搜|浏览|打开|读/.test(input.toLowerCase());
