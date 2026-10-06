import numpy as np, soundfile as sf, json
from scipy.signal import sosfilt, butter, resample_poly, oaconvolve as fftconvolve
import gc
SR=48000
TL=json.load(open('timeline.json'));M=TL['marks'];END=TL['end']
N=int((END+0.5)*SR); L=np.zeros(N); R=np.zeros(N); t=np.arange(N)/SR
rng=np.random.default_rng(5)
head,hsr=sf.read('soundtrack.wav'); n0=min(len(head),int(50*SR)); L[:n0]+=head[:n0,0]*.6; R[:n0]+=head[:n0,1]*.6
def lp(f,o=2):return butter(o,f/(SR/2),'low',output='sos')
def hp(f,o=2):return butter(o,f/(SR/2),'high',output='sos')
def bp(a,b):return butter(2,[a/(SR/2),b/(SR/2)],'band',output='sos')
def place(x,t0,g=1,pan=0,A=None,B=None):
    A=L if A is None else A;B=R if B is None else B;i=int(t0*SR);x=x[:max(0,len(A)-i)];
    A[i:i+len(x)]+=x*g*np.cos((pan+1)*np.pi/4);B[i:i+len(x)]+=x*g*np.sin((pan+1)*np.pi/4)
def addw(a,b,gen,pan=None):
    i0,i1=max(0,int(a*SR)),min(N,int(b*SR));n=i1-i0
    if n<=0:return
    tt=t[i0:i1];out=gen(n,tt)
    if isinstance(out,tuple):L[i0:i1]+=out[0];R[i0:i1]+=out[1]
    else:L[i0:i1]+=out;R[i0:i1]+=out
def ew(tt,a,b,fi,fo):return np.clip((tt-a)/fi,0,1)*np.clip((b-tt)/fo,0,1)
def env(a,b,fi=.5,fo=.5):
    e=np.clip((t-a)/fi,0,1)*np.clip((b-t)/fo,0,1);return e
def ir(sec,damp,seed):
    r=np.random.default_rng(seed);n=int(sec*SR);tt=np.arange(n)/SR;e=np.exp(-6.9*tt/sec)
    a=sosfilt(lp(damp),r.standard_normal(n)*e);b=sosfilt(lp(damp),r.standard_normal(n)*e);return a/np.sqrt((a**2).sum()),b/np.sqrt((b**2).sum())
def verb(x,sec,mix,damp,seed):
    a,b=ir(sec,damp,seed);nz=np.nonzero(np.abs(x)>1e-7)[0]
    if len(nz)==0:return x.copy(),x.copy()
    i0=nz[0];i1=min(len(x),nz[-1]+len(a));seg=x[i0:i1]
    oL=x.copy();oR=x.copy();oL[i0:i1]+=fftconvolve(seg,a)[:i1-i0]*mix;oR[i0:i1]+=fftconvolve(seg,b)[:i1-i0]*mix;return oL,oR
def vo(i):
    x,sr=sf.read(f'vo/{i}.wav');x=resample_poly(x,2,1);return x/(np.abs(x).max()+1e-9)
WHO={l['id']:l['who'] for l in TL['lines']}
ROOM={'s2':(.6,.12,4000),'s4':(.5,.14,5000),'s5':(.35,.12,3000),'s6':(.3,.05,4000),'s7':(.5,.1,4000),'s9':(.5,.1,4000)}
def scene_at(tt):
    k=[x for x in ('s2','s3','s4','s5','s6','s7','s8','s9','s10') if M[x]<=tt];return k[-1] if k else 's2'
PAN={'bob':-.15,'cofer':.25,'teacher':-.25,'orla':.3,'anabela':.0,'saba':-.3,'all':0}
dL=np.zeros(N);dR=np.zeros(N);nL=np.zeros(N);nR=np.zeros(N);wL=np.zeros(N);wR=np.zeros(N)
for l in TL['lines']:
    x=vo(l['id']);x=sosfilt(hp(80),x);x=x*0.85
    if l['who']=='anna':
        place(x,l['t0'],.62,0,nL,nR)
    else:
        sc=scene_at(l['t0']);g={'s4':.55,'s5':.6}.get(sc,.6)
        if l['who'] in ('orla','anabela','saba','all'):g=.62
        if l['id']=='s5_3' or l['id']=='o5_3':g=.35
        if l['who'] in ('orla','anabela','saba','all') and l['id'] not in ('s5_3','o5_3'):place(x,l['t0'],g,PAN.get(l['who'],0),wL,wR)
        else:place(x,l['t0'],g,PAN.get(l['who'],0),dL,dR)
