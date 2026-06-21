// Black Hole — a real-time, physically-based Schwarzschild renderer.
// Single full-screen fragment shader: each pixel traces a light ray as a null
// geodesic through curved spacetime (units where the Schwarzschild radius
// r_s = 1). three.js supplies the WebGL plumbing; the orbit camera is
// hand-rolled so we pull in nothing but the core three module from the CDN.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/* ============================================================
   Shaders
   ============================================================ */
const VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
  varying vec2 vUv;

  uniform vec2  uResolution;
  uniform vec3  uCamPos;
  uniform vec3  uCamRight;
  uniform vec3  uCamUp;
  uniform vec3  uCamFwd;
  uniform float uTanFov;
  uniform float uAspect;
  uniform float uTime;

  uniform int   uSteps;
  uniform float uEscape;

  uniform float uDiskOn;
  uniform float uDiskInner;
  uniform float uDiskOuter;
  uniform float uDiskBright;
  uniform float uTempBias;

  uniform float uLensing;
  uniform float uBeaming;
  uniform float uRedshift;

  uniform float uStarsOn;
  uniform float uStarDensity;
  uniform float uExposure;

  const int MAX_STEPS = 500;

  // --- hashes / noise ---
  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float hash13(vec3 p){
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  // --- procedural starfield, sampled with the (lensed) escape direction ---
  vec3 starField(vec3 dir){
    vec3 col = vec3(0.0);
    for(int l = 0; l < 2; l++){
      float sc = (l == 0 ? 46.0 : 90.0) * uStarDensity;
      vec2 uv = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0))) * sc;
      vec2 ip = floor(uv);
      vec2 fp = fract(uv) - 0.5;
      float h = hash21(ip + float(l) * 31.0);
      float thresh = (l == 0 ? 0.984 : 0.992);
      if(h > thresh){
        float b = smoothstep(0.5, 0.0, length(fp)) * (0.4 + 0.6 * hash21(ip + 7.3));
        float tw = 0.75 + 0.25 * sin(uTime * 2.2 + h * 40.0);
        vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.9, 0.74), hash21(ip + 5.1));
        col += b * tw * tint * (l == 0 ? 1.0 : 0.55);
      }
    }
    // faint nebular wash so the void isn't pure black
    float neb = 0.5 + 0.5 * dir.y;
    col += 0.018 * mix(vec3(0.10, 0.10, 0.20), vec3(0.20, 0.12, 0.10), neb);
    return col * uStarsOn;
  }

  // --- accretion-disk blackbody-ish colour ramp, t ~ normalised temperature ---
  vec3 diskColor(float t){
    t = clamp(t, 0.0, 1.4);
    vec3 a = vec3(0.62, 0.10, 0.02); // coolest: deep red
    vec3 b = vec3(1.00, 0.42, 0.08); // orange
    vec3 c = vec3(1.00, 0.82, 0.42); // amber
    vec3 d = vec3(1.00, 0.97, 0.90); // white
    vec3 e = vec3(0.80, 0.88, 1.00); // hottest: blue-white
    if(t < 0.35)      return mix(a, b, t / 0.35);
    else if(t < 0.70) return mix(b, c, (t - 0.35) / 0.35);
    else if(t < 1.00) return mix(c, d, (t - 0.70) / 0.30);
    else              return mix(d, e, (t - 1.00) / 0.40);
  }

  // geodesic "acceleration": reproduces u'' + u = 1.5 u^2 (i.e. r_s = 1)
  vec3 accel(vec3 p, float h2){
    float r2 = dot(p, p);
    return -1.5 * h2 * p / (r2 * r2 * sqrt(r2));
  }

  void main(){
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 rd = normalize(uCamFwd + uTanFov * (ndc.x * uAspect * uCamRight + ndc.y * uCamUp));

    vec3 pos = uCamPos;
    vec3 vel = rd;
    float h2 = dot(cross(pos, vel), cross(pos, vel)); // conserved angular momentum^2

    vec3 disk = vec3(0.0);     // additive (optically-thin) disk emission
    bool captured = false;
    vec3 escDir = rd;

    for(int i = 0; i < MAX_STEPS; i++){
      if(i >= uSteps) break;
      float r = length(pos);

      if(r < 1.0){ captured = true; break; }                 // event horizon
      if(r > uEscape && dot(pos, vel) > 0.0){ escDir = normalize(vel); break; }

      float dt = clamp(0.18 * (r - 0.9), 0.02, 1.0);
      vec3 prev = pos;

      // velocity Verlet (symplectic, stable for tight orbits)
      vec3 a1 = accel(pos, h2) * uLensing;
      vel += a1 * 0.5 * dt;
      pos += vel * dt;
      vec3 a2 = accel(pos, h2) * uLensing;
      vel += a2 * 0.5 * dt;

      // accretion disk lives in the y = 0 plane; catch a plane crossing
      if(uDiskOn > 0.5 && prev.y * pos.y < 0.0){
        float f = prev.y / (prev.y - pos.y);
        vec3 hit = mix(prev, pos, f);
        float rho = length(hit.xz);
        if(rho >= uDiskInner && rho <= uDiskOuter){
          // temperature profile T ~ r^(-3/4), normalised to ~1 at the inner edge
          float tBase = pow(uDiskInner / rho, 0.75);

          // relativistic Doppler from near-Keplerian orbital motion
          float beta = sqrt(clamp(0.5 / (rho - 1.0), 0.0, 0.95));
          vec3 vdir = normalize(cross(vec3(0.0, 1.0, 0.0), hit)); // prograde
          vec3 ndir = -normalize(vel);                            // toward camera
          float gamma = 1.0 / sqrt(1.0 - beta * beta);
          float dopp = 1.0 / (gamma * (1.0 - beta * dot(vdir, ndir)));
          if(uBeaming < 0.5) dopp = 1.0;

          // gravitational redshift climbing out of the well
          float gshift = uRedshift > 0.5 ? sqrt(max(1.0 - 1.0 / rho, 1e-3)) : 1.0;

          float shift = dopp * gshift;                  // observed / emitted frequency
          float tObs  = tBase * shift * (0.8 + 0.5 * uTempBias);

          // gentle azimuthal texture so the disk reads as moving gas
          float ang = atan(hit.z, hit.x);
          float swirl = 0.85 + 0.15 * sin(ang * 5.0 - uTime * 1.3 + rho * 1.7)
                             + 0.10 * (hash13(vec3(floor(rho * 3.0), floor(ang * 6.0), 1.0)) - 0.5);

          float beam   = uBeaming > 0.5 ? pow(dopp, 3.0) : 1.0;
          float radial = smoothstep(uDiskOuter, uDiskInner, rho);
          float edge   = smoothstep(0.0, 0.5, rho - uDiskInner)
                       * smoothstep(0.0, 1.5, uDiskOuter - rho);
          float emis   = uDiskBright * (0.22 + 0.95 * radial) * beam * shift * swirl * edge;

          disk += diskColor(tObs) * emis;
        }
      }
    }

    vec3 col = disk;
    if(!captured) col += starField(escDir);

    // exposure tone-map + gamma (ShaderMaterial output is taken as-is)
    col *= uExposure;
    col = vec3(1.0) - exp(-col);
    col = pow(col, vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ============================================================
   Renderer + scene
   ============================================================ */
const canvas = document.getElementById('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  showGlError();
}

if (renderer) {
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // we tone-map/gamma in-shader
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const scene = new THREE.Scene();
  const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uResolution:  { value: new THREE.Vector2(1, 1) },
    uCamPos:      { value: new THREE.Vector3() },
    uCamRight:    { value: new THREE.Vector3() },
    uCamUp:       { value: new THREE.Vector3() },
    uCamFwd:      { value: new THREE.Vector3() },
    uTanFov:      { value: Math.tan((55 * Math.PI / 180) / 2) },
    uAspect:      { value: 1.6 },
    uTime:        { value: 0 },
    uSteps:       { value: 240 },
    uEscape:      { value: 60 },
    uDiskOn:      { value: 1 },
    uDiskInner:   { value: 3.0 },
    uDiskOuter:   { value: 16.0 },
    uDiskBright:  { value: 1.2 },
    uTempBias:    { value: 0.5 },
    uLensing:     { value: 1 },
    uBeaming:     { value: 1 },
    uRedshift:    { value: 1 },
    uStarsOn:     { value: 1 },
    uStarDensity: { value: 1 },
    uExposure:    { value: 1 }
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // --- state + constants declared up front: the control wiring below runs its
  //     handlers immediately on setup, so these must already be initialised ---
  let dirty = true, autorotate = false;
  let massLabel = '4.0×10⁶';
  const G = 6.674e-11, C = 2.998e8, MSUN = 1.989e30, SIGMA = 5.670e-8,
        HBAR = 1.055e-34, KB = 1.381e-23;
  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
                '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const sup = (n) => String(n).split('').map((c) => SUP[c] || c).join('');

  /* ---------- hand-rolled orbit camera (around the origin) ---------- */
  const cam = { az: 0.6, el: 0.22, dist: 14 };
  const EL_LIMIT = 1.45;
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

  function updateCamera() {
    const ce = Math.cos(cam.el), se = Math.sin(cam.el);
    const ca = Math.cos(cam.az), sa = Math.sin(cam.az);
    const pos = uniforms.uCamPos.value.set(cam.dist * ce * ca, cam.dist * se, cam.dist * ce * sa);
    const fwd = uniforms.uCamFwd.value.copy(pos).multiplyScalar(-1).normalize();
    const right = uniforms.uCamRight.value.copy(fwd).cross(WORLD_UP).normalize();
    uniforms.uCamUp.value.copy(right).cross(fwd).normalize();
    uniforms.uEscape.value = Math.max(60, uniforms.uDiskOuter.value + 12, cam.dist + 12);
  }

  /* ---------- pointer / wheel interaction ---------- */
  let dragging = false, lastX = 0, lastY = 0, hintFaded = false;
  const hint = document.getElementById('stageHint');
  function fadeHint() { if (!hintFaded) { hintFaded = true; if (hint) hint.classList.add('fade'); } }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId); fadeHint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    cam.az += (e.clientX - lastX) * 0.005;
    cam.el = Math.max(-EL_LIMIT, Math.min(EL_LIMIT, cam.el - (e.clientY - lastY) * 0.005));
    lastX = e.clientX; lastY = e.clientY;
    dirty = true;
  });
  const endDrag = (e) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 3, 60);
    syncDistance(); fadeHint(); dirty = true;
  }, { passive: false });

  /* ---------- control wiring ---------- */
  const $ = (id) => document.getElementById(id);
  const out = (id, v) => { const el = $(id); if (el) el.value = v; };

  // range/checkbox -> uniform + readout
  function bindRange(id, uni, fmt, after) {
    const el = $(id);
    const apply = () => {
      const v = parseFloat(el.value);
      if (uni) uniforms[uni].value = v;
      out(id + 'Out', fmt ? fmt(v) : String(v));
      if (after) after(v);
      dirty = true;
    };
    el.addEventListener('input', apply);
    apply();
  }
  function bindCheck(id, uni, after) {
    const el = $(id);
    const apply = () => {
      if (uni) uniforms[uni].value = el.checked ? 1 : 0;
      if (after) after(el.checked);
      dirty = true;
    };
    el.addEventListener('change', apply);
    apply();
  }

  const one = (v) => v.toFixed(1);
  const two = (v) => v.toFixed(2);
  const int = (v) => String(Math.round(v));

  bindRange('distance', null, one, (v) => { cam.dist = v; updateCamera(); });
  bindRange('fov', null, int, (v) => { uniforms.uTanFov.value = Math.tan((v * Math.PI / 180) / 2); });
  bindCheck('autorotate', null, (on) => { autorotate = on; if (on) dirty = true; });

  bindCheck('diskOn', 'uDiskOn');
  bindRange('diskInner', 'uDiskInner', one, recomputePhysics);
  bindRange('diskOuter', 'uDiskOuter', int, () => { updateCamera(); });
  bindRange('diskBright', 'uDiskBright', two);
  bindRange('mdot', null, two, recomputePhysics);

  bindCheck('lensing', 'uLensing');
  bindCheck('beaming', 'uBeaming');
  bindCheck('redshift', 'uRedshift');

  bindCheck('starsOn', 'uStarsOn');
  bindRange('starDensity', 'uStarDensity', two);
  bindRange('steps', 'uSteps', int);
  bindRange('exposure', 'uExposure', two);

  bindRange('mass', null, () => massLabel, recomputePhysics);

  function syncDistance() {
    const el = $('distance');
    el.value = String(cam.dist);
    out('distanceOut', one(cam.dist));
  }

  /* ---------- physical-parameter read-outs ---------- */
  function recomputePhysics() {
    const massVal = parseFloat($('mass').value);     // log10(M / Msun), 0..9
    const Msun = Math.pow(10, massVal);
    const Mkg = Msun * MSUN;
    const rs = 2 * G * Mkg / (C * C);

    massLabel = fmtMsun(Msun);
    out('massOut', massLabel);
    $('roRs').textContent     = fmtLen(rs);
    $('roPhoton').textContent = fmtLen(1.5 * rs);
    $('roIsco').textContent   = fmtLen(3 * rs);
    $('roShadow').textContent = fmtLen(Math.sqrt(27) * rs);

    // Shakura–Sunyaev peak effective temperature near the inner edge
    const eta = 0.1;
    const Ledd = 1.26e31 * Msun;                     // W
    const MdotEdd = Ledd / (eta * C * C);            // kg/s at the Eddington rate
    const mdot = parseFloat($('mdot').value);        // in Eddington units
    const Mdot = mdot * MdotEdd;
    const rin = parseFloat($('diskInner').value) * rs;
    const Tstar = Math.pow(3 * G * Mkg * Mdot / (8 * Math.PI * SIGMA * Math.pow(rin, 3)), 0.25);
    const Tpeak = 0.488 * Tstar;
    $('roTemp').textContent = fmtTemp(Tpeak);

    const Th = HBAR * Math.pow(C, 3) / (8 * Math.PI * G * Mkg * KB);
    $('roHawking').textContent = fmtTemp(Th);

    // bias the in-shader colour ramp: hotter disks render bluer
    uniforms.uTempBias.value = clamp(0.5 + 0.18 * Math.log10(Tpeak / 1e5), 0, 1);
    dirty = true;
  }

  /* ---------- number formatting ---------- */
  function sci(x) {
    if (x === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(x)));
    const m = x / Math.pow(10, e);
    return m.toFixed(2) + '×10' + sup(e);
  }
  function fmtMsun(m) {
    if (m < 1e3) return m.toFixed(m < 10 ? 1 : 0) + ' M☉';
    return sci(m) + ' M☉';
  }
  function fmtLen(m) {
    const RSUN = 6.957e8, AU = 1.496e11, LY = 9.461e15;
    if (m < 1e3) return m.toFixed(0) + ' m';
    if (m < 0.3 * RSUN) return Math.round(m / 1e3).toLocaleString('en-US') + ' km';
    if (m < 0.3 * AU) return (m / RSUN).toFixed(2) + ' R☉';
    if (m < 0.3 * LY) return (m / AU).toFixed(2) + ' AU';
    return (m / LY).toFixed(3) + ' ly';
  }
  function fmtTemp(k) {
    if (k < 1e-2) return sci(k) + ' K';
    if (k < 1e5) return Math.round(k).toLocaleString('en-US') + ' K';
    return sci(k) + ' K';
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- resize ---------- */
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    const dpr = renderer.getPixelRatio();
    uniforms.uResolution.value.set(w * dpr, h * dpr);
    uniforms.uAspect.value = w / h;
    dirty = true;
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);

  /* ---------- render loop (only when something changed) ---------- */
  const fpsEl = document.getElementById('fpsReadout');
  const clock = new THREE.Clock();
  let acc = 0, frames = 0;

  function loop() {
    requestAnimationFrame(loop);
    const dt = clock.getDelta();
    if (autorotate) { cam.az += dt * 0.18; dirty = true; }
    if (!dirty) { if (fpsEl) fpsEl.textContent = 'idle'; return; }

    uniforms.uTime.value += dt;
    updateCamera();
    renderer.render(scene, screenCam);
    dirty = autorotate;

    acc += dt; frames++;
    if (acc >= 0.5 && fpsEl) { fpsEl.textContent = Math.round(frames / acc) + ' fps'; acc = 0; frames = 0; }
  }

  recomputePhysics();
  resize();
  updateCamera();
  loop();
}

