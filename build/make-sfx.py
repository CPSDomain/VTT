# Builds Tabletop's sound effects (public/audio/sfx/*.mp3): dice, doors, blows, spells, footsteps, the scene and
# story sounds, and the short loops that come from things on the map (torches, lava).
#   python3 build/make-sfx.py [names…]      needs numpy, scipy, pyloudnorm and ffmpeg
# Everything is synthesised from physical models: impacts as filtered noise bursts exciting resonances, metal and
# glass as inharmonic partials, fire and water as noise and bubbles, all placed in a small natural room.
import numpy as np, subprocess, os, sys
import pyloudnorm as pyln
from scipy.signal import fftconvolve, butter, sosfilt

SR = 44100
rng = np.random.default_rng(7)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'audio', 'sfx')

def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, min(hi, SR / 2 - 100)], 'bandpass', fs=SR, output='sos'), x)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'lowpass', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'highpass', fs=SR, output='sos'), x)
def t_(d): return np.arange(int(d * SR)) / SR
def noise(d): return rng.standard_normal(int(d * SR))
def env(d, a, dec, shape=1.0):  # attack (s) then exponential decay (time constant dec)
    t = t_(d); e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(t - a, 0) / dec)
    return e ** shape
def pad(x, d):  # extend with silence to d seconds
    n = int(d * SR); return np.r_[x, np.zeros(max(0, n - len(x)))][:max(n, len(x))]
def mix(*parts):  # (signal, start seconds, gain)
    n = max(int(s * SR) + len(x) for x, s, g in parts); out = np.zeros(n)
    for x, s, g in parts: i = int(s * SR); out[i:i + len(x)] += x * g
    return out
def resonator(x, f, q):  # a single ringing mode
    return bp(x, f / (1 + 0.5 / q), f * (1 + 0.5 / q), 2)
def partials(d, f0, ratios, decays, amps, jitter=0.0):
    t = t_(d); out = np.zeros(len(t))
    for r, dc, a in zip(ratios, decays, amps):
        f = f0 * r * (1 + rng.normal(0, jitter)); out += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / dc)
    return out
def room(x, rt=0.35, wet=0.18, bright=0.6):  # a small stone or wooden room, in stereo
    n = int(rt * 1.4 * SR); t = np.arange(n) / SR; irs = []
    for _ in range(2):
        ir = rng.standard_normal(n) * np.exp(-6.9 * t / rt); ir = lp(ir, 2500 + 9000 * bright); ir[: int(0.006 * SR)] *= np.linspace(0, 1, int(0.006 * SR))
        irs.append(np.r_[np.zeros(int(0.009 * SR)), ir] / np.sqrt(np.sum(ir ** 2)))
    dry = np.stack([x, x], 1); w = np.stack([fftconvolve(x, irs[0]), fftconvolve(x, irs[1])], 1)[: len(x) + len(irs[0])]
    dry = np.r_[dry, np.zeros((len(w) - len(dry), 2))]
    return dry * (1 - wet) + w * (np.sqrt(np.mean(dry ** 2)) / (np.sqrt(np.mean(w ** 2)) + 1e-9)) * wet
def fade_tail(x, d=0.02):
    n = min(len(x), int(d * SR)); x = x.copy(); x[-n:] *= np.linspace(1, 0, n)[:, None] if x.ndim == 2 else np.linspace(1, 0, n); return x
def trim(x, thr=1e-4):  # drop silence at the end
    a = np.abs(x).max(1) if x.ndim == 2 else np.abs(x); idx = np.where(a > thr * a.max())[0]
    return x[: (idx[-1] + int(0.03 * SR)) if len(idx) else len(x)]

def save(name, x, lufs=-20, loop=False):
    x = np.asarray(x, float)
    if x.ndim == 1: x = np.stack([x, x], 1)
    if not loop: x = fade_tail(trim(x))
    m = pyln.Meter(SR, block_size=min(0.4, len(x) / SR * 0.9))
    try: x *= 10 ** ((lufs - m.integrated_loudness(x)) / 20)
    except Exception: x = x / (np.abs(x).max() + 1e-9) * 0.5
    pk = np.abs(x).max()
    if pk > 0.9: x *= 0.9 / pk
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-', '-c:a', 'libmp3lame', '-q:a', '3', path],
                   input=(np.clip(x, -1, 1) * 32767).astype('<i2').tobytes(), check=True)
    print('wrote', name, f'{len(x) / SR:.2f}s', flush=True)