nL,_=verb(nL,.45,.08,6000,17);_,nR=verb(nR,.45,.08,6000,17);gc.collect()
d1,_=verb(dL,.5,.18,3500,21);_,d2=verb(dR,.5,.18,3500,22)
# only the witches get the big eerie room; Bob stays dry in his bedroom
i0,i1=int(M['s5']*SR),int(M['s6']*SR)+int(2*SR)
wl,_=verb(wL[i0:i1].copy(),1.6,.35,2500,23);_,wr=verb(wR[i0:i1].copy(),1.6,.35,2500,24)
dL=d1;dR=d2;dL[i0:i1]+=wl;dR[i0:i1]+=wr;del d1,d2,wl,wr,wL,wR;gc.collect()
L+=dL;L+=nL;R+=dR;R+=nR;del dL,dR,nL,nR;gc.collect()
# ---------- music ----------
def ks(f,dur,bright=.5,seed=0):
    r=np.random.default_rng(seed);p=max(2,int(round(SR/f)));n=int(dur*SR);y=np.zeros(n+p+1);y[:p]=r.uniform(-1,1,p)
    from scipy.signal import lfilter
    y[:p]=lfilter([bright],[1,-(1-bright)],y[:p]);rho=.996
    for i in range(p,n+p):y[i]=rho*.5*(y[i-p]+y[i-p-1])
    return y[p:n+p]*np.minimum(1,np.arange(n)/(.0015*SR))
mh=lambda m:440*2**((m-69)/12)
def guitar(prog,pat,bpm,t0,t1,gain,seed=1,slow=1.0):
    out=np.zeros(N);beat=60/bpm;bar=0
    while True:
        tb=t0+bar*4*beat
        if tb>=t1:break
        ch=prog[bar%len(prog)]
        for k in range(8):
            tt=tb+k*beat/2+rng.normal(0,.006)
            if tt>=t1:break
            seed+=1;n=ks(mh(ch[pat[k]]),2.2,.45,seed)*(.3 if k==0 else .2);i=int(tt*SR);n=n[:max(0,N-i)];out[i:i+len(n)]+=n
        seed+=1;n=ks(mh(ch[0]-12),3.0,.3,seed)*.45;i=int(tb*SR);n=n[:max(0,N-i)];out[i:i+len(n)]+=n
        bar+=1
    out=sosfilt(hp(70),out);return out*gain
# Timber stand-in: acoustic, minor, two voices humming
prog=[[45,52,57,60,64,69],[41,48,53,57,60,65],[48,55,60,64,67,72],[43,50,55,59,62,67]]
tim=guitar(prog,[0,3,2,4,1,3,2,5],88,M['s6'],M['musiccut'],.5,100)
hum=np.zeros(N);mel=[69,72,71,69,67,69,64,65,67,69,72,74,72,71,69,67]
beat=60/88
for i,m in enumerate(mel*6):
    t0=M['s6']+i*beat*1.0
    if t0>M['musiccut']-0.3:break
    a,b=int(t0*SR),int((t0+beat*0.95)*SR);tt=np.arange(b-a)/SR;f=mh(m)
    v=(np.sin(2*np.pi*f*tt+.4*np.sin(2*np.pi*5.5*tt))+.3*np.sin(4*np.pi*f*tt))*np.minimum(1,tt/.08)*np.minimum(1,(beat*.95-tt)/.1)
    hum[a:b]+=v*.04
hum=sosfilt(lp(2500),hum)
mus=tim+hum
cut=int(M['musiccut']*SR);mus[cut:]=0
mL,mR=verb(mus,1.4,.2,4000,31)
# duck under narration
duck=np.ones(N)
for l in TL['lines']:
    a,b=int((l['t0']-.25)*SR),int((l['t1']+.2)*SR);duck[a:b]=np.minimum(duck[a:b],.55)
