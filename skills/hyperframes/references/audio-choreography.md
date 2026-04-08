# Beat Choreography

Sync animation to music structure. The audio analysis gives you timestamps and energy data. This reference teaches you how to think about that data — not as a list of triggers, but as a story with setup, tension, and payoff.

## Every Line in the Analysis Must Produce a Visual Reaction

This is non-negotiable. The audio analysis is a script. Every section, every line must have a corresponding visual response in the composition:

- **STRUCTURE**: Every phase boundary is a visual gear change — palette shift, scale change, density change. If structure says HIGH at 7s, the composition must look and feel measurably different at 7s than at 6s.
- **KEY MOMENTS**: Every surge gets a build sequence before it (compress → hold → release). Every drop gets a visual exhale. No key moment should pass without the viewer SEEING it happen.
- **SILENCES**: Every silence is a breath — strip to near-black, hold, let the viewer absorb.
- **BUILDS**: Every detected build must have visual tension rising in sync — gradient compressing, density accelerating, scale shrinking toward the peak. The build section tells you EXACTLY where to start the visual tension and where it peaks.
- **ACCENT PATTERNS**: Every detected accent train or roll gets a matching rapid-fire visual — stagger cascade, per-character reveal, or pulse sequence at the same rate.
- **BEATS**: Every beat is an opportunity. You don't have to use every beat for a content reveal, but the composition should acknowledge beats through SOMETHING — a content entrance, an exit, a pulse on a decorative element, a scale bump, a flash. Beats that pass with zero visual response are wasted sync opportunities.

Read the analysis top to bottom before writing any code. Plan what happens at each structural moment FIRST, then fill in the beats between them.

## Analyze the Audio

Run this to extract the structure. Replace `audio.mp3` with your file.

