"""Per-line mouth tracks from the real voice audio: open, wide, round, emphasis at 30 fps, uint8, base64."""
import numpy as np, soundfile as sf, json, base64
TL=json.load(open('timeline.json'))
FPS=30; out={}
for l in TL['lines']:
    x,sr=sf.read(f"vo/{l['id']}.wav")
    if x.ndim>1: x=x.mean(1)
    hop=sr//FPS; win=int(sr*0.045); n=int(np.ceil(len(x)/hop))
    pad=np.pad(x,(win,win)); w=np.hanning(win)
    rms=np.zeros(n); cen=np.zeros(n); hi=np.zeros(n)
    fr=np.fft.rfftfreq(win,1/sr)
    b=(fr>250)&(fr<3500); bh=(fr>4000)&(fr<9000)
    for i in range(n):
        seg=pad[i*hop+win//2:i*hop+win//2+win]
        if len(seg)<win: seg=np.pad(seg,(0,win-len(seg)))
        seg=seg*w; rms[i]=np.sqrt((seg**2).mean()+1e-12)
        sp=np.abs(np.fft.rfft(seg))**2
        e=sp[b].sum()+1e-12; cen[i]=(sp[b]*fr[b]).sum()/e; hi[i]=sp[bh].sum()/(e+sp[bh].sum())
    p=np.percentile(rms,95)+1e-9
    op=np.clip((rms/p)**0.85,0,1)
    op=op*(1-0.6*np.clip((hi-0.35)/0.4,0,1))   # sibilants: teeth, small opening
    wide=np.clip((cen-1150)/700,0,1)*np.clip(op*2,0,1)
    rnd=np.clip((950-cen)/450,0,1)*np.clip(op*2,0,1)
    # attack/release smoothing
    def smooth(a,att=.65,rel=.35):
        o=np.zeros_like(a);v=0
        for i,s in enumerate(a):k=att if s>v else rel;v+=(s-v)*k;o[i]=v
        return o
    op=smooth(op);wide=smooth(wide,.5,.3);rnd=smooth(rnd,.5,.3)
    d=np.diff(np.r_[0,smooth(rms/p,.4,.15)]);emph=np.clip(d*6,0,1);emph=smooth(emph,.6,.12)
    arr=np.stack([op,wide,rnd,emph],1);arr=(np.clip(arr,0,1)*255).astype(np.uint8)
    out[l['id']]=base64.b64encode(arr.tobytes()).decode()
json.dump(out,open('lips.json','w'))
print(len(out),'lines',sum(len(v) for v in out.values())//1000,'KB')
