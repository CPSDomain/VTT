# Builds Tabletop's built-in ambiences and music (public/audio/*.mp3).
#   python3 build/make-audio.py [names…]     needs numpy, scipy, mido, pyloudnorm, ffmpeg, fluidsynth and FluidR3_GM.sf2
# Ambiences: noise shaped in the frequency domain over time (so wind can gust, waves can break and thunder can roll),
# separate left and right channels for real width, and a natural convolution reverb.
# Music: written as MIDI and played on sampled instruments (FluidSynth with the FluidR3 GM soundfont, MIT licence).
# Every clip loops seamlessly: beds are crossfaded, events and reverb tails wrap round to the start.
import numpy as np, subprocess, os, sys, mido, tempfile
import pyloudnorm as pyln
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.io import wavfile

SR = 44100
rng = np.random.default_rng(11)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'audio')
SF = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
LSEC = 45
L = LSEC * SR

def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'bandpass', fs=SR, output='sos'), x)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'lowpass', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'highpass', fs=SR, output='sos'), x)
def rms(x): return np.sqrt(np.mean(np.square(x))) + 1e-12
def norm(x): return x / rms(x)
def band(f, lo, hi):  # a soft band: rolls off below lo and above hi (2nd order)
    a = (f / lo) ** 2; return a / (1 + a) / (1 + (f / hi) ** 2)

def shaped(n, fn, nfft=2048):
    """Noise whose spectrum over time is fn(t, f) (magnitudes); t and f broadcast."""
    hop = nfft // 4; T = n // hop + 5
    t = (np.arange(T) * hop - nfft / 2) / SR
    f = np.fft.rfftfreq(nfft, 1 / SR)
    M = np.broadcast_to(fn(t[:, None], f[None, :]), (T, len(f)))
    fr = np.fft.irfft(M * np.exp(2j * np.pi * rng.random((T, len(f)))), nfft, axis=1) * np.hanning(nfft)
    out = np.zeros(T * hop + nfft)
    for k in range(T): out[k * hop:k * hop + nfft] += fr[k]
    return out[nfft // 2: nfft // 2 + n]

def pair(n, fn, corr=0.3, nfft=2048):  # stereo: two independent noises with the same spectrum, partly blended
    a, b = shaped(n, fn, nfft), shaped(n, fn, nfft)
    return np.stack([a * (1 - corr) + b * corr, b * (1 - corr) + a * corr], 1)

def wander(dur, rate, lo=0.0, hi=1.0):  # a smooth random curve, as a function of time
    k = int(dur * rate) + 4; x = np.arange(k) / rate - 1 / rate
    f = PchipInterpolator(x, rng.uniform(lo, hi, k)); return lambda t: f(np.clip(t, x[0], x[-1]))

def loop_bed(x, fade=4.0):  # x is L + fade long: blend its overhang into its start (equal power for noise)
    F = int(fade * SR); w = np.sin(np.linspace(0, np.pi / 2, F))
    if x.ndim == 2: w = w[:, None]
    y = x[:L].copy(); y[:F] = x[:F] * w + x[L:L + F] * np.cos(np.linspace(0, np.pi / 2, F)).reshape(w.shape)
    return y

def wrap(y):  # fold anything beyond the loop's end back onto its start
    out = y[:L].copy(); k = L
    while k < len(y):
        seg = y[k:k + L]; out[:len(seg)] += seg; k += L
    return out

def panned(snd, pan):  # pan -1..1, equal power
    a = (pan + 1) * np.pi / 4
    return np.stack([snd * np.cos(a), snd * np.sin(a)], 1)

def place(buf, at, snd, gain=1.0, pan=None):  # add a sound at a time, wrapping round the loop
    if snd.ndim == 1: snd = panned(snd, 0 if pan is None else pan)
    i = int(at * SR) % L; snd = snd * gain
    while len(snd):
        j = min(L, i + len(snd)); buf[i:j] += snd[:j - i]; snd = snd[j - i:]; i = 0

def impulse_response(rt, bright=0.5, pre=0.012, er=0.0):
    n = int(rt * 1.3 * SR)
    def fn(t, f):
        rtf = rt * (1 - 0.65 * (1 - bright) * np.clip(f / 6000, 0, 1))
        return np.exp(-6.9 * np.maximum(t, 0) / rtf) / (1 + (f / (3000 + 9000 * bright)) ** 2)
    irs = []
    for _ in range(2):
        x = shaped(n, fn, 1024); x[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
        x = np.r_[np.zeros(int(pre * SR)), x]
        for d in rng.uniform(0.005, 0.04, 6 if er else 0): x[int((pre * 0.4 + d) * SR)] += er * rng.uniform(0.3, 1) * np.abs(x).max()
        irs.append(x / np.sqrt(np.sum(x ** 2)))
    return irs

def reverb(x, rt, wet, bright=0.5, er=0.0):  # x stereo (L,2), loop-aware
    ir = impulse_response(rt, bright, er=er)
    w = np.stack([wrap(fftconvolve(x[:, 0], ir[0]) * 0.8 + fftconvolve(x[:, 1], ir[0]) * 0.2),
                  wrap(fftconvolve(x[:, 1], ir[1]) * 0.8 + fftconvolve(x[:, 0], ir[1]) * 0.2)], 1)
    return x * (1 - wet) + w * (rms(x) / rms(w)) * wet

def master(name, x, title, lufs):
    x = np.asarray(x, float)
    x = x / rms(x) * 0.1
    x *= 10 ** ((lufs - pyln.Meter(SR).integrated_loudness(x)) / 20)
    ceil = 0.85; env = np.abs(x).max(1)  # a gentle peak limiter
    g = np.minimum(1, ceil / (env + 1e-9)); w = int(0.008 * SR)
    g = uniform_filter1d(minimum_filter1d(g, 2 * w, mode='wrap'), w, mode='wrap'); x *= g[:, None]
    path = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-', '-c:a', 'libmp3lame', '-q:a', '2',
                    '-metadata', f'title={title}', '-metadata', 'artist=Tabletop', path], input=(np.clip(x, -1, 1) * 32767).astype('<i2').tobytes(), check=True)
    print(f'wrote {name}  peak-limited {100 * np.mean(g < 0.999):.1f}% of samples', flush=True)