# ---------------- dice on a wooden table ----------------
def dice_hit(seed):
    r = np.random.default_rng(seed)
    click = hp(noise(0.03), 1800) * env(0.03, 0.0003, 0.004 + r.uniform(0, 0.003))  # resin corner on wood
    body = sum(resonator(noise(0.12), f, 18) * a for f, a in [(r.uniform(2400, 3600), 1.0), (r.uniform(4200, 6200), 0.6), (r.uniform(7000, 9000), 0.35)]) * env(0.12, 0.0005, 0.018)
    table = resonator(noise(0.15), r.uniform(160, 260), 6) * env(0.15, 0.001, 0.03) * 2.5  # the table answers
    x = mix((click, 0, 1.0), (body, 0, 0.9), (table, 0, 0.8))
    return room(x, 0.22, 0.12, 0.8)
def dice_roll():  # a handful of dice rattling across the table
    hits = []
    for k in range(rng.integers(9, 14)): hits.append((dice_hit(100 + k)[:, 0] * 1, 0.05 + k * 0.06 + rng.uniform(0, 0.05), np.exp(-k * 0.18) * rng.uniform(0.5, 1)))
    return room(mix(*hits), 0.25, 0.12)

# ---------------- doors ----------------
def creak(d, f0=95, f1=150, roughness=0.6):
    t = t_(d); f = f0 + (f1 - f0) * (0.5 - 0.5 * np.cos(np.pi * t / d)) + 18 * np.sin(2 * np.pi * 1.3 * t)
    ph = np.cumsum(f / SR); pulses = (np.diff(np.floor(ph), prepend=0) > 0).astype(float)  # stick-slip: a pulse per slip
    pulses *= 1 + roughness * rng.standard_normal(len(t)) * 0.3
    exc = lp(pulses, 6000)
    wood = sum(resonator(exc, fr, q) * a for fr, q, a in [(420, 12, 1), (890, 14, 0.8), (1650, 16, 0.6), (2600, 18, 0.35)])
    e = np.minimum(1, t / 0.08) * np.minimum(1, (d - t) / 0.15) * (0.6 + 0.4 * np.sin(np.pi * t / d))
    return wood * e
def latch():
    c = hp(noise(0.05), 1500) * env(0.05, 0.0002, 0.005)
    ring = partials(0.25, 1850, [1, 2.71, 4.9], [0.06, 0.04, 0.02], [1, 0.5, 0.3]) * 0.4
    return mix((c, 0, 1), (ring, 0.002, 0.5))
def thud(f=85, dec=0.12, d=0.6):
    return lp(noise(d), 400) * env(d, 0.002, dec) * 1.0 + np.sin(2 * np.pi * f * t_(d) * (1 - 0.15 * t_(d))) * env(d, 0.002, dec * 1.3) * 0.9
def door_open():
    return room(mix((latch(), 0, 0.7), (creak(1.1, 90, 160), 0.08, 1.0), (thud(110, 0.05, 0.3), 1.12, 0.25)), 0.5, 0.22, 0.5)
def door_close():
    return room(mix((creak(0.35, 140, 100), 0, 0.5), (thud(80, 0.1), 0.33, 1.4), (latch(), 0.35, 0.8)), 0.55, 0.25, 0.5)

# ---------------- blows ----------------
def swish(d=0.22, lo=500, hi=3500):
    t = t_(d); x = noise(d); fc = lo + (hi - lo) * np.sin(np.pi * t / d) ** 2
    out = np.zeros(len(t)); step = 256
    for i in range(0, len(t), step): seg = x[i:i + step + 512]; out[i:i + step] = bp(seg, fc[i] * 0.7, fc[i] * 1.4)[: len(out[i:i + step])]
    return out * np.sin(np.pi * t / d) ** 1.5
