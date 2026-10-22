import { useEffect, useRef } from 'react';

/**
 * 两侧数字雨。
 *
 * 视觉口径：
 *  · 字**大而清晰**：字号 18px、列距 24px，离屏按设备像素 1:1 绘制
 *    （降采样再放大是"糊"的根因）；
 *  · 下落**偏慢**：22–62 px/s，配合较长拖尾；
 *  · 只在左右两侧可见，越靠近中线越淡，中线上为零；
 *  · 纵向受页面发光区域约束（上下收掉）；
 *  · 鼠标移到两侧时出现一块**圆形玻璃片**（扁平圆盘，半径 96px）：
 *    放大是均匀的（不是球面畸变），反光是**斜向直线**而不是径向高光，
 *    边缘是一圈随方位变亮变冷的细环 —— 像一片圆玻璃搁在屏幕上，不是透镜球。
 *
 * 实现要点：
 *  · 雨画在离屏画布，主画布只做合成；
 *  · 渐隐用 `destination-in` + 横向/纵向渐变遮罩（像素级；玻璃片放大出来的
 *    内容也会被同一套遮罩裁掉，中线不会因为开玻璃而露雨）；
 *  · 帧率锁 30fps，离屏按 devicePixelRatio（上限 1.5）。
 */

const CHARS = '0123456789';
const COL_W = 40; // 列宽（CSS px，拉大间距，减少"栅栏感"）
const FONT = 18; // 字号
const LINE = FONT + 5; // 行距
const TRAIL_MIN = 4;
const TRAIL_MAX = 11;
const SPEED_MIN = 22; // px/s
const SPEED_MAX = 62;
const FRAME_MS = 33; // ~30fps

/** 玻璃圆盘半径（原来 132 偏大） */
const DISC_R = 82;
/** 反光带的倾角：斜向直线才像"片"，径向高光会变回"球" */
const SHEEN_TILT = -0.6;

type Drop = { y: number; speed: number; trail: number; delay: number };

