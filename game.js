/* =========================================================
   MAALAM PH — game script (installable app copy of GameJs)
   This file holds ONLY JavaScript (no <script> tags).
   The same code runs in the Apps Script web app and here (index.html).
   ========================================================= */
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const PALETTE = { red:'#e53935', blue:'#1e88e5', yellow:'#fdd835', green:'#43a047', orange:'#fb8c00', purple:'#8e24aa', pink:'#ec407a' };
const COLORS = Object.assign({ brown:'#8d6e63', black:'#212121', white:'#fafafa', gray:'#9e9e9e' }, PALETTE);
const GEM_SHAPES = ['heart', 'star', 'circle', 'square', 'triangle', 'diamond'];
const TOPIC_ICON = { color:'🎨', number:'🔢', shape:'🔷', letter:'🔤', syllable:'🗣️', sentence:'📖' };
const TOPIC_DECK = { color:'Colors', number:'Numbers', shape:'Shapes', letter:'Letters', syllable:'Syllables', sentence:'Letters' };
const PRAISE = ['Great job!', 'Yes! You got it!', 'Galing! Super!', 'Wow, well done!', 'That is right!'];
const HEROES = {
  boy:  { sprite:'hero_boy',  emoji:'👦🏽', label:'Boy',  he:'he',  his:'his', him:'him' },
  girl: { sprite:'hero_girl', emoji:'👧🏽', label:'Girl', he:'she', his:'her', him:'her' }
};

const G = { data:null, cfg:{}, media:{}, mediaCache:{}, audio:null, player:null, session:null, account:null, screen:'', previewType:'boy',
  sceneDef:null, hero:null, enemies:[], restore:[], recent:new Set(), sound:true, voiceRate:0.85, camMode:'orbit', camTarget:0,
  walking:false, attacking:false, panelUp:false, tutorial:false, shield:0, double:false, spellCtx:null, readToken:0,
  voiceToken:0, ttsPending:{}, hashCache:{} };

/** Fills story placeholders with the child's hero: {hero} {heroEmoji} {he} {He} {his} {him} */
function fill(t) {
  const type = (G.player && G.player.heroType) || G.previewType || 'boy', h = HEROES[type] || HEROES.boy;
  const name = (G.player && G.player.name) || 'Maalam';
  return String(t == null ? '' : t).replace(/\{hero\}/g, name).replace(/\{heroEmoji\}/g, h.emoji)
    .replace(/\{He\}/g, cap(h.he)).replace(/\{he\}/g, h.he).replace(/\{his\}/g, h.his).replace(/\{him\}/g, h.him);
}
const heroName = () => (G.player && G.player.name) || 'Maalam';

/* ---------------- browser storage (session only) ---------------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ---------------- server bridge ---------------- */
/* The same game runs two ways:
   • inside the Apps Script web app  → google.script.run
   • as the installable app (PWA)    → fetch() to the Apps Script /exec API (works offline where possible) */
const API_URL = 'https://script.google.com/macros/s/AKfycbxZB8Go9WgEABH8iZqJNQ3p7ttQnD-KSpwooPolTHsK4LNC79EcpZzofntqO1Le4ebv/exec';
const IS_GAS = !!(window.google && google.script && google.script.run);
const IS_PWA = !IS_GAS;
async function server(fn, ...args) {
  if (IS_GAS) {
    return new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej)[fn](...args));
  }
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args }), redirect: 'follow', cache: 'no-store' });
  } catch (e) {
    // Online but blocked = the server sent an error page (old deployment, missing permission, or access not "Anyone").
    G.serverBlocked = navigator.onLine;
    throw new Error(navigator.onLine
      ? 'OFFLINE: Cannot reach the Maalam PH server right now. Please try again in a moment.'
      : 'OFFLINE: You are offline. Connect to the internet and try again.');
  }
  if (!res.ok) { G.serverBlocked = true; throw new Error('OFFLINE: The game server did not answer (' + res.status + '). Please try again.'); }
  let j;
  try { j = await res.json(); }
  catch (e) { G.serverBlocked = true; throw new Error('OFFLINE: The game server sent a page instead of an answer. Please try again in a moment.'); }
  G.serverBlocked = false;
  if (!j.ok) throw new Error(j.error || 'Something went wrong.');
  return j.result;
}
const isOfflineError = e => /OFFLINE:/.test(String((e && e.message) || e));
/* ---------------- media from Google Drive ---------------- */
const hasMedia = k => !!(G.media && G.media[k]);
/* Media cache on this device (installable app only): every picture and voice clip that is
   played is kept, so it works offline next time. "Download for offline" fills it in advance. */
const MEDIA_CACHE = 'maalam-media-v1';
const canCache = () => IS_PWA && 'caches' in window;
const mediaCacheUrl = key => new URL('__media/' + encodeURIComponent(key), location.href).href;
async function cacheGet(key) {
  if (!canCache()) return null;
  try { const r = await caches.match(mediaCacheUrl(key)); return r ? await r.blob() : null; } catch (e) { return null; }
}
async function cachePut(key, blob) {
  if (!canCache()) return;
  try { const c = await caches.open(MEDIA_CACHE); await c.put(mediaCacheUrl(key), new Response(blob, { headers: { 'Content-Type': blob.type } })); } catch (e) {}
}
function b64Blob(b64, mime) {
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'application/octet-stream' });
}
async function getMedia(key) {
  if (G.mediaCache[key]) return G.mediaCache[key];
  const m = G.media && G.media[key];
  if (m && m.kind === 'video') {
    return (G.mediaCache[key] = { kind: 'video', url: `https://drive.google.com/file/d/${encodeURIComponent(m.fileId)}/preview` });
  }
  let blob = await cacheGet(key);
  if (!blob) {
    if (!m) return null;
    try {
      const d = await server('getMediaData', key, G.session);
      if (!d) return null;
      blob = b64Blob(d.b64, d.mime);
      cachePut(key, blob);
    } catch (e) { if (!isOfflineError(e)) console.warn('Media not loaded:', key, e); return null; }
  }
  return (G.mediaCache[key] = { kind: (m && m.kind) || 'audio', url: URL.createObjectURL(blob) });
}
function stopAudio() { if (G.audio) { const a = G.audio; G.audio = null; try { a.pause(); } catch (e) {} } }
/**
 * Plays an MP3. If `spans` (word elements) are given, words light up in step with the audio
 * (spread by word length, so it follows the reading closely without needing timing data).
 */
function playAudio(url, spans, rate) {
  return new Promise(res => {
    stopAudio();
    if (!G.sound) { res(); return; }
    const a = new Audio(url); G.audio = a;
    if (rate && rate < .85) { a.playbackRate = .9; a.preservesPitch = true; }
    const words = spans || [], lens = words.map(w => w.textContent.length + 1), total = lens.reduce((x, y) => x + y, 0) || 1;
    const light = i => words.forEach((w, j) => w.classList.toggle('hl', j === i));
    if (words.length) a.ontimeupdate = () => {
      if (!a.duration) return;
      const lead = .25, t = Math.max(0, a.currentTime - lead) / Math.max(.1, a.duration - lead) * total;
      let i = 0, acc = lens[0]; while (i < lens.length - 1 && acc < t) { i++; acc += lens[i]; }
      light(i);
    };
    let fin = false;
    const done = () => { if (fin) return; fin = true; words.forEach(w => w.classList.remove('hl')); if (G.audio === a) G.audio = null; res(); };
    a.onended = done; a.onerror = done; a.onpause = () => { if (!a.ended) done(); };
    a.play().catch(done);
  });
}
function showVideo(key, title, doneLabel = 'Continue ▶') {
  return new Promise(async res => {
    if (IS_PWA && !navigator.onLine) { toast('📶 Videos need the internet', 3000); res('none'); return; }
    const m = await getMedia(key);
    if (!m) { res('none'); return; }
    hush();
    const v = $('video');
    v.innerHTML = `<div class="vcard"><h2>${esc(title)}</h2>
      <div class="vframe"><iframe src="${esc(m.url)}" allow="autoplay; fullscreen" allowfullscreen title="${esc(title)}"></iframe></div>
      <div class="row"><button class="toy ghost" id="vClose">✖ Close</button><button class="toy big" id="vDone">${doneLabel}</button></div>
      <div class="tip">Press ▶ on the video to play it.</div></div>`;
    v.classList.remove('hidden');
    const close = r => { v.classList.add('hidden'); v.innerHTML = ''; res(r); };
    $('vDone').onclick = () => close('done');
    $('vClose').onclick = () => close('closed');
  });
}

/* ---------------- voice + sound effects ---------------- */
let voice = null, AC = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find(v => /^en[-_](PH)/i.test(v.lang))
       || vs.find(v => /^en[-_](US|GB|AU)/i.test(v.lang) && /female|samantha|zira|google us|karen/i.test(v.name))
       || vs.find(v => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
/* ---- AI voice (OpenAI, generated on the server and saved in Drive) ---- */
const normVoiceText = t => String(t || '').replace(/\s+/g, ' ').trim();
const aiVoiceOn = () => String(G.cfg.aiVoice || '').toLowerCase() === 'on' && !!(window.crypto && crypto.subtle && window.TextEncoder);
async function ttsHash(text) {
  const profile = [G.cfg.ttsModel || 'gpt-4o-mini-tts', G.cfg.ttsVoice || 'coral', G.cfg.ttsVersion || '1'].join('|');
  const src = profile + '\n' + normVoiceText(text);
  if (G.hashCache[src]) return G.hashCache[src];
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  return (G.hashCache[src] = hex);
}
function b64Url(b64, mime) {
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime || 'audio/mpeg' }));
}
/** Returns a playable URL for this line in the AI voice, or null (then the device voice is used). */
async function aiVoiceUrl(text) {
  if (!aiVoiceOn()) return null;
  const t = normVoiceText(text); if (!t) return null;
  let key;
  try { key = 'tts:' + await ttsHash(t); } catch (e) { return null; }
  if (G.mediaCache[key]) return G.mediaCache[key].url;
  if (hasMedia(key) || canCache()) { const m = await getMedia(key); if (m) return m.url; }
  if (!G.session || !G.account || G.account.status !== 'active') return null;
  if (IS_PWA && !navigator.onLine) return null;
  if (!G.ttsPending[key]) {
    G.ttsPending[key] = server('speakText', G.session, t)
      .then(d => {
        if (!d) return null;
        const blob = b64Blob(d.b64, d.mime); cachePut(key, blob);
        const url = URL.createObjectURL(blob); G.mediaCache[key] = { kind: 'audio', url }; return url;
      })
      .catch(() => null)
      .finally(() => { setTimeout(() => { delete G.ttsPending[key]; }, 0); });
  }
  return G.ttsPending[key];
}
/** Loads common lines in the background so they play instantly. */
function preloadVoice(lines) { if (aiVoiceOn()) lines.forEach(l => { aiVoiceUrl(l); }); }

/**
 * The one voice function. Order: AI voice MP3 → device voice.
 * opt.el / opt.spans: words to highlight while speaking. Resolves when finished (false if interrupted).
 */
async function speak(text, opt = {}) {
  const token = ++G.voiceToken;
  stopAudio(); if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (!G.sound || !text) return true;
  const spans = opt.spans || (opt.el ? [...opt.el.querySelectorAll('.word')] : null);
  const url = await aiVoiceUrl(text);
  if (token !== G.voiceToken) return false;
  if (url) { await playAudio(url, spans, opt.rate); return token === G.voiceToken; }
  if (spans && spans.length) await deviceSayHighlight(spans, opt); else await deviceSay(text, opt);
  return token === G.voiceToken;
}
function say(text, opt = {}) { return speak(text, opt); }

/* ---- device voice (fallback when there is no AI voice) ---- */
function deviceSay(text, opt = {}) {
  return new Promise(res => {
    if (!G.sound || !('speechSynthesis' in window) || !text) { res(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[“”"]/g, ''));
    if (voice) u.voice = voice;
    u.rate = opt.rate || G.voiceRate; u.pitch = 1.12;
    u.onend = res; u.onerror = res;
    speechSynthesis.speak(u);
    setTimeout(res, 1500 + String(text).length * 90);
  });
}
function deviceSayHighlight(spans, opt = {}) {
  const words = spans.map(s => s.textContent);
  const text = words.join(' '), offs = []; let pos = 0;
  words.forEach(w => { offs.push(pos); pos += w.length + 1; });
  return new Promise(res => {
    if (!G.sound || !('speechSynthesis' in window) || !text) { res(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = opt.rate || G.voiceRate; u.pitch = 1.1;
    let fin = false; const end = () => { if (fin) return; fin = true; spans.forEach(s => s.classList.remove('hl')); res(); };
    u.onboundary = e => {
      if (e.name && e.name !== 'word') return;
      let i = 0; while (i + 1 < offs.length && offs[i + 1] <= e.charIndex) i++;
      spans.forEach((s, j) => s.classList.toggle('hl', j === i));
    };
    u.onend = end; u.onerror = end;
    speechSynthesis.speak(u);
    setTimeout(end, 3000 + text.length * 110);
  });
}
function hush() { G.readToken++; G.voiceToken++; stopAudio(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
/** Your own recording (from Drive) first, then the AI voice, then the device voice. Words light up as they are read. */
async function narrate(el, text, audioKey, opt = {}) {
  const token = ++G.readToken;
  const spans = el ? [...el.querySelectorAll('.word')] : null;
  if (audioKey && hasMedia(audioKey)) {
    const m = await getMedia(audioKey);
    if (token !== G.readToken) return false;
    if (m) { await playAudio(m.url, spans, opt.rate); return token === G.readToken; }
  }
  const say2 = text || (spans ? spans.map(s => s.textContent).join(' ') : '');
  await speak(say2, Object.assign({}, opt, { spans }));
  return token === G.readToken;
}
/** Reading practice: the whole sentence is read with each word lighting up. */
async function readAlong(selector) {
  const spans = [...document.querySelectorAll(selector)];
  if (!spans.length) return true;
  if (aiVoiceOn() && G.session) {
    const token = ++G.readToken;
    await speak(spans.map(s => s.textContent).join(' '), { spans, rate: .72 });
    return token === G.readToken;
  }
  const token = ++G.readToken;
  for (const sp of spans) {
    if (token !== G.readToken) return false;
    sp.classList.add('hl');
    await deviceSay(sp.textContent.replace(/[.!?,]/g, ''), { rate: .72 });
    sp.classList.remove('hl');
    await wait(70);
  }
  return token === G.readToken;
}
function unlockAudio() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch (e) {} }
function tone(f, dur, type = 'sine', vol = .14, when = 0) {
  if (!AC || !G.sound) return;
  const o = AC.createOscillator(), g = AC.createGain(), t0 = AC.currentTime + when;
  o.type = type; o.frequency.setValueAtTime(f, t0);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
  o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + dur + .02);
}
const SFX = {
  good: () => { tone(660, .15); tone(880, .22, 'sine', .14, .1); },
  bad: () => tone(210, .28, 'triangle', .12),
  hit: () => { tone(160, .12, 'square', .1); tone(90, .22, 'sawtooth', .07, .03); },
  hurt: () => { tone(300, .15, 'square', .08); tone(180, .3, 'square', .08, .12); },
  gem: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .25, 'sine', .12, i * .07)),
  level: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, .32, 'triangle', .13, i * .1)),
  magic: () => [880, 1175, 1568].forEach((f, i) => tone(f, .3, 'sine', .1, i * .06)),
  flip: () => tone(700, .08, 'triangle', .08),
  poof: () => { tone(500, .1, 'sine', .1); tone(250, .3, 'sine', .08, .08); },
  laugh: () => [420, 380, 420, 380].forEach((f, i) => tone(f, .09, 'square', .05, i * .1))
};

/* ---------------- three.js core ---------------- */
let renderer, scene3, camera, world, dirLight;
const tickers = [];
const clock = new THREE.Clock();
const lin = k => k;
const easeInOut = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const easeOutBack = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
function tween(dur, fn, ease = easeInOut) {
  return new Promise(res => {
    let e = 0; fn(ease(0));
    tickers.push(dt => { e += dt; const k = Math.min(e / dur, 1); fn(ease(k)); if (k >= 1) { res(); return false; } return true; });
  });
}
function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene3 = new THREE.Scene(); scene3.background = new THREE.Color('#b3e5fc');
  camera = new THREE.PerspectiveCamera(55, 1, .1, 300); camera.position.set(0, 4, 10);
  scene3.add(new THREE.HemisphereLight('#ffffff', '#8d6e63', .78));
  dirLight = new THREE.DirectionalLight('#fff4e0', .85);
  dirLight.castShadow = true; dirLight.shadow.mapSize.set(1024, 1024);
  Object.assign(dirLight.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
  scene3.add(dirLight); scene3.add(dirLight.target);
  world = new THREE.Group(); scene3.add(world);
  G.look = V(0, 1, 0);
  window.addEventListener('resize', resize); resize();
  tickers.push(heroTick, enemyTick);
  loop();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = camera.aspect < .8 ? 72 : 55; camera.updateProjectionMatrix();
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  for (let i = tickers.length - 1; i >= 0; i--) if (tickers[i](dt, t) === false) tickers.splice(i, 1);
  updateCamera(dt, t);
  renderer.render(scene3, camera);
}
const _p = V(0, 0, 0), _l = V(0, 0, 0);
function updateCamera(dt, t) {
  const hx = G.hero ? G.hero.root.position.x : 0, portrait = camera.aspect < .8;
  const drop = G.panelUp ? (portrait ? 2.4 : 1.0) : 0;
  switch (G.camMode) {
    case 'preview': portrait ? (_p.set(hx + .3, 2.1, 6), _l.set(hx, -.2, 0)) : (_p.set(hx + 1.8, 2.0, 5.4), _l.set(hx + 1.7, 1.1, 0)); break;
    case 'orbit': _p.set(hx + Math.sin(t * .25) * 4.5, 3.2, (portrait ? 10 : 7.5) + Math.cos(t * .3) * 1.2); _l.set(hx, 1.3, 0); break;
    case 'battle': { const m = (hx + G.camTarget) / 2; _p.set(m - .5, 3.4, portrait ? 12 : 9.2); _l.set(m, 1.7 - drop, 0); break; }
    case 'gem': _p.set(G.camTarget, 3, portrait ? 8.8 : 6.8); _l.set(G.camTarget, 2.1 - drop * .75, 1); break;
    default: _p.set(hx + 1, 3.4, portrait ? 12 : 9); _l.set(hx + 3, 1.2, 0);
  }
  const a = 1 - Math.pow(.03, dt);
  camera.position.lerp(_p, a); G.look.lerp(_l, a); camera.lookAt(G.look);
  dirLight.position.set(hx + 6, 12, 8); dirLight.target.position.set(hx, 0, 0);
}

/* ---------------- geometry helpers ---------------- */
const Box = (...a) => new THREE.BoxGeometry(...a);
const Sph = (...a) => new THREE.SphereGeometry(...a);
const Cyl = (...a) => new THREE.CylinderGeometry(...a);
const Cone = (...a) => new THREE.ConeGeometry(...a);
const Torus = (...a) => new THREE.TorusGeometry(...a);
function mat(hex, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color: hex, roughness: .65, metalness: 0 }, o)); }
function M(geo, m, x = 0, y = 0, z = 0) { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; return me; }
function cached(g) { g.userData.cached = true; return g; }
const PART_GEO = cached(new THREE.OctahedronGeometry(.09));
const PUFF_GEO = cached(new THREE.SphereGeometry(.14, 10, 8));
const TEX = {};
function textTex(txt) {
  if (TEX[txt]) return TEX[txt];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#2e1f5e'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `800 ${txt.length > 2 ? 46 : 86}px "Baloo 2", Arial, sans-serif`;
  x.fillText(txt, 64, 70);
  return (TEX[txt] = new THREE.CanvasTexture(c));
}
function R(m, hex) { const c = new THREE.Color(hex); m.color.copy(c).lerp(new THREE.Color('#9e9e9e'), .82); G.restore.push({ m, c }); return m; }
/** A limb that hangs down from a pivot (so rotation.x swings it forward). */
function limb(len, rTop, rBot, m, handR) {
  const g = new THREE.Group();
  g.add(M(Cyl(rTop, rBot, len, 10), m, 0, -len / 2, 0));
  if (handR) g.add(M(Sph(handR, 10, 8), m, 0, -len, 0));
  return g;
}
function eyesOn(g, y, z, dx, r, hex) {
  const white = mat('#ffffff'), glow = mat(hex, { emissive: hex, emissiveIntensity: .8 });
  [-1, 1].forEach(s => { g.add(M(Sph(r, 12, 10), white, s * dx, y, z)); g.add(M(Sph(r * .55, 10, 8), glow, s * dx, y, z + r * .72)); });
}
function fangs(g, y, z, dx, size, white) { [-1, 1].forEach(s => { const f = M(Cone(size * .4, size, 6), white, s * dx, y, z); f.rotation.x = Math.PI; g.add(f); }); }

