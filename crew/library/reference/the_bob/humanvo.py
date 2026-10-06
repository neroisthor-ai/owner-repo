"""Human-sounding voices: full-precision Kokoro, blended voices, continuous prosody, natural pauses, breaths.
usage: python3 humanvo.py <variant: real|alias> <outdir>"""
import numpy as np, soundfile as sf, json, os, sys, re
from scipy.signal import butter, sosfilt
sys.path.insert(0, '.')
from lines import LINES
from kokoro_onnx import Kokoro
VAR = sys.argv[1]; OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
K = Kokoro('/home/claude/tts/kokoro-v1.0.onnx', '/home/claude/tts/voices_all.npz')
VV = np.load('/home/claude/tts/voices_all.npz')
def blend(spec): return sum(w * VV[n] for n, w in spec).astype(np.float32)
# who -> (blend, lang, base speed)
CAST = {
 'anna':    ([('bf_emma', .62), ('af_heart', .38)], 'en-gb', 1.0),
 'bob':     ([('am_puck', .7), ('am_michael', .3)], 'en-us', 1.04),
 'cofer':   ([('bm_george', .7), ('bm_fable', .3)], 'en-gb', .98),
 'teacher': ([('af_sarah', .5), ('af_heart', .5)], 'en-us', 1.02),
 'orla':    ([('bf_isabella', .7), ('bf_emma', .3)], 'en-gb', .94),
 'anabela': ([('af_bella', .8), ('af_heart', .2)], 'en-us', .97),
 'saba':    ([('af_nicole', .6), ('af_heart', .4)], 'en-us', .93),
}
ALIAS = [('Bob Cofer', 'Bob Carver'), ('Cofer', 'Carver'), ('Dowie', 'Hale'), ('Baden', 'Fenwick')]
def alias(s):
    if VAR != 'alias': return s
    for a, b in ALIAS: s = s.replace(a, b)
    return s
SR = 24000
hp = butter(2, 70 / (SR / 2), 'high', output='sos')
rng = np.random.default_rng(11)
def breath(n):
    x = rng.standard_normal(n); x = sosfilt(butter(2, [500 / (SR / 2), 2600 / (SR / 2)], 'band', output='sos'), x)
    t = np.linspace(0, 1, n); e = np.sin(np.pi * t) ** 1.6 * (0.6 + 0.4 * t); return x * e
def trim(x, th=0.006):
    nz = np.nonzero(np.abs(x) > th)[0]
    if len(nz) == 0: return x
    a = max(0, nz[0] - int(.03 * SR)); b = min(len(x), nz[-1] + int(.08 * SR)); return x[a:b]
def humanize(x):
    """find long gaps (sentence breaks) and put a quiet breath in some of them; small level ride"""
    env = np.convolve(np.abs(x), np.ones(240) / 240, 'same'); quiet = env < 0.004
    out = x.copy(); i = 0; n = len(x); pk = np.abs(x).max() + 1e-9
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]: j += 1
            gap = (j - i) / SR
            if gap > .26 and i > SR * .3 and j < n - SR * .3 and rng.random() < .65:
                L = int(min(gap * .7, .34) * SR); s = j - L - int(.03 * SR)
                if s > i: out[s:s + L] += breath(L) * pk * .045
            i = j
        else: i += 1
    return out
def say(text, who, speed):
    spec, lang, base = CAST[who]
    sp = base * speed
    a, sr = K.create(text, voice=blend(spec), speed=sp, lang=lang, sentence_pause=.34, clause_pause=.07)
    return a
durs = {}
for ln in LINES:
    txt = alias(ln['tts'])
    if ln['id'] == 'all5':
        outs = []
        for who, sp in (('orla', .94), ('anabela', .96), ('saba', .92)):
            outs.append(trim(say(txt, who, sp / CAST[who][2])))
        outs = [np.pad(o, (int(rng.uniform(0, .03) * SR), 0)) for o in outs]; n = max(len(o) for o in outs); s = sum(np.pad(o, (0, n - len(o))) for o in outs) / 2.2
    else:
        # keep the per-line speed intent (slower for weight) but closer to natural pace
        rel = ln['speed'] / {'anna': .9, 'bob': 1.0, 'cofer': .95, 'teacher': 1.0, 'orla': .92, 'anabela': .95, 'saba': .9}[ln['who']]
        s = trim(say(txt, ln['who'], min(1.0, rel) ** 0.6 if rel < 1 else rel))
        s = humanize(s)
    s = sosfilt(hp, s); s = s / (np.sqrt(np.mean(s ** 2)) + 1e-9) * 0.08; s = np.clip(s, -0.98, 0.98)
    sf.write(f"{OUT}/{ln['id']}.wav", s.astype(np.float32), SR); durs[ln['id']] = len(s) / SR
    json.dump(durs, open(f'{OUT}/durs.json', 'w')); print(ln['id'], round(durs[ln['id']], 2), flush=True)
# the opening narration (Dr Anna over the home video)
OPEN = [('n1', "Once upon a time, before all of this, two people met at university."), ('n2', "Over a frisbee, and a dream."), ('n3', "But this isn't their story."),
        ('n4', "Once upon a time, there was a Bob Cofer."), ('n5', "Not the one you know. Well, at least, not yet."), ('n6', "This is him at sixteen.")]
od = {}
for k, txt in OPEN:
    s = trim(say(alias(txt), 'anna', .97 if k != 'n3' else .9)); s = sosfilt(hp, s); s = s / (np.abs(s).max() + 1e-9) * .9
    sf.write(f'{OUT}/vo_{k}.wav', s.astype(np.float32), SR); od[k] = len(s) / SR; print(k, round(od[k], 2), flush=True)
json.dump(od, open(f'{OUT}/open_durs.json', 'w'))