from scipy.signal import lfilter
duck=lfilter([.0015],[1,-.9985],duck)
L+=mL*duck*.9;R+=mR*duck*.9;del mL,mR,mus,tim,hum;gc.collect()
# Delta Dawn reprise: slower, sadder, warping into tape pull
dd=guitar([[43,47,50,55,59,62],[40,47,52,55,59,64],[36,43,48,52,55,60],[38,45,50,54,57,62]],[0,3,2,4,1,3,2,5],58,M['s8'],M['s9'],.55,300)
seg=dd[int(M['s8']*SR):int(M['s9']*SR)].copy();n=len(seg);warp_start=int(10.4*SR)
tt=np.arange(n)/SR;rate=np.where(tt<10.4,1.0,np.maximum(.25,1-(tt-10.4)*.28))
pos=np.cumsum(rate);pos=pos-pos[0];pos=np.clip(pos,0,n-1)
w=np.interp(pos,np.arange(n),seg)*np.where(tt<10.4,1,np.maximum(0,1-(tt-10.4)/2.8))
w=sosfilt(lp(5000),w);w=np.tanh(w*1.4)/1.4
a=int(M['s8']*SR);L[a:a+n]+=w*.75;R[a:a+n]+=w*.75
hiss=sosfilt(hp(3000),rng.standard_normal(n))*.008;L[a:a+n]+=hiss;R[a:a+n]+=hiss
# Timber full under the credits
cr=guitar(prog,[0,3,2,4,1,3,2,5],88,M['credits'],END,.55,500)
for i,m in enumerate(mel*8):
    t0=M['credits']+1.4+i*beat
    if t0>END-1:break
    a2,b2=int(t0*SR),int((t0+beat*.95)*SR);tt=np.arange(b2-a2)/SR;f=mh(m)
    cr[a2:b2]+=(np.sin(2*np.pi*f*tt+.4*np.sin(2*np.pi*5.5*tt))*np.minimum(1,tt/.08)*np.minimum(1,(beat*.95-tt)/.1))*.05
i0=int(M['credits']*SR);cr[i0:]*=ew(t[i0:],M['credits'],END,1.5,3);cl,crr=verb(cr,1.4,.22,4000,41);L+=cl;R+=crr
# ---------- SFX ----------
def thud(t0,g,f=70,pan=0):
    n=int(.5*SR);tt=np.arange(n)/SR;ph=2*np.pi*np.cumsum(f*(1+1.5*np.exp(-tt*35)))/SR
    y=np.sin(ph)*np.exp(-tt*11)+sosfilt(lp(1500),rng.standard_normal(n))*np.exp(-tt*50)*.9;place(y,t0,g,pan)
def click(t0,g,f=2400,pan=0):
    n=int(.03*SR);tt=np.arange(n)/SR;y=(np.sin(2*np.pi*f*tt)*.6+rng.standard_normal(n)*.4)*np.exp(-tt*170);place(y,t0,g,pan)
def noise(t0,t1,g,band,pan=0,fi=.3,fo=.3):
    n=int((t1-t0)*SR);x=sosfilt(bp(*band),rng.standard_normal(n));tt=np.arange(n)/SR;e=np.minimum(1,tt/fi)*np.minimum(1,(t1-t0-tt)/fo);place(x*e,t0,g,pan)
def step(t0,g,pan=0,hard=1):
    n=int(.12*SR);tt=np.arange(n)/SR;y=sosfilt(bp(250,5000*hard),rng.standard_normal(n))*np.exp(-tt*38)+np.sin(2*np.pi*80*tt)*np.exp(-tt*40)*.5;place(y,t0,g,pan)
def steps(t0,t1,rate,g,pan=0,hard=1):
    k=t0
    while k<t1:step(k+rng.normal(0,.01),g,pan,hard);k+=rate
def tone(t0,dur,f,g,pan=0,att=.05):
    n=int(dur*SR);tt=np.arange(n)/SR;y=np.sin(2*np.pi*f*tt)*np.minimum(1,tt/att)*np.exp(-tt*1.5/dur);place(y,t0,g,pan)
def whisper(t0,t1,g):
    n=int((t1-t0)*SR);x=rng.standard_normal(n);y=np.zeros(n);tt=np.arange(n)/SR
    for k in range(8):
        f=rng.uniform(900,3200);y+=sosfilt(bp(f*.85,f*1.15),x)*(.5+.5*np.sin(2*np.pi*rng.uniform(2,6)*tt+k))
    y*=np.minimum(1,tt/.6)*np.minimum(1,(t1-t0-tt)/.05);place(y,t0,g,0)