/* ---------------- heroes ---------------- */
function heroSpriteFor(type) { return sprite((HEROES[type] || HEROES.boy).sprite); }
function buildHero(sp, type) {
  const skin = mat(sp.bodyColor), shirt = mat(sp.accentColor), bottoms = mat(sp.extraColor || '#0038a8');
  const dark = mat('#2b1d14'), hairM = mat(sp.eyeColor || '#2b1d14'), wood = mat('#bc8a5f'), cheek = mat('#ff8a80');
  const girl = type === 'girl';
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group();
  [[legL, -.13], [legR, .13]].forEach(([g, x]) => {
    g.position.set(x, .55, 0);
    g.add(M(Cyl(.1, .1, .45, 12), skin, 0, -.25, 0)); g.add(M(Sph(.13, 12, 8), girl ? mat('#ce1126') : dark, 0, -.5, .05));
    body.add(g);
  });
  if (girl) body.add(M(Cyl(.26, .44, .42, 20), bottoms, 0, .66, 0));
  else body.add(M(Cyl(.3, .3, .28, 16), bottoms, 0, .65, 0));
  body.add(M(Cyl(.26, .31, .52, 16), shirt, 0, 1.0, 0));
  const armL = new THREE.Group(), armR = new THREE.Group();
  [[armL, -.37], [armR, .37]].forEach(([g, x]) => {
    g.position.set(x, 1.2, 0);
    g.add(M(Sph(.12, 10, 8), shirt, 0, 0, 0)); g.add(M(Cyl(.075, .075, .4, 10), skin, 0, -.22, 0)); g.add(M(Sph(.1, 10, 8), skin, 0, -.44, 0));
    body.add(g);
  });
  const sword = new THREE.Group(); sword.position.set(0, -.46, .04);
  const bladeMat = mat('#e0c9a6', { emissive: '#000000' });
  sword.add(M(Box(.08, .08, .8), bladeMat, 0, 0, .45)); sword.add(M(Box(.3, .07, .07), wood, 0, 0, .07));
  armR.add(sword);
  body.add(M(Sph(.33, 22, 16), skin, 0, 1.56, 0));
  body.add(M(Sph(.345, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.1), hairM, 0, 1.6, -.03));
  [-1, 1].forEach(s => {
    body.add(M(Sph(.05, 8, 6), dark, s * .11, 1.6, .29));
    const ch = M(Sph(.055, 8, 6), cheek, s * .19, 1.49, .25); ch.scale.z = .4; body.add(ch);
  });
  const smile = M(Torus(.08, .018, 6, 14, Math.PI), dark, 0, 1.49, .3); smile.rotation.z = Math.PI; body.add(smile);
  if (girl) {
    const back = M(Cyl(.3, .36, .75, 16, 1, false, Math.PI / 2, Math.PI), hairM, 0, 1.36, -.02); body.add(back);
    for (let i = 0; i < 4; i++) body.add(M(Sph(.1 - i * .012, 10, 8), hairM, 0, 1.25 - i * .16, -.33));
    const flower = new THREE.Group(); flower.position.set(.24, 1.76, .14);
    const petal = mat('#ffffff'); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; flower.add(M(Sph(.045, 8, 6), petal, Math.cos(a) * .06, Math.sin(a) * .06, 0)); }
    flower.add(M(Sph(.035, 8, 6), mat('#fcd116'), 0, 0, .02)); body.add(flower);
    body.add(M(Torus(.3, .03, 6, 24, Math.PI), mat('#ce1126'), 0, 1.66, .02));
  } else {
    body.add(M(Cone(.66, .34, 28), mat('#d9a441'), 0, 1.93, 0));
    const hb = M(Torus(.3, .03, 6, 24), mat('#8d5524'), 0, 1.82, 0); hb.rotation.x = Math.PI / 2; body.add(hb);
    body.add(M(Sph(.05, 8, 6), mat('#8d5524'), 0, 2.11, 0));
  }
  const ring = new THREE.Mesh(Torus(.72, .05, 8, 44), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .85 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = .06; ring.visible = false; root.add(ring);
  const bubble = new THREE.Mesh(Sph(1.3, 24, 16), new THREE.MeshBasicMaterial({ color: '#80d8ff', transparent: true, opacity: 0, depthWrite: false }));
  bubble.position.y = 1.1; root.add(bubble);
  const light = new THREE.PointLight('#ffffff', 0, 5); light.position.y = 1.2; root.add(light);
  return { root, body, legL, legR, armL, armR, sword, bladeMat, ring, light, bubble };
}
function heroTick(dt, t) {
  const h = G.hero; if (!h) return true;
  const s = G.walking ? Math.sin(t * 11) : 0;
  h.legL.rotation.x = s * .7; h.legR.rotation.x = -s * .7; h.armL.rotation.x = -s * .6;
  if (!G.attacking) h.armR.rotation.x = s * .6;
  h.body.position.y = G.walking ? Math.abs(Math.sin(t * 11)) * .07 : Math.sin(t * 2.2) * .025;
  if (G.camMode === 'preview') h.root.rotation.y = .5 + Math.sin(t * .8) * .6;
  if (h.ring.visible) { h.ring.rotation.z += dt; h.ring.scale.setScalar(1 + Math.sin(t * 4) * .07); }
  const target = G.shield > 0 ? .22 + Math.sin(t * 3) * .05 : 0;
  h.bubble.material.opacity += (target - h.bubble.material.opacity) * Math.min(1, dt * 6);
  h.bubble.visible = h.bubble.material.opacity > .01;
  return true;
}

/* ---------------- Philippine creatures ----------------
   Each builder adds meshes to `b` (facing +z) and returns
   { arm, reach, hitY, update? }. `arm` swings on rotation.x.  */
function smokePuff(p) {
  const m = new THREE.Mesh(PUFF_GEO, new THREE.MeshBasicMaterial({ color: '#cfd8dc', transparent: true, opacity: .7, depthWrite: false }));
  m.position.copy(p); world.add(m); let life = 0;
  tickers.push(dt => {
    life += dt; m.position.y += dt * .7; m.position.x += dt * .15; m.scale.setScalar(1 + life * 2.2);
    m.material.opacity = Math.max(0, .7 - life / 2.2 * .7);
    if (life > 2.2) { world.remove(m); m.material.dispose(); return false; }
    return true;
  });
}
function buildTiyanak(sp, b) {
  const skin = mat(sp.bodyColor), diaper = mat(sp.accentColor || '#eceff1'), hair = mat(sp.extraColor || '#2b1d14');
  const dark = mat('#2b1d14'), white = mat('#ffffff');
  [-.16, .16].forEach(x => b.add(M(Sph(.14, 10, 8), skin, x, .12, .08)));
  const d = M(Sph(.36, 16, 12), diaper, 0, .38, 0); d.scale.set(1, .7, .95); b.add(d);
  b.add(M(Sph(.33, 16, 12), skin, 0, .66, 0));
  b.add(M(Sph(.44, 20, 16), skin, 0, 1.12, 0));
  [-1, 1].forEach(s => { const ear = M(Cone(.09, .24, 8), skin, s * .42, 1.2, 0); ear.rotation.z = -s * 1.1; b.add(ear); });
  const tuft = M(Cone(.08, .24, 8), hair, 0, 1.6, 0); tuft.rotation.z = .35; b.add(tuft);
  eyesOn(b, 1.17, .35, .16, .12, sp.eyeColor || '#ff5252');
  const mouth = M(Sph(.08, 10, 8), dark, 0, .98, .38); mouth.scale.set(1.4, .8, .5); b.add(mouth);
  fangs(b, 1.02, .42, .05, .07, white);
  const armL = limb(.3, .06, .06, skin, .07); armL.position.set(-.34, .82, 0); armL.rotation.z = .6; b.add(armL);
  const arm = limb(.3, .06, .06, skin, .07); arm.position.set(.34, .82, 0); arm.rotation.z = -.35; b.add(arm);
  const stick = M(Cyl(.02, .02, .3, 6), mat('#fcd116'), 0, -.32, .15); stick.rotation.x = Math.PI / 2; arm.add(stick);
  arm.add(M(Sph(.08, 10, 8), mat('#ec407a'), 0, -.32, .32));
  return { arm, reach: .42, hitY: 1.0 };
}
function buildTikbalang(sp, b) {
  const fur = mat(sp.bodyColor), mane = mat(sp.accentColor), snout = mat(sp.extraColor), hoof = mat('#1b1b1b'), white = mat('#ffffff');
  [-1, 1].forEach(s => {
    const leg = limb(1.0, .1, .08, fur); leg.position.set(s * .18, 1.05, 0); b.add(leg);
    b.add(M(Box(.16, .1, .22), hoof, s * .18, .05, .04));
  });
  b.add(M(Cyl(.3, .34, .26, 14), mat('#795548'), 0, 1.07, 0));
  b.add(M(Cyl(.26, .32, .75, 14), fur, 0, 1.55, 0));
  const armL = limb(.85, .08, .07, fur, .09); armL.position.set(-.4, 1.85, 0); armL.rotation.z = .15; b.add(armL);
  const arm = limb(.85, .08, .07, fur, .09); arm.position.set(.4, 1.85, 0); arm.rotation.z = -.1; b.add(arm);
  const bamboo = M(Cyl(.045, .045, 1.3, 8), mat('#9ccc65'), 0, -.85, .5); bamboo.rotation.x = Math.PI / 2; arm.add(bamboo);
  const neck = M(Cyl(.12, .16, .45, 10), fur, 0, 2.05, .06); neck.rotation.x = .35; b.add(neck);
  const head = new THREE.Group(); head.position.set(0, 2.3, .18); b.add(head);
  const skull = M(Sph(.24, 16, 12), fur, 0, 0, .1); skull.scale.set(.85, 1, 1.6); head.add(skull);
  const muzzle = M(Sph(.17, 14, 10), snout, 0, -.08, .45); muzzle.scale.set(1, .8, 1); head.add(muzzle);
  [-1, 1].forEach(s => { head.add(M(Sph(.03, 6, 6), mat('#1b1b1b'), s * .06, -.05, .6)); const ear = M(Cone(.06, .22, 8), fur, s * .12, .27, -.04); ear.rotation.z = -s * .2; head.add(ear); });
  eyesOn(head, .08, .22, .17, .07, sp.eyeColor);
  head.add(M(Box(.2, .05, .05), white, 0, -.19, .5));
  for (let i = 0; i < 6; i++) { const c = M(Cone(.07, .3, 6), mane, 0, 2.55 - i * .14, -.08 - i * .03); c.rotation.x = -.7; b.add(c); }
  return { arm, reach: .5, hitY: 2.0 };
}
function buildKapre(sp, b) {
  const fur = mat(sp.bodyColor), beard = mat(sp.accentColor), cigarM = mat(sp.extraColor);
  const ember = mat('#ff7043', { emissive: '#ff5722', emissiveIntensity: 1 });
  [-1, 1].forEach(s => { const leg = limb(1.0, .2, .18, fur); leg.position.set(s * .3, 1.02, 0); b.add(leg); b.add(M(Sph(.22, 12, 8), fur, s * .3, .12, .08)); });
  b.add(M(Cyl(.55, .62, .38, 16), mat('#795548'), 0, 1.06, 0));
  const torso = M(Sph(.75, 18, 14), fur, 0, 1.75, 0); torso.scale.set(1, 1.15, .85); b.add(torso);
  const chest = M(Sph(.45, 14, 10), beard, 0, 1.8, .42); chest.scale.set(1, 1.1, .4); b.add(chest);
  b.add(M(Sph(.45, 18, 14), fur, 0, 2.85, 0));
  const hair = M(Sph(.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), beard, 0, 2.9, -.02); hair.scale.set(1.1, 1, 1.1); b.add(hair);
  const bd = M(Cone(.4, .8, 14), beard, 0, 2.5, .2); bd.rotation.x = Math.PI; b.add(bd);
  eyesOn(b, 2.95, .38, .16, .1, sp.eyeColor);
  [-1, 1].forEach(s => { const br = M(Box(.22, .06, .06), beard, s * .16, 3.1, .4); br.rotation.z = s * .3; b.add(br); });
  const cigar = M(Cyl(.05, .05, .5, 8), cigarM, .14, 2.72, .6); cigar.rotation.x = Math.PI / 2; b.add(cigar);
  const tip = M(Sph(.065, 8, 6), ember, .14, 2.72, .86); b.add(tip);
  const armL = limb(1.1, .16, .13, fur, .17); armL.position.set(-.82, 2.2, 0); armL.rotation.z = .2; b.add(armL);
  const arm = limb(1.1, .16, .13, fur, .17); arm.position.set(.82, 2.2, 0); arm.rotation.z = -.15; b.add(arm);
  const branch = M(Cyl(.07, .11, 1.4, 8), mat('#5d4037'), 0, -1.1, .6); branch.rotation.x = Math.PI / 2; arm.add(branch);
  arm.add(M(Sph(.25, 10, 8), mat('#2e7d32'), 0, -1.1, 1.3));
  let acc = 0;
  const update = dt => { acc += dt; if (acc > .7) { acc = 0; smokePuff(tip.getWorldPosition(V(0, 0, 0))); } };
  return { arm, reach: .95, hitY: 2.3, update };
}
function buildAswang(sp, b) {
  const skin = mat(sp.bodyColor), dark = mat(sp.accentColor), tongue = mat(sp.extraColor), white = mat('#ffffff');
  const torso = M(Sph(.5, 18, 14), skin, 0, .95, 0); torso.scale.set(.85, .75, 1.5); b.add(torso);
  for (let i = 0; i < 6; i++) { const c = M(Cone(.07, .3, 6), dark, 0, 1.33, -.55 + i * .2); c.rotation.x = -.3; b.add(c); }
  const legs = [];
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
    const l = limb(.8, .09, .07, skin, .1); l.position.set(sx * .25, .88, sz * .45); b.add(l); legs.push(l);
  });
  const tail = M(Cone(.08, .6, 8), skin, 0, 1.1, -.85); tail.rotation.x = -2.2; b.add(tail);
  b.add(M(Sph(.3, 16, 12), skin, 0, 1.38, .8));
  const snout = M(Sph(.18, 14, 10), skin, 0, 1.3, 1.08); snout.scale.set(.9, .75, 1.4); b.add(snout);
  b.add(M(Sph(.05, 8, 6), mat('#1b1b1b'), 0, 1.34, 1.3));
  [-1, 1].forEach(s => { const ear = M(Cone(.08, .3, 8), skin, s * .17, 1.66, .72); ear.rotation.z = -s * .25; b.add(ear); });
  for (let i = 0; i < 4; i++) { const h = M(Cone(.05, .25, 6), dark, (i - 1.5) * .1, 1.68, .62); h.rotation.x = -.5; b.add(h); }
  eyesOn(b, 1.47, 1.0, .13, .08, sp.eyeColor);
  const tg = M(Box(.1, .02, .32), tongue, 0, 1.12, 1.22); tg.rotation.x = .7; b.add(tg);
  fangs(b, 1.2, 1.24, .07, .08, white);
  return { arm: legs[1], reach: .95, hitY: 1.3 };
}
function batWingGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, .3); s.lineTo(.5, .7); s.lineTo(1.4, .85);
  s.quadraticCurveTo(1.2, .3, 1.3, -.1); s.quadraticCurveTo(1.0, .1, .85, -.25);
  s.quadraticCurveTo(.6, 0, .45, -.35); s.quadraticCurveTo(.25, -.05, 0, -.2); s.lineTo(0, .3);
  return new THREE.ShapeGeometry(s, 12);
}
function buildManananggal(sp, b) {
  const skin = mat(sp.bodyColor), wingM = mat(sp.accentColor, { side: THREE.DoubleSide }), hair = mat(sp.extraColor), white = mat('#ffffff');
  const mist = new THREE.MeshStandardMaterial({ color: sp.accentColor, transparent: true, opacity: .45, emissive: sp.accentColor, emissiveIntensity: .3 });
  const tail = M(Cone(.34, 1.0, 16), mist, 0, 1.35, 0); tail.rotation.x = Math.PI; tail.castShadow = false; b.add(tail);
  b.add(M(Cyl(.22, .3, .55, 14), mat('#6a1b9a'), 0, 2.05, 0));
  b.add(M(Sph(.28, 16, 12), skin, 0, 2.55, 0));
  b.add(M(Sph(.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 2.6, -.01));
  b.add(M(Box(.52, .95, .12), hair, 0, 2.2, -.2));
  eyesOn(b, 2.58, .23, .1, .07, sp.eyeColor);
  fangs(b, 2.43, .27, .04, .06, white);
  const armL = limb(.55, .06, .05, skin, .06); armL.position.set(-.3, 2.25, 0); armL.rotation.z = .3; b.add(armL);
  const arm = limb(.55, .06, .05, skin, .06); arm.position.set(.3, 2.25, 0); arm.rotation.z = -.2; b.add(arm);
  for (let i = 0; i < 3; i++) { const n = M(Cone(.015, .12, 5), white, (i - 1) * .03, -.62, .04); n.rotation.x = Math.PI; arm.add(n); }
  const geo = batWingGeo(), wings = [];
  [-1, 1].forEach(s => {
    const w = new THREE.Group(); w.position.set(s * .18, 2.2, -.16); w.scale.x = s;
    const mesh = M(geo, wingM); mesh.scale.setScalar(1.1); w.add(mesh); b.add(w); wings.push({ w, s });
  });
  const update = (dt, t) => { const f = .3 + Math.sin(t * 6) * .45; wings.forEach(({ w, s }) => { w.rotation.y = s * f; }); };
  return { arm, reach: .45, hitY: 2.2, update };
}
function buildBampira(sp, b) {
  const skin = mat(sp.bodyColor), capeM = mat(sp.accentColor), lining = mat(sp.extraColor, { side: THREE.BackSide });
  const suit = mat('#212121'), white = mat('#ffffff'), hair = mat('#111111');
  [-1, 1].forEach(s => { const l = limb(.9, .09, .08, suit); l.position.set(s * .14, .95, 0); b.add(l); b.add(M(Box(.14, .08, .24), mat('#000'), s * .14, .04, .05)); });
  b.add(M(Cyl(.26, .3, .78, 14), suit, 0, 1.38, 0));
  b.add(M(Box(.16, .5, .05), white, 0, 1.45, .27));
  b.add(M(Box(.14, .06, .05), mat('#b71c1c'), 0, 1.7, .3));
  b.add(M(Cyl(.5, .78, 1.6, 20, 1, true, Math.PI / 2, Math.PI), capeM, 0, 1.2, 0));
  b.add(M(Cyl(.48, .76, 1.58, 20, 1, true, Math.PI / 2, Math.PI), lining, 0, 1.2, 0));
  [-1, 1].forEach(s => { const c = M(Box(.3, .45, .04), capeM, s * .22, 2.05, -.12); c.rotation.set(-.3, s * .5, s * -.25); b.add(c); });
  b.add(M(Sph(.27, 16, 12), skin, 0, 2.02, 0));
  b.add(M(Sph(.285, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), hair, 0, 2.06, -.02));
  const peak = M(Cone(.07, .14, 4), hair, 0, 2.2, .24); peak.rotation.x = Math.PI; b.add(peak);
  [-1, 1].forEach(s => { const e = M(Cone(.05, .18, 6), skin, s * .27, 2.05, 0); e.rotation.z = -s * 1.2; b.add(e); });
  eyesOn(b, 2.05, .22, .1, .07, sp.eyeColor);
  fangs(b, 1.9, .26, .045, .07, white);
  const armL = limb(.72, .07, .06, suit, .07); armL.position.set(-.34, 1.72, 0); armL.rotation.z = .5; b.add(armL);
  const arm = limb(.72, .07, .06, suit, .07); arm.position.set(.34, 1.72, 0); arm.rotation.z = -.25; b.add(arm);
  return { arm, reach: .6, hitY: 1.8 };
}
function buildEngkanto(sp, b) {
  const skin = mat(sp.bodyColor, { emissive: '#ffecb3', emissiveIntensity: .25 });
  const capeM = mat(sp.accentColor, { side: THREE.DoubleSide }), robe = mat(sp.extraColor);
  const gold = mat('#ffc107', { metalness: .6, roughness: .3, side: THREE.DoubleSide });
  const gem = mat(sp.eyeColor, { emissive: sp.eyeColor, emissiveIntensity: .9 });
  b.add(M(Cone(.62, 1.65, 22), robe, 0, .82, 0));
  b.add(M(Cyl(.25, .32, .5, 14), robe, 0, 1.78, 0));
  const belt = M(Torus(.3, .04, 6, 20), gold, 0, 1.58, 0); belt.rotation.x = Math.PI / 2; b.add(belt);
  b.add(M(Cyl(.42, .72, 1.9, 20, 1, true, Math.PI / 2, Math.PI), capeM, 0, 1.1, -.02));
  b.add(M(Sph(.27, 16, 12), skin, 0, 2.28, 0));
  b.add(M(Box(.46, .75, .1), mat('#eceff1'), 0, 2.05, -.2));
  b.add(M(Sph(.285, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), mat('#eceff1'), 0, 2.3, -.02));
  eyesOn(b, 2.3, .22, .1, .07, sp.eyeColor);
  b.add(M(Cyl(.24, .27, .22, 10, 1, true), gold, 0, 2.58, 0));
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; b.add(M(Cone(.05, .2, 6), gold, Math.sin(a) * .25, 2.78, Math.cos(a) * .25)); }
  b.add(M(Sph(.05, 8, 6), gem, 0, 2.6, .26));
  const armL = limb(.72, .07, .06, robe, .07); armL.position.set(-.33, 2.0, 0); armL.rotation.z = .25; b.add(armL);
  const arm = limb(.72, .07, .06, robe, .07); arm.position.set(.33, 2.0, 0); arm.rotation.z = -.2; b.add(arm);
  arm.add(M(Cyl(.035, .035, 2.0, 8), gold, 0, -.7, .1));
  const orb = M(Sph(.14, 14, 10), gem, 0, .36, .1); arm.add(orb);
  const light = new THREE.PointLight(sp.eyeColor, .8, 5); light.position.set(0, 2.2, .5); b.add(light);
  let acc = 0;
  const update = (dt, t) => {
    orb.scale.setScalar(1 + Math.sin(t * 4) * .15);
    acc += dt; if (acc > .9) { acc = 0; burst(orb.getWorldPosition(V(0, 0, 0)), [sp.eyeColor, '#ffffff', '#fcd116'], 4); }
  };
  return { arm, reach: .65, hitY: 1.9, update };
}
const CREATURES = { tiyanak: buildTiyanak, tikbalang: buildTikbalang, kapre: buildKapre, aswang: buildAswang,
  manananggal: buildManananggal, bampira: buildBampira, engkanto: buildEngkanto };
