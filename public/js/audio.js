// The table's sound on this screen: one music track and a few ambience layers, as the DM set them.
// Short loops are decoded whole and looped seamlessly; big files (the DM's own long tracks) stream.
// Everyone starts a loop at the same point: how long ago the DM started it, round the loop.
const BIG = 12 * 1024 * 1024;   // bytes: bigger files stream instead of being decoded whole
const FADE = { music: 2.5, amb: 2 }; // seconds to fade in, out, or across

export function createSound({ onState } = {}) {
  let ac = null, master = null, previewNode = null;
  const buses = {}, layers = new Map(), buffers = new Map();
  let want = { music: null, amb: [] }, skew = 0;
  const levels = { master: 1, music: 1, amb: 1, sfx: 1, mute: false };
  const spatial = new Map(); // loops coming from things on the map: key → { gain, panner, src }

  function ctx() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain(); master.connect(ac.destination);
    for (const b of ['music', 'amb', 'preview', 'sfx']) { buses[b] = ac.createGain(); buses[b].connect(master); }
    ac.onstatechange = report;
    applyLevels();
    return ac;
  }
  function applyLevels() {
    if (!ac) return;
    const t = ac.currentTime;
    master.gain.setTargetAtTime(levels.mute ? 0 : levels.master, t, 0.05);
    buses.music.gain.setTargetAtTime(levels.music, t, 0.05);
    buses.amb.gain.setTargetAtTime(levels.amb, t, 0.05);
    buses.sfx.gain.setTargetAtTime(levels.sfx == null ? 1 : levels.sfx, t, 0.05);
  }
  const wanted = () => !!(want.music || want.amb.length);
  // blocked: the browser won't play sound until this person clicks something
  function report() { if (onState) onState({ blocked: !!ac && ac.state !== 'running' && wanted(), playing: wanted() }); }

  // a decoded loop, or null when the file is too big to decode (then it streams)
  function load(url) {
    if (!buffers.has(url)) buffers.set(url, (async () => {
      const ctl = new AbortController();
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('Could not load ' + url);
      if (Number(res.headers.get('content-length') || 0) > BIG) { ctl.abort(); return null; }
      return await ctx().decodeAudioData(await res.arrayBuffer());
    })().catch((e) => { buffers.delete(url); throw e; }));
    return buffers.get(url);
  }
  const offsetIn = (at, dur) => (dur > 0 ? (((Date.now() + skew - at) / 1000) % dur + dur) % dur : 0);

  async function start(key, item, bus) {
    const c = ctx(); if (!c) return;
    const L = { id: item.id, url: item.url, bus, gain: c.createGain(), vol: item.vol, stopped: false };
    L.gain.gain.value = 0; L.gain.connect(buses[bus]);
    layers.set(key, L);
    let buf;
    try { buf = await load(item.url); } catch (e) { console.warn(e); layers.delete(key); L.gain.disconnect(); return; }
    if (L.stopped) return;
    if (buf) {
      L.src = c.createBufferSource(); L.src.buffer = buf; L.src.loop = true; L.src.connect(L.gain);
      L.src.start(0, offsetIn(item.at, buf.duration));
    } else { // stream it
      const el = new Audio(); el.preload = 'auto'; el.loop = true; el.src = item.url; L.el = el;
      c.createMediaElementSource(el).connect(L.gain);
      el.addEventListener('loadedmetadata', () => { try { el.currentTime = offsetIn(item.at, el.duration); } catch { /* not seekable yet */ } el.play().catch(() => {}); }, { once: true });
    }
    L.gain.gain.setTargetAtTime(L.vol, c.currentTime, FADE[bus] / 3);
  }
  function stop(key) {
    const L = layers.get(key); if (!L) return;
    layers.delete(key); L.stopped = true;
    if (!ac) return;
    L.gain.gain.cancelScheduledValues(ac.currentTime);
    L.gain.gain.setTargetAtTime(0, ac.currentTime, FADE[L.bus] / 3);
    setTimeout(() => { try { L.src && L.src.stop(); } catch { /* never started */ } if (L.el) { L.el.pause(); L.el.removeAttribute('src'); L.el.load(); } L.gain.disconnect(); }, FADE[L.bus] * 1000 + 400);
  }
  function sync() {
    const desired = new Map();
    if (want.music) desired.set('music:' + want.music.id + '@' + want.music.at, ['music', want.music]);
    for (const a of want.amb) desired.set('amb:' + a.id + '@' + a.at, ['amb', a]);
    for (const k of [...layers.keys()]) if (!desired.has(k)) stop(k);
    for (const [k, [bus, item]] of desired) {
      const L = layers.get(k);
      if (!L) start(k, item, bus);
      else if (L.vol !== item.vol) { L.vol = item.vol; if (ac) L.gain.gain.setTargetAtTime(item.vol, ac.currentTime, 0.12); }
    }
    report();
  }

  // ---------- sound effects and sounds from the map ----------
  const SFX = (name) => '/audio/sfx/' + name + '.mp3';
  function effect(name, { vol = 1, pan = 0, rate = 1, delay = 0 } = {}) {
    const c = ctx(); if (!c || c.state !== 'running' || levels.mute) return;
    load(SFX(name)).then((buf) => {
      if (!buf) return;
      const src = c.createBufferSource(), g = c.createGain(), p = c.createStereoPanner();
      src.buffer = buf; src.playbackRate.value = rate; g.gain.value = Math.max(0, Math.min(1.5, vol)); p.pan.value = Math.max(-1, Math.min(1, pan));
      src.connect(g); g.connect(p); p.connect(buses.sfx); src.start(c.currentTime + delay);
      src.onended = () => { g.disconnect(); p.disconnect(); };
    }).catch(() => {});
  }
  // list: [{ key, name, vol, pan }]; loops fade in, follow their volume and pan, and fade out when gone
  function setSpatial(list) {
    const c = ac; if (!c || c.state !== 'running') { for (const k of [...spatial.keys()]) dropSpatial(k); return; }
    const want = new Map(list.map((x) => [x.key, x]));
    for (const k of [...spatial.keys()]) if (!want.has(k)) dropSpatial(k);
    for (const [k, x] of want) {
      let L = spatial.get(k);
      if (!L) {
        L = { gain: c.createGain(), pan: c.createStereoPanner(), stopped: false }; L.gain.gain.value = 0; L.gain.connect(L.pan); L.pan.connect(buses.sfx); spatial.set(k, L);
        load(x.url || SFX(x.name)).then((buf) => { if (L.stopped || !buf) return; L.src = c.createBufferSource(); L.src.buffer = buf; L.src.loop = true; L.src.playbackRate.value = x.rate || 1; L.src.connect(L.gain); L.src.start(0, Math.random() * buf.duration); }).catch(() => {});
      }
      L.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, x.vol)), c.currentTime, 0.25);
      L.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x.pan || 0)), c.currentTime, 0.25);
    }
  }
  function dropSpatial(k) {
    const L = spatial.get(k); if (!L) return; spatial.delete(k); L.stopped = true;
    if (ac) L.gain.gain.setTargetAtTime(0, ac.currentTime, 0.3);
    setTimeout(() => { try { L.src && L.src.stop(); } catch { /* */ } L.gain.disconnect(); L.pan.disconnect(); }, 1500);
  }

  return {
    effect, setSpatial,
    running: () => !!ac && ac.state === 'running',
    // what the DM has playing, and the server's clock when it was sent
    apply(sound, serverNow) {
      if (serverNow) skew = serverNow - Date.now();
      want = { music: sound && sound.music ? sound.music : null, amb: sound && Array.isArray(sound.amb) ? sound.amb : [] };
      if (wanted()) ctx();
      sync();
    },
    setLevels(p) { Object.assign(levels, p); applyLevels(); },
    levels,
    // after a click: the browser lets sound play now
    resume() { const c = ctx(); if (!c) return; if (c.state === 'running') return; c.resume().then(() => { for (const L of layers.values()) if (L.el && L.el.paused) L.el.play().catch(() => {}); report(); }).catch(() => {}); },
    blocked: () => !!ac && ac.state !== 'running' && wanted(),
    // the DM listens to a track on their own screen only (null stops it)
    async preview(url) {
      if (previewNode) { const p = previewNode; previewNode = null; try { p.gain.gain.setTargetAtTime(0, ac.currentTime, 0.2); setTimeout(() => { try { p.src && p.src.stop(); } catch { /* */ } if (p.el) p.el.pause(); p.gain.disconnect(); }, 800); } catch { /* */ } }
      if (!url) return;
      const c = ctx(); if (!c) return; c.resume().catch(() => {});
      const p = { gain: c.createGain(), url }; p.gain.gain.value = 0; p.gain.connect(buses.preview); previewNode = p;
      const buf = await load(url).catch(() => null);
      if (previewNode !== p) return;
      if (buf) { p.src = c.createBufferSource(); p.src.buffer = buf; p.src.loop = true; p.src.connect(p.gain); p.src.start(); }
      else { p.el = new Audio(url); p.el.loop = true; c.createMediaElementSource(p.el).connect(p.gain); p.el.play().catch(() => {}); }
      p.gain.gain.setTargetAtTime(0.8, c.currentTime, 0.2);
    },
    previewing: () => (previewNode ? previewNode.url : null),
    // for tests: what's playing on this screen, and where in each loop
    debug: () => ({ state: ac ? ac.state : 'none', levels: { ...levels }, spatial: [...spatial.keys()], layers: [...layers.entries()].map(([k, L]) => ({ key: k, id: L.id, bus: L.bus, vol: L.vol, gain: L.gain.gain.value, ready: !!(L.src || L.el), pos: L.src ? offsetIn(want.music && want.music.id === L.id ? want.music.at : (want.amb.find((a) => a.id === L.id) || {}).at, L.src.buffer.duration) : L.el ? L.el.currentTime : null })) })
  };
}