export function RainField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (
      typeof window === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    ) {
      return;
    }

    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    if (!octx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let cols = 0;
    let drops: Drop[] = [];

    const pointer = { x: -999, y: -999, tx: -999, ty: -999, active: false };
    let raf = 0;
    let last = 0;

    const spawn = (): Drop => ({
      y: -Math.random() * height * 0.6,
      speed: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN),
      trail: TRAIL_MIN + Math.random() * (TRAIL_MAX - TRAIL_MIN),
      // 每列下完一轮会停一会儿：**不是所有列同时在下**
      delay: Math.random() * 2.2,
    });

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      off.width = Math.max(1, Math.floor(width * dpr));
      off.height = Math.max(1, Math.floor(height * dpr));
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.fillStyle = '#000';
      octx.fillRect(0, 0, width, height);

      cols = Math.ceil(width / COL_W);
      // 初始撒满整屏，避免首帧空一片
      drops = Array.from({ length: cols }, () => ({
        ...spawn(),
        y: Math.random() * height,
        // 开局让大多数列立即下雨（只有少数先停着），否则第一秒看起来是空的；
        // 停顿交错的"栅栏感"是在稳态之后才需要的。
        delay: Math.random() < 0.75 ? 0 : Math.random() * 1.4,
      }));
    };

    const onMove = (event: PointerEvent) => {
      pointer.tx = event.clientX;
      pointer.ty = event.clientY;
      pointer.active = true;
      if (pointer.x < -100) {
        pointer.x = pointer.tx;
        pointer.y = pointer.ty;
      }
    };
    const onLeave = () => {
      pointer.active = false;
    };

    const paint = (now: number) => {
      // ---- 1) 离屏：刷新雨 ----
      octx.globalCompositeOperation = 'source-over';
      octx.fillStyle = 'rgba(4, 6, 8, 0.26)';
      octx.fillRect(0, 0, width, height);
      octx.font = `600 ${FONT}px "JetBrains Mono", Consolas, monospace`;
      octx.textBaseline = 'top';

      const tick = Math.floor(now / 220);
      const dt = FRAME_MS / 1000;
      for (let i = 0; i < cols; i += 1) {
        const drop = drops[i];
        // 停顿期：这一列暂时不下，避免整屏同时形成"竖栅栏"
        if (drop.delay > 0) {
          drop.delay -= dt;
          continue;
        }
        drop.y += drop.speed * dt;
        // 每列横向错开几像素，打破机械对齐
        const x = i * COL_W + 4 + ((i * 7) % 5);

        for (let k = 0; k < drop.trail; k += 1) {
          const y = drop.y - k * LINE;
          if (y < -LINE || y > height + LINE) continue;
          const age = k / drop.trail;
          const alpha = Math.pow(1 - age, 1.7) * 0.85;
          if (alpha <= 0.02) continue;
          const ch = CHARS[(i * 13 + k * 7 + tick) % CHARS.length];
          octx.fillStyle = `rgba(232, 242, 244, ${alpha.toFixed(3)})`;
          octx.fillText(ch, x, y);
        }

        if (drop.y - drop.trail * LINE > height) {
          // 落到屏幕外：从顶部重新开始，并随机停一会儿再落
          drops[i] = {
            ...spawn(),
            y: -LINE * (1 + Math.random() * 6),
            delay: Math.random() * 2.6,
          };
        }
      }

      // ---- 2) 合成 ----
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, width, height);

      // ---- 3) 圆形玻璃片 ----
      const halfWidth = width / 2;
      if (pointer.active) {
        pointer.x += (pointer.tx - pointer.x) * 0.2;
        pointer.y += (pointer.ty - pointer.y) * 0.2;
      }
      const offAxis = Math.abs(pointer.x - halfWidth) / halfWidth; // 0=正中，1=最边
      const discOn = pointer.active && offAxis > 0.4;
      const px = pointer.x;
      const py = pointer.y;
      // 反光带 / 边缘高光共用同一条倾斜方向
      const sheenCos = Math.cos(SHEEN_TILT);
      const sheenSin = Math.sin(SHEEN_TILT);

      if (discOn) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, DISC_R, 0, Math.PI * 2);
        ctx.clip();

        // 均匀放大（圆盘是平的，不做球面畸变），仅纵向 2px 错位模拟厚玻璃
        const k = 1.12;
        const half = DISC_R / k;
        const sx = Math.max(0, (px - half) * dpr);
        const sy = Math.max(0, (py - half + 2) * dpr);
        const sw = Math.max(1, Math.min(off.width - sx, 2 * half * dpr));
        const sh = Math.max(1, Math.min(off.height - sy, 2 * half * dpr));
        ctx.drawImage(off, sx, sy, sw, sh, px - DISC_R, py - DISC_R, DISC_R * 2, DISC_R * 2);

        // 斜向反光带：直线渐变 + 圆裁剪 = 一片玻璃，而不是一颗珠子
        const sheen = ctx.createLinearGradient(
          px - DISC_R * sheenCos,
          py - DISC_R * sheenSin,
          px + DISC_R * sheenCos,
          py + DISC_R * sheenSin,
        );
        sheen.addColorStop(0, 'rgba(228, 244, 248, 0.13)');
        sheen.addColorStop(0.38, 'rgba(228, 244, 248, 0.025)');
        sheen.addColorStop(0.55, 'rgba(228, 244, 248, 0)');
        sheen.addColorStop(0.78, 'rgba(228, 244, 248, 0.02)');
        sheen.addColorStop(1, 'rgba(228, 244, 248, 0.06)');
        ctx.fillStyle = sheen;
        ctx.fillRect(px - DISC_R, py - DISC_R, DISC_R * 2, DISC_R * 2);
        ctx.restore();
      }

      // ---- 4) 遮罩：左右渐隐 + 纵向限制 ----
      ctx.globalCompositeOperation = 'destination-in';
      const hg = ctx.createLinearGradient(0, 0, width, 0);
      hg.addColorStop(0, 'rgba(0,0,0,1)');
      hg.addColorStop(0.26, 'rgba(0,0,0,0.62)');
      hg.addColorStop(0.4, 'rgba(0,0,0,0.2)');
      hg.addColorStop(0.5, 'rgba(0,0,0,0)');
      hg.addColorStop(0.6, 'rgba(0,0,0,0.2)');
      hg.addColorStop(0.74, 'rgba(0,0,0,0.62)');
      hg.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, width, height);

      const vg = ctx.createLinearGradient(0, 0, 0, height);
      vg.addColorStop(0, 'rgba(0,0,0,0.08)');
      vg.addColorStop(0.16, 'rgba(0,0,0,0.9)');
      vg.addColorStop(0.52, 'rgba(0,0,0,1)');
      vg.addColorStop(0.84, 'rgba(0,0,0,0.5)');
      vg.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      // ---- 5) 圆盘的边（画在遮罩之后，避免被压没）----
      if (discOn) {
        ctx.save();
        // 外缘：左上偏亮、右下偏冷 —— 圆盘有厚度，但不是球面高光
        const edge = ctx.createLinearGradient(
          px - DISC_R * sheenCos,
          py - DISC_R * sheenSin,
          px + DISC_R * sheenCos,
          py + DISC_R * sheenSin,
        );
        edge.addColorStop(0, 'rgba(234, 248, 252, 0.34)');
        edge.addColorStop(0.5, 'rgba(206, 228, 234, 0.12)');
        edge.addColorStop(1, 'rgba(198, 220, 228, 0.26)');
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, DISC_R - 0.5, 0, Math.PI * 2);
        ctx.stroke();

        // 内圈极淡的反光，表现玻璃厚度（不是发光球）
        ctx.strokeStyle = 'rgba(238, 250, 252, 0.09)';
        ctx.beginPath();
        ctx.arc(px, py, DISC_R - 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      paint(now);
    };

    resize();
    // 先同步画一帧：不依赖第一帧 rAF（后台标签里 rAF 会推迟很久）
    paint(performance.now());
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={ref} className="rain-field" aria-hidden="true" />;
}