function buildCreature(sp, isBoss) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const r = (CREATURES[sp.model] || buildTiyanak)(sp, body);
  const scale = +sp.scale || 1; root.scale.setScalar(scale);
  return { root, body, arm: r.arm, armRest: r.arm.rotation.x, scale, reach: (r.reach || .45) * scale, hitY: (r.hitY || 1.1) * scale,
    update: r.update, boss: isBoss, alive: true, busy: false, ph: Math.random() * 6 };
}
function enemyTick(dt, t) {
  G.enemies.forEach(e => {
    if (e.update && e.alive) e.update(dt, t);
    if (!e.alive || e.busy) return;
    e.body.position.y = Math.abs(Math.sin(t * 3 + e.ph)) * .08;
    e.body.rotation.z = Math.sin(t * 2 + e.ph) * .05;
  });
  return true;
}

/* ---------------- gems & chest ---------------- */
const GEM_GEO = {};
function heartShape() {
  const s = new THREE.Shape(); s.moveTo(0, -.45);
  s.bezierCurveTo(-.15, -.3, -.5, -.1, -.5, .15); s.bezierCurveTo(-.5, .38, -.3, .48, -.2, .48);
  s.bezierCurveTo(-.08, .48, 0, .4, 0, .3); s.bezierCurveTo(0, .4, .08, .48, .2, .48);
  s.bezierCurveTo(.3, .48, .5, .38, .5, .15); s.bezierCurveTo(.5, -.1, .15, -.3, 0, -.45);
  return s;
}
function starShape() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? .22 : .52, a = Math.PI / 2 + i * Math.PI / 5; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? s.lineTo(x, y) : s.moveTo(x, y); }
  s.closePath(); return s;
}
function triShape() { const s = new THREE.Shape(); s.moveTo(0, .48); s.lineTo(-.5, -.4); s.lineTo(.5, -.4); s.closePath(); return s; }
function gemGeo(shape) {
  if (GEM_GEO[shape]) return GEM_GEO[shape];
  const ex = { depth: .2, bevelEnabled: true, bevelThickness: .08, bevelSize: .06, bevelSegments: 2, curveSegments: 18 };
  let g;
  switch (shape) {
    case 'heart': g = new THREE.ExtrudeGeometry(heartShape(), ex); break;
    case 'star': g = new THREE.ExtrudeGeometry(starShape(), ex); break;
    case 'triangle': g = new THREE.ExtrudeGeometry(triShape(), ex); break;
    case 'square': g = Box(.72, .72, .32); break;
    case 'circle': g = Cyl(.44, .44, .3, 32); g.rotateX(Math.PI / 2); break;
    case 'diamond': g = new THREE.OctahedronGeometry(.5); g.scale(.8, 1.1, .55); break;
    default: g = Sph(.4, 16, 12);
  }
  g.center();
  return (GEM_GEO[shape] = cached(g));
}
function makeGem(shape, hex) {
  const m = new THREE.Mesh(gemGeo(shape), new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: .25, metalness: .3, roughness: .25 }));
  m.castShadow = true; return m;
}
function spawnChest(x) {
  const g = new THREE.Group(), wood = mat('#8d5524'), gold = mat('#ffc107', { metalness: .6, roughness: .3 });
  g.add(M(Box(1, .6, .7), wood, 0, .3, 0)); g.add(M(Box(1.04, .1, .74), gold, 0, .55, 0));
  const lid = new THREE.Group(); lid.position.set(0, .6, -.35);
  lid.add(M(Box(1, .3, .7), wood, 0, .15, .35)); lid.add(M(Box(.18, .22, .06), gold, 0, .05, .72));
  g.add(lid); g.position.set(x, 0, 0); g.rotation.y = -.35; g.scale.setScalar(.01); world.add(g);
  tween(.45, k => g.scale.setScalar(.01 + k * .99), easeOutBack);
  return { g, lid };
}
async function openChest(c) { SFX.gem(); await tween(.5, k => { c.lid.rotation.x = -1.9 * k; }); burst(c.g.position.clone().add(V(0, .8, 0)), ['#ffe082', '#fff'], 24); }

/* ---------------- effects ---------------- */
function burst(pos, color, n = 16) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(PART_GEO, new THREE.MeshBasicMaterial({ color: Array.isArray(color) ? pick(color) : color, transparent: true }));
    m.position.copy(pos); world.add(m);
    const v = V(rand(-3, 3), rand(1.5, 5), rand(-2, 2)); let life = 0;
    tickers.push(dt => {
      life += dt; v.y -= 9 * dt; m.position.addScaledVector(v, dt); m.rotation.x += dt * 6;
      m.material.opacity = Math.max(0, 1 - life / .9);
      if (life > .9) { world.remove(m); m.material.dispose(); return false; }
      return true;
    });
  }
}
function flash(obj, color = '#ff1744') {
  const saved = [];
  obj.root.traverse(o => {
    if (o.material && o.material.emissive && !saved.some(s => s.m === o.material))
      saved.push({ m: o.material, e: o.material.emissive.clone(), i: o.material.emissiveIntensity });
  });
  saved.forEach(s => { s.m.emissive.set(color); s.m.emissiveIntensity = 1; });
  return tween(.4, k => saved.forEach(s => { s.m.emissive.copy(new THREE.Color(color)).lerp(s.e, k); }))
    .then(() => { saved.forEach(s => { s.m.emissive.copy(s.e); s.m.emissiveIntensity = s.i; }); updateAura(); });
}
function updateAura() {
  const h = G.hero; if (!h || !G.player) return;
  const lv = levelFor(G.player.power), n = +lv.level;
  h.ring.visible = n > 1; h.ring.material.color.set(lv.auraColor);
  h.light.color.set(lv.auraColor); h.light.intensity = (n - 1) * .7;
  h.bladeMat.emissive.set(n > 1 ? lv.auraColor : '#000000'); h.bladeMat.emissiveIntensity = (n - 1) * .35;
}
function heroSparkle(colors) { if (G.hero) burst(G.hero.root.position.clone().add(V(0, 1.2, 0)), colors, 26); }

/* ---------------- world (Philippine countryside) ---------------- */
function clearWorld() {
  while (world.children.length) {
    const c = world.children[world.children.length - 1]; world.remove(c);
    c.traverse(o => {
      if (o.geometry && !o.geometry.userData.cached) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
  G.enemies = []; G.restore = []; G.hero = null;
}
function tree(x, z, s, leaf, conifer) {
  const g = new THREE.Group();
  g.add(M(Cyl(.15, .2, 1.2, 8), mat('#6d4c41'), 0, .6, 0));
  if (conifer) { g.add(M(Cone(.9, 1.6, 10), mat(leaf), 0, 1.7, 0)); g.add(M(Cone(.7, 1.2, 10), mat(leaf), 0, 2.4, 0)); }
  else g.add(M(Sph(.85, 14, 10), mat(leaf), 0, 1.7, 0));
  g.position.set(x, 0, z); g.scale.setScalar(s); world.add(g);
}
function palm(x, z, s) {
  const g = new THREE.Group(), trunk = mat('#8d6e63'), leaf = mat('#43a047', { side: THREE.DoubleSide });
  const t = M(Cyl(.1, .16, 3, 8), trunk, 0, 1.5, 0); t.rotation.z = .12; g.add(t);
  for (let i = 0; i < 7; i++) {
    const f = M(Box(.28, .03, 1.4), leaf, 0, 3.0, 0);
    f.geometry.translate(0, 0, .7); f.rotation.set(.45, i / 7 * Math.PI * 2, 0); f.position.x = .2; g.add(f);
  }
  g.add(M(Sph(.12, 8, 6), mat('#6d4c41'), .22, 2.9, .1));
  g.position.set(x, 0, z); g.scale.setScalar(s); world.add(g);
}
function bahayKubo(x, z) {
  const g = new THREE.Group(), bamboo = mat('#d7b46a'), nipa = mat('#a1887f'), post = mat('#8d6e63');
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, c]) => g.add(M(Cyl(.07, .07, 1, 6), post, a * .9, .5, c * .8)));
  g.add(M(Box(2.1, .12, 1.9), post, 0, 1.0, 0));
  g.add(M(Box(2, 1.2, 1.8), bamboo, 0, 1.65, 0));
  const roof = M(Cone(1.8, 1.4, 4), nipa, 0, 2.95, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  g.add(M(Box(.5, .7, .05), mat('#5d4037'), 0, 1.5, .92));
  g.add(M(Box(.45, .4, .05), mat('#3e2723'), .6, 1.8, .92));
  g.position.set(x, 0, z); g.rotation.y = rand(-.3, .3); world.add(g);
}
function balete(x, z) {
  const g = new THREE.Group(), bark = mat('#5d4037'), leaf = mat('#1b5e20');
  g.add(M(Cyl(.9, 1.5, 5, 12), bark, 0, 2.5, 0));
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const r = M(Cyl(.05, .08, 4, 5), bark, Math.cos(a) * 1.4, 3.2, Math.sin(a) * 1.4); g.add(r); }
  [[0, 5.6, 0, 2.6], [-1.6, 5, .5, 1.8], [1.7, 5.1, -.3, 1.9], [0, 6.6, -.4, 1.8]].forEach(([a, b2, c, r]) => g.add(M(Sph(r, 14, 10), leaf, a, b2, c)));
  g.position.set(x, 0, z); world.add(g);
}
function topicProp(topic, i, x) {
  const g = new THREE.Group(); g.position.set(x, 0, rand(-5, -2.8));
  const cols = Object.values(PALETTE);
  switch (topic) {
    case 'color':
      g.add(M(Cyl(.04, .04, .9, 6), R(mat('#fff'), '#43a047'), 0, .45, 0));
      g.add(M(Sph(.26, 12, 10), R(mat('#fff'), pick(cols)), 0, 1, 0));
      if (i % 3 === 0) { const b = M(Sph(.4, 14, 12), R(mat('#fff'), pick(cols)), .5, 2.6, 0); b.scale.y = 1.2; g.add(b); g.add(M(Cyl(.01, .01, 1.6, 4), mat('#666'), .5, 1.6, 0)); }
      break;
    case 'number': g.add(M(Box(.9, .9, .9), R(mat('#fff', { map: textTex(String(i % 10 + 1)) }), pick(cols)), 0, .45, 0)); break;
    case 'shape': {
      const kinds = [() => Box(.9, .9, .9), () => Cone(.6, 1.1, 3), () => Sph(.5, 18, 14), () => Torus(.4, .16, 10, 22), () => Cyl(.45, .45, .9, 24)];
      g.add(M(pick(kinds)(), R(mat('#fff'), pick(cols)), 0, .6, 0)); break;
    }
    case 'letter': g.add(M(Box(.9, .9, .9), R(mat('#fff', { map: textTex(String.fromCharCode(65 + i % 26)) }), pick(cols)), 0, .45, 0)); break;
    case 'syllable': {
      const c = M(new THREE.OctahedronGeometry(.5), R(mat('#fff', { emissive: '#1a1033', roughness: .2 }), pick(['#ab47bc', '#26c6da', '#f06292', '#fcd116'])), 0, .8, 0);
      c.scale.set(.6, 1.6, .6); g.add(c);
      g.add(M(Box(.7, .5, .45), R(mat('#fff', { map: textTex(pick(['ba', 'ma', 'pa', 'la', 'na', 'ta'])) }), '#ffffff'), .7, .25, .2));
      break;
    }
    case 'sentence': g.add(M(Box(1.1, .9, .22), R(mat('#fff', { map: textTex(pick(['cat', 'sun', 'dog', 'hat', 'run', 'big', 'red', 'fish'])) }), pick(cols)), 0, .45, 0)); break;
  }
  world.add(g);
}
function buildWorld(s, restored) {
  clearWorld();
  scene3.background = new THREE.Color(s.skyColor);
  scene3.fog = new THREE.Fog(s.skyColor, 28, 75);
  const groundC = new THREE.Color(s.groundColor), topic = s.topic;
  const ground = M(new THREE.PlaneGeometry(200, 70), mat(s.groundColor), 30, 0, -10); ground.rotation.x = -Math.PI / 2; ground.castShadow = false; world.add(ground);
  const path = M(new THREE.PlaneGeometry(200, 2.4), mat('#' + groundC.clone().lerp(new THREE.Color('#fff3d6'), .55).getHexString()), 30, .01, 0);
  path.rotation.x = -Math.PI / 2; path.castShadow = false; world.add(path);
  if (topic === 'letter') { const w = M(new THREE.PlaneGeometry(200, 6), mat('#4fc3f7', { transparent: true, opacity: .85, roughness: .1 }), 30, .02, -9); w.rotation.x = -Math.PI / 2; world.add(w); }
  for (let x = -30; x < 110; x += rand(9, 14)) {
    const hill = topic === 'shape' || topic === 'syllable'
      ? M(Cone(rand(6, 10), rand(8, 14), 6), mat('#' + groundC.clone().multiplyScalar(.75).getHexString()), x, 4, rand(-45, -35))
      : M(Sph(rand(7, 11), 16, 10), mat('#' + groundC.clone().multiplyScalar(.85).getHexString()), x, -2, rand(-45, -35));
    hill.castShadow = false; world.add(hill);
  }
  const tropical = topic === 'color' || topic === 'letter' || topic === 'sentence';
  for (let x = -20; x < 100; x += rand(2.5, 4.5)) {
    const z = rand(-16, -6);
    if (topic === 'shape' || topic === 'syllable') rock(x, z, rand(.8, 2), topic === 'syllable' ? '#4a3b73' : '#90a4ae');
    else if (tropical && Math.random() < .4) palm(x, z, rand(.9, 1.3));
    else tree(x, z, rand(.8, 1.4), pick(['#43a047', '#66bb6a', '#2e7d32']), topic === 'number' || Math.random() < .2);
  }
  if (topic !== 'syllable') {
    bahayKubo(-5, -7);
    if (topic !== 'shape') bahayKubo(33, -10);
    for (let x = -20; x < 100; x += rand(10, 16)) {
      const c = new THREE.Group(), wm = mat('#ffffff');
      for (let i = 0; i < 4; i++) c.add(M(Sph(rand(.8, 1.4), 12, 8), wm, i * 1.1, rand(-.2, .3), rand(-.3, .3)));
      c.position.set(x, rand(9, 13), rand(-30, -20)); world.add(c);
    }
  }
  if (topic === 'number') balete(48, -6);
  let i = 0; for (let x = -6; x < 70; x += rand(2.8, 4)) topicProp(topic, i++, x);
  if (topic === 'sentence') {
    const stone = mat('#e0d6c8'), roof = R(mat('#fff'), '#2e7d32');
    world.add(M(Box(8, 4, 3), stone, 60, 2, -10));
    [-4, 4].forEach(dx => { world.add(M(Cyl(1.2, 1.2, 6, 16), stone, 60 + dx, 3, -10)); world.add(M(Cone(1.5, 2.2, 16), roof, 60 + dx, 7.1, -10)); });
  }
  if (restored) G.restore.forEach(r => r.m.color.copy(r.c));
  placeHero();
}
function rock(x, z, s, hex) { const r = M(new THREE.DodecahedronGeometry(.6), mat(hex), x, .3 * s, z); r.scale.setScalar(s); r.rotation.set(rand(0, 3), rand(0, 3), 0); world.add(r); }
function placeHero(type) {
  const t = type || (G.player && G.player.heroType) || G.previewType || 'boy';
  const x = G.hero ? G.hero.root.position.x : 0;
  if (G.hero) world.remove(G.hero.root);
  G.hero = buildHero(heroSpriteFor(t), t);
  G.hero.root.position.x = x; G.hero.root.rotation.y = .9;
  world.add(G.hero.root);
  updateAura();
}