def blow(seed, metal=1.0):
    r = np.random.default_rng(seed)
    impact = lp(noise(0.25), 1800) * env(0.25, 0.001, 0.03) * 1.6 + np.sin(2 * np.pi * 70 * t_(0.25)) * env(0.25, 0.001, 0.06)  # into a body
    f0 = r.uniform(520, 760)
    ring = partials(1.2, f0, [1, 2.32, 2.76, 4.18, 5.4, 7.1], [0.35, 0.22, 0.25, 0.12, 0.1, 0.06], [1, 0.5, 0.7, 0.4, 0.3, 0.2], 0.01)  # steel
    scrape = hp(noise(0.18), 3000) * env(0.18, 0.002, 0.04)
    return room(mix((swish(0.18), 0, 0.35), (impact, 0.16, 1.0), (ring * metal, 0.16, 0.38), (scrape * metal, 0.16, 0.3)), 0.45, 0.2, 0.6)

# ---------------- spells ----------------
def boom(d=1.6, f=55):
    t = t_(d); return lp(noise(d), 260, 4) * env(d, 0.006, 0.35) * 2 + np.sin(2 * np.pi * f * t * (1 - 0.3 * t / d)) * env(d, 0.004, 0.25)
def roar(d=1.4):
    t = t_(d); x = noise(d); out = np.zeros(len(t))
    for i in range(0, len(t), 512): k = i / len(t); out[i:i + 512] = bp(x[i:i + 512 + 256], 120 + 900 * k, 800 + 3500 * k)[: len(out[i:i + 512])]
    return out * np.minimum(1, t / 0.5) * np.exp(-np.maximum(0, t - 0.5) / 0.3)
def crackles(d, rate, lo=1500, hi=7000):
    out = np.zeros(int(d * SR))
    for at in np.cumsum(rng.exponential(1 / rate, int(d * rate * 2))):
        if at >= d - 0.02: break
        k = int(0.006 * SR); c = bp(noise(0.006), lo, hi) * np.exp(-np.linspace(0, 6, k)); i = int(at * SR); out[i:i + k] += c * rng.lognormal(-0.5, 0.6)
    return out
def spell_fire():
    return room(mix((roar(0.7), 0, 0.8), (boom(1.8, 48), 0.62, 1.4), (lp(noise(1.8), 1500) * env(1.8, 0.02, 0.5), 0.62, 0.8), (crackles(1.6, 30), 0.7, 0.5)), 0.9, 0.25, 0.5)
def spell_lightning():
    crack = hp(noise(0.12), 600) * env(0.12, 0.0005, 0.02) * 2.2
    zap = sum(np.sign(np.sin(2 * np.pi * f * t_(0.5))) * a for f, a in [(61, 0.4), (122, 0.25), (183, 0.15)]) * env(0.5, 0.003, 0.12) * 0.35
    rumble = lp(noise(2.4), 160, 4) * (np.minimum(1, t_(2.4) / 0.25) * np.exp(-t_(2.4) / 0.7)) * 3
    return room(mix((crackles(0.3, 140, 2000, 9000), 0, 1.0), (crack, 0.05, 1.0), (zap, 0.05, 0.6), (rumble, 0.12, 1.0)), 1.2, 0.3, 0.6)
def spell_cold():
    shards = np.zeros(int(1.4 * SR))
    for k in range(26):
        f = rng.uniform(2500, 7500); p = partials(0.6, f, [1, 2.4, 3.9], [0.12, 0.07, 0.04], [1, 0.4, 0.2]); i = int(rng.uniform(0.05, 0.6) * SR); shards[i:i + len(p)] += p[: len(shards) - i] * rng.uniform(0.2, 0.7)
    gust = bp(noise(1.4), 2500, 9000) * np.minimum(1, t_(1.4) / 0.15) * np.exp(-t_(1.4) / 0.4)
    return room(mix((gust, 0, 0.6), (shards, 0, 0.8), (hp(noise(0.08), 3000) * env(0.08, 0.001, 0.015), 0.04, 1.0)), 1.4, 0.35, 0.9)
