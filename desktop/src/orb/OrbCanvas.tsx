import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { AgentState } from '../types';
import type { FluxAudio } from '../audio';
import { raymarchFragment, raymarchVertex } from './raymarchShader';

type Props = {
  state: AgentState;
  audio: FluxAudio;
};

const SPIKE_DIRECTIONS = [
  new THREE.Vector3(-0.5, 0.58, 0.54).normalize(),
  new THREE.Vector3(0.64, 0.42, 0.52).normalize(),
  new THREE.Vector3(-0.92, 0.1, 0.1).normalize(),
  new THREE.Vector3(0.94, 0.08, 0.03).normalize(),
  new THREE.Vector3(0.05, 0.94, 0.24).normalize(),
  new THREE.Vector3(-0.3, -0.74, 0.5).normalize(),
  new THREE.Vector3(0.38, -0.55, 0.36).normalize(),
  new THREE.Vector3(-0.2, 0.2, -0.96).normalize(),
];

function createMatcapTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.fillStyle = '#010202';
  context.fillRect(0, 0, size, size);

  const ambient = context.createRadialGradient(
    size * 0.58,
    size * 0.72,
    8,
    size * 0.5,
    size * 0.5,
    size * 0.56,
  );
  ambient.addColorStop(0, 'rgba(10, 17, 22, 0.52)');
  ambient.addColorStop(0.55, 'rgba(4, 6, 8, 0.28)');
  ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = ambient;
  context.fillRect(0, 0, size, size);

  // The reflection of a softbox is graphic, not a diffuse glow.
  context.save();
  context.translate(size * 0.35, size * 0.29);
  context.rotate(-0.34);
  context.filter = `blur(${size * 0.016}px)`;
  context.fillStyle = 'rgba(240, 242, 235, 0.3)';
  context.beginPath();
  context.ellipse(0, 0, size * 0.155, size * 0.065, 0, 0, Math.PI * 2);
  context.fill();
  context.filter = `blur(${size * 0.005}px)`;
  context.fillStyle = 'rgba(255, 253, 247, 0.3)';
  context.beginPath();
  context.ellipse(-size * 0.018, 0, size * 0.1, size * 0.032, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  // Cold vertical strip, camera-right.
  context.save();
  context.translate(size * 0.71, size * 0.5);
  context.rotate(-0.18);
  context.filter = `blur(${size * 0.011}px)`;
  context.fillStyle = 'rgba(153, 195, 205, 0.17)';
  context.beginPath();
  context.ellipse(0, 0, size * 0.035, size * 0.22, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  // Pinpoint reflection on the lower shoulder.
  context.filter = 'none';
  const glint = context.createRadialGradient(
    size * 0.63,
    size * 0.66,
    0,
    size * 0.63,
    size * 0.66,
    size * 0.04,
  );
  glint.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  glint.addColorStop(0.3, 'rgba(183, 217, 224, 0.22)');
  glint.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = glint;
  context.fillRect(0, 0, size, size);

  // A cool bounce that traces the underside.
  const bounce = context.createRadialGradient(
    size * 0.52,
    size * 0.9,
    3,
    size * 0.52,
    size * 0.84,
    size * 0.26,
  );
  bounce.addColorStop(0, 'rgba(41, 78, 93, 0.12)');
  bounce.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = bounce;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function OrbCanvas({ state, audio }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const audioRef = useRef(audio);
  stateRef.current = state;
  audioRef.current = audio;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      host.classList.add('orb--fallback');
      return;
    }

    // The orb is displayed at ~300–420 CSS px. The old 640²@1.6 backing store
    // made the raymarch loop fight the UI (30 fps); 416² at 1× keeps the same
    // apparent size while leaving headroom for a steady 60 fps.
    renderer.setPixelRatio(1);
    renderer.setSize(416, 416, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    host.appendChild(renderer.domElement);

    // A lost WebGL context used to leave a dead black canvas (and in some WebView2
    // builds an unhandled context-lost event). Keep the shell alive and let CSS
    // fall back to the static core instead of taking the window down.
    const canvas = renderer.domElement;
    const onContextLost = (event: Event) => {
      event.preventDefault();
      host.classList.add('orb--fallback');
    };
    const onContextRestored = () => host.classList.remove('orb--fallback');
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const matcapTexture = createMatcapTexture();

    const drops = [
      new THREE.Vector3(1.16, 0.28, 0.26),
      new THREE.Vector3(-0.9, 0.72, 0.36),
      new THREE.Vector3(0.52, -0.82, 0.42),
    ];
    const dropRadii = new Float32Array([0.062, 0.04, 0.03]);

    const uniforms = {
      uMatcap: { value: matcapTexture },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uListening: { value: 0 },
      uThinking: { value: 0 },
      uSpeaking: { value: 0 },
      uDirs: { value: SPIKE_DIRECTIONS },
      uAmps: { value: new Float32Array(8) },
      uDrops: { value: drops },
      uDropR: { value: dropRadii },
      uPointer: { value: new THREE.Vector2(0, 0) },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: raymarchVertex,
      fragmentShader: raymarchFragment,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    scene.add(quad);

    const pointer = { x: 0, y: 0 };
    const smoothPointer = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const weights = { listening: 0, thinking: 0, speaking: 0 };
    const bases = [0.88, 0.34, 1.05, 0.95, 0.78, 0.22, 1.0, 0.58];
    let raf = 0;
    let active = true;
    let last = performance.now();
    // 流体自己的时钟：按「速度倍率」累加，而不是直接用 wall clock。
    // 直接缩放 now/1000 会在状态切换时相位跳变（画面会「抖一下」），
    // 累加式的时间可以平滑变速。
    let flowTime = 0;
    let flowSpeed = 1;
    /**
     * 减少动态效果：只渲染一帧静态画面。
     * 流体的形状与光泽都在，只是不再蠕动——对前庭敏感的用户这是必需的，
     * 不是可选的美化开关。时间给一个固定值，保证这一帧有尖刺而不是一颗光球。
     */
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (reduceMotion) flowTime = 1.6;

    const renderFrame = (now: number) => {
      if (!active) return;
      if (!reduceMotion) raf = requestAnimationFrame(renderFrame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const time = now / 1000;
      const currentState = stateRef.current;
      const frame = audioRef.current.sample(time, currentState);

      // 静息时把蠕动放慢：没有输入、没有朗读、也没有声音能量时，
      // 介质应该像几乎不受外力一样缓慢流动，而不是保持说话时那种活跃度。
      // 有声压或处于聆听/思考/朗读时回到 1.0（甚至被能量推得更快一点）。
      const engaging =
        currentState === 'listening' ||
        currentState === 'thinking' ||
        currentState === 'speaking';
      const energy = Math.min(1, frame.level * 1.5 + (frame.bass + frame.mid) * 0.3);
      const targetSpeed = engaging ? 1 : 0.38 + energy * 1.1;
      flowSpeed += (targetSpeed - flowSpeed) * Math.min(1, dt * 1.6);
      flowTime += dt * flowSpeed;

      const target = {
        listening: currentState === 'listening' ? 1 : 0,
        thinking: currentState === 'thinking' ? 1 : 0,
        speaking: currentState === 'speaking' ? 1 : 0,
      };
      weights.listening += (target.listening - weights.listening) * Math.min(1, dt * 4.2);
      weights.thinking += (target.thinking - weights.thinking) * Math.min(1, dt * 4.6);
      weights.speaking += (target.speaking - weights.speaking) * Math.min(1, dt * 5.5);

      smoothPointer.x += (pointer.x - smoothPointer.x) * Math.min(1, dt * 2.8);
      smoothPointer.y += (pointer.y - smoothPointer.y) * Math.min(1, dt * 2.8);

      uniforms.uTime.value = flowTime;
      uniforms.uLevel.value = frame.level;
      uniforms.uBass.value = frame.bass;
      uniforms.uMid.value = frame.mid;
      uniforms.uTreble.value = frame.treble;
      uniforms.uListening.value = weights.listening;
      uniforms.uThinking.value = weights.thinking;
      uniforms.uSpeaking.value = weights.speaking;
      uniforms.uPointer.value.set(smoothPointer.x, smoothPointer.y);

      const amps = uniforms.uAmps.value;
      for (let i = 0; i < 8; i += 1) {
        // Audio leads the spikes; the bases only keep the eight directions
        // distinguishable at rest. Each direction drifts on its own phase so
        // the ferrofluid never pulses as one rigid shape.
        const energy = Math.pow(frame.bands[i], 1.35);
        const drift = 0.78 + 0.22 * Math.sin(flowTime * (0.7 + i * 0.13) + i * 2.1);
        amps[i] = Math.min(
          0.96,
          0.16 + bases[i] * 0.34 + energy * (1.15 + weights.speaking * 1.25 + weights.listening * 0.35) * drift,
        );
      }

      const dropOrbit = [
        { distance: 1.16, speed: 0.11, phase: 0.5, height: 0.3 },
        { distance: 1.22, speed: -0.08, phase: 2.7, height: 0.68 },
        { distance: 1.09, speed: 0.14, phase: 4.2, height: -0.5 },
      ];
      dropOrbit.forEach((drop, index) => {
        const angle = flowTime * drop.speed + drop.phase;
        drops[index].set(
          Math.cos(angle) * drop.distance,
          drop.height + Math.sin(flowTime * 0.43 + index * 1.9) * 0.12,
          Math.sin(angle) * drop.distance * 0.76,
        );
      });

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(renderFrame);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(renderFrame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      quad.geometry.dispose();
      material.dispose();
      matcapTexture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={hostRef} className="orb-canvas" aria-hidden="true">
      <div className="orb-fallback-core" />
    </div>
  );
}