/* ---------------- data helpers ---------------- */
const byId = (list, key, id) => (list || []).find(r => r[key] === id);
function sprite(id) { return byId(G.data.sprites, 'spriteId', id) || { model: 'tiyanak', bodyColor: '#9ccc65', accentColor: '#fff', eyeColor: '#ff5252', scale: '1' }; }
function sortedScenes() { return G.data.scenes.slice().sort((a, b) => a.order - b.order); }
function levelFor(power) { let lv = G.data.levels[0]; G.data.levels.forEach(l => { if (power >= +l.minPower) lv = l; }); return lv; }
const maxHearts = () => +G.cfg.maxHearts || 5;
const maxMagic = () => +G.cfg.maxMagic || 10;
function sortedBooks() { return G.data.grimoires.slice().sort((a, b) => a.order - b.order); }
function mySpells() {
  const out = {};
  G.player.grimoires.forEach(id => {
    const b = byId(G.data.grimoires, 'grimoireId', id); if (!b || !b.spellId) return;
    const s = byId(G.data.spells, 'spellId', b.spellId); if (!s) return;
    if (!out[s.spellId]) out[s.spellId] = Object.assign({}, s, { cost: +s.cost, owned: false, enriched: 0 });
    if (b.spellAction === 'enrich') out[s.spellId].enriched++; else out[s.spellId].owned = true;
  });
  return Object.values(out).filter(s => s.owned)
    .map(s => Object.assign(s, { cost: Math.max(1, s.cost - s.enriched) }))
    .sort((a, b) => a.order - b.order);
}

/* ---------------- UI helpers ---------------- */
function overlay(html, cls) { const o = $('overlay'); o.className = cls || ''; o.innerHTML = html; }
function closeOverlay() { $('overlay').className = 'hidden'; }
let toastT = 0;
function toast(html, ms = 2400) { const t = $('toast'); t.innerHTML = html; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function banner(html) { const b = $('banner'); b.innerHTML = `<div class="inner">${html}</div>`; b.classList.remove('hidden'); }
function hideBanner() { $('banner').classList.add('hidden'); }
function hidePanel() { $('panel').className = ''; G.panelUp = false; G.spellCtx = null; }
function updateHUD() {
  const p = G.player; if (!p) return;
  const lv = levelFor(p.power), total = G.data.gems.length;
  $('hud').classList.remove('hidden');
  $('hHearts').textContent = Array.from({ length: maxHearts() }, (_, i) => i < p.hearts ? '❤️' : '🤍').join('');
  $('hMagic').style.width = Math.min(100, p.magic / maxMagic() * 100) + '%';
  $('hMagicN').textContent = p.magic;
  $('hLevel').innerHTML = `⭐ Lv ${lv.level} <small>${esc(lv.title)}</small>`;
  $('hPower').style.width = Math.min(100, p.power / total * 100) + '%';
  $('hGems').textContent = `💎 ${p.gems.length}/${total}`;
  $('hStrike').innerHTML = `⚔️ ${lv.strikesToDefeat} <small>${+lv.strikesToDefeat === 1 ? 'strike wins' : 'strikes per tiyanak'}</small>`;
  if (G.account) { $('hTokN').textContent = G.account.tokens; $('hTokens').classList.remove('hidden'); }
  const buffs = (G.shield > 0 ? '🛡️' : '') + (G.double ? '⚔️×2' : '');
  $('hBuff').textContent = buffs; $('hBuff').classList.toggle('hidden', !buffs);
  updateAura();
}
function showEnemyBar(name, need, left, isBoss) {
  const e = $('enemy'); e.classList.remove('hidden');
  e.innerHTML = `<div class="ename">${isBoss ? '👑' : '👶'} ${esc(name)}</div>
    <div class="pips">${Array.from({ length: need }, (_, i) => `<span class="${i < left ? '' : 'off'}"></span>`).join('')}</div>
    <div class="ehint">${left > 0 ? `${left} more ${left === 1 ? 'strike' : 'strikes'}! Answer right to strike.` : 'Defeated!'}</div>`;
}
function hideEnemyBar() { $('enemy').classList.add('hidden'); }
function starPts() { const p = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 19 : 46, a = -Math.PI / 2 + i * Math.PI / 5; p.push((50 + Math.cos(a) * r).toFixed(1) + ',' + (54 + Math.sin(a) * r).toFixed(1)); } return p.join(' '); }
function shapeSVG(shape, color, size = 64) {
  const inner = {
    circle: '<circle cx="50" cy="50" r="40"/>', square: '<rect x="13" y="13" width="74" height="74" rx="6"/>',
    rectangle: '<rect x="4" y="27" width="92" height="46" rx="6"/>', triangle: '<polygon points="50,9 92,88 8,88"/>',
    oval: '<ellipse cx="50" cy="50" rx="45" ry="28"/>', diamond: '<polygon points="50,5 86,50 50,95 14,50"/>',
    star: `<polygon points="${starPts()}"/>`,
    heart: '<path d="M50 88 C20 66 4 46 16 28 C28 10 46 16 50 32 C54 16 72 10 84 28 C96 46 80 66 50 88Z"/>'
  }[shape] || '<circle cx="50" cy="50" r="40"/>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><g fill="${color}" stroke="#2e1f5e" stroke-width="5" stroke-linejoin="round">${inner}</g></svg>`;
}
function optionHTML(kind, v) {
  switch (kind) {
    case 'color': return `<span class="swatch" style="background:${COLORS[v] || v}"></span>`;
    case 'shape': return shapeSVG(v, '#7e57c2', 72);
    case 'emoji': return `<span class="emo">${v}</span>`;
    case 'count': return `<span class="num">${v}</span><span class="dots">${'●'.repeat(+v)}</span>`;
    default: return `<span class="txt">${esc(v)}</span>`;
  }
}
function wordsHTML(text) { return String(text).split(/\s+/).filter(Boolean).map(w => `<span class="word">${esc(w)}</span>`).join(' '); }
function visualHTML(ch) {
  if (ch.type === 'sentence') return `<div class="sentence">${wordsHTML(ch.visual)}</div>`;
  return ch.visual ? `<div class="vis">${ch.visual}</div>` : '';
}

/* ---------------- question panel + spells ---------------- */
function renderPanel({ prompt, speak, visual, options, readAlongBtn, onPick, spellCtx }) {
  const p = $('panel');
  p.innerHTML = `<div class="qtop"><button class="toy spk ${readAlongBtn ? 'wide' : ''}" id="spk" aria-label="Hear it again">${readAlongBtn ? '🔊 Read with me' : '🔊'}</button>
      <div class="qprompt">${prompt}</div></div>${visual || ''}
    <div class="opts">${options.map((o, i) => `<button class="toy opt" data-i="${i}" data-v="${esc(o.value)}" aria-label="${esc(o.label)}">${o.html}</button>`).join('')}</div>
    ${spellCtx ? '<div class="spells" id="spellbar"></div>' : ''}`;
  p.className = 'show'; G.panelUp = true; G.spellCtx = spellCtx || null;
  $('spk').onclick = () => readAlongBtn ? readAlong('#panel .word') : say(speak);
  p.querySelectorAll('.opt').forEach(b => b.onclick = () => { if (!b.disabled) onPick(options[+b.dataset.i].value, b); });
  if (spellCtx) drawSpellBar(spellCtx);
  say(speak);
}
function drawSpellBar(ctx) {
  const bar = $('spellbar'); if (!bar || !ctx) return;
  const sp = mySpells();
  if (!sp.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = '<span class="spl">🔮 Spells</span>' + sp.map(s => {
    const active = (s.effect === 'shield' && G.shield > 0) || (s.effect === 'double' && G.double);
    const off = active || G.player.magic < s.cost || ctx.isDone();
    return `<button class="toy spell ${active ? 'active' : ''}" data-s="${esc(s.spellId)}" ${off ? 'disabled' : ''} title="${esc(s.description)}" aria-label="${esc(s.name)}: ${esc(s.description)}">
      <span class="si">${s.icon}</span><span class="sn">${esc(s.name)}</span><span class="sc">🔮${s.cost}</span></button>`;
  }).join('');
  bar.querySelectorAll('.spell').forEach(b => b.onclick = () => castSpell(sp.find(x => x.spellId === b.dataset.s), ctx));
}
async function readOptions(ctx) {
  if (ctx.ch && ctx.ch.type === 'sentence') { await readAlong('#panel .word'); return; }
  const token = ++G.readToken;
  for (const b of document.querySelectorAll('#panel .opt:not(.gone)')) {
    if (token !== G.readToken) return;
    b.classList.add('hl'); await say(b.dataset.v); b.classList.remove('hl'); await wait(120);
  }
}
async function castSpell(sp, ctx) {
  if (!sp || ctx.isDone()) return;
  const p = G.player;
  if (p.magic < sp.cost) { say('Not enough magic. Find gems or read a Grimoire!'); return; }
  if (sp.effect === 'hint') {
    const wrong = [...document.querySelectorAll('#panel .opt')].filter(b => !b.disabled && b.dataset.v !== ctx.answer);
    if (!wrong.length) { say('Only the right answer is left!'); return; }
    const b = pick(wrong); b.classList.add('gone'); b.disabled = true;
  }
  if (sp.effect === 'shield') G.shield = 1;
  if (sp.effect === 'double') G.double = true;
  p.magic -= sp.cost;
  SFX.magic(); heroSparkle(['#b388ff', '#80d8ff', '#ffffff']);
  toast(`${sp.icon} ${esc(sp.name)}!`); updateHUD(); drawSpellBar(ctx); save();
  if (sp.effect === 'bubble') { await readOptions(ctx); return; }
  if (sp.effect === 'rainbow') { await say('Rainbow Burst!'); ctx.finish({ strikes: ctx.boss ? 3 : 99 }); return; }
  say(sp.name + '!');
}
function askQuestion(ch, opts = {}) {
  return new Promise(resolve => {
    const kind = ch.optionsKind, answer = String(ch.answer).trim();
    const vals = shuffle(String(ch.options).split('|').map(s => s.trim()).filter(Boolean));
    let done = false, busy = false;
    const lockAll = () => document.querySelectorAll('#panel .opt').forEach(b => { b.disabled = true; });
    const ctx = { ch, kind, answer, boss: !!opts.boss, isDone: () => done,
      finish: r => { if (done) return; done = true; lockAll(); resolve(r); } };
    renderPanel({
      prompt: esc(ch.prompt), speak: ch.speak || ch.prompt, visual: visualHTML(ch), readAlongBtn: ch.type === 'sentence',
      spellCtx: opts.spells ? ctx : null,
      options: vals.map(v => ({ value: v, label: v, html: optionHTML(kind, v) })),
      onPick: async (v, b) => {
        if (done || busy) return;
        if (v === answer) {
          done = true; b.classList.add('right'); lockAll(); SFX.good(); say(pick(PRAISE));
          await wait(750);
          const strikes = G.double ? 2 : 1;
          if (G.double) { G.double = false; updateHUD(); }
          resolve({ strikes });
          return;
        }
        b.classList.add('wrong'); b.disabled = true; SFX.bad();
        const named = ['color', 'shape', 'text'].includes(kind) ? `That is ${v}. ` : '';
        if (opts.onWrong) {
          busy = true; $('panel').classList.add('busy');
          await opts.onWrong();
          $('panel').classList.remove('busy'); busy = false;
          drawSpellBar(G.spellCtx);
        }
        say(named + 'Try again!');
      }
    });
  });
}
function nextChallenge(isBoss) {
  const s = G.sceneDef;
  let sceneId = s.sceneId;
  if (isBoss && +s.order > 1 && Math.random() < .35) sceneId = sortedScenes()[+s.order - 2].sceneId;
  const pool = G.data.challenges.filter(c => c.sceneId === sceneId);
  let avail = pool.filter(c => !G.recent.has(c.challengeId));
  if (!avail.length) { pool.forEach(c => G.recent.delete(c.challengeId)); avail = pool; }
  const c = pick(avail); G.recent.add(c.challengeId); return c;
}

/* ---------------- movement & combat ---------------- */
async function walkTo(x) {
  const r = G.hero.root, x0 = r.position.x, d = Math.abs(x - x0);
  if (d < .05) return;
  G.camMode = 'follow'; G.walking = true;
  await tween(d / 3.6, k => { r.position.x = x0 + (x - x0) * k; }, lin);
  G.walking = false;
}
function spawnEnemy(sp, x, isBoss) {
  const e = buildCreature(sp, isBoss);
  e.root.position.set(x, 0, 0); e.root.rotation.y = -.9;
  world.add(e.root); G.enemies.push(e);
  return e;
}
async function enemyTaunt(e) {
  if (!e || !e.alive || e.busy) return;
  e.busy = true; SFX.laugh();
  await tween(.55, k => { e.body.position.y = Math.sin(Math.PI * k) * .6; e.body.rotation.z = Math.sin(k * Math.PI * 4) * .25; });
  e.body.rotation.z = 0; e.busy = false;
}
function knock(e) {
  e.busy = true;
  tween(.35, k => { const s = Math.sin(Math.PI * k); e.body.rotation.x = -s * .35; e.body.scale.set(1 + s * .15, 1 - s * .15, 1); })
    .then(() => { e.body.scale.set(1, 1, 1); e.body.rotation.x = 0; e.busy = false; });
}
async function heroAttack(e) {
  const h = G.hero, r = h.root, x0 = r.position.x, tx = e.root.position.x - (.7 + e.reach);
  G.attacking = true; G.walking = true;
  await tween(.24, k => { r.position.x = x0 + (tx - x0) * k; h.armR.rotation.x = -2.8 * k; });
  G.walking = false;
  await tween(.1, k => { h.armR.rotation.x = -2.8 + 1.9 * k; });
  SFX.hit(); flash(e); knock(e);
  const lv = levelFor(G.player.power);
  burst(e.root.position.clone().add(V(-.3 * e.scale, e.hitY, .3)), [lv.auraColor === '#ffffff' ? '#fcd116' : lv.auraColor, '#ffffff', '#ff6b6b'], 18);
  await wait(140);
  await tween(.32, k => { r.position.x = tx + (x0 - tx) * k; h.armR.rotation.x = -.9 * (1 - k); });
  G.attacking = false;
}
/** The creature hits back after a wrong answer. Shield blocks; otherwise the hero loses a heart. */
async function enemyStrike(e) {
  if (!e || !e.alive) return;
  while (e.busy) await wait(50);
  e.busy = true; SFX.laugh();
  const x0 = e.root.position.x, hx = G.hero.root.position.x, tx = hx + .75 + e.reach;
  await tween(.28, k => { e.root.position.x = x0 + (tx - x0) * k; e.arm.rotation.x = e.armRest - 1.6 * Math.sin(Math.PI * k); });
  let hurt = false;
  if (G.shield > 0) { G.shield--; SFX.magic(); heroSparkle(['#80d8ff', '#ffffff']); toast('🛡️ Blocked by the Rainbow Shield!'); }
  else { hurt = true; heroHurt(); }
  await tween(.35, k => { e.root.position.x = tx + (x0 - tx) * k; });
  e.arm.rotation.x = e.armRest; e.busy = false;
  updateHUD();
  if (hurt) {
    await say(G.player.hearts > 0 ? pick(['Aray!', `Ouch! Be careful, ${heroName()}!`]) : 'Oh no!');
    if (G.player.hearts <= 0) await knockout();
  } else await say('Blocked!');
}
function heroHurt() {
  const p = G.player; p.hearts = Math.max(0, p.hearts - 1);
  SFX.hurt(); flash(G.hero);
  const r = G.hero.root, x0 = r.position.x;
  tween(.3, k => { r.position.x = x0 - Math.sin(Math.PI * k) * .5; });
  toast(`💔 ${esc(heroName())} lost a heart`);
  const hh = $('hHearts'); hh.classList.remove('shake'); void hh.offsetWidth; hh.classList.add('shake');
  updateHUD(); save();
}
/** Out of hearts: the hero rests until a Grimoire is read, listened to, or watched. */
async function knockout() {
  const wasUp = G.panelUp, keepCtx = G.spellCtx;
  if (wasUp) { $('panel').className = ''; G.panelUp = false; }
  hush();
  const b = G.hero.body;
  await tween(.6, k => { b.rotation.x = -1.35 * k; });
  await say(`Oh no! ${heroName()} has no more hearts. Read a Grimoire to feel strong again!`);
  const r = await openGrimoireLibrary({ mustRead: true });
  if (r === 'exit') {                       // rest for now: back to the map, the checkpoint keeps the place
    b.rotation.x = 0; hidePanel(); hideEnemyBar(); showMap();
    return new Promise(() => {});           // this scene run ends here
  }
  await tween(.5, k => { b.rotation.x = -1.35 * (1 - k); });
  if (wasUp) { $('panel').className = 'show'; G.panelUp = true; G.spellCtx = keepCtx; drawSpellBar(keepCtx); }
}
async function defeatEnemy(e) {
  e.alive = false; e.busy = true; SFX.poof();
  const s = e.scale, p = e.root.position.clone().add(V(0, e.hitY, 0));
  await tween(.7, k => { e.root.rotation.y = -.9 + k * Math.PI * 4; e.root.scale.setScalar(s * (1 - k) + .001); e.root.position.y = Math.sin(Math.PI * k) * 1.2; });
  burst(p, Object.values(PALETTE), 34);
  world.remove(e.root); G.enemies = G.enemies.filter(x => x !== e);
}
async function battle(def, enemy, isBoss) {
  const lv = levelFor(G.player.power);
  const need = +lv.strikesToDefeat + (isBoss ? +(def.bonusStrikes || G.cfg.bossBonusStrikes || 2) : 0);
  let left = need;
  G.camMode = 'battle'; G.camTarget = enemy.root.position.x;
  showEnemyBar(def.name, need, left, isBoss);
  enemyTaunt(enemy);
  await say(def.taunt);
  if (!G.tutorial) { G.tutorial = true; await say('Answer right to strike! If you miss, the creature strikes back. Watch your hearts!'); }
  while (left > 0) {
    const ch = nextChallenge(isBoss);
    const r = await askQuestion(ch, { spells: true, boss: isBoss, onWrong: () => enemyStrike(enemy) });
    hidePanel();
    const hits = Math.min(left, r.strikes || 1);
    for (let i = 0; i < hits; i++) { await heroAttack(enemy); left--; showEnemyBar(def.name, need, left, isBoss); }
    await wait(250);
  }
  await defeatEnemy(enemy);
  hideEnemyBar();
  toast(`🎉 ${esc(def.name)} is defeated!`);
  await say(def.defeatLine);
}

/* ---------------- gem challenges ---------------- */
function spawnGemCluster(items, cx) {
  const grp = new THREE.Group(), n = items.length;
  const cols = Math.min(camera.aspect < .8 ? 3 : 5, n), rows = Math.ceil(n / cols), sp = .95;
  const meshes = items.map((it, i) => {
    const m = makeGem(it.shape, it.hex), r = Math.floor(i / cols), c = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    m.position.set((c - (inRow - 1) / 2) * sp, ((rows - 1) / 2 - r) * sp, 0);
    m.userData = { item: it, baseY: m.position.y, ph: Math.random() * 6 };
    m.scale.setScalar(.001); grp.add(m);
    setTimeout(() => tween(.35, k => m.scale.setScalar(.001 + k * .7), easeOutBack), i * 80);
    return m;
  });
  grp.position.set(cx, 2.4, 1.6); world.add(grp);
  const cl = { grp, meshes, alive: true };
  tickers.push((dt, t) => {
    if (!cl.alive) return false;
    meshes.forEach(m => { m.rotation.y = Math.sin(t * 1.5 + m.userData.ph) * .45; m.position.y = m.userData.baseY + Math.sin(t * 2 + m.userData.ph) * .06; });
    return true;
  });
  return cl;
}
async function countTogether(cl, isT) {
  const ms = cl.meshes.filter(m => isT(m.userData.item));
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i]; tween(.4, k => m.scale.setScalar(.7 + Math.sin(Math.PI * k) * .4));
    await say(String(i + 1), { rate: .9 }); await wait(150);
  }
}
async function gemChallenge(gem, x) {
  const chest = spawnChest(x);
  await walkTo(x - 2.2); await wait(200); await openChest(chest);
  const order = +G.sceneDef.order, askColor = String(gem.askColor).toUpperCase() === 'TRUE';
  const T = { shape: gem.shape, hex: gem.hex, color: gem.colorName };
  const count = randi(1, Math.min(2 + order, 6));
  const items = Array.from({ length: count }, () => T);
  const others = GEM_SHAPES.filter(s => s !== T.shape), otherColors = Object.keys(PALETTE).filter(c => c !== T.color);
  const nd = randi(2, Math.min(2 + order, 5));
  for (let i = 0; i < nd; i++) {
    if (askColor && i % 2 === 0) { const c = pick(otherColors); items.push({ shape: T.shape, hex: PALETTE[c], color: c }); }
    else { const c = pick(Object.keys(PALETTE)); items.push({ shape: pick(others), hex: PALETTE[c], color: c }); }
  }
  const cx = x - 1.1, cl = spawnGemCluster(shuffle(items), cx);
  const isT = it => it.shape === T.shape && (!askColor || it.color === T.color);
  G.camMode = 'gem'; G.camTarget = cx;
  const label = (askColor ? T.color + ' ' : '') + T.shape;
  const set = new Set([count]);
  while (set.size < 4) { const v = count + randi(-2, 3); if (v >= 1 && v <= 9) set.add(v); }
  const opts = shuffle([...set]).map(String);
  let wrong = 0, done = false;
  await new Promise(resolve => renderPanel({
    prompt: `${shapeSVG(T.shape, askColor ? T.hex : '#7e57c2', 50)} How many ${esc(label.toUpperCase())} gems?`,
    speak: `How many ${label} gems? Count them!`,
    options: opts.map(v => ({ value: v, label: v, html: optionHTML('count', v) })),
    onPick: (v, b) => {
      if (done) return;
      if (v === String(count)) {
        done = true; b.classList.add('right'); document.querySelectorAll('#panel .opt').forEach(x => { x.disabled = true; });
        SFX.good(); say(`Yes! ${count}! Great counting!`); setTimeout(resolve, 900); return;
      }
      b.classList.add('wrong'); b.disabled = true; SFX.bad(); wrong++;
      if (wrong >= 2) say("Let's count together!").then(() => countTogether(cl, isT)); else say('Count again!');
    }
  }));
  hidePanel();
  await collectGem(cl, isT, gem);
  cl.alive = false; world.remove(cl.grp);
  tween(.3, k => chest.g.scale.setScalar(1 - k + .001)).then(() => world.remove(chest.g));
}
function gainMagic(n) { const p = G.player; p.magic = Math.min(maxMagic(), p.magic + n); updateHUD(); }
async function collectGem(cl, isT, gem) {
  const tg = cl.meshes.filter(m => isT(m.userData.item)), rest = cl.meshes.filter(m => !isT(m.userData.item));
  rest.forEach(m => tween(.3, k => m.scale.setScalar(.7 * (1 - k) + .001)));
  await wait(320);
  const hp = G.hero.root.position, end = V(hp.x, 1.2, hp.z);
  await Promise.all(tg.map((m, i) => {
    const start = m.getWorldPosition(V(0, 0, 0));
    cl.grp.remove(m); world.add(m); m.position.copy(start);
    return wait(i * 130).then(() => tween(.55, k => { m.position.lerpVectors(start, end, k); m.position.y += Math.sin(Math.PI * k) * 1.2; m.scale.setScalar(.7 * (1 - k * .8)); }))
      .then(() => { world.remove(m); m.material.dispose(); SFX.gem(); burst(end, [gem.hex, '#fff59d', '#ffffff'], 10); });
  }));
  const p = G.player, before = +levelFor(p.power).level;
  gainMagic(+G.cfg.magicPerGem || 1);
  if (!p.gems.includes(gem.gemId)) {
    p.gems.push(gem.gemId); p.power += (+gem.power || 1);
    burst(end, [gem.hex, '#ffffff'], 30);
    tween(.6, k => G.hero.root.scale.setScalar(1 + Math.sin(Math.PI * k) * .2));
    updateHUD();
    toast(`${shapeSVG(gem.shape, gem.hex, 28)} ${esc(gem.name)}! ⚡+${gem.power || 1} 🔮+${G.cfg.magicPerGem || 1}`, 3000);
    await say(`You got the ${gem.name}! ${heroName()} powers up!`);
  } else {
    p.stars++; toast('⭐ Bonus star! 🔮+1');
    await say('You already have this gem. Here is a bonus star!');
  }
  const lv = levelFor(p.power);
  if (+lv.level > before) await levelUpFx(lv);
  save();
}
async function levelUpFx(lv) {
  SFX.level();
  const h = G.hero, n = +lv.strikesToDefeat;
  burst(h.root.position.clone().add(V(0, 1, 0)), [lv.auraColor, '#ffffff', '#fcd116'], 44);
  tween(.9, k => h.root.scale.setScalar(1 + Math.sin(Math.PI * k) * .35));
  updateHUD();
  banner(`<div class="lvup">Level up!</div><div>Level ${lv.level}: ${esc(lv.title)}</div>
    <div class="sub">Tiyanak now fall in ${n} ${n === 1 ? 'strike' : 'strikes'} ⚔️</div>`);
  await say(`Level up! ${heroName()} is now a ${lv.title}! Tiyanak fall in ${n} ${n === 1 ? 'strike' : 'strikes'}!`);
  await wait(500); hideBanner();
}
async function restoreColors() {
  const items = G.restore.map(r => ({ m: r.m, from: r.m.color.clone(), to: r.c }));
  SFX.level(); say('Everything is shining again!');
  await tween(1.6, k => items.forEach(it => it.m.color.copy(it.from).lerp(it.to, k)));
  const hx = G.hero.root.position.x;
  for (let i = 0; i < 8; i++) burst(V(hx + rand(-4, 6), rand(1, 3), rand(-4, 0)), Object.values(PALETTE), 10);
  await wait(700);
}