def spell_acid():
    fizz = np.zeros(int(1.6 * SR))
    for at in np.cumsum(rng.exponential(1 / 90, 200)):
        if at > 1.5: break
        b = bubble(rng.uniform(1500, 4500)); i = int(at * SR); fizz[i:i + len(b)] += b[: len(fizz) - i] * rng.uniform(0.1, 0.4)
    hiss = bp(noise(1.6), 3000, 10000) * np.minimum(1, t_(1.6) / 0.05) * np.exp(-t_(1.6) / 0.6)
    return room(mix((swish(0.25, 300, 2000), 0, 0.6), (hiss, 0.2, 0.7), (fizz, 0.2, 0.8)), 0.6, 0.18)
def bubble(f0, rise=1.6, tau=0.012, dur=0.07):
    t = t_(dur); f = f0 * (1 + rise * t / dur); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau)
def spell_necrotic():
    d = 1.8; t = t_(d); x = noise(d)
    rev = lp(x, 900) * (t / d) ** 2 * np.exp(-np.maximum(0, t - 1.4) / 0.08)  # a breath drawn in backwards
    drone = sum(np.sin(2 * np.pi * f * t + 0.3 * np.sin(2 * np.pi * 3.1 * t)) * a for f, a in [(55, 1), (58.3, 0.8), (110.5, 0.4)]) * np.sin(np.pi * t / d) ** 2 * 0.5
    return room(mix((rev, 0, 1.0), (drone, 0, 0.8), (thud(60, 0.15, 0.8), 1.4, 0.8)), 1.5, 0.35, 0.3)
def spell_radiant():
    d = 2.2; t = t_(d); out = np.zeros(len(t))
    for f in [523.25, 659.25, 783.99, 1046.5, 1318.5]:  # a bright chord, swelling like voices
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6)); ph = 2 * np.pi * np.cumsum(f * vib) / SR
        out += (np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)) * np.sin(np.pi * np.minimum(1, t / d * 1.2)) ** 2
    bell = partials(2.2, 1568, [1, 2.76, 5.4], [0.8, 0.4, 0.2], [1, 0.4, 0.2]) * 0.5
    return room(mix((out * 0.25, 0, 1), (bell, 0.25, 0.6)), 2.0, 0.45, 0.9)
def spell_thunder():
    return room(mix((boom(2.4, 40), 0, 1.6), (crackles(0.2, 120, 800, 4000), 0, 0.6), (lp(noise(2.4), 120, 4) * np.exp(-t_(2.4) / 0.9), 0.08, 2.2)), 1.6, 0.35, 0.4)
def spell_poison():
    gas = bp(noise(1.6), 1800, 7000) * np.minimum(1, t_(1.6) / 0.3) * np.exp(-t_(1.6) / 0.7) * (1 + 0.3 * np.sin(2 * np.pi * 6 * t_(1.6)))
    glug = np.zeros(int(1.6 * SR))
    for at in np.cumsum(rng.exponential(1 / 12, 30)):
        if at > 1.3: break
        b = bubble(rng.uniform(250, 700), 1.2, 0.03, 0.12); i = int(at * SR); glug[i:i + len(b)] += b[: len(glug) - i] * rng.uniform(0.3, 0.8)
    return room(mix((gas, 0, 0.8), (glug, 0.1, 0.6)), 0.7, 0.2, 0.4)
def spell_force():
    d = 0.9; t = t_(d); f = 160 * np.exp(-t * 3) + 45
    return room(mix((np.sin(2 * np.pi * np.cumsum(f) / SR) * env(d, 0.004, 0.22), 0, 1.0), (swish(0.3, 300, 1500), 0, 0.5), (lp(noise(d), 500) * env(d, 0.002, 0.08), 0.02, 0.6)), 0.8, 0.25, 0.4)
def spell_psychic():
    d = 1.6; t = t_(d); out = np.zeros(len(t))
    for f, m in [(880, 7), (1320, 11), (1760, 5)]: out += np.sin(2 * np.pi * f * t + 2.5 * np.sin(2 * np.pi * m * t)) * np.sin(np.pi * t / d) ** 2
    return room(out * 0.3, 1.4, 0.45, 0.8)
