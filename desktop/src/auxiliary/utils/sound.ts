/**
 * 兼容旧引用：辅助窗口（browser / chat / document）也统一走 engine 的原版音效引擎。
 *
 * 这里不再保留第二份合成器。两份实现各自 new AudioContext 的结果是：主窗口被
 * 用户手势解锁了，辅助窗口却仍是 suspended——同一个「消息已发出」在浏览器窗口里
 * 永远没声。单例实现从根上消掉这类分叉。
 */
export * from '../../engine/utils/sound';