/* ---------------- saving (per gadget) ---------------- */
let saveT = 0;
function save(now) { clearTimeout(saveT); saveT = setTimeout(doSave, now ? 0 : 700); }
function savePayload(p) {
  return {
    name: p.name, heroType: p.heroType, level: p.level, power: p.power, gems: p.gems.join(','),
    unlocked: p.unlocked, stars: p.stars, hearts: p.hearts, magic: p.magic, grimoires: p.grimoires.join(','),
    grimoireUsed: JSON.stringify(p.grimoireUsed || {}), checkpoint: p.checkpoint ? JSON.stringify(p.checkpoint) : '',
    finished: !!p.finished
  };
}
/** Remembers the account + hero on this device so the game can open offline. */
function rememberBundle() {
  if (!G.session || !G.account) return;
  store.set('maalam_bundle', JSON.stringify({ session: G.session, account: G.account, player: G.player, payments: [], savedAt: Date.now() }));
}
function doSave() {
  const p = G.player; if (!p || !G.session) return;
  p.level = +levelFor(p.power).level;
  rememberBundle();
  const payload = savePayload(p);
  store.set('maalam_outbox', JSON.stringify(payload));          // cleared once the server has it
  callAuthed('saveProgress', payload)
    .then(() => { if (store.get('maalam_outbox') === JSON.stringify(payload)) store.del('maalam_outbox'); })
    .catch(e => { if (!isOfflineError(e)) console.warn('Save failed:', e); });
}
/** Sends progress that was saved while offline. */
async function flushOutbox() {
  const raw = store.get('maalam_outbox');
  if (!raw || !G.session) return;
  try { await server('saveProgress', G.session, JSON.parse(raw)); if (store.get('maalam_outbox') === raw) store.del('maalam_outbox'); toast('☁️ Progress synced'); }
  catch (e) { /* still offline */ }
}
function starterBooks() { return G.data.grimoires.filter(b => b.unlockBy === 'start').map(b => b.grimoireId); }
function newPlayer(name, heroType) {
  return { name, heroType: heroType === 'girl' ? 'girl' : 'boy', level: 1, power: 0, gems: [], unlocked: 1, stars: 0,
    hearts: maxHearts(), magic: 0, grimoires: starterBooks(), grimoireUsed: {}, checkpoint: null, finished: false };
}
function normalizePlayer(p) {
  const n = newPlayer(p.name || 'Maalam', p.heroType);
  Object.keys(n).forEach(k => { if (p[k] === undefined || p[k] === null || (typeof n[k] === 'number' && isNaN(+p[k]))) p[k] = n[k]; });
  ['level', 'power', 'unlocked', 'stars', 'hearts', 'magic'].forEach(k => { p[k] = +p[k]; });
  p.heroType = p.heroType === 'girl' ? 'girl' : 'boy';
  p.hearts = Math.max(0, Math.min(maxHearts(), p.hearts));
  p.magic = Math.max(0, Math.min(maxMagic(), p.magic));
  starterBooks().forEach(id => { if (!p.grimoires.includes(id)) p.grimoires.push(id); });
  if (!p.grimoireUsed || typeof p.grimoireUsed !== 'object') p.grimoireUsed = {};
  const last = sortedScenes()[sortedScenes().length - 1];
  const finalBook = last && G.data.grimoires.find(g => g.unlockBy === last.sceneId);
  p.finished = !!p.finished || !!(finalBook && p.grimoires.includes(finalBook.grimoireId));
  return p;
}

/* ---------------- flip charts ---------------- */
function fcFront(c) {
  switch (c.kind) {
    case 'letter': return `<div class="fbig">${esc(c.front)}<span class="flow">${esc(c.frontSub)}</span></div>`;
    case 'color': return `<div class="blob" style="background:${esc(c.color)}"></div><div class="fsub">${esc(cap(c.front))}</div>`;
    case 'shape': return `${shapeSVG(c.front, c.color || '#7e57c2', 150)}<div class="fsub">${esc(cap(c.front))}</div>`;
    default: return `<div class="fbig">${esc(c.front)}</div>${c.frontSub ? `<div class="fsub">${esc(c.frontSub)}</div>` : ''}`;
  }
}
function fcBack(c) {
  const n = c.kind === 'number' ? (+c.front || 1) : 1;
  let word = esc(c.sample);
  if (['letter', 'syllable', 'color'].includes(c.kind)) {
    const i = c.sample.toLowerCase().indexOf(c.front.toLowerCase());
    if (i >= 0) word = esc(c.sample.slice(0, i)) + '<b>' + esc(c.sample.slice(i, i + c.front.length)) + '</b>' + esc(c.sample.slice(i + c.front.length));
  }
  return `<div class="bemoji ${n > 1 ? 'many' : ''}">${Array(n).fill(c.emoji).join('')}</div>
    ${c.sound ? `<div class="bsound">${esc(c.sound)}</div>` : ''}<div class="bword">${word}</div>`;
}
function showFlipChart(startDeck) {
  return new Promise(res => {
    const all = G.data.flipcharts || [];
    const decks = [...new Set(all.map(c => c.deck))];
    if (!decks.length) { toast('No flip charts yet'); res(); return; }
    const cardsOf = d => all.filter(c => c.deck === d).sort((a, b) => a.order - b.order);
    let deck = decks.includes(startDeck) ? startDeck : decks[0], i = 0;
    const draw = () => {
      const cards = cardsOf(deck), c = cards[i];
      overlay(`<div class="card">
        <button class="toy x" id="fcClose" aria-label="Close">✖</button>
        <h2>📇 Flip Charts</h2>
        <div class="tabs">${decks.map(d => `<button class="toy tab ${d === deck ? 'on' : ''}" data-d="${esc(d)}">${esc(d)}</button>`).join('')}</div>
        <div class="flip" id="flip" role="button" tabindex="0" aria-label="Flip the card">
          <div class="inner"><div class="face front">${fcFront(c)}</div><div class="face back">${fcBack(c)}</div></div></div>
        <div class="tip">Tap the card to flip it!</div>
        <div class="row">
          <button class="toy ghost" id="fcPrev" ${i === 0 ? 'disabled' : ''} aria-label="Previous card">◀</button>
          <button class="toy ghost" id="fcSay" aria-label="Hear it">🔊</button>
          <button class="toy ghost" id="fcNext" ${i === cards.length - 1 ? 'disabled' : ''} aria-label="Next card">▶</button>
        </div>
        <div class="chips">${cards.map((x, j) => `<button class="chip ${j === i ? 'on' : ''}" data-j="${j}">${esc(x.front)}</button>`).join('')}</div>
      </div>`);
      let flipped = false;
      const f = $('flip');
      const flip = () => { flipped = !flipped; f.classList.toggle('on', flipped); SFX.flip(); say(flipped ? c.speakBack : c.speakFront); };
      f.onclick = flip;
      f.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
      $('fcSay').onclick = () => say(flipped ? c.speakBack : c.speakFront);
      $('fcPrev').onclick = () => { i--; draw(); };
      $('fcNext').onclick = () => { i++; draw(); };
      document.querySelectorAll('.tab').forEach(b => b.onclick = () => { deck = b.dataset.d; i = 0; draw(); });
      document.querySelectorAll('.chip').forEach(b => b.onclick = () => { i = +b.dataset.j; draw(); });
      $('fcClose').onclick = () => { hush(); closeOverlay(); res(); };
      say(c.speakFront);
    };
    draw();
  });
}