def heal():
    d = 1.8; out = np.zeros(int(d * SR))
    for k, f in enumerate([783.99, 987.77, 1174.66, 1567.98]):  # a rising arpeggio of chimes
        p = partials(1.4, f, [1, 2.0, 3.01, 4.2], [0.5, 0.3, 0.15, 0.08], [1, 0.35, 0.15, 0.08]); i = int(k * 0.09 * SR); out[i:i + len(p)] += p[: len(out) - i]
    shimmer = bp(noise(d), 5000, 12000) * np.sin(np.pi * t_(d) / d) ** 2 * 0.08
    return room(out * 0.5 + shimmer, 1.6, 0.4, 0.95)
def nat20():
    d = 2.4; out = np.zeros(int(d * SR))
    for k, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        p = partials(1.8, f, [1, 2.0, 3.0, 4.01, 5.02], [0.9, 0.5, 0.3, 0.2, 0.12], [1, 0.45, 0.25, 0.15, 0.08]); i = int(k * 0.07 * SR); out[i:i + len(p)] += p[: len(out) - i]
    return room(mix((out * 0.45, 0, 1), (bp(noise(d), 6000, 14000) * np.exp(-t_(d) / 0.7) * 0.06, 0.2, 1)), 1.8, 0.4, 0.95)
def nat1():
    d = 1.4; t = t_(d); f = 220 * np.exp(-t * 0.9)
    tone = (np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.4 * np.sin(4 * np.pi * np.cumsum(f) / SR)) * env(d, 0.01, 0.45)
    return room(mix((thud(70, 0.12, 0.8), 0, 1.0), (tone * 0.35, 0.05, 1)), 1.0, 0.3, 0.3)

# ---------------- footsteps ----------------
def step_stone(seed):
    r = np.random.default_rng(seed)
    heel = bp(noise(0.1), 900, 5000) * env(0.1, 0.0005, 0.008) + resonator(noise(0.1), r.uniform(1800, 2600), 10) * env(0.1, 0.001, 0.012) * 0.6
    toe = bp(noise(0.06), 1500, 6000) * env(0.06, 0.0005, 0.006) * 0.6
    grit = hp(noise(0.06), 4000) * env(0.06, 0.002, 0.02) * 0.15
    return room(mix((heel, 0, 1), (toe, 0.06 + r.uniform(0, 0.02), 1), (grit, 0.06, 1)), 0.6, 0.25, 0.6)
def step_wood(seed):
    r = np.random.default_rng(seed)
    knock = sum(resonator(noise(0.2), f, 10) * a for f, a in [(r.uniform(180, 240), 1), (r.uniform(420, 560), 0.7), (r.uniform(950, 1200), 0.4)]) * env(0.2, 0.001, 0.035)
    click = bp(noise(0.03), 1500, 5000) * env(0.03, 0.0005, 0.004) * 0.6
    return room(mix((knock, 0, 1.4), (click, 0, 1), (knock * 0.5, 0.07, 1)), 0.4, 0.18, 0.5)
def step_grass(seed):
    r = np.random.default_rng(seed); d = 0.22
    rustle = bp(noise(d), 1800, 8000) * env(d, 0.01, 0.05)
    blades = crackles(d, 120, 3000, 9000) * np.exp(-t_(d) / 0.08)
    soft = lp(noise(d), 300) * env(d, 0.003, 0.03) * 0.8
    return mix((rustle, 0, 0.7), (blades, 0, 0.3), (soft, 0, 1.0))
def step_dirt(seed):
    r = np.random.default_rng(seed); d = 0.25
    crunch = crackles(d, 300, 800, 5000) * env(d, 0.004, 0.05)
    soft = lp(noise(d), 400) * env(d, 0.002, 0.03)
    return room(mix((crunch, 0, 0.9), (soft, 0, 1.0), (crunch * 0.5, 0.05, 1)), 0.3, 0.1)
def step_water(seed):
    r = np.random.default_rng(seed); d = 0.5
    splash = bp(noise(d), 800, 7000) * env(d, 0.004, 0.07)
    bub = np.zeros(int(d * SR))
    for at in np.cumsum(r.exponential(1 / 40, 25)):
        if at > 0.35: break
        b = bubble(r.uniform(500, 1600), 1.4, 0.015, 0.06); i = int(at * SR); bub[i:i + len(b)] += b[: len(bub) - i] * r.uniform(0.2, 0.6)
    return room(mix((splash, 0, 1), (bub, 0.02, 0.6), (lp(noise(d), 350) * env(d, 0.003, 0.05), 0, 0.7)), 0.4, 0.15)

