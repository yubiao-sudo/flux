import { useEffect, useState } from 'react';

/**
 * HUD 时钟（日期 + 时刻）。
 *
 * 「每秒跳一次」的状态刻意隔离在这片叶子里：之前 now 挂在 App 根上，
 * 每一秒都触发整棵树（转录流 / 模块层 / 页脚）跟着重渲染。
 * 这里重渲染的只有这两个 span。
 */
export default function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  const dateStamp = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(now);
  const timeStamp = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return (
    <>
      <span className="hud-date">{dateStamp}</span>
      <span className="hud-time">{timeStamp}</span>
    </>
  );
}