```bash
python3 << 'EOF'
import subprocess, math, array

path = 'audio.mp3'
sr = 22050
dur = float(subprocess.run(['ffprobe','-v','quiet','-show_entries','format=duration','-of','csv=p=0',path], capture_output=True, text=True).stdout.strip())

# 7-band analysis
band_defs = [("sub",20,60),("bass",60,250),("low_mid",250,500),("mid",500,2000),("upper_mid",2000,4000),("high",4000,8000),("air",8000,16000)]
quarter = int(sr * 0.25)
band_curves = {}
for name,lo,hi in band_defs:
    filt = f"lowpass=f={hi}" if name=="sub" else (f"highpass=f={lo}" if name=="air" else f"highpass=f={lo},lowpass=f={hi}")
    p2 = subprocess.run(['ffmpeg','-i',path,'-af',filt,'-ac','1','-ar',str(sr),'-f','s16le','-'], capture_output=True)
    bp = array.array('h', p2.stdout)
    vals = [math.sqrt(sum(x*x for x in bp[s:s+quarter])/max(len(bp[s:s+quarter]),1)) if len(bp[s:s+quarter])>50 else 0 for s in range(0,len(bp)-quarter,quarter)]
    bmx = max(vals) if max(vals)>0 else 1
    band_curves[name] = [v/bmx for v in vals]

# Broadband
p = subprocess.run(['ffmpeg','-i',path,'-ac','1','-ar',str(sr),'-f','s16le','-'], capture_output=True)
pcm = array.array('h', p.stdout)
broad = [math.sqrt(sum(x*x for x in pcm[s:s+quarter])/max(len(pcm[s:s+quarter]),1)) if len(pcm[s:s+quarter])>50 else 0 for s in range(0,len(pcm)-quarter,quarter)]
bmx = max(broad) if broad else 1
broad_n = [v/bmx for v in broad]

# 1s energy for structure
rms_1s = [math.sqrt(sum(x*x for x in pcm[s*sr:min((s+1)*sr,len(pcm))])/max(len(pcm[s*sr:min((s+1)*sr,len(pcm))]),1)) if len(pcm[s*sr:min((s+1)*sr,len(pcm))])>100 else 0 for s in range(int(dur))]
mx1 = max(rms_1s) if rms_1s else 1
norms = [r/mx1 for r in rms_1s]

# Phases
phases = []; cur,cs = None,0
for i,n in enumerate(norms):
    l = "VOID" if n<0.2 else ("LOW" if n<0.4 else ("MEDIUM" if n<0.65 else "HIGH"))
    if l!=cur:
        if cur: phases.append((cs,i,cur))
        cur,cs = l,i
if cur: phases.append((cs,len(norms),cur))

# Character at timestamp
def char_at(t):
    idx = min(int(t/0.25), len(broad_n)-1)
    v = {n: (band_curves[n][idx] if idx<len(band_curves[n]) else 0) for n,_,_ in band_defs}
    parts = []
    if v["sub"]>0.7: parts.append("sub")
    if v["bass"]>0.6: parts.append("bass")
    if v["low_mid"]>0.5: parts.append("warm")
    if v["mid"]>0.5: parts.append("vocal/melody")
    if v["upper_mid"]>0.5: parts.append("presence")
    if v["high"]>0.5: parts.append("bright")
    if v["air"]>0.4: parts.append("airy")
    if not parts: parts.append("thin" if any(x>0.2 for x in v.values()) else "silence")
    has_bot = v["sub"]>0.5 or v["bass"]>0.5
    has_top = v["high"]>0.5 or v["air"]>0.4
    has_mid = v["mid"]>0.4 or v["upper_mid"]>0.4
    feel = "full" if has_bot and has_top and has_mid else ("heavy" if has_bot and not has_top else ("bright" if has_top and not has_bot else ("intimate" if has_mid else ("scooped" if has_bot and has_top else "sparse"))))
    return ", ".join(parts), feel

# Onsets — sensitive then deduplicate
blk = 512
ef = [math.sqrt(sum(x*x for x in pcm[i:i+blk])/blk) for i in range(0,len(pcm)-blk,blk)]
mu=sum(ef)/len(ef); sig=math.sqrt(sum((x-mu)**2 for x in ef)/len(ef))
raw_ons = []
for i,e in enumerate(ef):
    if e > mu+1.0*sig and (not raw_ons or i-raw_ons[-1]>3): raw_ons.append(i)
raw_beats = [(i*blk/sr, ef[i]) for i in raw_ons]
beats = []; i = 0
while i < len(raw_beats):
    t,a = raw_beats[i]
    if i+1<len(raw_beats) and raw_beats[i+1][0]-t < 0.15:
        beats.append(raw_beats[i] if a>=raw_beats[i+1][1] else raw_beats[i+1]); i += 2
    else: beats.append(raw_beats[i]); i += 1
moa = max(a for _,a in beats) if beats else 1
iois = [beats[i+1][0]-beats[i][0] for i in range(len(beats)-1)] if len(beats)>4 else []
bpm = round(60/sorted(iois)[len(iois)//2],1) if iois else None

# Silences
sp=subprocess.run(['ffmpeg','-i',path,'-af','silencedetect=n=-35dB:d=0.5','-f','null','-'],capture_output=True,text=True)
sils=[]
for line in sp.stderr.split('\n'):
    if 'silence_start' in line:
        try: sils.append(('s',float(line.split('silence_start: ')[1].strip())))
        except: pass
    elif 'silence_end' in line:
        try: sils.append(('e',float(line.split('silence_end: ')[1].split('|')[0].strip())))
        except: pass

# Output
print(f"AUDIO ANALYSIS — {dur:.1f}s\n{'='*60}\n")
print(f"RHYTHM — {bpm} BPM, {len(beats)} beats")
print(f"\nSTRUCTURE")
for s,e,l in phases:
    bd, feel = char_at((s+e)/2)
    print(f"  {s:3d}-{e:3d}s  {l:6s}  {feel:8s}  ({bd})")
print(f"\nKEY MOMENTS")
mom=[(i,norms[i]-norms[i-1]) for i in range(1,len(norms)) if abs(norms[i]-norms[i-1])>0.12]
for s,d in sorted(mom,key=lambda x:abs(x[1]),reverse=True)[:8]:
    print(f"  {s:3d}s  {'DROP' if d<0 else 'SURGE'}  Δ{d:+.2f}")
if sils:
    print(f"\nSILENCES")
    i=0
    while i<len(sils):
        if sils[i][0]=='s':
            s=sils[i][1]; e=sils[i+1][1] if i+1<len(sils) and sils[i+1][0]=='e' else s+1
            print(f"  {s:.1f}s - {e:.1f}s"); i+=2
        else: i+=1
# Build detection — gradual rises ending in sharp drops
print(f"\nBUILDS (suspense → release)")
half = int(sr * 0.5)
all_bands = {"broadband": broad_n}
for name,lo,hi in band_defs:
    filt = f"lowpass=f={hi}" if name=="sub" else (f"highpass=f={lo}" if name=="air" else f"highpass=f={lo},lowpass=f={hi}")
    p3 = subprocess.run(['ffmpeg','-i',path,'-af',filt,'-ac','1','-ar',str(sr),'-f','s16le','-'], capture_output=True)
    bp3 = array.array('h', p3.stdout)
    hv = [math.sqrt(sum(x*x for x in bp3[s:s+half])/max(len(bp3[s:s+half]),1)) if len(bp3[s:s+half])>50 else 0 for s in range(0,len(bp3)-half,half)]
    hmx = max(hv) if max(hv)>0 else 1
    all_bands[name] = [v/hmx for v in hv]

builds = []
for bname, curve in all_bands.items():
    i = 0
    while i < len(curve) - 3:
        start = i
        while i < len(curve)-1 and curve[i+1] >= curve[i]-0.05: i += 1
        peak_idx = i; duration = (peak_idx-start)*0.5
        if duration >= 1.5 and peak_idx < len(curve)-1:
            drop = curve[peak_idx] - curve[min(peak_idx+2, len(curve)-1)]
            rise = curve[peak_idx] - curve[start]
            score = duration * rise * drop
            if score > 0.2:
                builds.append((start*0.5, peak_idx*0.5, duration, bname, rise, drop, curve[peak_idx], score))
        i += 1

# Deduplicate by peak time (within 2s), keep highest score
builds.sort(key=lambda x: x[7], reverse=True)
seen = set()
for b in builds:
    peak_key = round(b[1] / 2) * 2
    if peak_key not in seen:
        seen.add(peak_key)
        print(f"  {b[0]:5.1f}s → {b[1]:5.1f}s  {b[2]:.1f}s build in {b[3]}, rises {b[4]:+.2f} → {b[6]:.2f}, drops {b[5]:.2f}")

# Accent pattern detection (mid-to-high range rhythmic trains)
print(f"\nACCENT PATTERNS")
for filt_label, filt_str in [("upper_mid+high","highpass=f=2000,lowpass=f=8000"),("high+air","highpass=f=4000")]:
    pa = subprocess.run(['ffmpeg','-i',path,'-af',filt_str,'-ac','1','-ar',str(sr),'-f','s16le','-'], capture_output=True)
    ap = array.array('h', pa.stdout)
    ablk = int(sr*0.03)
    ae = [math.sqrt(sum(x*x for x in ap[s:s+ablk])/ablk) for s in range(0,len(ap)-ablk,ablk)]
    amx = max(ae) if ae else 1
    an = [e/amx for e in ae]
    aw = 15
    at = []
    for ai in range(aw, len(an)-aw):
        la = sum(an[max(0,ai-aw):ai+aw]) / min(2*aw, ai+aw-max(0,ai-aw))
        if an[ai] > la+0.15 and an[ai] > 0.25:
            tt = round(ai*0.03, 2)
            if not at or tt-at[-1][0] > 0.06: at.append((tt, an[ai]))
    # Find regular sequences
    pats = []
    for si in range(len(at)):
        for ln in range(4, min(15, len(at)-si+1)):
            grp = at[si:si+ln]; ts = [t for t,_ in grp]
            gaps = [ts[i+1]-ts[i] for i in range(len(ts)-1)]
            ag = sum(gaps)/len(gaps)
            if ag < 0.01: continue
            sg = math.sqrt(sum((g-ag)**2 for g in gaps)/len(gaps))
            reg = 1.0-min(sg/ag, 1.0)
            if reg > 0.6 and ln >= 4:
                pats.append((ts[0], ts[-1], ln, 60/ag, reg, filt_label, ts))
    pats.sort(key=lambda x: x[2], reverse=True)
    seen = set()
    for pt in pats[:5]:
        tk = round(pt[0])
        if tk in seen: continue
        seen.add(tk)
        ptype = "roll" if pt[3]>300 else ("rapid fill" if pt[3]>150 else ("accent train" if pt[3]>80 else "rhythmic hits"))
        out_line = f"  {pt[0]:5.2f}s - {pt[1]:5.2f}s  {pt[2]} hits at {pt[3]:.0f}/min  ({ptype}) in {pt[5]}"
        if pt[2] <= 8: out_line += f"  [{', '.join(f'{t:.2f}' for t in pt[6])}]"
        print(out_line)

print(f"\nBEATS ({len(beats)})")
for t, amp in beats:
    energy = broad_n[min(int(t/0.25), len(broad_n)-1)]
    bd, feel = char_at(t)
    print(f"  {t:6.2f}s  energy={energy:.2f}  hit={amp/moa:.2f}  {feel:8s}  {bd}")
EOF
```

## Build Before Every Drop

Every key moment in the analysis needs a setup phase. Before you plan what happens AT the surge, plan what happens in the 4-6 seconds LEADING TO it.

Scale the build to the moment's importance:

- First surge (always the most important): Full 4-6s build
- Biggest surge (Δ > 0.4): Full 4-6s build
- Medium surge (Δ 0.2-0.4): 2-3s compression
- Minor surge (Δ 0.12-0.2): 1s tightening

## Frequency Bands Shape the Feel

Sub-bass entering doesn't just mean "louder."

When sub-bass drops out at 22s but highs stay, everything should feel weightless and bright.

When highs peak and bass is absent — maximum visual sharpness.

When bass and sub-bass dominate with no highs — heavy, warm, submerged. The composition should feel like it has gravity.

The band data tells you HOW a moment should feel, not just WHEN it happens.