/* ---------------- grimoires (audio-visual story books) ---------------- */
/** Reads any book. meta = {id,title,icon,coverColor}; prefix = 'book' (Grimoires) or 'story' (Library). */
function readBook(meta, pages, prefix, { mustRead = false } = {}) {
  return new Promise(res => {
    const bid = meta.id, book = meta;
    if (!pages.length) { res(true); return; }
    pages.forEach(p => { getMedia(`${prefix}:${bid}:p${p.page}:image`); });   // preload pictures
    const videoKey = `${prefix}:${bid}:video`;
    let i = 0, auto = false, closed = false;
    const finish = r => { if (closed) return; closed = true; auto = false; hush(); res(r); };
    const draw = anim => {
      const pg = pages[i], last = i === pages.length - 1;
      overlay(`<div class="card reader" style="--cover:${esc(book.coverColor)}">
        ${mustRead ? '' : '<button class="toy x" id="bkClose" aria-label="Close book">✖</button>'}
        <h2>${book.icon} ${esc(fill(book.title))}</h2>
        ${hasMedia(videoKey) ? '<button class="toy tool" id="bkVid">🎬 Watch the story</button>' : ''}
        <div class="bookpage ${anim || ''}"><div class="art" id="bkArt">${fill(pg.art)}</div>
          <div class="sentence" id="bkText">${wordsHTML(fill(pg.text))}</div>
          <div class="pno">Page ${i + 1} of ${pages.length}</div></div>
        <div class="row">
          <button class="toy ghost" id="bkPrev" ${i === 0 ? 'disabled' : ''} aria-label="Previous page">◀</button>
          <button class="toy ghost" id="bkRead" aria-label="Read this page to me">🔊</button>
          <button class="toy tool auto ${auto ? 'on' : ''}" id="bkAuto">🎧 ${auto ? 'Listening…' : 'Read to me'}</button>
          ${last ? '<button class="toy big" id="bkEnd">✨ The End</button>' : '<button class="toy ghost" id="bkNext" aria-label="Next page">▶</button>'}
        </div></div>`);
      const ik = `${prefix}:${bid}:p${pg.page}:image`;
      if (hasMedia(ik)) getMedia(ik).then(m => { if (m && $('bkArt') && pages[i] === pg) $('bkArt').innerHTML = `<img src="${m.url}" alt="">`; });
      $('bkPrev').onclick = () => { stopAuto(); i--; draw('turn-prev'); };
      if ($('bkNext')) $('bkNext').onclick = () => { stopAuto(); i++; SFX.flip(); draw('turn-next'); };
      if ($('bkEnd')) $('bkEnd').onclick = () => finish(true);
      if ($('bkClose')) $('bkClose').onclick = () => finish(false);
      if ($('bkVid')) $('bkVid').onclick = async () => {
        stopAuto();
        const r = await showVideo(videoKey, fill(book.title), '✨ I finished the story');
        if (r === 'done') finish(true);
      };
      $('bkRead').onclick = () => { stopAuto(); readPage(); };
      $('bkAuto').onclick = () => { if (auto) { stopAuto(); draw(); } else startAuto(); };
    };
    const readPage = () => { const pg = pages[i]; return narrate($('bkText'), fill(pg.text), `${prefix}:${bid}:p${pg.page}:audio`, { rate: .8 }); };
    const stopAuto = () => { auto = false; hush(); };
    const startAuto = async () => {
      auto = true; draw();
      while (auto && !closed) {
        const ok = await readPage();
        if (!ok || !auto) return;
        await wait(600);
        if (!auto) return;
        if (i < pages.length - 1) { i++; SFX.flip(); draw('turn-next'); }
        else { auto = false; draw(); say('The End! Tap The End to finish.'); return; }
      }
    };
    draw();
    say(`${fill(book.title)}. Read it yourself, or tap read to me.`);
  });
}
function grimoireMeta(b) { return { id: b.grimoireId, title: b.title, icon: b.icon, coverColor: b.coverColor }; }
function grimoirePages(b) { return G.data.grimoirepages.filter(p => p.grimoireId === b.grimoireId).sort((x, y) => x.page - y.page); }
function readGrimoire(b, opts) { return readBook(grimoireMeta(b), grimoirePages(b), 'book', opts); }
const cooldownMs = () => (+G.cfg.grimoireCooldownHours || 0) * 3600e3;
function grimoireRestLeft(id) {
  const u = G.player && G.player.grimoireUsed && G.player.grimoireUsed[id];
  return u && cooldownMs() ? Math.max(0, u + cooldownMs() - Date.now()) : 0;
}
function fmtWait(ms) { const h = Math.floor(ms / 3600e3), m = Math.ceil((ms % 3600e3) / 60e3); return h ? `${h}h ${m}m` : `${m}m`; }
async function refill(fromBookId) {
  if (fromBookId) { G.player.grimoireUsed = G.player.grimoireUsed || {}; G.player.grimoireUsed[fromBookId] = Date.now(); }
  const p = G.player, gm = +G.cfg.grimoireMagic || maxMagic();
  p.hearts = maxHearts(); p.magic = Math.min(maxMagic(), Math.max(p.magic, gm));
  updateHUD(); save(true); SFX.level();
  heroSparkle(['#ff6b6b', '#b388ff', '#ffffff', '#fcd116']);
  banner(`<div class="lvup" style="color:#ff6b6b">${'❤️'.repeat(maxHearts())}</div><div>Hearts are full!</div>
    <div class="sub">🔮 Magic is full — worth ${gm} gems!</div>`);
  await say('You finished the book! Your hearts are full, and your magic is full!');
  await wait(400); hideBanner();
}
function unlockLabel(b) {
  if (b.unlockBy === 'start') return 'Ready';
  const s = byId(G.data.scenes, 'sceneId', b.unlockBy), boss = s && byId(G.data.bosses, 'bossId', s.bossId);
  return boss ? `Beat the ${boss.name}` : 'Locked';
}
function spellLine(b) {
  const sp = byId(G.data.spells, 'spellId', b.spellId); if (!sp) return '';
  return b.spellAction === 'enrich' ? `${sp.icon} ${sp.name} costs less` : `New spell: ${sp.icon} ${sp.name}`;
}
function openGrimoireLibrary({ mustRead = false } = {}) {
  return new Promise(res => {
    const draw = (msg = '') => {
      const books = sortedBooks(), own = G.player.grimoires;
      const anyReady = own.some(id => !grimoireRestLeft(id));
      const price = +G.cfg.refillPriceTokens || 15;
      overlay(`<div class="card" style="max-width:720px">
        ${mustRead ? '' : '<button class="toy x" id="lbClose" aria-label="Close">✖</button>'}
        <h2>📚 Grimoires</h2>
        <p>${mustRead ? (anyReady ? 'Rest time! Read, listen to, or watch a Grimoire to fill your hearts and magic.'
            : 'All your Grimoires are resting. Use an Emergency Grimoire, or rest and come back later.')
          : 'Finish a Grimoire to fill your ❤️ hearts and 🔮 magic. After it helps you, a Grimoire rests for a while.'}</p>
        <div class="books">${books.map(b => {
          const has = own.includes(b.grimoireId), rest = has ? grimoireRestLeft(b.grimoireId) : 0;
          const off = !has || (mustRead && rest);
          const label = !has ? unlockLabel(b) : rest ? `😴 Resting · ${fmtWait(rest)}` : spellLine(b);
          return `<button class="toy bookbtn ${has ? '' : 'locked'}" data-b="${esc(b.grimoireId)}" ${off ? 'disabled' : ''} style="--cover:${esc(b.coverColor)}">
            <span class="bi">${has ? b.icon : '🔒'}</span><span class="bt">${esc(fill(b.title))}</span>
            <span class="bs">${esc(label)}</span></button>`;
        }).join('')}</div>
        ${mustRead ? `<div class="row" style="margin-top:16px">
            <button class="toy big" id="lbEmerg">📕⚡ Emergency Grimoire · 🪙 ${price}</button>
            <button class="toy tool" id="lbTop">🪙 Top up</button>
            <button class="toy tool" id="lbRest">🗺️ Rest for now</button></div>` : ''}
        <p class="formmsg" id="lbMsg" role="status">${esc(msg)}</p></div>`);
      document.querySelectorAll('.bookbtn').forEach(btn => {
        const ck = `book:${btn.dataset.b}:cover`;
        if (!btn.disabled && hasMedia(ck)) getMedia(ck).then(m => {
          if (m) btn.style.background = `linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,.55)), url("${m.url}") center/cover`;
        });
        btn.onclick = async () => {
          const book = byId(G.data.grimoires, 'grimoireId', btn.dataset.b);
          const restBefore = grimoireRestLeft(book.grimoireId);
          const finished = await readGrimoire(book, { mustRead });
          if (finished) {
            closeOverlay();
            if (!restBefore) { await refill(book.grimoireId); if (mustRead) { res(true); return; } }
            else { toast('⭐ Great reading!'); say('Great reading!'); }
          }
          draw();
        };
      });
      if ($('lbClose')) $('lbClose').onclick = () => { hush(); res(false); };
      if ($('lbEmerg')) $('lbEmerg').onclick = async () => { if (await buyEmergency()) res(true); else draw('You need more tokens. Ask a grown-up to top up.'); };
      if ($('lbTop')) $('lbTop').onclick = async () => { const r = await showTopUp(); if (r === 'refilled') res(true); else draw(); };
      if ($('lbRest')) $('lbRest').onclick = () => { hush(); res('exit'); };
    };
    draw();
  });
}
function unlockGrimoireFor(sceneId) {
  const b = G.data.grimoires.find(g => g.unlockBy === sceneId);
  if (b && !G.player.grimoires.includes(b.grimoireId)) { G.player.grimoires.push(b.grimoireId); return b; }
  return null;
}
function announceGrimoire(b) {
  return new Promise(res => {
    SFX.level();
    const sp = byId(G.data.spells, 'spellId', b.spellId);
    overlay(`<div class="card"><div class="hero-emoji">📕✨</div><h2>New Grimoire!</h2>
      <button class="toy bookbtn" style="--cover:${esc(b.coverColor)};margin:6px auto;max-width:220px;width:100%" disabled>
        <span class="bi">${b.icon}</span><span class="bt">${esc(fill(b.title))}</span></button>
      <p>${esc(spellLine(b))}${sp ? `<br><small>${esc(sp.description)}</small>` : ''}</p>
      <p><small>Finish a Grimoire any time to fill your hearts and magic.</small></p>
      <div class="row"><button class="toy ghost" id="gLater">Later</button><button class="toy big" id="gRead">📖 Read now</button></div></div>`);
    say(`You unlocked a new Grimoire: ${fill(b.title)}! ${spellLine(b)}.`);
    $('gLater').onclick = () => { hush(); res(); };
    $('gRead').onclick = async () => { hush(); const done = await readGrimoire(b); if (done) { closeOverlay(); await refill(); } res(); };
  });
}

