/* Rumb — 霞んだ空に浮かぶ街（3Dの背景）
   three.js を版を固定して読み込み、すべての形をその場で計算して作っています。 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TAU = Math.PI * 2;
const canvas = document.getElementById('world');
const root = document.documentElement;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]still\b/.test(location.search);
const low = matchMedia('(hover: none) and (pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 620;

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) { renderer = null; }
if (renderer) {
  try { init(); } catch (e) { console.error(e); root.classList.remove('has3d'); }
}

function init() {
  /* 毎回同じ街になるよう、種つきの乱数を使う */
  let seed = 20261116;
  const rnd = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.setClearColor(0x2a1c10, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 9000);

  const SUN = new THREE.Vector3(-0.30, 0.31, -1).normalize();
  const CITY_Y = 150;
  const U = {                                   // すべての材質で共有する値
    uTime: { value: 0 },
    uSun: { value: SUN },
    uSunCol: { value: new THREE.Vector3(2.5, 1.72, 1.0) },
    uFog: { value: 0.00115 },
    uPx: { value: 800 },
  };

  /* ---------------- 共通のシェーダー部品 ---------------- */
  const COMMON = /* glsl */`
    uniform vec3 uSun;
    uniform float uTime;
    uniform float uFog;
    float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float hash13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
    float vnoise(vec3 p){
      vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    float vnoise2(vec2 p){
      vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y);
    }
    float fbm2(vec2 p){
      float a = .5, s = 0.;
      for (int i = 0; i < 4; i++) { s += a * vnoise2(p); p = p * 2.03 + 17.1; a *= .5; }
      return s;
    }
    /* 霞の色：太陽の側は琥珀、反対側は青みのある灰色。遠くの物はこの色に溶けていく */
    vec3 haze(vec3 d){
      float s = max(dot(d, uSun), 0.);
      float az = dot(normalize(d.xz + vec2(1e-5)), normalize(uSun.xz)) * .5 + .5;
      az = smoothstep(0., 1., az);
      vec3 hor = mix(vec3(.40, .45, .48), vec3(.88, .50, .20), az);
      vec3 zen = mix(vec3(.17, .22, .27), vec3(.20, .12, .065), az);
      vec3 c = mix(hor, zen, pow(clamp(d.y, 0., 1.), .55));
      c += vec3(1., .66, .30) * (pow(s, 6.) * .28 + pow(s, 48.) * .95);
      return c;
    }
    float fogAmount(float dist, float yA, float yB){
      float h = max(.5 * (yA + yB), 0.);
      return 1. - exp(-dist * uFog * mix(1.45, .55, smoothstep(0., 280., h)));
    }
  `;
  const TAIL = /* glsl */`
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  `;

  /* ---------------- 空 ---------------- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.ShaderMaterial({
      uniforms: U, side: THREE.BackSide, depthWrite: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = position;
          vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.);
          gl_Position = p.xyww;
        }`,
      fragmentShader: COMMON + /* glsl */`
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 c = haze(d);
          float s = max(dot(d, uSun), 0.);
          /* 高い空を流れる砂ぼこりの筋 */
          vec2 q = d.xz / (abs(d.y) + .16);
          float n = fbm2(q * vec2(.55, 1.5) + vec2(uTime * .006, uTime * .002));
          float band = smoothstep(.38, .78, n) * smoothstep(-.02, .12, d.y);
          c = mix(c, c * vec3(.62, .58, .55) + vec3(.9, .55, .26) * pow(s, 3.) * .35, band * .55);
          /* 霞の向こうの太陽 */
          c += vec3(1., .86, .62) * smoothstep(.99982, .99992, s) * 9. * (1. - band * .6);
          c = mix(c, c * .8, smoothstep(0., -.25, d.y));
          gl_FragColor = vec4(c, 1.);
          ${TAIL}
        }`,
    })
  );
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);

  /* ---------------- 建物・機械・地面に使う材質（錆びた金属） ---------------- */
  function hullMaterial(o) {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...U,
        uA: { value: new THREE.Vector3(...o.a) }, uB: { value: new THREE.Vector3(...o.b) },
        uDark: { value: o.dark ?? 1 }, uWin: { value: o.win ?? 0 },
        uCell: { value: new THREE.Vector2(...(o.cell ?? [1.0, 1.25])) },
        uGrain: { value: o.grain ?? 1 },
      },
      vertexShader: /* glsl */`
        attribute vec4 aSeed;
        varying vec3 vWorld; varying vec3 vN; varying vec3 vObj; varying vec3 vObjN; varying vec3 vScale; varying vec3 vLocal; varying vec4 vSeed;
        void main(){
          vec3 n = normal; vec3 sc = vec3(1.);
          vec4 lp = vec4(position, 1.);
          #ifdef USE_INSTANCING
            sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
            lp = instanceMatrix * lp;
            n = normalize(mat3(instanceMatrix) * (n / sc));
          #endif
          vLocal = lp.xyz; vObj = position; vObjN = normal; vScale = sc; vSeed = aSeed;
          vec4 wp = modelMatrix * lp; vWorld = wp.xyz;
          vN = normalize(mat3(modelMatrix) * n);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: COMMON + /* glsl */`
        uniform vec3 uSunCol; uniform vec3 uA; uniform vec3 uB;
        uniform float uDark; uniform float uWin; uniform float uGrain; uniform vec2 uCell;
        varying vec3 vWorld; varying vec3 vN; varying vec3 vObj; varying vec3 vObjN; varying vec3 vScale; varying vec3 vLocal; varying vec4 vSeed;
        void main(){
          vec3 N = normalize(vN);
          vec3 toCam = cameraPosition - vWorld; float dist = length(toCam); vec3 V = toCam / dist;

          /* 錆と汚れ：鉄の地色に、錆色のまだらと、縦に流れた雨だれの跡 */
          vec3 lp = vLocal * uGrain;
          float n1 = vnoise(lp * .13 + vSeed.x * 7.) * .62 + vnoise(lp * .47) * .38;
          float streak = vnoise(vec3(lp.x * 1.1, lp.y * .08, lp.z * 1.1) + vSeed.x * 3.);
          vec3 alb = mix(uA, uB, smoothstep(.36, .74, n1 * .68 + streak * .42));
          alb *= .72 + .56 * vSeed.z;
          alb *= mix(.5, 1., smoothstep(.18, .62, streak));
          float band = fract(lp.y / 3.2);
          alb *= 1. - .3 * (1. - smoothstep(0., .07, band)) * (1. - smoothstep(.15, .6, fwidth(lp.y / 3.2)));

          float ndl = max(dot(N, uSun), 0.);
          vec3 amb = mix(vec3(.045, .032, .024), vec3(.25, .185, .13), N.y * .5 + .5);
          float ao = 1.;
          #ifdef USE_INSTANCING
            ao = mix(.42, 1., smoothstep(0., .45, vObj.y));
          #endif
          vec3 col = alb * (amb * ao + uSunCol * ndl);
          float fres = pow(1. - max(dot(N, V), 0.), 3.);
          col += uSunCol * alb * fres * .55 * smoothstep(-.3, .7, dot(-V, uSun));
          col *= uDark;

          /* 窓の灯り */
          float hc = abs(vObjN.x) > .5 ? vObj.z * vScale.z : vObj.x * vScale.x;
          vec2 g = vec2(hc / uCell.x, vObj.y * vScale.y / uCell.y);
          float fw = max(fwidth(g.x), fwidth(g.y));
          if (uWin > 0. && vSeed.y > 0. && abs(vObjN.y) < .5) {
            vec2 id = floor(g); vec2 fr = fract(g);
            float face = dot(vObjN, vec3(1., 0., 2.));
            float r = hash12(id + vSeed.x * 91.7 + face * 13.);
            float fl = hash12(vec2(id.y, vSeed.x * 57. + face));
            float lit = step(1. - vSeed.y * (.3 + .9 * fl * fl), r);
            float tw = .78 + .22 * sin(uTime * (.7 + r * 3.) + r * 40.);
            tw *= mix(1., step(.35, fract(r * 13.7 + uTime * .05 * (.5 + fl))), step(.86, fl));
            vec2 m2 = smoothstep(vec2(.16, .2), vec2(.26, .3), fr) * (1. - smoothstep(vec2(.74, .7), vec2(.84, .8), fr));
            float detail = 1. - smoothstep(.22, .65, fw);
            float avg = vSeed.y * .55 * .3;
            vec3 wc = mix(vec3(1., .58, .22), vec3(1., .86, .58), hash12(id.yx + vSeed.x * 17.));
            wc = mix(wc, vec3(.5, .9, 1.), step(.94, hash12(id + face * 7. + 3.)));
            col += wc * uWin * mix(avg, lit * m2.x * m2.y * tw, detail);
          }

          col = mix(col, haze(-V), fogAmount(dist, vWorld.y, cameraPosition.y));
          gl_FragColor = vec4(col, 1.);
          ${TAIL}
        }`,
    });
  }
  const matCity = hullMaterial({ a: [.25, .225, .205], b: [.46, .215, .09], win: 2.1 });
  const matDeck = hullMaterial({ a: [.21, .19, .175], b: [.40, .19, .085] });
  const matGroundCity = hullMaterial({ a: [.14, .115, .095], b: [.24, .14, .075], win: .62, dark: .7, cell: [1.15, 1.5], grain: .6 });
  const matGround = hullMaterial({ a: [.19, .14, .095], b: [.30, .2, .115], dark: .62, grain: .22 });

  /* 箱をたくさん一度に描くための入れ物（1回の描画命令でまとめて描く） */
  const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
  const dummy = new THREE.Object3D();
  class Batch {
    constructor() { this.items = []; }
    add(x, y, z, sx, sy, sz, ry = 0, dens = 0, tint = rnd()) { this.items.push([x, y, z, sx, sy, sz, ry, rnd(), dens, tint]); }
    build(mat, geo = BOX) {
      const n = this.items.length, g = geo.clone();
      const mesh = new THREE.InstancedMesh(g, mat, n);
      const s = new Float32Array(n * 4);
      this.items.forEach((it, i) => {
        dummy.position.set(it[0], it[1], it[2]); dummy.rotation.set(0, it[6], 0); dummy.scale.set(it[3], it[4], it[5]);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        s[i * 4] = it[7]; s[i * 4 + 1] = it[8]; s[i * 4 + 2] = it[9]; s[i * 4 + 3] = 1;
      });
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4));
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false;
      return mesh;
    }
  }
  /* 灯り（光の点）をためておく入れ物 */
  class Lights {
    constructor() { this.p = []; this.c = []; this.a = []; }
    add(x, y, z, col, size, mode = 0, k = 1) { this.p.push(x, y, z); this.c.push(col[0] * k, col[1] * k, col[2] * k); this.a.push(size, rnd() * TAU, mode); }
    build(dynamic) {
      const g = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(this.p), 3);
      if (dynamic) pos.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', pos);
      g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(this.c), 3));
      g.setAttribute('aP', new THREE.BufferAttribute(new Float32Array(this.a), 3));
      const pts = new THREE.Points(g, matLights); pts.frustumCulled = false;
      return pts;
    }
  }
  const matLights = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute vec3 aP;
      uniform float uTime; uniform float uPx; uniform float uFog;
      varying vec3 vC;
      void main(){
        vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.);
        float d = max(-mv.z, 1.);
        float b = aP.z < .5 ? .72 + .28 * sin(uTime * 2.3 + aP.y)
                : (aP.z < 1.5 ? step(.8, fract(uTime * .55 + aP.y)) : .62 + .38 * sin(uTime * 1.4 + aP.y));
        float s = aP.x * uPx / d;
        float k = clamp(s / 3., 0., 1.);
        gl_PointSize = clamp(s, 3., 360.);
        vC = aColor * b * k * k * exp(-d * uFog * .8);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main(){
        float r = length(gl_PointCoord - .5) * 2.;
        float a = max(exp(-r * r * 6.) - .0025, 0.) + .35 * max(1. - r, 0.) * max(1. - r, 0.) * .5;
        gl_FragColor = vec4(vC * a, 1.);
        ${TAIL}
      }`,
  });

  const AMBER = [1, .6, .24], WARM = [1, .82, .55], RED = [1, .2, .1], TEAL = [.42, .88, 1];

  /* ================= 浮遊都市 =================
     上から見ると3枚羽根の形。上面に街、下面に段々に細くなる機関部、
     羽根の先には音叉のような2本の塔、周りをゆっくり回る細い輪。 */
  const city = new THREE.Group();
  scene.add(city);
  const rShape = (th) => 60 + 52 * Math.pow(.5 + .5 * Math.cos(3 * th), 1.4);
  function slab(scale, y, depth) {
    const s = new THREE.Shape();
    for (let i = 0; i <= 150; i++) {
      const th = i / 150 * TAU, r = rShape(th) * scale;
      if (i) s.lineTo(Math.cos(th) * r, Math.sin(th) * r); else s.moveTo(Math.cos(th) * r, Math.sin(th) * r);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
    const m = new THREE.Mesh(g, matDeck); m.frustumCulled = false; city.add(m);
  }
  slab(1, -6, 6); slab(.82, -18, 12); slab(.6, -34, 16); slab(.36, -56, 22); slab(.16, -84, 28); slab(.29, 0, 6);
  const underY = (f) => f > .82 ? -6 : f > .6 ? -18 : f > .36 ? -34 : f > .16 ? -56 : -84;

  const bTop = new Batch(), bUnder = new Batch(), cl = new Lights();
  const G = low ? 6.6 : 5.4;
  for (let k = 0; k < 3; k++) {
    const ang = k * TAU / 3, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let u = -116; u <= 116; u += G) for (let v = -116; v <= 116; v += G) {
      const jx = u + (rnd() - .5) * .8, jz = v + (rnd() - .5) * .8;
      const x = jx * ca - jz * sa, z = jx * sa + jz * ca;
      const r = Math.hypot(x, z), th = Math.atan2(z, x);
      if (Math.cos(th - ang) < .5) continue;                 // この羽根の区画だけ
      const f = r / rShape(th);
      /* --- 上面の街 --- */
      if (f < .93 && rnd() > .1) {
        let h = 3 + rnd() * 7 + 62 * Math.exp(-((r / 36) ** 2)) + 20 * Math.exp(-((v / 13) ** 2)) * Math.max(0, 1 - r / 120);
        h *= .55 + rnd() * .85; if (rnd() < .05) h *= 1.7;
        const base = f < .28 ? 6 : 0, w = G * (.45 + rnd() * .38), d = G * (.45 + rnd() * .38);
        const dens = .35 + rnd() * .55, tint = rnd();
        bTop.add(x, base, z, w, h, d, -ang, dens, tint);
        let top = base + h;
        if (h > 18) { const h2 = h * (.2 + rnd() * .3); bTop.add(x, top, z, w * .68, h2, d * .68, -ang, dens, tint); top += h2; }
        if (h > 34 || rnd() < .12) { const h3 = 4 + rnd() * 12; bTop.add(x + (rnd() - .5) * w * .4, top, z + (rnd() - .5) * d * .4, .35, h3, .35, 0, 0, .3); top += h3; }
        if (h > 40) cl.add(x, top + .6, z, RED, 2.4, 1, 3.2);
        else if (rnd() < .1) cl.add(x + w * .3, base + h + .5, z, rnd() < .8 ? AMBER : TEAL, 1.2, 0, 1.6);
      }
      /* --- 下面にぶら下がる機械 --- */
      if (f < .95 && rnd() < .62) {
        const y = underY(f), len = 2 + rnd() * rnd() * 22 * (1.25 - f), w = 1.6 + rnd() * 4.2;
        bUnder.add(x, y - len, z, w, len, 1.6 + rnd() * 4.2, -ang, .14, rnd() * .7);
        if (rnd() < .3) bUnder.add(x + 1.5, y - len * 1.9, z + 1, .6, len * 1.9, .6, 0, 0, .2);
        if (rnd() < .16) bUnder.add(x, y - 1.6 - rnd() * 3, z, 1, 1, G * (2 + rnd() * 3), -ang + (rnd() < .5 ? 0 : Math.PI / 2), 0, .25);
        if (rnd() < .2) cl.add(x, y - len - .6, z, rnd() < .6 ? AMBER : TEAL, 1.3, rnd() < .2 ? 1 : 0, 1.8);
      }
    }
    /* 羽根の先の「音叉」の塔と土台 */
    const P = (u, v) => [u * ca - v * sa, u * sa + v * ca];
    const [bx, bz] = P(98, 0);
    bTop.add(bx, 0, bz, 14, 7, 17, -ang, .5, .5);
    for (const v of [-5.2, 5.2]) {
      const [x, z] = P(98, v);
      bTop.add(x, 7, z, 2.6, 70, 2.6, -ang, .12, .35);
      bTop.add(x, 77, z, .4, 10, .4, 0, 0, .3);
      cl.add(x, 88, z, WARM, 3.2, 2, 3);
    }
    /* 羽根の下の浮上機関 */
    const [ex, ez] = P(66, 0);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(8, 10, 15, 24), matDeck);
    eng.position.set(ex, -25.5, ez); city.add(eng);
    cl.add(ex, -34.5, ez, TEAL, 17, 2, .9); cl.add(ex, -34, ez, [.7, 1, 1], 5, 2, 2.2);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; cl.add(ex + Math.cos(a) * 10.5, -32.5, ez + Math.sin(a) * 10.5, TEAL, 1.4, 0, 2); }
  }
  /* 中心の尖塔群と、真下に伸びる竜骨 */
  bTop.add(0, 6, 0, 8, 92, 8, 0, .55, .5); bTop.add(0, 98, 0, 4.6, 30, 4.6, 0, .4, .5); bTop.add(0, 128, 0, .6, 30, .6, 0, 0, .3);
  cl.add(0, 159, 0, RED, 3, 1, 3.4);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + .4, r = 11 + rnd() * 6, h = 45 + rnd() * 35;
    bTop.add(Math.cos(a) * r, 6, Math.sin(a) * r, 5, h, 5, a, .6, rnd());
    bTop.add(Math.cos(a) * r, 6 + h, Math.sin(a) * r, 3, h * .25, 3, a, .5, rnd());
  }
  bUnder.add(0, -122, 0, 2.2, 38, 2.2, 0, 0, .3); bUnder.add(0, -100, 0, 7, 3, 7, .5, .2, .4);
  cl.add(0, -123, 0, TEAL, 4, 2, 3); cl.add(0, -86, 0, TEAL, 13, 2, .9);
  /* 甲板の縁に並ぶ灯り */
  for (let i = 0; i < 132; i++) { const th = i / 132 * TAU, r = rShape(th) * .99; cl.add(Math.cos(th) * r, .7, Math.sin(th) * r, AMBER, 1.25, 0, 1.7); }
  city.add(bTop.build(matCity), bUnder.build(matCity), cl.build());

  /* 都市を取り巻いて回る細い輪（都市とは逆向きに回る） */
  const ringHold = new THREE.Group(), ring = new THREE.Group();
  ringHold.rotation.set(.1, 0, .3); ringHold.add(ring); scene.add(ringHold);
  {
    const b = new Batch(), l = new Lights(), R = 152, N = 168;
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU, big = i % 14 === 0, mid = i % 14 === 7;
      const sy = big ? 5 : mid ? 2.6 : 1.3, sx = big ? 6 : mid ? 3.6 : 2.4;
      b.add(Math.cos(a) * R, -sy / 2, Math.sin(a) * R, sx, sy, TAU * R / N * (big ? 1.5 : .7), -a, big ? .7 : 0, rnd());
      if (big) b.add(Math.cos(a) * R, sy / 2, Math.sin(a) * R, .3, 5, .3, 0, 0, .3);
      if (i % 3 === 0) l.add(Math.cos(a) * (R + 2.2), 0, Math.sin(a) * (R + 2.2), AMBER, 1.1, 0, 1.6);
    }
    for (const [rr, yy] of [[R - 1.5, .5], [R + 1.5, .5], [R, -1]]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(rr, .34, 5, 200).rotateX(Math.PI / 2), matDeck);
      rail.position.y = yy; rail.frustumCulled = false; ring.add(rail);
    }
    for (let q = 0; q < 3; q++) for (let j = 0; j < 5; j++) {
      const a = q / 3 * TAU + j * .012; l.add(Math.cos(a) * (R - 2.8), 1.6, Math.sin(a) * (R - 2.8), TEAL, 2.4 - j * .3, 2, 2.6 - j * .4);
    }
    ring.add(b.build(matCity), l.build());
  }

  /* ================= カメラの道すじ（スクロールで進む） ================= */
  const posCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 40, 430),          // 1: 地上の街から見上げる（逆光）
    new THREE.Vector3(152, 174, 124),       // 2: 甲板の高さで街並みをかすめる
    new THREE.Vector3(238, 118, -112),      //    回り込み
    new THREE.Vector3(-112, 72, -252),      // 3: 太陽の側へ。下から機関部を見上げる
    new THREE.Vector3(-300, 335, 170),      // 4: 高く離れて全体を見下ろす
  ]);
  const lookCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 86, 0), new THREE.Vector3(-34, 166, -44), new THREE.Vector3(0, 142, 0),
    new THREE.Vector3(0, 136, 0), new THREE.Vector3(0, 118, 0),
  ]);
  const ease = (s) => s + (s * s * (3 - 2 * s) - s) * .65;
  const pathU = (p) => p < 1 / 3 ? ease(p * 3) * .25 : p < 2 / 3 ? .25 + ease((p - 1 / 3) * 3) * .5 : .75 + ease((p - 2 / 3) * 3) * .25;

  /* ================= 地上 ================= */
  {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), matGround);
    g.frustumCulled = false; scene.add(g);
    const samples = []; for (let i = 0; i <= 60; i++) samples.push(posCurve.getPoint(i / 60));
    const b = new Batch(), l = new Lights(), n = low ? 800 : 1700;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = 50 + 1500 * Math.pow(rnd(), 1.35);
      const x = Math.cos(a) * r + (rnd() < .5 ? 0 : 60), z = Math.sin(a) * r + 180;
      const dx = x, dz = z - 430, d = Math.hypot(dx, dz);
      if (d < 26) continue;
      let h = 7 + rnd() * rnd() * 70;
      const side = Math.abs(dx) > .52 * d || dz > 0;        // 視界の中央（都市の手前）は低く、脇は高く
      h = Math.min(h, side ? 42 + .2 * d : 33 + .055 * d);
      let ok = true;
      for (const s of samples) if (Math.hypot(x - s.x, z - s.z) < 34 && h > s.y - 16) { ok = false; break; }
      if (!ok) continue;
      const w = 7 + rnd() * 15, dd = 7 + rnd() * 15, ry = rnd() < .7 ? 0 : rnd() * 1.5, tint = rnd() * .8;
      b.add(x, 0, z, w, h, dd, ry, .04 + rnd() * .16, tint);
      if (h > 20 && rnd() < .7) { b.add(x, h, z, w * .55, h * .22, dd * .55, ry, .1, tint); }
      if (d < 420) for (let q = 0; q < 3; q++) {
        const rw = 1.5 + rnd() * 3.5; b.add(x + (rnd() - .5) * (w - rw), h, z + (rnd() - .5) * (dd - rw), rw, .8 + rnd() * 2.6, 1.5 + rnd() * 3.5, ry, 0, tint * .7);
      }
      if (rnd() < .22) { const m = 6 + rnd() * 16; b.add(x + w * .2, h, z, .5, m, .5, 0, 0, .2); if (rnd() < .5) l.add(x + w * .2, h + m + .6, z, RED, 2.2, 1, 2.6); }
      if (rnd() < .3) l.add(x + (rnd() - .5) * w, 1.5 + rnd() * 5, z + dd * .55, rnd() < .8 ? AMBER : WARM, 1.6, 0, 1.5);
    }
    scene.add(b.build(matGroundCity), l.build());
  }

  /* ================= 低く漂う砂ぼこりの層 ================= */
  const matCard = (off, alpha) => new THREE.ShaderMaterial({
    uniforms: { ...U, uOff: { value: off }, uAlpha: { value: alpha } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: COMMON + /* glsl */`
      uniform float uOff; uniform float uAlpha;
      varying vec3 vWorld;
      void main(){
        vec3 toC = vWorld - cameraPosition; float d = length(toC); vec3 dir = toC / d;
        float n = fbm2(vWorld.xz * .0017 + vec2(uTime * .011, uTime * .004) + uOff);
        float a = smoothstep(.4, .82, n) * uAlpha * smoothstep(30., 240., d) * exp(-d * .0008)
                * smoothstep(5., 42., abs(cameraPosition.y - vWorld.y));
        gl_FragColor = vec4(haze(dir) * 1.04, a);
        ${TAIL}
      }`,
  });
  for (const [y, off, al] of (low ? [[60, 3.1, .6]] : [[24, 0, .6], [62, 3.1, .55], [104, 7.7, .45]])) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000).rotateX(-Math.PI / 2), matCard(off, al));
    m.position.y = y; m.frustumCulled = false; m.renderOrder = 2; scene.add(m);
  }

  /* ================= 漂う塵（カメラの周りを流れ続ける） ================= */
  {
    const n = low ? 1800 : 5200, p = new Float32Array(n * 3), r = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) { p[i] = rnd(); r[i] = rnd(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aR', new THREE.BufferAttribute(r, 3));
    const dust = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec3 aR; uniform float uTime; uniform float uPx; uniform vec3 uSun;
        varying float vA;
        void main(){
          const vec3 B = vec3(260., 180., 260.);
          vec3 p = position * B + vec3(uTime * 7., sin(uTime * .25 + aR.x * 6.28) * 3. - uTime * .5, uTime * 3.) * (.5 + aR.y);
          p = mod(p - cameraPosition + B * .5, B) - B * .5 + cameraPosition;
          vec4 mv = viewMatrix * vec4(p, 1.);
          float d = max(-mv.z, .1);
          float sunward = pow(max(dot(normalize(p - cameraPosition), uSun), 0.), 3.);
          float s = (.16 + aR.z * .5) * uPx / d;
          gl_PointSize = clamp(s, 1.5, 14.);
          vA = smoothstep(3., 16., d) * (1. - smoothstep(80., 128., d)) * (.22 + 1.1 * sunward) * (.4 + .6 * aR.x) * clamp(s / 1.5, .3, 1.);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main(){
          float r = length(gl_PointCoord - .5) * 2.;
          gl_FragColor = vec4(vec3(1., .78, .5) * vA * max(1. - r, 0.) * .3, 1.);
          ${TAIL}
        }`,
    }));
    dust.frustumCulled = false; dust.renderOrder = 3; scene.add(dust);
  }

  /* ================= 小型機 ================= */
  const NF = low ? 22 : 44, fl = [];
  const craftGeo = new THREE.ConeGeometry(1, 4.4, 5).rotateX(Math.PI / 2).scale(1.5, .5, 1);
  const craft = new THREE.InstancedMesh(craftGeo, matDeck, NF); craft.frustumCulled = false; scene.add(craft);
  const fLights = new Lights();
  for (let i = 0; i < NF; i++) {
    const near = i < 6, big = !near && i % 9 === 0;
    fl.push({
      cx: near ? (rnd() - .5) * 60 : 0, cy: near ? 62 + rnd() * 30 : CITY_Y + (rnd() - .45) * 150, cz: near ? 330 : 0,
      r: near ? 55 + rnd() * 90 : 135 + rnd() * 190, e: .7 + rnd() * .5,
      w: (rnd() < .5 ? 1 : -1) * (near ? .16 + rnd() * .12 : (big ? .035 : .07 + rnd() * .1)),
      ph: rnd() * TAU, amp: 4 + rnd() * 16, s: big ? 3.2 : .8 + rnd() * .7, tilt: (rnd() - .5) * .5,
    });
    fLights.add(0, 0, 0, WARM, big ? 3.4 : 1.7, 0, 2.6);
    fLights.add(0, 0, 0, i % 3 ? RED : TEAL, big ? 2.6 : 1.4, 1, 3);
  }
  const fPts = fLights.build(true); scene.add(fPts);
  const fPos = fPts.geometry.attributes.position, va = new THREE.Vector3(), vb = new THREE.Vector3();
  const flyAt = (f, t, out) => {
    const a = f.ph + t * f.w;
    out.set(f.cx + Math.cos(a) * f.r, f.cy + Math.sin(a * 2 + f.ph) * f.amp + Math.sin(a) * f.r * f.tilt * .3, f.cz + Math.sin(a) * f.r * f.e);
  };
  function updateFlyers(t) {
    for (let i = 0; i < NF; i++) {
      const f = fl[i];
      flyAt(f, t, va); flyAt(f, t + .3, vb);
      dummy.position.copy(va); dummy.scale.setScalar(f.s); dummy.lookAt(vb); dummy.updateMatrix();
      craft.setMatrixAt(i, dummy.matrix);
      vb.sub(va).normalize();
      fPos.setXYZ(i * 2, va.x - vb.x * 2.4 * f.s, va.y, va.z - vb.z * 2.4 * f.s);
      fPos.setXYZ(i * 2 + 1, va.x, va.y + .6 * f.s, va.z);
    }
    craft.instanceMatrix.needsUpdate = true; fPos.needsUpdate = true;
  }

  /* ================= 霞の中に立つ巨大な題字「Rumb」 =================
     文字を1枚の絵に描き、世界の中（地上の街と浮遊都市の間）に光る看板として立てる。
     霧でかすみ、手前のビルに一部が隠れる。スクロールで離れると消える。 */
  const TITLE_Z = 200, TITLE_D = 430 - TITLE_Z, TITLE_FILL = { v: .8 };
  const titleMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: null }, uFade: { value: 0 }, uBoost: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWorld;
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: COMMON + /* glsl */`
      uniform sampler2D uMap; uniform float uFade; uniform float uBoost;
      varying vec2 vUv; varying vec3 vWorld;
      void main(){
        vec4 tx = texture2D(uMap, vUv); float a = tx.r; float back = tx.b;   /* r=文字、b=文字の後ろに広がる暗い煙 */
        vec3 toC = vWorld - cameraPosition; float d = length(toC);
        float n = vnoise2(vWorld.xy * .045 + vec2(uTime * .05, -uTime * .02));
        vec3 col = vec3(1., .9, .7) * ${low ? '3.1' : '1.45'} * uBoost * (.93 + .07 * sin(uTime * 1.3 + vUv.x * 9.));
        col = mix(col, haze(toC / d), fogAmount(d, vWorld.y, cameraPosition.y) * .5);
        float foot = mix(.6, 1., smoothstep(.2, .34, vUv.y + (n - .5) * .14));   /* 足もとは砂ぼこりに溶ける */
        a = min(a * foot, 1.);
        /* 文字のまわりだけ霞を暗く沈めて、後ろの光に埋もれないようにする */
        float shade = min(back * (.8 + .14 * n), .8) * foot * ${low ? '.4' : '1.'};
        vec3 dark = haze(toC / d) * vec3(.15, .105, .072);
        float alpha = a + shade * (1. - a);
        gl_FragColor = vec4(mix(dark, col, a / max(alpha, 1e-4)), alpha * uFade);
        ${TAIL}
      }`,
  });
  const title = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), titleMat);
  title.visible = false; title.renderOrder = 1; scene.add(title);
  let titleOn = false;
  function layoutTitle() {
    const half = Math.tan(camera.fov * Math.PI / 360) * camera.aspect;         // 画面の横半分の広がり
    const w = Math.min(262, .88 * 2 * TITLE_D * half / TITLE_FILL.v), h = w * 640 / 2048;
    title.scale.set(w, h, 1);
    title.position.set(0, (camera.aspect < 1 ? 56 : 52) + h * .247, TITLE_Z);   // 文字の下端が屋根の連なりのすぐ上に来る高さ
  }
  function makeTitle() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 640;
    const g = c.getContext('2d'), txt = 'Rumb', fs = 470, gap = fs * .3;
    g.font = `400 ${fs}px Jost, Inter, sans-serif`; g.textBaseline = 'alphabetic'; g.fillStyle = '#fff';
    const ws = [...txt].map((ch) => g.measureText(ch).width);
    const total = ws.reduce((a, b) => a + b, 0) + gap * (txt.length - 1);
    TITLE_FILL.v = total / c.width + .02;
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'lighter';
    /* 青＝文字の後ろに広がる暗い煙（大きくぼかす）、赤＝光る文字（薄い光の輪＋くっきりした本体） */
    for (const [color, blur, alpha, reps] of [['#00f', 75, 1, 4], ['#f00', 26, .4, 1], ['#f00', 0, 1, 1]]) {
      g.fillStyle = color; g.shadowColor = color; g.shadowBlur = blur; g.globalAlpha = alpha;
      for (let k = 0; k < reps; k++) {
        let x = (c.width - total) / 2;
        [...txt].forEach((ch, i) => { g.fillText(ch, x, 478); x += ws[i] + gap; });
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    titleMat.uniforms.uMap.value = tex;
    layoutTitle(); title.visible = true; titleOn = true;
    root.classList.add('title3d');
    if (still) draw(0);
  }
  if (document.fonts && document.fonts.load) {
    document.fonts.load('400 100px Jost', 'Rumb').then((f) => { if (f && f.length) makeTitle(); }).catch(() => {});
  }

  /* ================= 光のにじみ（後処理）と描画の大きさ ================= */
  let composer = null, bloom = null, useBloom = !low;
  if (useBloom) {
    try {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), .5, .65, 1.05);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } catch (e) { composer = null; useBloom = false; }
  }
  const dprMax = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 1.75);
  const dprMin = Math.min(dprMax, low ? .8 : 1);
  let pr = dprMax, W = 0, H = 0, scrollMax = 1;
  function resize(force) {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    scrollMax = Math.max(1, root.scrollHeight - innerHeight);
    if (!force && w === W && h === H) return;
    W = w; H = h;
    renderer.setPixelRatio(pr); renderer.setSize(W, H, false);
    if (composer) { composer.setPixelRatio(pr); composer.setSize(W, H); }
    const asp = W / H;
    camera.aspect = asp; camera.fov = asp < 1 ? 45 + (1 - asp) * 38 : 45; camera.updateProjectionMatrix();
    U.uPx.value = H * pr * .5 / Math.tan(camera.fov * Math.PI / 360);
    if (titleOn) layoutTitle();
  }

  /* ================= 毎フレームの更新 ================= */
  let t = still ? 21 : 0, last = 0, p = 0, mx = 0, my = 0, vx = 0, vy = 0, raf = 0, shown = false;
  const cp = new THREE.Vector3(), ct = new THREE.Vector3(), right = new THREE.Vector3();
  const stats = { ms: 0, pr, bloom: useBloom, frames: 0 };
  window.__rumb = stats;
  let acc = 0, cnt = 0, settle = 40, slow = 0, tried = null, locked = false;

  function draw(dt) {
    U.uTime.value = t;
    const target = still ? 0 : Math.min(1, Math.max(0, (window.scrollY || 0) / scrollMax));
    p += (target - p) * (still ? 1 : 1 - Math.exp(-dt * 3.2));
    vx += (mx - vx) * (1 - Math.exp(-dt * 2.5)); vy += (my - vy) * (1 - Math.exp(-dt * 2.5));

    /* 都市：ゆっくり回りながら、わずかに上下に揺れて浮いている */
    city.position.set(0, CITY_Y + Math.sin(t * .33) * 3.2, 0);
    city.rotation.set(Math.cos(t * .17) * .012, t * .05, Math.sin(t * .21) * .014);
    ringHold.position.copy(city.position);
    ringHold.rotation.set(.1 + Math.sin(t * .11) * .03, 0, .3 + Math.cos(t * .09) * .03);
    ring.rotation.y = -t * .085;
    updateFlyers(t);
    if (titleOn) { const k = Math.min(1, Math.max(0, (p - .05) / .2)); titleMat.uniforms.uFade.value = 1 - k * k * (3 - 2 * k); title.visible = k < 1; titleMat.uniforms.uBoost.value = still ? 1.15 : 1 + .3 * Math.exp(-t * .4); }

    const u = pathU(p);
    posCurve.getPoint(u, cp); lookCurve.getPoint(u, ct);
    const intro = still ? 0 : Math.exp(-t * .85) * (1 - Math.min(1, p * 4));
    cp.z += intro * 70; cp.y -= intro * 9;
    cp.x += Math.sin(t * .13) * 3.5; cp.y += Math.sin(t * .1) * 1.6;
    camera.position.copy(cp); camera.lookAt(ct);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    camera.position.addScaledVector(right, vx * 16); camera.position.y += -vy * 9;
    camera.lookAt(ct);
    camera.rotation.z += vx * .012;

    if (composer && useBloom) composer.render(); else renderer.render(scene, camera);
    if (!shown) { shown = true; stats.first = Math.round(performance.now()); root.classList.add('has3d'); }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const raw = last ? now - last : 16.7; last = now;
    const dt = Math.min(.05, raw / 1000);
    t += dt;
    draw(dt);
    /* 重いときは描画の細かさを自動で下げる */
    stats.frames++;
    if (settle > 0) { settle--; return; }
    if (raw < 200) { acc += raw; cnt++; }
    if (cnt >= 50) {
      const avg = acc / cnt; acc = 0; cnt = 0; stats.ms = avg;
      if (locked) return;
      slow = avg > 23 ? slow + 1 : 0;
      if (slow >= 2) {
        slow = 0; settle = 20;
        if (!tried) tried = { avg, pr, bloom: useBloom };
        if (pr > dprMin + .01) { pr = Math.max(dprMin, pr * .8); resize(true); }
        else if (useBloom) useBloom = false;
        else {
          /* いちばん軽くしても速くならないなら、原因は画質ではない（省電力で30コマに制限されている等）。元の画質に戻して以後は触らない */
          if (avg > tried.avg * .88) { pr = tried.pr; useBloom = tried.bloom; resize(true); }
          locked = true;
        }
        stats.pr = pr; stats.bloom = useBloom;
      }
    }
  }
  function start() {
    cancelAnimationFrame(raf); last = 0;
    if (still) { draw(0); return; }
    raf = requestAnimationFrame(loop);
  }

  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { resize(false); if (still) draw(0); }, 120); });
  addEventListener('load', () => { resize(false); });
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); root.classList.remove('has3d', 'title3d'); });
  canvas.addEventListener('webglcontextrestored', () => { shown = false; if (titleOn) root.classList.add('title3d'); start(); });

  resize(true);
  start();
}