# ---------------- the scene and the story ----------------
def transition():  # a slow breath of wind as the scene changes
    d = 2.4; t = t_(d); x = noise(d); out = np.zeros(len(t))
    for i in range(0, len(t), 512): k = np.sin(np.pi * i / len(t)); out[i:i + 512] = bp(x[i:i + 768], 200 + 500 * k, 900 + 1800 * k)[: len(out[i:i + 512])]
    low = lp(noise(d), 120, 4) * 2
    return room((out + low * 0.5) * np.sin(np.pi * t / d) ** 2, 1.5, 0.35, 0.4)
def page():  # parchment unrolled
    d = 0.9; out = np.zeros(int(d * SR))
    for at in np.cumsum(rng.exponential(1 / 28, 40)):
        if at > 0.75: break
        k = rng.uniform(0.01, 0.05); s = bp(noise(k), rng.uniform(800, 2500), rng.uniform(4000, 9000)) * np.exp(-np.linspace(0, 5, int(k * SR))); i = int(at * SR); out[i:i + len(s)] += s[: len(out) - i] * rng.uniform(0.3, 1)
    slide = bp(noise(d), 1500, 6000) * np.sin(np.pi * t_(d) / d) * 0.25
    return room(out + slide, 0.4, 0.15, 0.6)
def turn():  # a soft bell: your turn
    p = partials(2.0, 659.25, [1, 2.0, 2.98, 4.1, 5.43], [0.9, 0.6, 0.35, 0.2, 0.12], [1, 0.35, 0.2, 0.1, 0.06])
    return room(p, 1.4, 0.35, 0.8)
def quake():
    d = 3.2; t = t_(d)
    rumble = lp(noise(d), 90, 4) * (np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 1.0)) * (1 + 0.5 * np.sin(2 * np.pi * 3.3 * t)) * 4
    debris = crackles(d, 25, 300, 3000) * np.sin(np.pi * t / d)
    return room(mix((rumble, 0, 1), (debris, 0, 0.4)), 0.8, 0.2, 0.3)
def thunderclap():
    return spell_lightning()

def coins(n=14, d=0.9):
    out = np.zeros(int(d * SR))
    for k in range(n):
        at = rng.uniform(0.0, d * 0.6) * (1 - 0.5 * k / n); p = partials(0.25, rng.uniform(2600, 4800), [1, 2.4, 3.9, 5.6], [0.06, 0.04, 0.025, 0.015], [1, 0.6, 0.35, 0.2])
        i = int(at * SR); out[i:i + len(p)] += p[: len(out) - i] * rng.uniform(0.2, 0.7)
    return out
def chest_open():
    hinge = creak(0.55, 160, 260, 0.9) * 0.8
    return room(mix((latch(), 0, 0.6), (hinge, 0.06, 1.0), (thud(95, 0.06, 0.4), 0.6, 0.6), (coins(), 0.62, 0.55)), 0.45, 0.2, 0.6)
def chest_close():
    return room(mix((creak(0.25, 220, 150, 0.9), 0, 0.5), (thud(85, 0.09, 0.6), 0.24, 1.3), (latch(), 0.27, 0.7)), 0.45, 0.2, 0.5)
def trap():
    click = hp(noise(0.05), 2000) * env(0.05, 0.0003, 0.004)
    snap = partials(0.6, 900, [1, 2.71, 4.3, 6.1], [0.12, 0.08, 0.05, 0.03], [1, 0.6, 0.4, 0.2]) * 0.6
    stabs = np.zeros(int(0.5 * SR))
    for k in range(5):
        st = mix((bp(noise(0.06), 1200, 6000) * env(0.06, 0.0005, 0.012), 0, 1), (partials(0.3, rng.uniform(1300, 1900), [1, 2.4, 3.8], [0.08, 0.05, 0.03], [1, 0.4, 0.2]), 0, 0.3))
        i = int((0.02 + k * 0.025) * SR); stabs[i:i + len(st)] += st[: len(stabs) - i]
    return room(mix((click, 0, 1.0), (swish(0.12, 800, 4000), 0.04, 0.6), (stabs, 0.12, 1.2), (snap, 0.12, 0.7), (thud(70, 0.1, 0.5), 0.12, 0.8)), 0.5, 0.22, 0.6)