def events(rate, sec=LSEC):
    t, out = rng.exponential(1 / rate), []
    while t < sec: out.append(t); t += rng.exponential(1 / rate)
    return out

# ---------------- ambience parts ----------------
def drop(f0, dur):  # a raindrop tick: short noise burst with a resonance
    n = max(16, int(dur * SR)); s = bp(rng.standard_normal(n), f0 / 1.6, min(f0 * 1.6, 20000)) * np.exp(-np.linspace(0, 7, n))
    return s / (np.abs(s).max() + 1e-9)

def bubble(f0, rise=1.6, tau=0.012, dur=0.07):  # a water drop into water (a rising-pitch bubble ring)
    t = np.arange(int(dur * SR)) / SR; f = f0 * (1 + rise * t / dur)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau) * np.minimum(1, t / 0.0008)
    click = np.zeros_like(s); k = int(0.002 * SR); click[:k] = rng.standard_normal(k) * np.exp(-np.linspace(0, 6, k)) * 0.25
    return s + hp(click, 2000)

def rain_mix(heavy=1.0):
    n = L + 4 * SR; inten = wander(n / SR, 0.12, 0.85, 1.15)
    bed = pair(n, lambda t, f: inten(t) * (band(f, 300, 5500) * (f / 800 + 0.3) ** -0.7 + 1.6 * heavy * band(f, 60, 450) + 0.6 * band(f, 400, 1500)), 0.25)
    bed = loop_bed(norm(bed))
    pat = np.zeros((L, 2)); bank = [drop(np.exp(rng.uniform(np.log(700), np.log(5500))), rng.uniform(0.003, 0.014)) for _ in range(80)]
    for at in events(90 * heavy): place(pat, at, bank[rng.integers(80)], rng.lognormal(-2.6, 0.6), rng.uniform(-0.95, 0.95))
    for at in events(4 * heavy): place(pat, at, bubble(rng.uniform(1400, 3600), dur=0.04, tau=0.008), rng.uniform(0.02, 0.07), rng.uniform(-0.9, 0.9))
    spots = [(rng.uniform(-0.8, 0.8), rng.uniform(700, 1300), rng.uniform(0.6, 1.6)) for _ in range(3)]  # drips off eaves
    for pan, f0, per in spots:
        t = rng.uniform(0, per)
        while t < LSEC: place(pat, t, bubble(f0 * rng.uniform(0.95, 1.05), tau=0.014), rng.uniform(0.05, 0.11), pan); t += per * rng.uniform(0.8, 1.2)
    pat[:, 0] = lp(pat[:, 0], 7000); pat[:, 1] = lp(pat[:, 1], 7000)
    return reverb(bed * 1.0 + pat * (1 / rms(pat)) * 0.6, 1.1, 0.2, 0.45)