/* ---------------- accounts, GCash payments, tokens, library ---------------- */
const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH');
function errText(e) {
  return String((e && e.message) || e || 'Something went wrong.').replace(/^Error:\s*/, '').replace(/^(AUTH|NOT_ENOUGH_TOKENS|OFFLINE):\s*/, '');
}
function callAuthed(fn, ...args) {
  return server(fn, G.session, ...args).catch(e => {
    if (/AUTH:/.test(String((e && e.message) || e))) { signOutLocal(); showAuth('signin', 'Please sign in again.'); }
    throw e;
  });
}
function signOutLocal() {
  store.del('maalam_session'); store.del('maalam_save'); store.del('maalam_bundle'); store.del('maalam_outbox');
  G.session = null; G.account = null; G.player = null;
  $('hud').classList.add('hidden'); $('hTokens').classList.add('hidden');
}
async function signOut() {
  hush();
  const t = G.session;
  signOutLocal();
  if (t) server('signOut', t).catch(() => {});
  buildWorld(sortedScenes()[0], true); G.camMode = 'orbit';
  showAuth('signin');
}
const LOGO_HTML = () => IS_PWA ? '<img class="logoimg" src="icons/logo-512.png" alt="Maalam PH">' : '<div class="logo">Maalam<span>PH</span></div>';
function linkOrText(label, url) { return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>` : label; }

function showAuth(mode = 'signin', msg = '') {
  G.screen = 'auth'; hidePanel(); hideEnemyBar(); $('hud').classList.add('hidden');
  const up = mode === 'signup', price = +G.cfg.subscriptionPrice || 500;
  overlay(`<div class="card auth">
    ${LOGO_HTML()}
    <p class="tagline">Matalino · Matapang · Matulungin · May dangal</p>
    <div class="tabs" role="tablist">
      <button class="toy tab ${up ? '' : 'on'}" id="tIn" role="tab" aria-selected="${!up}">Sign in</button>
      <button class="toy tab ${up ? 'on' : ''}" id="tUp" role="tab" aria-selected="${up}">Sign up</button></div>
    <p class="small">${up ? `For parents and guardians. One-time subscription: <b>${peso(price)}</b> with GCash.` : 'Parents, please sign in to start playing.'}</p>
    ${up ? '<label class="field">Parent or guardian name<input id="aName" autocomplete="name" maxlength="60"></label>' : ''}
    <label class="field">Mobile number<input id="aMobile" inputmode="tel" autocomplete="tel" placeholder="09XXXXXXXXX" maxlength="13"></label>
    ${up ? '<label class="field">Email (optional, for receipts)<input id="aEmail" type="email" autocomplete="email" maxlength="120"></label>' : ''}
    <label class="field">Password<input id="aPass" type="password" autocomplete="${up ? 'new-password' : 'current-password'}"></label>
    ${up ? `<label class="field">Type the password again<input id="aPass2" type="password" autocomplete="new-password"></label>
      <label class="check"><input type="checkbox" id="aConsent"><span>I am the parent or guardian, and I agree to the
        ${linkOrText('Terms', G.cfg.termsUrl)} and ${linkOrText('Privacy Policy', G.cfg.privacyUrl)}.</span></label>` : ''}
    <p class="formmsg" id="aMsg" role="alert">${esc(msg)}</p>
    <button class="toy big" id="aGo">${up ? 'Create account' : 'Sign in'}</button>
    ${up ? '' : `<p class="small">Forgot your password? ${esc(G.cfg.supportContact || '')}</p>`}
  </div>`);
  $('tIn').onclick = () => showAuth('signin');
  $('tUp').onclick = () => showAuth('signup');
  const go = async () => {
    const btn = $('aGo'); $('aMsg').textContent = '';
    try {
      btn.disabled = true; btn.textContent = 'Please wait…';
      let r;
      if (up) {
        if ($('aPass').value !== $('aPass2').value) throw new Error('The two passwords are not the same.');
        r = await server('signUp', { parentName: $('aName').value, mobile: $('aMobile').value, email: $('aEmail').value,
          password: $('aPass').value, consent: $('aConsent').checked });
      } else {
        r = await server('signIn', $('aMobile').value, $('aPass').value);
      }
      G.session = r.session; store.set('maalam_session', r.session);
      unlockAudio();
      await afterAuth(r);
    } catch (e) {
      if ($('aMsg')) $('aMsg').textContent = errText(e);
      if ($('aGo')) { btn.disabled = false; btn.textContent = up ? 'Create account' : 'Sign in'; }
    }
  };
  $('aGo').onclick = go;
  document.querySelectorAll('.auth input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
}

async function afterAuth(r) {
  G.account = r.account;
  if (r.session) G.session = r.session;
  if (!r.offline) { G.player = r.player ? normalizePlayer(r.player) : null; rememberBundle(); }
  $('hud').classList.add('hidden');
  if (G.account.status !== 'active') { showSubscribe(r.payments || []); return; }
  preloadVoice(PRAISE.concat(['Try again!', 'Count again!', "Let's count together!", 'Pick a place to explore!', 'Aray!', 'Blocked!']));
  if (r.player) {
    G.player = normalizePlayer(r.player);
    buildWorld(sortedScenes()[Math.min(G.player.unlocked, sortedScenes().length) - 1], true);
    showWelcomeBack();
  } else {
    showHeroCreate();
  }
}
async function refreshAccountAndRoute() {
  try { const r = await callAuthed('getAccount'); await afterAuth(r); } catch (e) { toast(errText(e), 3500); }
}
async function checkPendingOnBoot() {
  const id = store.get('maalam_pending_pay');
  if (!id || !G.session) return;
  try {
    const r = await callAuthed('checkPayment', id);
    if (r.status === 'paid' || r.status === 'rejected' || r.status === 'missing') store.del('maalam_pending_pay');
    if (r.status === 'paid') {
      const wasPending = G.account.status !== 'active';
      G.account = r.account; SFX.level(); toast('✅ Payment received. Salamat!', 3500);
      if (wasPending) refreshAccountAndRoute(); else updateHUD();
    }
  } catch (e) { /* try again next time */ }
}

function showSubscribe(payments) {
  G.screen = 'subscribe';
  const price = +G.cfg.subscriptionPrice || 500;
  const pending = (payments || []).filter(p => p.kind === 'subscription' && p.status === 'pending').pop();
  const rejected = (payments || []).filter(p => p.kind === 'subscription' && p.status === 'rejected').pop();
  overlay(`<div class="card">
    ${LOGO_HTML()}
    <h2>One step left, ${esc(G.account.parentName)}!</h2>
    <p>A one-time payment of <b>${peso(price)}</b> unlocks all six adventures, the flip charts and the Grimoires. No monthly fees.</p>
    ${pending ? `<p class="note">We received your GCash payment${pending.reference ? ` (Ref. <b>${esc(pending.reference)}</b>)` : ''}.
        We will unlock the game after we confirm it, ${esc(G.cfg.manualApprovalNote || 'usually within 24 hours')}.</p>
      <div class="row"><button class="toy big" id="sCheck">Check status</button></div>`
      : `${rejected ? `<p class="note">Your last payment could not be confirmed${rejected.note ? ': ' + esc(rejected.note) : ''}. Please try again or contact us.</p>` : ''}
      <div class="row"><button class="toy big" id="sPay">Pay ${peso(price)} with GCash</button></div>`}
    <p class="small">${esc(G.cfg.supportContact || '')}</p>
    <button class="linkish" id="sOut">Sign out</button></div>`);
  if ($('sPay')) $('sPay').onclick = async () => { unlockAudio(); await payFlow('subscription'); refreshAccountAndRoute(); };
  if ($('sCheck')) $('sCheck').onclick = async () => {
    $('sCheck').disabled = true;
    try {
      const r = await callAuthed('checkPayment', pending.paymentId);
      if (r.status === 'paid') { SFX.level(); toast('✅ Payment received. Salamat!', 3500); }
      else if (r.status === 'pending') toast('Still checking your payment. Thank you for waiting!', 3500);
      refreshAccountAndRoute();
    } catch (e) { toast(errText(e), 3500); if ($('sCheck')) $('sCheck').disabled = false; }
  };
  $('sOut').onclick = signOut;
}

async function payFlow(kind, packId) {
  let info;
  try { info = await callAuthed('startPayment', kind, packId || ''); }
  catch (e) { toast(errText(e), 4000); return 'error'; }
  return showPayScreen(info);
}
/** GCash payment screen. Resolves 'paid', 'pending' (waiting for approval) or 'closed'. */
function showPayScreen(info) {
  return new Promise(res => {
    let timer = null, done = false;
    const finish = r => { if (done) return; done = true; clearInterval(timer); if (r === 'paid') store.del('maalam_pending_pay'); res(r); };
    const check = async loud => {
      try {
        const r = await callAuthed('checkPayment', info.paymentId);
        if (r.account) G.account = r.account;
        if (r.status === 'paid') { SFX.level(); toast('✅ Payment received. Salamat!', 3500); updateHUD(); finish('paid'); return; }
        if (r.status === 'rejected' && $('payMsg')) $('payMsg').textContent = 'This payment could not be confirmed. ' + (r.note || 'Please contact us.');
        else if (loud && $('payMsg')) $('payMsg').textContent = 'Not confirmed yet. Please wait a little, then check again.';
      } catch (e) { if (loud && $('payMsg')) $('payMsg').textContent = errText(e); }
    };
    store.set('maalam_pending_pay', info.paymentId);
    const head = `<button class="toy x" id="pClose" aria-label="Close">✖</button>
      <h2>Pay ${peso(info.amountPHP)} with GCash</h2><p class="small">${esc(info.item)}</p>`;
    const bind = () => {
      $('pClose').onclick = () => finish(info.method === 'manual' && !info.sent ? 'closed' : 'pending');
      if ($('pCheck')) $('pCheck').onclick = () => check(true);
      if ($('pLater')) $('pLater').onclick = () => finish('pending');
    };
    const waiting = ref => {
      overlay(`<div class="card pay">${head}<div class="hero-emoji">🧾</div>
        <p>Salamat! We received Reference No. <b>${esc(ref)}</b>. We will confirm your payment ${esc(info.approvalNote || 'soon')}.</p>
        <div class="row"><button class="toy big" id="pCheck">Check status</button><button class="toy tool" id="pLater">Close</button></div>
        <p class="formmsg" id="payMsg" role="status"></p></div>`);
      bind(); timer = setInterval(() => check(false), 20000);
    };
    if (info.method === 'paymongo') {
      overlay(`<div class="card pay">${head}
        <p>Tap the button to open the secure GCash checkout. Come back to this screen after you pay.</p>
        <div class="row"><a class="toy big" href="${esc(info.checkoutUrl)}" target="_blank" rel="noopener">Open GCash checkout</a></div>
        <div class="row" style="margin-top:12px"><button class="toy tool" id="pCheck">I have paid</button></div>
        <p class="formmsg" id="payMsg" role="status"></p></div>`);
      bind(); timer = setInterval(() => check(false), 5000);
      return;
    }
    overlay(`<div class="card pay">${head}
      <div id="payQr"></div>
      <ol class="steps">
        <li>Open GCash and tap <b>Send Money</b>${hasMedia('pay:qr') ? ', or scan the QR code' : ''}.</li>
        <li>Send exactly <b>${peso(info.amountPHP)}</b> to <b>${esc(info.gcashName)}</b>, <b>${esc(info.gcashNumber)}</b>.</li>
        <li>Type the <b>Reference No.</b> from your GCash receipt here.</li></ol>
      <input id="pRef" inputmode="numeric" maxlength="20" placeholder="Reference No." autocomplete="off" aria-label="GCash Reference No.">
      <div class="row"><button class="toy big" id="pSend">Send Reference No.</button></div>
      <p class="formmsg" id="payMsg" role="status"></p></div>`);
    if (hasMedia('pay:qr')) getMedia('pay:qr').then(m => { if (m && $('payQr')) $('payQr').innerHTML = `<img src="${m.url}" alt="GCash QR code" class="qr">`; });
    bind();
    $('pSend').onclick = async () => {
      const ref = $('pRef').value.replace(/\s+/g, '');
      $('pSend').disabled = true; $('payMsg').textContent = '';
      try { await callAuthed('submitReference', info.paymentId, ref); info.sent = true; waiting(ref); }
      catch (e) { $('payMsg').textContent = errText(e); $('pSend').disabled = false; }
    };
  });
}

/** Top up: buy token packs with GCash, or use tokens for an Emergency Grimoire. Resolves 'refilled' or 'closed'. */
function showTopUp() {
  return new Promise(res => {
    const draw = (msg = '') => {
      const packs = (G.data.tokenpacks || []).slice().sort((a, b) => a.order - b.order);
      const p = G.player, cost = +G.cfg.refillPriceTokens || 15;
      const canRefill = !!p && (p.hearts < maxHearts() || p.magic < maxMagic());
      overlay(`<div class="card" style="max-width:720px"><button class="toy x" id="tuClose" aria-label="Close">✖</button>
        <h2>🪙 Top up</h2>
        <p>You have <b>🪙 ${G.account.tokens}</b> tokens. Tokens unlock Library books and Emergency Grimoires.</p>
        <div class="packs">${packs.map(k => `<button class="toy pack" data-k="${esc(k.packId)}">
          <span class="pt">🪙 ${esc(k.tokens)}</span><span class="pn">${esc(k.name)}</span><span class="pp">${peso(k.pricePHP)}</span>
          ${k.tag ? `<span class="tag">${esc(k.tag)}</span>` : ''}</button>`).join('')}</div>
        <div class="emerg"><div class="hero-emoji">📕⚡</div><h3>Emergency Grimoire</h3>
          <p class="small">Fills ❤️ hearts and 🔮 magic right away, even when every Grimoire is resting.</p>
          <button class="toy big" id="tuRefill" ${canRefill ? '' : 'disabled'}>Use 🪙 ${cost}</button>
          ${canRefill ? '' : '<p class="small">Your hearts and magic are already full.</p>'}</div>
        <p class="formmsg" id="tuMsg" role="status">${esc(msg)}</p></div>`);
      $('tuClose').onclick = () => { hush(); res('closed'); };
      document.querySelectorAll('.pack').forEach(b => b.onclick = async () => {
        const r = await payFlow('tokens', b.dataset.k);
        draw(r === 'paid' ? 'Tokens added. Salamat!' : r === 'pending' ? 'We will add your tokens after we confirm the payment.' : '');
      });
      $('tuRefill').onclick = async () => { if (await buyEmergency()) res('refilled'); else draw('Not enough tokens yet. Choose a token pack above.'); };
    };
    draw();
  });
}
async function buyEmergency() {
  try {
    G.account = await callAuthed('buyRefill');
    updateHUD(); closeOverlay();
    await refill(null);
    return true;
  } catch (e) { toast(errText(e), 4000); say('You need more tokens. Ask a grown-up to top up.'); return false; }
}

function showLibraryIntro() {
  return new Promise(res => {
    const need = +G.cfg.booksToUnlockNext || 10;
    overlay(`<div class="card"><div class="hero-emoji">🏛️📚✨</div><h2>The Maalam Library is open!</h2>
      <p class="stext" id="libIntro">${wordsHTML(`A new challenge, Maalam ${heroName()}! The Maalam Library is full of short story books. Unlock ${need} story books to open the next challenge.`)}</p>
      <div class="row"><button class="toy big" id="liGo">Enter the Library ▶</button></div></div>`);
    narrate($('libIntro'), '', null);
    $('liGo').onclick = () => { hush(); res(); };
  });
}
function storyMeta(b) { return { id: b.storyId, title: b.title, icon: b.icon, coverColor: b.coverColor }; }
function showNextChallenge() {
  return new Promise(res => {
    overlay(`<div class="card"><div class="hero-emoji">🏰🚀</div><h2>${esc(G.cfg.nextChallengeTitle || 'Next challenge')}</h2>
      <p>${esc(G.cfg.nextChallengeMessage || 'Coming soon!')}</p>
      <div class="row"><button class="toy big" id="ncOk">OK ▶</button></div></div>`);
    say(G.cfg.nextChallengeMessage || 'Coming soon!');
    $('ncOk').onclick = () => { hush(); res(); };
  });
}
/** The Library shop: covers, titles, add to cart, buy with tokens, read owned books. */
function openLibrary() {
  return new Promise(res => {
    const cart = new Set(), need = +G.cfg.booksToUnlockNext || 10;
    const pagesCache = {};
    const draw = (msg = '') => {
      G.screen = 'library';
      const books = (G.data.storybooks || []).slice().sort((a, b) => a.order - b.order);
      const own = G.account.books || [];
      const total = [...cart].reduce((t, id) => t + (+(byId(books, 'storyId', id) || {}).price || 0), 0);
      const have = own.length;
      overlay(`<div class="card lib" style="max-width:920px"><button class="toy x" id="lbX" aria-label="Close">✖</button>
        <h2>📚 The Maalam Library</h2>
        <p>Unlock <b>${need}</b> story books to open the next challenge. You have <b>${Math.min(have, need)} of ${need}</b>.</p>
        <div class="bar wide"><i style="width:${Math.min(100, have / need * 100)}%"></i></div>
        ${have >= need ? '<div class="row"><button class="toy big" id="lbNext">🚀 Next challenge</button></div>' : ''}
        <div class="shelf">${books.map(b => {
          const owned = own.includes(b.storyId), inCart = cart.has(b.storyId);
          return `<div class="sbook">
            <div class="cover" data-c="${esc(b.storyId)}" style="--cover:${esc(b.coverColor)}"><span>${b.icon}</span>${owned ? '<i class="ribbon">✓</i>' : ''}</div>
            <div class="stitle">${esc(b.title)}</div>
            ${owned ? `<button class="toy tool" data-read="${esc(b.storyId)}">📖 Read</button>`
              : `<button class="toy tool ${inCart ? 'incart' : ''}" data-cart="${esc(b.storyId)}" aria-pressed="${inCart}">${inCart ? '✓ In cart' : `🛒 Add · 🪙 ${esc(b.price)}`}</button>`}
          </div>`;
        }).join('')}</div>
        <div class="cartbar">
          <span>🛒 ${cart.size} ${cart.size === 1 ? 'book' : 'books'} · 🪙 ${total}</span>
          <span class="small">You have 🪙 ${G.account.tokens}</span>
          <button class="toy big" id="lbBuy" ${cart.size ? '' : 'disabled'}>Buy with tokens</button>
          <button class="toy tool" id="lbTop">🪙 Top up</button></div>
        <p class="formmsg" id="lbMsg" role="status">${esc(msg)}</p></div>`, 'lib');
      document.querySelectorAll('.cover[data-c]').forEach(el => {
        const k = `story:${el.dataset.c}:cover`;
        if (hasMedia(k)) getMedia(k).then(m => { if (m) { el.style.background = `url("${m.url}") center/cover`; const sp = el.querySelector('span'); if (sp) sp.remove(); } });
      });
      document.querySelectorAll('[data-cart]').forEach(b => b.onclick = () => {
        const id = b.dataset.cart; cart.has(id) ? cart.delete(id) : cart.add(id); SFX.flip(); draw();
      });
      document.querySelectorAll('[data-read]').forEach(b => b.onclick = async () => {
        const book = byId(books, 'storyId', b.dataset.read);
        try {
          let pages = pagesCache[book.storyId];
          if (!pages) {
            const saved = store.get('maalam_pages_' + book.storyId);
            try { pages = await callAuthed('getStoryPages', book.storyId); store.set('maalam_pages_' + book.storyId, JSON.stringify(pages)); }
            catch (e) { if (saved) pages = JSON.parse(saved); else throw e; }
            pagesCache[book.storyId] = pages;
          }
          const done = await readBook(storyMeta(book), pages, 'story');
          if (done) { SFX.good(); toast('⭐ Great reading!'); say(`Great reading, Maalam ${heroName()}!`); }
        } catch (e) { toast(errText(e), 3500); }
        draw();
      });
      $('lbBuy').onclick = async () => {
        $('lbBuy').disabled = true;
        const before = (G.account.books || []).length;
        try {
          G.account = await callAuthed('purchaseBooks', [...cart]);
          cart.clear(); updateHUD(); SFX.gem();
          const now = G.account.books.length;
          if (before < need && now >= need) { SFX.level(); draw(); say('You unlocked ten books! The next challenge is open!'); return; }
          draw('Added to your shelf. Happy reading!'); say('New books on your shelf!');
        } catch (e) { draw(errText(e)); }
      };
      $('lbTop').onclick = async () => { await showTopUp(); draw(); };
      if ($('lbNext')) $('lbNext').onclick = async () => { await showNextChallenge(); draw(); };
      $('lbX').onclick = () => { hush(); res(); };
    };
    draw();
    say('Welcome to the Maalam Library! Pick the books you want, then buy them with tokens.');
  });
}

/* ---------------- intro (narrated story) ---------------- */
function introSlides() { return (G.data.introslides || []).slice().sort((a, b) => a.order - b.order); }
/**
 * Plays the intro. If a video is in Drive (01 Intro), it plays first; if only an audio
 * narration is there, the story slides play along with it. The ★ slides (hero name)
 * always follow in the game voice.
 */
async function playIntro() {
  const all = introSlides();
  const named = all.filter(s => String(s.showAfterVideo).toUpperCase() === 'TRUE');
  const story = all.filter(s => !named.includes(s));
  if (hasMedia('intro:video')) {
    const r = await showVideo('intro:video', 'Maalam PH', 'Continue ▶');
    if (r !== 'none') { await playSlides(named); return; }
  }
  if (hasMedia('intro:audio')) {
    if (await playSlides(story, { wholeAudio: 'intro:audio' }) === 'skip') return;
    await playSlides(named); return;
  }
  await playSlides(all);
}
function playSlides(slides, opt = {}) {
  return new Promise(async res => {
    if (!slides.length) { res('done'); return; }
    let i = 0, stopped = false, whole = null, weights = [], total = 1;
    const finish = r => { if (stopped) return; stopped = true; hush(); res(r); };
    const seek = j => {
      if (j >= slides.length) { finish('done'); return; }
      i = Math.max(0, j); render();
      if (whole && whole.duration) { let acc = 0; for (let k = 0; k < i; k++) acc += weights[k]; whole.currentTime = acc / total * whole.duration; }
    };
    const render = () => {
      const s = slides[i];
      overlay(`<div class="intro" style="--bg:${esc(s.bg)}">
          <button class="toy skip" id="inSkip">Skip ⏭</button>
          <div class="iart" id="iart">${fill(s.art)}</div>
          <p class="itext" id="itext">${wordsHTML(fill(s.text))}</p>
          <div class="row"><button class="toy ghost" id="inPrev" ${i ? '' : 'disabled'} aria-label="Back">◀</button>
            <button class="toy ghost" id="inRep" aria-label="Hear again">🔊</button>
            <button class="toy big" id="inNext">${i === slides.length - 1 ? '▶ Start' : 'Next ▶'}</button></div>
          <div class="idots">${slides.map((_, j) => `<span class="${j === i ? 'on' : ''}"></span>`).join('')}</div></div>`);
      const imgKey = `intro:s${s.order}:image`;
      if (hasMedia(imgKey)) getMedia(imgKey).then(m => { if (m && $('iart') && slides[i] === s) $('iart').innerHTML = `<img src="${m.url}" alt="">`; });
      $('inSkip').onclick = () => finish('skip');
      if (whole) {
        $('inPrev').onclick = () => seek(i - 1);
        $('inNext').onclick = () => seek(i + 1);
        $('inRep').onclick = () => seek(i);
      } else {
        $('inPrev').onclick = () => { i--; render(); play(); };
        $('inNext').onclick = () => advance();
        $('inRep').onclick = () => play();
      }
    };
    const advance = () => { if (stopped) return; if (i < slides.length - 1) { i++; render(); play(); } else finish('done'); };
    const play = async () => {
      const s = slides[i], idx = i;
      const ok = await narrate($('itext'), fill(s.text), `intro:s${s.order}:audio`, { rate: .9 });
      if (ok && !stopped && idx === i) { await wait(800); if (!stopped && idx === i) advance(); }
    };
    if (opt.wholeAudio) {
      const m = await getMedia(opt.wholeAudio);
      if (m) {
        weights = slides.map(s => fill(s.text).length); total = weights.reduce((a, b) => a + b, 0) || 1;
        hush(); whole = new Audio(m.url); G.audio = whole;
        whole.ontimeupdate = () => {
          if (!whole.duration || stopped) return;
          const t = whole.currentTime / whole.duration * total; let j = 0, acc = 0;
          while (j < slides.length - 1 && acc + weights[j] <= t) { acc += weights[j]; j++; }
          if (j !== i) { i = j; render(); }
        };
        whole.onended = () => finish('done');
        render();
        whole.play().catch(() => { whole = null; render(); play(); });
        return;
      }
    }
    render(); play();
  });
}

/* ---------------- screens ---------------- */
function showStory(text, icon, title, extra, audioKey) {
  return new Promise(res => {
    overlay(`<div class="card"><div class="hero-emoji">${icon}</div>${title ? `<h2>${esc(fill(title))}</h2>` : ''}
      <p class="stext" id="stext">${wordsHTML(fill(text))}</p>
      <div class="row"><button class="toy ghost" id="rep" aria-label="Hear the story">🔊</button>
      ${extra ? `<button class="toy tool" id="ex">${extra.label}</button>` : ''}<button class="toy big" id="nx">Next ▶</button></div></div>`);
    const speak = () => narrate($('stext'), fill(text), audioKey);
    speak();
    $('rep').onclick = speak;
    if (extra) $('ex').onclick = async () => { hush(); await extra.fn(); res(showStory(text, icon, title, extra, audioKey)); };
    $('nx').onclick = () => { hush(); closeOverlay(); res(); };
  });
}
function showHeroCreate() {
  G.screen = 'create';
  $('hud').classList.add('hidden'); hidePanel();
  G.player = null; G.previewType = G.previewType || 'boy';
  buildWorld(sortedScenes()[0], true); G.camMode = 'preview';
  overlay(`<div class="card">
      ${LOGO_HTML()}
      <p class="tagline">Matalino · Matapang · Matulungin · May dangal</p>
      <h2 style="font-size:24px">Choose your Maalam</h2>
      <div class="row heroes">
        <button class="toy herobtn ${G.previewType === 'boy' ? 'on' : ''}" data-h="boy" aria-pressed="${G.previewType === 'boy'}"><span>👦🏽</span>Boy</button>
        <button class="toy herobtn ${G.previewType === 'girl' ? 'on' : ''}" data-h="girl" aria-pressed="${G.previewType === 'girl'}"><span>👧🏽</span>Girl</button>
      </div>
      <label for="pname">What is your hero's name?</label>
      <input id="pname" maxlength="16" placeholder="Hero name" autocomplete="off">
      <div class="row"><button class="toy big" id="go">▶ Begin the story</button></div>
      <p class="acct">Signed in as ${esc(G.account.parentName)} · <button class="linkish" id="hcOut">Sign out</button></p></div>`, 'side');
  document.querySelectorAll('.herobtn').forEach(b => b.onclick = () => {
    unlockAudio();
    G.previewType = b.dataset.h;
    document.querySelectorAll('.herobtn').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    placeHero(G.previewType); heroSparkle(['#fcd116', '#ffffff', '#0038a8', '#ce1126']); SFX.magic();
    say(G.previewType === 'girl' ? 'A brave girl Maalam!' : 'A brave boy Maalam!');
  });
  $('pname').addEventListener('keydown', e => { if (e.key === 'Enter') $('go').click(); });
  $('go').onclick = async () => {
    unlockAudio();
    const name = $('pname').value.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (!name) { $('pname').focus(); $('pname').classList.add('shake'); setTimeout(() => $('pname').classList.remove('shake'), 500); say("What is your hero's name?"); return; }
    G.player = newPlayer(name, G.previewType);
    save(true);
    G.camMode = 'orbit';
    await playIntro();
    updateHUD();
    const starter = byId(G.data.grimoires, 'grimoireId', starterBooks()[0]);
    if (starter) await announceGrimoire(starter);
    showMap();
  };
  $('hcOut').onclick = signOut;
}
function showWelcomeBack() {
  const p = G.player, h = HEROES[p.heroType];
  const cp = p.checkpoint && byId(G.data.scenes, 'sceneId', p.checkpoint.sceneId);
  placeHero(p.heroType); G.camMode = 'orbit'; updateHUD();
  overlay(`<div class="card"><div class="hero-emoji">${h.emoji}👋</div><h2>Welcome back, Maalam ${esc(p.name)}!</h2>
    <p>${'❤️'.repeat(p.hearts)}${'🤍'.repeat(maxHearts() - p.hearts)}<br>🔮 ${p.magic} &nbsp; 💎 ${p.gems.length} &nbsp; 📚 ${p.grimoires.length}</p>
    <div class="row">${cp ? `<button class="toy big" id="cont">▶ Continue in ${esc(cp.name)}</button>` : ''}
      <button class="toy ${cp ? 'tool' : 'big'}" id="toMap">🗺️ Adventure map</button></div>
    <div class="row" style="margin-top:12px"><button class="toy tool" id="reIntro">🎬 Watch the story again</button></div>
    <button class="linkish" id="reset">Start over with a new hero</button>
    <p class="acct">Signed in as ${esc(G.account.parentName)} · 🪙 ${G.account.tokens} · <button class="linkish" id="wbOut">Sign out</button></p></div>`);
  say(cp ? `Welcome back, Maalam ${p.name}! Let's continue in ${cp.name}!` : `Welcome back, Maalam ${p.name}!`);
  if (cp) $('cont').onclick = () => { unlockAudio(); hush(); playScene(cp.sceneId, +p.checkpoint.step || 0); };
  $('toMap').onclick = () => { unlockAudio(); hush(); showMap(); };
  $('reIntro').onclick = async () => { unlockAudio(); hush(); await playIntro(); showWelcomeBack(); };
  let armed = false;
  $('reset').onclick = () => {
    if (!armed) { armed = true; $('reset').textContent = 'Tap again: this erases the hero (tokens and books stay)'; return; }
    hush(); store.del('maalam_save'); G.player = null; showHeroCreate();
  };
  $('wbOut').onclick = signOut;
  G.screen = 'welcome';
}
function showMap() {
  hidePanel(); hideEnemyBar(); G.shield = 0; G.double = false;
  const scenes = sortedScenes();
  buildWorld(scenes[Math.min(G.player.unlocked, scenes.length) - 1], true);
  G.camMode = 'orbit'; updateHUD(); renderMapCard();
  say(G.player.hearts <= 0 ? `${heroName()} is tired. Read a Grimoire to fill your hearts!` : 'Pick a place to explore!');
}
function renderMapCard() {
  const p = G.player, scenes = sortedScenes();
  const cp = p.checkpoint && byId(G.data.scenes, 'sceneId', p.checkpoint.sceneId);
  const cards = scenes.map(s => {
    const locked = +s.order > p.unlocked;
    const boss = byId(G.data.bosses, 'bossId', s.bossId);
    const slots = G.data.gems.filter(g => g.sceneId === s.sceneId)
      .map(g => shapeSVG(g.shape, p.gems.includes(g.gemId) ? g.hex : '#ece8f5', 26)).join('');
    const here = cp && cp.sceneId === s.sceneId;
    return `<button class="toy scard ${locked ? 'locked' : ''}" data-id="${s.sceneId}" ${locked ? 'disabled' : ''} style="--c:${s.accentColor}">
      <div class="sicon">${locked ? '🔒' : TOPIC_ICON[s.topic] || '⭐'}</div>
      <div class="sname">${esc(s.name)}</div><div class="step">Stop ${s.order}: ${s.topic === 'sentence' ? 'reading' : s.topic + 's'}${boss ? ` · ${esc(boss.name)}` : ''}</div>
      <div class="slots">${slots}</div>${here ? '<span class="tag">You are here</span>' : ''}</button>`;
  }).join('');
  overlay(`<div class="card" style="max-width:780px"><h2>🗺️ Where to, Maalam ${esc(p.name)}?</h2>
    <div class="row">${cp ? `<button class="toy big" id="mCont">▶ Continue: ${esc(cp.name)}</button>` : ''}
      <button class="toy tool" id="mFlip">📇 Flip charts</button>
      <button class="toy tool" id="mBooks">📕 Grimoires ${p.grimoires.length}/${G.data.grimoires.length}</button>
      <button class="toy tool" id="mLib" ${p.finished ? '' : 'disabled title="Finish the adventure to open the Library"'}>${p.finished ? '📚' : '🔒'} Library ${(G.account.books || []).length}/${+G.cfg.booksToUnlockNext || 10}</button>
      <button class="toy tool" id="mTop">🪙 ${G.account.tokens} · Top up</button>
      ${IS_PWA ? `<button class="toy tool" id="mDl">📥 ${store.get('maalam_offline_ready') ? 'Update offline files' : 'Download for offline'}</button>` : ''}</div>
    <div class="grid">${cards}</div>
    <p class="acct">Signed in as ${esc(G.account.parentName)} · <button class="linkish" id="mOut">Sign out</button></p></div>`);
  G.screen = 'map';
  document.querySelectorAll('.scard').forEach(b => b.onclick = () => {
    hush();
    const resume = cp && cp.sceneId === b.dataset.id ? +p.checkpoint.step || 0 : 0;
    playScene(b.dataset.id, resume);
  });
  if (cp) $('mCont').onclick = () => { hush(); playScene(cp.sceneId, +p.checkpoint.step || 0); };
  $('mFlip').onclick = async () => { hush(); await showFlipChart(); renderMapCard(); };
  $('mBooks').onclick = async () => { hush(); await openGrimoireLibrary(); renderMapCard(); };
  $('mLib').onclick = async () => { hush(); await openLibrary(); renderMapCard(); };
  $('mTop').onclick = async () => { hush(); await showTopUp(); renderMapCard(); };
  $('mOut').onclick = signOut;
  if ($('mDl')) $('mDl').onclick = async () => { hush(); await downloadForOffline(); renderMapCard(); };
}
async function showEnding() {
  await showStory(G.cfg.ending, '🏆', 'The End!');
  await new Promise(res => {
    const h = HEROES[G.player.heroType];
    overlay(`<div class="card"><div class="cert"><div class="hero-emoji">${h.emoji}🏅</div><h2>Tunay na Maalam</h2>
      <p>Maalam ${esc(G.player.name)} brought back every Rainbow Gem to Barangay Liwanag!</p>
      <p>🧠 Matalino &nbsp; 🦁 Matapang &nbsp; 🤝 Matulungin &nbsp; 🌟 May dangal</p>
      <p>💎 ${G.player.gems.length} gems &nbsp; ⭐ ${G.player.stars} stars &nbsp; 📚 ${G.player.grimoires.length} grimoires</p></div>
      <button class="toy big" id="nx">Play again ▶</button></div>`);
    say(`Mabuhay, Maalam ${G.player.name}! You are a true Maalam!`);
    $('nx').onclick = () => { hush(); res(); };
  });
}