# library room tone across scenes 2-3
addw(M['s2'],M['s4'],lambda n,tt:(sosfilt(lp(350),rng.standard_normal(n))*.08*ew(tt,M['s2'],M['s4'],.2,.4),sosfilt(lp(350),rng.standard_normal(n))*.08*ew(tt,M['s2'],M['s4'],.2,.4)))
for k in np.arange(M['s2'],M['s4'],1.0):click(k,.06,2100 if int(k)%2 else 2600,-.5)
thud(M['thud'],.6,62,.6);noise(M['pickup']+2.2,M['pickup']+2.9,.08,(1500,7000))
for i in range(3):thud(M['thuds']+.5+i*.8,.55,66,.6)
tone(M['blink'],.8,120,.05);noise(M['blink'],M['blink']+1.4,.04,(4000,9000))
noise(M['startwrite']+.4,M['startwrite']+.8,.06,(800,5000))
whisper(M['montage'],M['answer'],.18)
for k in np.arange(M['startwrite']+3.0,M['answer'],.11):noise(k,k+.07,.03+.02*rng.random(),(2500,9000),.1,.01,.02)
snap=M['montage']+3.2;n=int(.05*SR);place(sosfilt(hp(1500),rng.standard_normal(n))*np.exp(-np.arange(n)/SR*90),snap,.4,.1)
# dead silence after answer: duck everything handled by silence (no tone)
steps(M['leave']+1.9,M['leave']+4.2,.3,.1,-.2)
noise(M['leave']+.8,M['leave']+1.3,.06,(1500,7000))
# corridor
addw(M['s4'],M['s5'],lambda n,tt:sosfilt(bp(200,2000),rng.standard_normal(n))*.035*ew(tt,M['s4'],M['s5'],.3,.5))
for k in range(30):
    tt=M['s4']+rng.uniform(0,M['s5']-M['s4']-1);n=int(rng.uniform(.3,.9)*SR);x=sosfilt(bp(300,2500),rng.standard_normal(n))*np.sin(np.pi*np.arange(n)/n)*.04;place(x,tt,1,rng.uniform(-.6,.6))
steps(M['s4'],M['stop'],.48,.09,-.1,1.3);steps(M['door']+3.6,M['cofer']+.6,.33,.11,-.1,1.3)
steps(M['cofer'],M['watch']+6,.5,.08,.3,1.3)
noise(M['door']+.3,M['door']+.8,.08,(200,1500),.3);thud(M['door']+2.6,.15,90,.3)
tone(M['board'],2.6,46,.12)
# bedroom
addw(M['cold'],M['gone'],lambda n,tt:(sosfilt(bp(400,1600),rng.standard_normal(n))*(.5+.5*np.sin(2*np.pi*.25*tt))*.14*ew(tt,M['cold'],M['gone'],1.5,1.0),sosfilt(bp(400,1600),rng.standard_normal(n))*(.5+.5*np.sin(2*np.pi*.27*tt+1))*.14*ew(tt,M['cold'],M['gone'],1.5,1.0)))
addw(M['cold'],M['gone'],lambda n,tt:np.sin(2*np.pi*np.cumsum(1150+60*np.sin(2*np.pi*.3*tt))/SR)*.012*np.clip((tt-M['cold'])/2,0,1))
tone(M['reveal']+.5,2.8,55,.18);tone(M['reveal']+.5,2.8,82.5,.08)
noise(M['b5_1']-.05,M['b5_1']+.4,.1,(200,2500))
hb=M['bottle']
for k in np.arange(hb,M['gone'],.92):thud(k,.06,48,0);thud(k+.18,.04,44,0)
step(M['s5_3']-.25,.18,.5);thud(M['s5_3']-.2,.12,120,.5)
noise(M['backaway'],M['gone'],.05,(300,1500))
# rain
addw(M['s6'],M['s7']+.5,lambda n,tt:(sosfilt(bp(800,9000),rng.standard_normal(n))*.13*ew(tt,M['s6'],M['s7']+.5,1.0,.3),sosfilt(bp(800,9000),rng.standard_normal(n))*.13*ew(tt,M['s6'],M['s7']+.5,1.0,.3)))
for k in range(4000):
    tt=rng.uniform(M['s6'],M['s7']);n=int(.01*SR);place(sosfilt(hp(2000),rng.standard_normal(n))*np.exp(-np.arange(n)/SR*600)*.05,tt,1,rng.uniform(-.8,.8))
addw(M['s7'],M['s10'],lambda n,tt:sosfilt(lp(1200),sosfilt(bp(500,4000),rng.standard_normal(n)))*.05*ew(tt,M['s7'],M['s10'],.3,.5)*((tt<M['s8'])|(tt>M['s9'])))
steps(M['s6'],M['atwindow'],.5,.1,0,.7)
for x in np.arange(M['s6']+1,M['atwindow'],2.4):noise(x,x+.3,.03,(3000,9000))
# phone ring
for r in range(2):
    a=M['phone']+r*.6;n=int(.4*SR);tt=np.arange(n)/SR;y=(np.sin(2*np.pi*1400*tt)+np.sin(2*np.pi*1750*tt))*(np.sin(2*np.pi*20*tt)>0)*.5;place(sosfilt(bp(600,4000),y),a,.05,-.2)