def wind_mix(level=1.0, whistle=1.0):
    n = L + 4 * SR; gust = wander(n / SR, 0.11, 0, 1); flutter = wander(n / SR, 1.8, -1, 1)
    G = lambda t: 0.18 + 0.82 * gust(t) ** 1.6 + 0.05 * flutter(t)
    tones = [(380, 1.0), (610, 0.7), (1040, 0.45)]
    def fn(t, f):
        g = G(t)
        base = band(f, 35, 120 + 1100 * g) * (f / 80 + 1) ** -0.35 * g
        howl = sum(a * g ** 3 * np.exp(-0.5 * ((f - f0 * (0.8 + 0.45 * g)) / (f0 / 45)) ** 2) for f0, a in tones) * 1.8 * whistle
        rustle = band(f, 2500, 7000) * 0.05 * g ** 2
        return base + howl + rustle
    x = loop_bed(pair(n, fn, 0.35))
    return reverb(norm(x) * level, 1.4, 0.15, 0.4)

def thunder(kind):
    close = kind == 'close'; dist = kind == 'distant'
    dur = 13 if close else 15; n = dur * SR; t = np.arange(n) / SR
    roll = np.zeros(n); c = 0.25 if close else rng.uniform(0.5, 1.0)  # the roll: a chain of rumbles getting further apart and weaker
    while c < dur - 2:
        w = rng.uniform(0.25, 0.9); a = np.exp(-c / (3.5 if close else 4.5)) * rng.uniform(0.5, 1)
        roll += a * np.exp(-0.5 * ((t - c) / w) ** 2); c += rng.uniform(0.4, 1.6)
    roll = roll / roll.max() * np.minimum(1, t / (0.03 if close else 0.6)) * np.minimum(1, (dur - t) / 2)
    fc0, fc1 = (2200, 220) if close else (500, 160) if not dist else (260, 110)
    fct = lambda tt: fc1 + (fc0 - fc1) * np.exp(-np.maximum(tt, 0) / 1.8)
    rum = pair(n, lambda tt, f: band(f, 22, fct(tt)) * (f / 50 + 1) ** -0.5, 0.4) * roll[:, None]
    rum = norm(rum)
    if close:  # the crack: a burst of sharp ticks tearing across the sky, then the boom
        cr = np.zeros(n)
        for at in np.cumsum(rng.exponential(0.008, 70)):
            k = int(rng.uniform(0.0005, 0.003) * SR); i = int(at * SR)
            if i + k < n: cr[i:i + k] += rng.standard_normal(k) * np.exp(-at / 0.18) * rng.uniform(0.3, 1)
        tear = bp(rng.standard_normal(n), 400, 5000) * np.exp(-t / 0.35) * np.minimum(1, t / 0.01) * 0.5
        boom = lp(rng.standard_normal(n), 140, 4); boom = boom / np.abs(boom).max() * np.exp(-t / 1.4) * np.minimum(1, t / 0.04) * 3
        crack = hp(cr, 250) * 1.4 + tear
        rum = rum + panned(crack / rms(crack[:SR]) * 0.6, 0.2) + panned(boom / rms(boom[:2 * SR]) * 0.9, 0.1)
    return rum * (1.0 if close else 0.55 if not dist else 0.35)

# ---------------- ambiences ----------------
def rain(): return rain_mix(1.0)

def wind(): return wind_mix(1.0)

def thunderstorm():
    x = rain_mix(1.7) * 0.42 + wind_mix(1.0, 0.35) * 0.25
    th = np.zeros((L, 2))
    for at, kind in [(2.0, 'distant'), (11.5, 'close'), (25.0, 'medium'), (35.5, 'distant')]: place(th, at, thunder(kind))
    th = reverb(th, 2.6, 0.35, 0.35)
    return x + th * (0.95 / rms(th))