/* ---------------- scene flow (resumable checkpoints) ---------------- */
function sceneSteps(s) {
  const minions = G.data.tiyanak.filter(g => g.sceneId === s.sceneId);
  const gems = G.data.gems.filter(g => g.sceneId === s.sceneId);
  const steps = []; let x = 0;
  minions.forEach((g, i) => {
    x += 14; steps.push({ type: 'battle', def: g, x, boss: false });
    const gem = gems.find(v => v.source === 'tiyanak' + (i + 1)); if (gem) steps.push({ type: 'gem', gem, x });
  });
  const bd = byId(G.data.bosses, 'bossId', s.bossId);
  if (bd) {
    x += 16; steps.push({ type: 'battle', def: bd, x, boss: true });
    const bg = gems.find(v => v.source === 'boss'); if (bg) steps.push({ type: 'gem', gem: bg, x });
  }
  return steps;
}
async function playScene(id, fromStep = 0) {
  const s = byId(G.data.scenes, 'sceneId', id);
  const steps = sceneSteps(s);
  fromStep = Math.max(0, Math.min(fromStep, steps.length));
  G.sceneDef = s; G.recent.clear(); G.shield = 0; G.double = false; G.screen = 'scene';
  closeOverlay(); buildWorld(s, false); G.camMode = 'follow'; updateHUD();
  const deck = TOPIC_DECK[s.topic];
  const practice = deck ? { label: '📇 Practice', fn: () => showFlipChart(deck) } : null;
  if (fromStep > 0) {
    G.hero.root.position.x = steps[fromStep - 1].x - 2.2;
    await showStory(`Welcome back to ${s.name}! Let's keep going, Maalam {hero}!`, TOPIC_ICON[s.topic] || '⭐', s.name, practice);
  } else {
    await showStory(s.storyIntro, TOPIC_ICON[s.topic] || '⭐', s.name, practice, `scene:${id}:intro:audio`);
  }
  G.player.checkpoint = { sceneId: id, step: fromStep }; save(true);
  if (G.player.hearts <= 0) await knockout();
  for (let k = fromStep; k < steps.length; k++) {
    const st = steps[k];
    if (st.type === 'battle') {
      const e = spawnEnemy(sprite(st.def.spriteId), st.x, st.boss);
      await walkTo(st.x - (st.boss ? 4.2 : 3));
      await battle(st.def, e, st.boss);
    } else {
      await gemChallenge(st.gem, st.x);
    }
    G.player.checkpoint = { sceneId: id, step: k + 1 }; save(true);
  }
  await restoreColors();
  const scenes = sortedScenes();
  G.player.unlocked = Math.min(scenes.length, Math.max(G.player.unlocked, +s.order + 1));
  G.player.checkpoint = null;
  const book = unlockGrimoireFor(id);
  save(true);
  await showStory(s.storyOutro, '🌈', 'Hooray!', null, `scene:${id}:outro:audio`);
  if (book) await announceGrimoire(book);
  if (+s.order === scenes.length) {
    const first = !G.player.finished;
    G.player.finished = true; save(true);
    await showEnding();
    if (first) await showLibraryIntro();
    await openLibrary();
  }
  showMap();
}

/* ---------------- boot ---------------- */
/**
 * Makes sure every screen element the game needs exists, even if the page (Index / index.html)
 * is an older version. Missing pieces are created instead of crashing the game.
 */
(function ensureDom() {
  const make = (tag, attrs, parent, before) => {
    const el = document.createElement(tag);
    Object.keys(attrs).forEach(k => { if (k === 'html') el.innerHTML = attrs[k]; else el.setAttribute(k, attrs[k]); });
    (parent || document.body).insertBefore(el, before || null);
    return el;
  };
  let hud = $('hud');
  if (!hud) hud = make('div', { id: 'hud', class: 'hidden' });
  const sound = $('hSound') || make('button', { id: 'hSound', class: 'toy', 'aria-label': 'Sound on or off', html: '🔊' }, hud);
  const pills = [['hHearts', '❤️❤️❤️❤️❤️'], ['hLevel', '⭐ Lv 1'], ['hGems', '💎 0'], ['hStrike', '⚔️ 5']];
  pills.forEach(([id, txt]) => { if (!$(id)) make('div', { id, class: 'pill', html: txt }, hud, sound); });
  if (!$('hMagic')) make('div', { class: 'pill', html: '<span>🔮</span><div class="bar mg"><i id="hMagic"></i></div><b id="hMagicN">0</b>' }, hud, sound);
  if (!$('hPower')) make('div', { class: 'pill', html: '<span>⚡</span><div class="bar"><i id="hPower"></i></div>' }, hud, sound);
  if (!$('hTokens')) make('button', { id: 'hTokens', class: 'pill tokbtn hidden', 'aria-label': 'Tokens. Tap to top up',
    html: '🪙 <b id="hTokN">0</b> <span class="plus">＋</span>' }, hud, sound);
  if (!$('hTokN')) make('b', { id: 'hTokN', html: '0' }, $('hTokens'));
  if (!$('hBuff')) make('div', { id: 'hBuff', class: 'pill hidden' }, hud, sound);
  if (!$('hNet')) make('div', { id: 'hNet', class: 'pill hidden', title: 'Offline', html: '📴 Offline' }, hud, sound);
  ['enemy', 'toast', 'banner', 'panel', 'overlay', 'video', 'installBar'].forEach(id => {
    if (!$(id)) make('div', { id, class: ['toast', 'panel', 'overlay'].includes(id) ? '' : 'hidden' });
  });
  const tb = $('hTokens');                                   // old pages: give the coin button a basic look
  if (tb && getComputedStyle(tb).pointerEvents === 'none') tb.style.pointerEvents = 'auto';
})();

$('hTokens').onclick = async () => {
  if (!G.account || G.account.status !== 'active') return;
  if (G.screen === 'map') { hush(); await showTopUp(); renderMapCard(); return; }
  if (!$('overlay').classList.contains('hidden')) { toast('Finish this screen first'); return; }
  const wasPanel = G.panelUp; if (wasPanel) { $('panel').className = ''; G.panelUp = false; }
  await showTopUp(); closeOverlay();
  if (wasPanel) { $('panel').className = 'show'; G.panelUp = true; drawSpellBar(G.spellCtx); }
};
$('hSound').onclick = () => { G.sound = !G.sound; $('hSound').textContent = G.sound ? '🔊' : '🔇'; if (!G.sound) hush(); };
async function loadGameData() {
  try {
    const d = await server('getGameData');
    if (canCache()) { try { const c = await caches.open(MEDIA_CACHE); await c.put(mediaCacheUrl('__gamedata'), new Response(JSON.stringify(d))); } catch (e) {} }
    return d;
  } catch (e) {
    if (canCache()) { const r = await caches.match(mediaCacheUrl('__gamedata')); if (r) { G.offlineStart = true; return r.json(); } }
    throw e;
  }
}
async function boot() {
  initThree();
  try {
    G.data = await loadGameData();
  } catch (e) {
    const blocked = IS_PWA && G.serverBlocked;
    overlay(`<div class="card">${LOGO_HTML()}
      <h2>${blocked ? 'The game server is not answering' : isOfflineError(e) ? 'Connect to the internet once' : "The game data didn't load"}</h2>
      <p>${blocked ? 'Please try again in a moment. If this keeps happening, tell the Maalam PH team.'
        : isOfflineError(e) ? 'The first time, Maalam PH needs the internet to download the game. After that, it can play offline.'
        : 'Run initializeSheet in Apps Script once, then open the game again.'}</p>
      ${blocked ? `<details class="small" style="text-align:left"><summary>For the owner</summary>
        <p class="small">The browser was blocked by the Apps Script link (CORS). In Apps Script: run <b>checkSetup</b> and allow
        the permissions, then <b>Deploy → Manage deployments → ✏️ Edit → New version → Deploy</b> with
        <b>Execute as: Me</b> and <b>Who has access: Anyone</b>. This link must then show {"ok":true…}:</p>
        <p class="small"><a href="${API_URL}?ping=1" target="_blank" rel="noopener">Open the server check</a></p></details>` : ''}
      <p style="font-size:15px;opacity:.7">${esc(errText(e))}</p>
      <div class="row"><button class="toy big" onclick="location.reload()">Try again</button></div></div>`);
    return;
  }
  G.cfg = Object.fromEntries(G.data.config.map(r => [r.key, r.value]));
  G.media = G.data.media || {};
  G.voiceRate = +G.cfg.voiceRate || .85;
  G.data.levels.sort((a, b) => a.minPower - b.minPower);
  buildWorld(sortedScenes()[0], true); G.camMode = 'orbit';
  if (IS_PWA) setupPwaUi();
  const token = store.get('maalam_session');
  if (token) {
    G.session = token;
    await flushOutbox();                                   // send offline progress before loading the server copy
    try { const r = await server('getAccount', token); await afterAuth(r); await checkPendingOnBoot(); return; }
    catch (e) {
      if (isOfflineError(e)) {
        const b = JSON.parse(store.get('maalam_bundle') || 'null');
        if (b && b.session === token && b.account) {
          G.player = b.player ? normalizePlayer(b.player) : null;
          await afterAuth({ session: token, account: b.account, player: b.player, payments: [], offline: true });
          toast('📴 Playing offline. Progress will sync later.', 3500);
          return;
        }
      }
      G.session = null; store.del('maalam_session');
    }
  }
  showAuth('signin', G.offlineStart ? 'You are offline. Sign in needs the internet.' : '');
}

/* ---------------- installable app extras: install banner, offline badge, offline download ---------------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; showInstallBanner(); });
window.addEventListener('appinstalled', () => { hideInstallBanner(); deferredInstall = null; toast('🎉 Maalam PH is installed!'); });
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function showInstallBanner() {
  if (!IS_PWA || isStandalone()) return;
  const snoozed = +store.get('maalam_install_snooze') || 0;
  if (Date.now() < snoozed) return;
  const bar = $('installBar'); if (!bar) return;
  const ios = isIOS() && !deferredInstall;
  if (!deferredInstall && !ios) return;              // browser cannot install (yet)
  bar.innerHTML = `<img src="icons/icon-96.png" alt="" width="48" height="48">
    <div class="ib-text"><b>Install Maalam PH</b><span>${ios
      ? 'Tap <b>Share</b> <span aria-hidden="true">⬆️</span> then <b>Add to Home Screen</b>.'
      : 'Play like an app, even without internet.'}</span></div>
    ${ios ? '' : '<button class="toy big ib-go" id="ibGo">Install</button>'}
    <button class="ib-x" id="ibX" aria-label="Not now">✕</button>`;
  bar.classList.remove('hidden');
  if ($('ibGo')) $('ibGo').onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const r = await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null; hideInstallBanner();
    if (!r || r.outcome !== 'accepted') store.set('maalam_install_snooze', String(Date.now() + 3 * 864e5));
  };
  $('ibX').onclick = () => { store.set('maalam_install_snooze', String(Date.now() + 7 * 864e5)); hideInstallBanner(); };
}
function hideInstallBanner() { const bar = $('installBar'); if (bar) bar.classList.add('hidden'); }
function updateNetBadge() { const b = $('hNet'); if (b) b.classList.toggle('hidden', navigator.onLine); }
function setupPwaUi() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  window.addEventListener('online', () => { updateNetBadge(); toast('📶 Back online'); flushOutbox(); });
  window.addEventListener('offline', () => { updateNetBadge(); toast('📴 Offline — you can keep playing', 3000); });
  updateNetBadge();
  setTimeout(showInstallBanner, 2500);               // iPhone has no install event, so show the tip after a moment
}
/** Downloads every picture and voice clip this family can use, so the whole game works offline. */
async function downloadForOffline() {
  if (!canCache()) { toast('This browser cannot save the game for offline use.', 3500); return; }
  if (!navigator.onLine) { toast('📶 Connect to the internet to download.', 3000); return; }
  const owned = (G.account && G.account.books) || [];
  const keys = Object.keys(G.media).filter(k => G.media[k].kind !== 'video' &&
    (!k.startsWith('story:') || k.endsWith(':cover') || owned.includes(k.split(':')[1])));
  const missing = [];
  for (const k of keys) if (!(await cacheGet(k))) missing.push(k);
  let done = keys.length - missing.length, stop = false;
  const draw = () => overlay(`<div class="card"><div class="hero-emoji">📥</div><h2>Download for offline</h2>
    <p>Saving pictures and voices on this ${isIOS() ? 'iPhone' : 'device'}…</p>
    <div class="bar wide"><i style="width:${Math.round(done / Math.max(1, keys.length) * 100)}%"></i></div>
    <p><b>${done}</b> of <b>${keys.length}</b></p>
    <div class="row"><button class="toy tool" id="dlStop">${done >= keys.length ? 'Done ✔' : 'Stop'}</button></div></div>`);
  draw();
  const bind = () => { $('dlStop').onclick = () => { stop = true; }; };
  bind();
  for (let i = 0; i < missing.length && !stop; i += 12) {
    const batch = missing.slice(i, i + 12);
    try {
      const got = await server('getMediaBatch', batch, G.session);
      for (const k of Object.keys(got)) await cachePut(k, b64Blob(got[k].b64, got[k].mime));
      done += batch.length;
    } catch (e) { toast(errText(e), 3500); break; }
    draw(); bind();
  }
  for (const id of owned) {                          // story book text for offline reading
    if (stop || store.get('maalam_pages_' + id)) continue;
    try { store.set('maalam_pages_' + id, JSON.stringify(await callAuthed('getStoryPages', id))); } catch (e) { break; }
  }
  if (!stop) { store.set('maalam_offline_ready', String(Date.now())); SFX.level(); toast('✅ Ready to play offline!', 3500); }
  if ($('dlStop')) await new Promise(r => { $('dlStop').textContent = 'Done ✔'; $('dlStop').onclick = r; });
}
boot();