noise(M['opendoor']+.3,M['opendoor']+1.0,.07,(200,1500),.3)
# staffroom: slow clock
for k in np.arange(M['s7'],M['st_clock'],1/.35):click(k,.12,1800,.4)
for k in np.arange(M['st_clock'],M['s8'],1.0):click(k,.1,1800,.4)
noise(M['st_enter']+1.6,M['st_enter']+2.3,.06,(1500,8000),.3)
noise(M['st_bottle']+1.3,M['st_bottle']+1.7,.06,(1500,6000))
n=int(.5*SR);tt=np.arange(n)/SR;y=sosfilt(bp(200,2500),rng.standard_normal(n))*np.exp(-tt*9)*(1+np.sin(2*np.pi*14*tt));place(y,M['st_cough']+.1,.45,.4)
for k in [M['st_cough']+.6,M['st_drops']+.8,M['st_drops']+1.8,M['st_drops']+2.8]:tone(k+.33,.25,900,.06)
tone(M['st_drops']+3.3,.12,40,.3)
noise(M['st_sip'],M['st_sip']+1.0,.04,(800,3000),.3)
noise(M['st_drink']+.8,M['st_drink']+3.0,.05,(800,3000),.3)
# collapse
thud(M['s9']+.65,.9,60,.2);n=int(.5*SR);tt=np.arange(n)/SR
place(sosfilt(hp(2500),rng.standard_normal(n))*np.exp(-tt*14),M['s9']+1.05,.55,.3)
for k in range(6):tone(M['s9']+1.1+k*.05,.15,rng.uniform(3000,5000),.04,.3)
noise(M['spread'],M['dowiein'],.03,(200,900),.3)
steps(M['dowiein'],M['dowiein']+2.0,.42,.09,-.3)
thud(M['phonedrop']+.6,.25,180,.0);place(sosfilt(hp(3000),rng.standard_normal(int(.2*SR)))*np.exp(-np.arange(int(.2*SR))/SR*25),M['phonedrop']+.62,.25)
tone(M['frozen'],3.2,58,.12)
# scene 10
addw(M['s10'],M['black5'],lambda n,tt:sosfilt(lp(300),rng.standard_normal(n))*.05*ew(tt,M['s10'],M['black5'],1,.05))
for a in [M['annaopen'],M['dip']+1.2,M['flicker']]:
    for k in range(5):click(a+k*.08,.08,600,.0)
addw(M['s10'],M['black5'],lambda n,tt:np.sin(2*np.pi*100*tt)*.006*ew(tt,M['s10'],M['black5'],1,.05))
n=int(1.8*SR);tt=np.arange(n)/SR;st=np.zeros(n)
for f in (880,932,1245):st+=np.sin(2*np.pi*f*tt+2*np.sin(2*np.pi*6*tt))*(1+.5*np.sin(2*np.pi*11*tt))
st*=np.minimum(1,tt/.02)*np.exp(-tt*1.8)*.08;sl,sr_=verb(st,1.5,.4,6000,51);place(sl,M['sting'],1,-.2);place(sr_,M['sting'],1,.2)
addw(M['standup'],M['black5'],lambda n,tt:(np.sin(2*np.pi*41*tt)*.06+np.sin(2*np.pi*61.7*tt)*.03)*np.clip((tt-M['standup'])/6,0,1))
noise(M['fold'],M['fold']+.6,.06,(1500,7000));thud(M['n10_14']+.4,.15,110,-.3)
# cut to black: everything except the final line drops out
a,b=int(M['black5']*SR),int(M['n10_15']*SR)-1
L[a:b]=0;R[a:b]=0
a2=int(M['s8']*SR);b2=int(M['s9']*SR)
# master
mx=max(np.abs(L).max(),np.abs(R).max());g=.89/mx
L*=g;R*=g;L=np.tanh(L*1.2)/np.tanh(1.2);R=np.tanh(R*1.2)/np.tanh(1.2)
L[a:b]=0;R[a:b]=0
sf.write('full.wav',np.c_[L,R].astype(np.float32),SR,subtype='PCM_16')
for s0 in range(0,int(END),20):
    seg=(L[int(s0*SR):int((s0+20)*SR)]+R[int(s0*SR):int((s0+20)*SR)])/2;print(s0,round(20*np.log10(np.sqrt((seg**2).mean())+1e-9),1),end=' | ')