def campfire():
    n = L + 4 * SR; fl = wander(n / SR, 2.5, 0.55, 1.0); slow = wander(n / SR, 0.2, 0.8, 1.1)
    roar = loop_bed(pair(n, lambda t, f: fl(t) * slow(t) * (band(f, 30, 320) + 0.05 * band(f, 900, 6000) * fl(t) ** 2), 0.5))
    cr = np.zeros((L, 2))
    for at in events(4.5):  # clusters of crackles
        pan = rng.uniform(-0.45, 0.45)
        for k in range(rng.integers(1, 9)):
            d = drop(np.exp(rng.uniform(np.log(1200), np.log(6000))), rng.uniform(0.001, 0.012))
            place(cr, at + abs(rng.normal(0, 0.06)), d, rng.lognormal(-1.2, 0.7), pan + rng.normal(0, 0.05))
    for at in events(0.5):  # pops from sap and knots
        k = int(0.03 * SR); s = bp(rng.standard_normal(k), 250, 1600) * np.exp(-np.linspace(0, 6, k)); s /= np.abs(s).max()
        place(cr, at, s, rng.uniform(0.9, 1.6), rng.uniform(-0.3, 0.3))
    for at in events(0.06):  # a log settling
        k = int(0.25 * SR); s = lp(rng.standard_normal(k), 300) * np.exp(-np.linspace(0, 5, k)); s /= np.abs(s).max()
        place(cr, at, s, 1.2, rng.uniform(-0.2, 0.2))
        for j in range(12): place(cr, at + rng.uniform(0, 0.8), drop(rng.uniform(1500, 5000), 0.006), rng.uniform(0.2, 0.6), rng.uniform(-0.4, 0.4))
    x = norm(roar) + cr * (1 / rms(cr)) * 0.55
    return reverb(x, 0.7, 0.12, 0.6)

def cave():
    n = L + 4 * SR; air = wander(n / SR, 0.08, 0.7, 1.0)
    bed = loop_bed(pair(n, lambda t, f: air(t) * (band(f, 18, 140) + 0.035 * band(f, 250, 1500)), 0.4))
    wet = np.zeros((L, 2))
    spots = [(-0.7, 1150, 2.3), (0.15, 820, 3.9), (0.6, 1500, 5.6), (-0.25, 650, 7.1)]  # water dripping from the same places
    for pan, f0, per in spots:
        t = rng.uniform(0, per)
        while t < LSEC: place(wet, t, bubble(f0 * rng.uniform(0.96, 1.04), rise=rng.uniform(1.2, 2.2), tau=0.016, dur=0.09), rng.uniform(0.6, 1.0), pan); t += per * rng.uniform(0.85, 1.15)
    for at in events(22):  # a trickle somewhere far off
        place(wet, at, bubble(rng.uniform(350, 1100), tau=0.006, dur=0.03), rng.uniform(0.01, 0.04), rng.uniform(-1, 1))
    wet[:, 0] = lp(wet[:, 0], 6000); wet[:, 1] = lp(wet[:, 1], 6000)
    wet = reverb(wet, 3.6, 0.7, 0.3, er=0.6)
    return norm(bed) * 0.8 + wet * (1 / rms(wet)) * 0.7

def wave(sec):
    n = int(sec * SR); t0 = rng.uniform(1.6, 2.4); hit = rng.uniform(0.8, 1.0)
    def A(t):  # swell, break, wash, draw back
        s = np.clip(t / t0, 0, 1) ** 2 * 0.35
        b = np.where(t > t0, np.exp(-(t - t0) / 2.2), 0) * np.minimum(1, np.maximum(t - t0, 0) / 0.25)
        return (s * (t <= t0) + (0.35 + 0.65 * b) * (t > t0) * np.exp(-np.maximum(t - t0 - 3, 0) / 1.5)) * np.minimum(1, (sec - t) / 1.0)
    fc = lambda t: 600 + 6500 * np.where(t > t0, np.exp(-(t - t0) / 1.6), (np.clip(t / t0, 0, 1)) ** 3 * 0.3)
    x = pair(n, lambda t, f: hit * A(t) * band(f, 60, fc(t)) * (f / 300 + 1) ** -0.3, 0.3)
    rattle = np.zeros(n); tt = np.arange(n) / SR
    for at in t0 + 2.5 + rng.exponential(1.0, 260):  # pebbles dragged back by the water
        i = int(at * SR)
        if i < n - 200: k = int(rng.uniform(0.001, 0.004) * SR); rattle[i:i + k] += hp(rng.standard_normal(k), 2500) * rng.uniform(0.2, 1)
    rattle *= np.exp(-np.maximum(tt - t0 - 2.5, 0) / 2)
    return x / rms(x) + panned(rattle / (rms(rattle) + 1e-9) * 0.06, rng.uniform(-0.4, 0.4))

