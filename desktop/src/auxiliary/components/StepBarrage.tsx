import { useEffect, useRef, useState } from "react";
import { getStepLog, onStepPush } from "../../engine/api";

type Step = { id: number; text: string };

let seq = 0;

/**
 * FLUX GUI 自动化接管条。
 *
 * 与白泽的「直播间弹幕」刻意区分：这里不滚屏、不随机分道，只保留一条
 * 固定的操作者状态栏——左侧品牌、中央最新一步、右侧紧急退出键。
 * 透明浮窗只占顶部 92px，不遮挡目标应用，也不会让截屏变黑。
 */
export default function StepBarrage() {
  const [items, setItems] = useState<Step[]>([]);
  const disposed = useRef(false);

  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";
    document.documentElement.style.background = "transparent";

    let unlisten: (() => void) | null = null;

    const push = (text: string) => {
      const t = (text ?? "").trim();
      if (!t || disposed.current) return;
      const id = seq++;
      setItems((prev) => [...prev.slice(-8), { id, text: t }]);
    };

    (async () => {
      try {
        const existing = await getStepLog();
        existing.forEach(push);
      } catch {
        /* 历史步骤取不到时保持空状态 */
      }
      unlisten = await onStepPush((text) => push(text));
    })();

    return () => {
      disposed.current = true;
      if (unlisten) unlisten();
    };
  }, []);

  const latest = items[items.length - 1]?.text ?? "等待下一步";

  return (
    <div className="flux-op">
      <div className="flux-op-brand">
        <span className="flux-op-pulse" />
        <strong>FLUX</strong>
        <em>/ OPERATOR</em>
      </div>

      <div className="flux-op-stage">
        <span className="flux-op-kicker">SCREEN CONTROL · LIVE</span>
        <p key={items[items.length - 1]?.id ?? "idle"}>{latest}</p>
      </div>

      <div className="flux-op-right">
        <span className="flux-op-count">{String(items.length).padStart(2, "0")} STEPS</span>
        <span className="flux-op-abort">
          <kbd>CTRL</kbd>
          <i>+</i>
          <kbd>SHIFT</kbd>
          <i>+</i>
          <kbd>F12</kbd>
          <b>紧急解除</b>
        </span>
      </div>
    </div>
  );
}
