import { simplexNoise } from './shaders';

export const raymarchVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const raymarchFragment = /* glsl */ `
precision highp float;

uniform sampler2D uMatcap;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uListening;
uniform float uThinking;
uniform float uSpeaking;
uniform vec3 uDirs[8];
uniform float uAmps[8];
uniform vec3 uDrops[3];
uniform float uDropR[3];
uniform vec2 uPointer;

varying vec2 vUv;

${simplexNoise}

  // 仅用于射线区间裁剪的**包围球**，不是玻璃壳。
  // 液体本体按设计稿恢复到半径约 0.91，外面不再画水晶球；
  // 半径 1.35 继续容纳磁尖峰（上限 1.32）与绕行的小液滴（~1.25）。
  const float BOUND_R = 1.35;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float fluidRadius(vec3 n) {
  float t = uTime;

  // DESIGN.md §8: a large body based on a 0.91 sphere. Two low-frequency
  // simplex tides warp the envelope; a fast field adds the fine capillary
  // shimmer. The glass shell is gone, but the liquid keeps the doc's volume.
  float flow = snoise(n * 1.16 + vec3(0.0, t * 0.12, t * 0.035));
  float swirl = snoise(n * 2.15 + vec3(t * 0.24, -t * 0.09, 0.0));
  float shimmer = snoise(n * 5.2 + vec3(0.0, t * 0.62, -t * 0.28));

  float r = 0.91;
  r += flow * 0.024;
  r += swirl * 0.008;
  r += shimmer * 0.0020;

  // Sound pressure swells the body; the low end moves the mass, the treble
  // only shivers the skin.
  r += uBass * 0.052 * (0.55 + 0.45 * flow);
  r += uTreble * 0.015 * sin(n.y * 17.0 + t * 4.6 + flow * 4.0);
  r += uLevel * 0.010;
  r -= uThinking * 0.012;

  // Eight narrow Rosensweig peaks: the doc's magnetic crowns. Keeping the
  // cones tight preserves a smooth liquid base instead of turning the whole
  // silhouette into an eight-sided polygon; each crown breathes on its own
  // phase so the idle body still looks like a liquid.
  for (int i = 0; i < 8; i++) {
    float a = max(dot(n, uDirs[i]), 0.0);
    float peak = pow(a, 36.0) * 0.28 + pow(a, 80.0) * 0.18;
    float pulse = 0.55 + 0.45 * sin(t * (0.55 + float(i) * 0.17) + float(i) * 2.1 + flow * 1.4);
    r += uAmps[i] * peak * pulse * (0.4 + uMid * 0.9 + uSpeaking * 0.35);
  }

  // Slow capillary waves keep the silhouette from ever settling into a flower.
  r += sin(n.y * 7.0 + t * 1.6 + flow * 3.1) * 0.0035 * (0.5 + uLevel);

  // A gravity-fed neck and a slightly heavier base: the droplet is not a
  // perfect sphere even at rest.
  r += smoothstep(-0.18, -1.0, n.y) * 0.030;
  r -= smoothstep(0.35, 1.0, n.y) * 0.022;

  // Two slow, opposing lobes keep the silhouette asymmetric instead of a
  // symmetric soap bubble.
  float lobeA = max(dot(n, normalize(vec3(0.86, 0.12, 0.4))), 0.0);
  float lobeB = max(dot(n, normalize(vec3(-0.74, -0.26, 0.48))), 0.0);
  r += pow(lobeA, 5.0) * (0.012 + uBass * 0.035);
  r += pow(lobeB, 5.0) * (0.008 + uMid * 0.022);

  return min(r, 1.32);
}

float mapLiquid(vec3 p) {
  vec3 n = normalize(p + vec3(0.000001));
  float d = length(p) - fluidRadius(n);

  for (int i = 0; i < 3; i++) {
    float bead = length(p - uDrops[i]) - uDropR[i];
    d = smin(d, bead, 0.045);
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0013, 0.0);
  return normalize(vec3(
    mapLiquid(p + e.xyy) - mapLiquid(p - e.xyy),
    mapLiquid(p + e.yxy) - mapLiquid(p - e.yxy),
    mapLiquid(p + e.yyx) - mapLiquid(p - e.yyx)
  ));
}

void main() {
  vec3 ro = vec3(uPointer.x * 0.16, -uPointer.y * 0.11, 5.9);
  vec3 ww = normalize(-ro);
  vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
  vec3 vv = cross(ww, uu);
  vec2 screen = vUv * 2.0 - 1.0;
  // 0.25 让半径 0.91 的液体在画布里保持充足的体量；水晶球去掉后，
  // 不再需要为外壳留出取景空白。镜头推进只影响取景，不改变 SDF。
  const float tanHalf = 0.25;
  vec3 rd = normalize(ww + screen.x * tanHalf * uu + screen.y * tanHalf * vv);

  float b = dot(ro, rd);
  float c = dot(ro, ro) - BOUND_R * BOUND_R;
  float h = b * b - c;
  if (h < 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float t0 = -b - sqrt(h);
  float t1 = -b + sqrt(h);

  // 只在包围球区间里步进磁流体。玻璃壳去掉后，
  // 「先算一遍球壳菲涅尔高光再叠加」的那一整段都不需要了。
  float t = t0 + 0.002;
  float d = 1.0;
  bool hit = false;
  for (int i = 0; i < 88; i++) {
    vec3 p = ro + rd * t;
    d = mapLiquid(p);
    if (d < 0.0014) {
      hit = true;
      break;
    }
    t += max(d * 0.48, 0.0022);
    if (t > t1) break;
  }

  if (!hit) {
    // 空处完全透明。以前这里会补一层极淡的球体染色，让"水晶球"读得出来；
    // 球壳去掉后，那片区域就该是纯背景。
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 N = calcNormal(p);
  vec3 Nv = vec3(dot(N, uu), dot(N, vv), dot(N, -ww));
  vec2 muv = Nv.xy * 0.5 + 0.5;
  vec3 color = texture2D(uMatcap, muv).rgb * 0.56;

  float ndvL = max(dot(N, -rd), 0.0);
  float rim = pow(1.0 - ndvL, 3.0);
  float edge = smoothstep(0.36, 0.98, rim);
  float fluidRim = pow(1.0 - ndvL, 5.0);

  vec3 R = reflect(rd, N);
  float key = pow(max(dot(R, normalize(vec3(-0.46, 0.72, 0.52))), 0.0), 260.0);
  float glint = pow(max(dot(R, normalize(vec3(0.68, 0.16, 0.66))), 0.0), 520.0);
  float fill = pow(max(dot(R, normalize(vec3(0.8, -0.2, 0.42))), 0.0), 90.0);

  color += key * vec3(1.25, 1.17, 1.03);
  color += glint * vec3(1.5, 1.7, 1.82);
  color += fill * vec3(0.1, 0.15, 0.2) * 0.3;

  float rimGlow = edge * (0.18 + uListening * 0.5 + uSpeaking * 0.2);
  color += rimGlow * vec3(0.28, 0.39, 0.46) * 0.9;
  color += fluidRim * vec3(0.48, 0.62, 0.7) * (0.85 + uListening * 0.55);

  vec3 iridescence = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + rim * 1.4 + uTime * 0.008));
  color += iridescence * edge * 0.02;

  float vein = smoothstep(0.5, 0.94, sin(p.y * 15.0 + p.x * 3.0 + uTime * 0.8) * 0.5 + 0.5);
  color += vein * (uLevel * 0.45 + uTreble * 0.18) * vec3(0.005, 0.007, 0.01);

  color *= mix(0.52, 1.0, smoothstep(-0.9, 0.35, N.y));

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