def ocean():
    n = L + 4 * SR; sw = wander(n / SR, 0.1, 0.7, 1.0)
    surf = loop_bed(pair(n, lambda t, f: sw(t) * band(f, 30, 700) * (f / 60 + 1) ** -0.4, 0.3))
    w = np.zeros((L, 2)); t = 0.0
    while t < LSEC:
        sec = rng.uniform(8, 10.5); s = wave(sec); pan = rng.uniform(-0.35, 0.35)
        s = s * np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
        place(w, t, s, rng.uniform(0.75, 1.0)); t += sec * rng.uniform(0.7, 0.85)
    return reverb(norm(surf) * 0.5 + w * (1 / rms(w)), 1.2, 0.12, 0.5)

def chirp(f0, pulses=3):  # one cricket chirp: a few quick pulses of a high tone
    pl, gap = 0.014, 0.032; n = int((pulses * gap + 0.02) * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for k in range(pulses):
        tt = t - k * gap; on = (tt >= 0) & (tt < pl)
        s += np.where(on, np.sin(2 * np.pi * f0 * t) * np.sin(np.pi * np.clip(tt / pl, 0, 1)), 0)
    return s + 0.15 * np.sin(2 * np.pi * 2 * f0 * t) * (s != 0)

def night():
    n = L + 4 * SR; air = wander(n / SR, 0.1, 0.5, 1.0)
    bed = loop_bed(pair(n, lambda t, f: air(t) * (band(f, 40, 400) + 0.08 * band(f, 1500, 5000)), 0.4))
    cr = np.zeros((L, 2))
    for i in range(7):  # crickets, near and far
        f0 = rng.uniform(3900, 5200); per = rng.uniform(0.45, 0.9); pan = rng.uniform(-0.9, 0.9); dist = rng.uniform(0.25, 1.0)
        snd = chirp(f0, int(rng.integers(2, 5))); t = rng.uniform(0, per)
        if dist < 0.6: snd = lp(snd, 4000) * 0.6
        while t < LSEC: place(cr, t, snd, dist * rng.uniform(0.8, 1.0), pan); t += per * rng.uniform(0.95, 1.05)
    owl = np.zeros((L, 2))
    for at in (9.0, 31.0):  # a distant owl
        for k, (d, f) in enumerate([(0.0, 395), (0.55, 380), (0.75, 372), (1.5, 360)]):
            m = int(0.38 * SR); tt = np.arange(m) / SR; ff = f * (1 + 0.04 * np.sin(np.pi * tt / 0.38))
            s = np.sin(2 * np.pi * np.cumsum(ff) / SR) * np.sin(np.pi * tt / 0.38) ** 2
            place(owl, at + d, lp(s + 0.1 * rng.standard_normal(m) * np.sin(np.pi * tt / 0.38), 900), 0.5, -0.5)
    x = norm(bed) * 0.6 + cr * (1 / rms(cr)) * 0.45
    return reverb(x + reverb(owl, 2.2, 0.6, 0.3) * 0.5, 0.9, 0.2, 0.5)

def river():
    n = L + 4 * SR; flow = wander(n / SR, 0.3, 0.8, 1.1)
    bed = loop_bed(pair(n, lambda t, f: flow(t) * (band(f, 80, 2500) * (f / 400 + 1) ** -0.4 + 0.25 * band(f, 2000, 6000)), 0.3))
    bub = np.zeros((L, 2)); bank = [bubble(np.exp(rng.uniform(np.log(300), np.log(2600))), rise=rng.uniform(0.5, 2.5), tau=rng.uniform(0.004, 0.012), dur=0.04) for _ in range(120)]
    for at in events(260): place(bub, at, bank[rng.integers(120)], rng.lognormal(-2.3, 0.6), rng.uniform(-1, 1))
    return reverb(norm(bed) * 0.8 + bub * (1 / rms(bub)) * 0.6, 0.8, 0.15, 0.5)

# ---------------- music ----------------
class Song:
    def __init__(self, bpm, beats): self.bpm, self.beats, self.notes, self.chans = bpm, beats, [], {}
    def chan(self, ch, prog, vol=100, pan=64, rev=60, bank=0): self.chans[ch] = (prog, vol, pan, rev, bank)
    def n(self, ch, at, dur, pitch, vel, human=True):
        if human: at += rng.normal(0, 0.012); vel += rng.integers(-7, 8)
        self.notes.append((ch, max(0, at), dur, int(pitch), int(np.clip(vel, 1, 127))))
    def render(self, name):
        tpb = 480; spb = 60 / self.bpm; tr = mido.MidiTrack(); mid = mido.MidiFile(ticks_per_beat=tpb); mid.tracks.append(tr)
        tr.append(mido.MetaMessage('set_tempo', tempo=int(spb * 1e6)))
        ev = []
        for ch, (prog, vol, pan, rev, bank) in self.chans.items():
            ev += [(0, 0, mido.Message('control_change', channel=ch, control=0, value=bank)), (0, 0, mido.Message('program_change', channel=ch, program=prog)),
                   (0, 0, mido.Message('control_change', channel=ch, control=7, value=vol)), (0, 0, mido.Message('control_change', channel=ch, control=10, value=pan)),
                   (0, 0, mido.Message('control_change', channel=ch, control=91, value=rev)), (0, 0, mido.Message('control_change', channel=ch, control=93, value=0))]
        for ch, at, dur, p, v in self.notes:
            ev.append((int(at * tpb), 2, mido.Message('note_on', channel=ch, note=p, velocity=v)))
            ev.append((int((at + dur) * tpb), 1, mido.Message('note_off', channel=ch, note=p, velocity=0)))
        end = int((self.beats + 7 / spb) * tpb)
        ev.append((end, 3, mido.Message('control_change', channel=15, control=7, value=0)))
        ev.sort(key=lambda e: (e[0], e[1])); last = 0
        for tk, _, m in ev: tr.append(m.copy(time=tk - last)); last = tk
        d = tempfile.mkdtemp(); mp, wp = os.path.join(d, 'a.mid'), os.path.join(d, 'a.wav'); mid.save(mp)
        subprocess.run(['fluidsynth', '-ni', '-q', '-g', '0.35', '-r', str(SR), '-F', wp, '-o', 'synth.reverb.room-size=0.75', '-o', 'synth.reverb.damp=0.4',
                        '-o', 'synth.reverb.width=1', '-o', 'synth.reverb.level=0.8', SF, mp], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        sr, y = wavfile.read(wp); y = y.astype(float) / 32768
        n = int(round(self.beats * spb * SR)); out = y[:n].copy(); tail = y[n:]; out[:len(tail)] += tail[:n]
        return out, n

def music(song, extra=None):
    global L
    y, n = song.render('x'); Lold = L; L = n
    if extra is not None: y = y + extra(n)
    L = Lold; return y

def tavern():  # a jig in D on fiddle and tin whistle, with guitar, bass and bodhran
    s = Song(112 * 3, 32 * 6)  # counted in eighth notes: 6 to a bar
    s.chan(0, 110, 112, 54, 50); s.chan(1, 78, 82, 80, 55); s.chan(2, 24, 100, 40, 45); s.chan(3, 32, 92, 64, 30); s.chan(9, 0, 92, 70, 35)
    A = [[(78, 1), (76, 1), (74, 1), (69, 1), (74, 1), (78, 1)], [(79, 1), (78, 1), (76, 1), (74, 1), (76, 1), (78, 1)],
         [(81, 1), (78, 1), (74, 1), (81, 1), (78, 1), (74, 1)], [(76, 2), (74, 1), (73, 1), (71, 1), (69, 1)],
         [(78, 1), (76, 1), (74, 1), (69, 1), (74, 1), (78, 1)], [(79, 1), (78, 1), (76, 1), (74, 1), (76, 1), (79, 1)],
         [(81, 1), (83, 1), (81, 1), (79, 1), (78, 1), (76, 1)]]
    B = [[(86, 1), (85, 1), (86, 1), (81, 1), (78, 1), (81, 1)], [(83, 1), (81, 1), (79, 1), (78, 1), (76, 1), (74, 1)],
         [(86, 1), (85, 1), (86, 1), (81, 1), (78, 1), (81, 1)], [(83, 2), (81, 1), (79, 1), (78, 1), (76, 1)],
         [(78, 1), (79, 1), (81, 1), (83, 1), (81, 1), (79, 1)], [(78, 1), (76, 1), (74, 1), (76, 1), (78, 1), (79, 1)],
         [(81, 1), (78, 1), (76, 1), (74, 1), (76, 1), (73, 1)]]
    endA1, endA2 = [(74, 3), (69, 1), (71, 1), (73, 1)], [(74, 3), (78, 1), (81, 1), (85, 1)]
    endB1, endB2 = [(74, 3), (81, 1), (83, 1), (85, 1)], [(74, 3), (69, 1), (71, 1), (73, 1)]
    hA = 'D D G D D D A A D D G G D A D D'.split(); hB = 'D D G D D D G A D G D Em D A D D'.split()
    parts = [(A + [endA1], hA, False), (A + [endA2], hA, True), (B + [endB1], hB, True), (B + [endB2], hB, True)]
    V = {'D': [50, 57, 62, 66], 'G': [43, 47, 50, 55, 59, 67], 'A': [45, 52, 57, 61, 64], 'Em': [40, 47, 52, 55, 59, 64]}
    root = {'D': 38, 'G': 43, 'A': 45, 'Em': 40}
    bar = 0
    for tune, harm, whistle in parts:
        for b, notes in enumerate(tune):
            t0 = bar * 6; t = t0
            for p, d in notes:
                acc = 14 if (t - t0) in (0, 3) else 0
                s.n(0, t, d * 0.92, p, 82 + acc)
                if whistle: s.n(1, t + 0.02, d * 0.85, p, 70 + acc)
                t += d
            for h in range(2):  # guitar: down-stroke, up-stroke; bass on the beat; the bodhran's beat and tips
                ch = harm[b * 2 + h]; tb = t0 + h * 3
                for k, p in enumerate(V[ch]): s.n(2, tb + k * 0.06, 2.6, p, 78, human=False)
                for k, p in enumerate(reversed(V[ch][-3:])): s.n(2, tb + 2 + k * 0.05, 0.9, p, 48, human=False)
                s.n(3, tb, 2.5, root[ch], 84)
                s.n(9, tb, 0.5, 64, 104); s.n(9, tb + 1, 0.4, 63, 46); s.n(9, tb + 2, 0.4, 62, 58)
            s.n(9, t0 + 3, 0.5, 54, 40)
            bar += 1
    return music(s)

def exploration():  # travelling music: strings, harp, a flute melody and horns, D dorian
    s = Song(80, 64)
    s.chan(0, 48, 82, 64, 80); s.chan(1, 46, 100, 48, 70); s.chan(2, 73, 96, 76, 75); s.chan(3, 42, 90, 64, 70); s.chan(4, 60, 76, 70, 85)
    C = {'Dm': [50, 57, 62, 65], 'C': [48, 55, 60, 64], 'Bb': [46, 53, 58, 62], 'F': [41, 53, 57, 60, 65], 'G': [43, 50, 55, 59, 62], 'A': [45, 52, 57, 61, 64]}
    prog = 'Dm C Bb C Dm C G A Dm C Bb C Dm F G A'.split()
    for b, ch in enumerate(prog):
        t = b * 4; v = C[ch]
        for p in v[1:]: s.n(0, t, 4.1, p, 58)
        s.n(3, t, 4, v[0] - (12 if v[0] > 47 else 0), 64)
        tones = [x + 12 for x in v[1:]] + [v[1] + 24]
        for k, i in enumerate([0, 1, 2, 3, 2, 1, 2, 3]): s.n(1, t + k * 0.5, 1.5, tones[i], 70 if k % 4 == 0 else 58)
    mel = [[(69, 2), (74, 1), (76, 1)], [(77, 1.5), (76, 0.5), (74, 1), (72, 1)], [(74, 3), (77, 1)], [(76, 2), (79, 2)],
           [(81, 2), (79, 1), (77, 1)], [(81, 1.5), (84, 0.5), (81, 1), (77, 1)], [(79, 1), (83, 1), (86, 1), (83, 1)], [(81, 3), (76, 1)]]
    for b, notes in enumerate(mel):
        t = (b + 8) * 4
        for p, d in notes: s.n(2, t, d * 0.97, p, 76); t += d
    for b, p in enumerate([62, 60, 62, 61]): s.n(4, (b + 12) * 4, 4, p, 52)
    return music(s)

def battle():  # driving strings, taiko and timpani, then a brass melody; D minor, 132 bpm
    s = Song(132, 96)
    s.chan(0, 48, 96, 50, 45); s.chan(1, 42, 110, 64, 40); s.chan(2, 61, 108, 72, 55); s.chan(3, 60, 92, 56, 55)
    s.chan(4, 116, 120, 64, 40); s.chan(5, 47, 116, 70, 45); s.chan(9, 48, 100, 64, 40)
    roots = {'Dm': 38, 'Bb': 34, 'C': 36, 'A': 33}
    prog = 'Dm Dm Bb C Dm Dm Bb A'.split() * 3
    for b, ch in enumerate(prog):
        t = b * 4; r = roots[ch] + 12
        for k, iv in enumerate([0, 0, 12, 0, 0, 10, 0, 7]):
            s.n(1, t + k * 0.5, 0.35, r + iv, 92 if k % 4 == 0 else 74)
            if b >= 8: s.n(0, t + k * 0.5, 0.35, r + iv + 12, 70 if k % 4 == 0 else 58)
        for at, v in [(0, 118), (1.5, 92), (2, 104), (3, 96), (3.5, 110)]: s.n(4, t + at, 0.5, 50, v)
        s.n(5, t, 1, roots[ch], 100); s.n(5, t + 2, 1, roots[ch] + 7, 84)
        s.n(9, t, 1, 36, 96)
        if b % 8 == 0: s.n(9, t, 2, 49, 100)
        if b % 8 == 7:
            for k in range(8): s.n(5, t + 2 + k * 0.25, 0.25, roots[ch], 70 + k * 6); s.n(9, t + 2 + k * 0.25, 0.2, 38, 60 + k * 7)
    mel = [[(62, 1.5), (65, 0.5), (69, 2)], [(69, 1), (67, 1), (65, 1), (64, 1)], [(62, 2), (65, 2)], [(64, 3), (67, 1)],
           [(69, 1.5), (72, 0.5), (74, 2)], [(72, 1), (70, 1), (69, 1), (67, 1)], [(65, 1.5), (67, 0.5), (69, 1), (70, 1)], [(69, 4)]]
    for rep in (1, 2):
        for b, notes in enumerate(mel):
            t = (b + rep * 8) * 4
            for p, d in notes:
                s.n(2, t, d * 0.9, p, 96 if rep == 1 else 110)
                if rep == 2: s.n(3, t, d * 0.9, p - 12, 92)
                t += d
    return music(s)

def dungeon():  # dread: low strings creeping by semitones, a heartbeat on timpani, choir and a distant bell
    s = Song(60, 48)
    s.chan(0, 43, 110, 64, 90); s.chan(1, 42, 100, 50, 95); s.chan(2, 52, 80, 80, 110); s.chan(3, 14, 70, 90, 120); s.chan(4, 47, 100, 64, 80); s.chan(5, 49, 64, 40, 120)
    for b in range(0, 12, 2): s.n(0, b * 4, 8, 38, 72)
    cel = [(50, 8), (51, 4), (50, 4), (48, 8), (51, 4), (49, 4), (50, 8), (46, 4), (45, 4)]
    t = 0
    for p, d in cel: s.n(1, t, d, p, 66); t += d
    for t0, ps in [(16, [62, 65]), (24, [63, 67]), (32, [62, 69]), (40, [61, 64])]:
        for p in ps: s.n(2, t0, 8, p, 50)
    for at, p in [(6, 74), (21, 69), (34, 75), (43, 74)]: s.n(3, at, 6, p, 60)
    for b in range(12): s.n(4, b * 4, 0.4, 38, 58); s.n(4, b * 4 + 0.45, 0.4, 38, 44)
    s.n(5, 32, 16, 81, 34)
    return music(s, lambda n: np.stack([lp(np.random.default_rng(3).standard_normal(n), 70, 4)] * 2, 1) * 0.004)

clips = [('rain', rain, 'Rain', -19), ('wind', wind, 'Wind', -19), ('campfire', campfire, 'Campfire', -19), ('cave', cave, 'Dripping cave', -20),
         ('ocean', ocean, 'Ocean shore', -19), ('thunderstorm', thunderstorm, 'Thunderstorm', -18),
         ('night', night, 'Night (crickets)', -21), ('river', river, 'River', -20),
         ('music-exploration', exploration, 'Exploration', -17), ('music-battle', battle, 'Battle', -16),
         ('music-dungeon', dungeon, 'Dungeon dread', -19), ('music-tavern', tavern, 'Tavern jig', -17)]
only = sys.argv[1:]
for name, fn, title, lufs in clips:
    if only and name not in only: continue
    master(name, fn(), title, lufs)