# ---------------- loops from things on the map ----------------
def loopify(x, fade=1.0):  # crossfade the end into the start
    n = int(fade * SR); x = x.copy(); a = np.linspace(0, 1, n)[:, None] if x.ndim == 2 else np.linspace(0, 1, n)
    x[:n] = x[:n] * np.sqrt(a) + x[-n:] * np.sqrt(1 - a); return x[:-n]
def torch_loop():
    d = 13; t = t_(d); fl = np.interp(t, np.linspace(0, d, 60), rng.uniform(0.6, 1.0, 60))
    body = lp(noise(d), 280) * fl * 0.6 + bp(noise(d), 600, 3000) * fl ** 2 * 0.06
    x = body + crackles(d, 9, 1200, 6500) * 0.9
    st = room(x, 0.5, 0.12, 0.6)[: int(d * SR)]
    return loopify(st, 1.0)
def lava_loop():
    d = 15; t = t_(d)
    bed = lp(noise(d), 140, 4) * (0.8 + 0.2 * np.sin(2 * np.pi * 0.13 * t)) * 1.5
    gl = np.zeros(int(d * SR))
    for at in np.cumsum(rng.exponential(1 / 2.2, 80)):
        if at > d - 0.5: break
        b = bubble(rng.uniform(80, 200), 0.8, rng.uniform(0.05, 0.12), 0.35); i = int(at * SR); gl[i:i + len(b)] += lp(b, 900)[: len(gl) - i] * rng.uniform(0.4, 1)
        if rng.random() < 0.4: s = crackles(0.2, 60, 1500, 5000) * 0.3; gl[i:i + len(s)] += s[: len(gl) - i]
    st = room(bed + gl * 0.9, 0.9, 0.2, 0.3)[: int(d * SR)]
    return loopify(st, 1.0)

SFX = [('dice-' + str(k), lambda k=k: dice_hit(k), -24) for k in range(1, 5)] + [
    ('dice-roll', dice_roll, -22),
    ('door-open', door_open, -22), ('door-close', door_close, -21),
    ('hit-1', lambda: blow(1), -19), ('hit-2', lambda: blow(2, 0.6), -19), ('hit-3', lambda: blow(3, 0.25), -19),
    ('spell-fire', spell_fire, -17), ('spell-lightning', spell_lightning, -17), ('spell-cold', spell_cold, -19), ('spell-acid', spell_acid, -20),
    ('spell-necrotic', spell_necrotic, -19), ('spell-radiant', spell_radiant, -20), ('spell-thunder', spell_thunder, -16), ('spell-poison', spell_poison, -20),
    ('spell-force', spell_force, -18), ('spell-psychic', spell_psychic, -21), ('heal', heal, -21),
    ('nat20', nat20, -19), ('nat1', nat1, -20),
    *[(f'step-{kind}-{k}', (lambda f=f, k=k: f(k)), lv) for kind, f, lv in [('stone', step_stone, -27), ('wood', step_wood, -26), ('grass', step_grass, -29), ('dirt', step_dirt, -28), ('water', step_water, -26)] for k in (1, 2, 3)],
    ('chest-open', chest_open, -22), ('chest-close', chest_close, -22), ('trap', trap, -18),
    ('transition', transition, -24), ('page', page, -24), ('turn', turn, -24), ('quake', quake, -18), ('thunderclap', thunderclap, -16),
]
LOOPS = [('loop-torch', torch_loop, -24), ('loop-lava', lava_loop, -23)]
only = sys.argv[1:]
for name, fn, lufs in SFX:
    if not only or name in only: save(name, fn(), lufs)
for name, fn, lufs in LOOPS:
    if not only or name in only: save(name, fn(), lufs, loop=True)