/* ============================================================
   Learn / physics primer overlay
   ============================================================ */
(function setupLearn() {
  const overlay = document.getElementById('learnOverlay');
  const panel = document.getElementById('learnPanel');
  const openers = [document.getElementById('learnBtn'), document.getElementById('learnBtn2')];
  const closeBtn = document.getElementById('learnClose');
  const trigger = document.getElementById('learnBtn');
  let mathRendered = false, lastFocus = null;

  function renderMath() {
    if (mathRendered) return;
    if (typeof window.renderMathInElement === 'function') {
      window.renderMathInElement(document.getElementById('learnBody'), {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
      mathRendered = true;
    }
  }

  function open() {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    // KaTeX scripts are deferred; retry briefly if not ready at first open
    renderMath();
    if (!mathRendered) { let n = 0; const t = setInterval(() => { renderMath(); if (mathRendered || ++n > 20) clearInterval(t); }, 100); }
    panel.focus();
    document.addEventListener('keydown', onKey);
  }
  function close() {
    overlay.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') { // simple focus trap inside the dialog
      const f = panel.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  openers.forEach((b) => b && b.addEventListener('click', open));
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
})();

function showGlError() {
  const err = document.getElementById('glError');
  const fps = document.getElementById('fpsReadout');
  const hint = document.getElementById('stageHint');
  if (err) err.hidden = false;
  if (fps) fps.hidden = true;
  if (hint) hint.hidden = true;
}
