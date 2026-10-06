"""Mii-style cast: simple rounded bodies, big round heads, smooth hair. Faces are added at runtime."""
import numpy as np, json, struct, sys, time
import people as P
from people import (v3, J, rc, el, sp, prim, evaluate, polygonise, label_at, skin, pack_mesh, tri_mat, BI, BONES, MAT,
                    PELVIS, ABD, CHEST, NECK, LUA, LFA, LHAND, RUA, RFA, RHAND, LTH, LCALF, LFOOT, RTH, RCALF, RFOOT)

P.wrinkle = lambda *a, **k: 0.0   # toy-smooth clothing

HEAD_C = v3(0, 1.665, .005); HEAD_R = (.118, .13, .115)

def body(sex):
    f = sex; W = lambda m, w: m*(1-f)+w*f
    pr = []
    pr.append(el((0,.94,0), (W(.15,.165),.1,W(.11,.115)), PELVIS, .05))
    pr.append(rc((0,.98,0),(0,1.34,0), W(.13,.122), W(.15,.135), ABD, .06, zs=.72))
    pr.append(el((0,1.37,-.005), (W(.19,.17),.09,W(.1,.095)), CHEST, .06))
    pr.append(rc((0,1.4,-.01),(0,1.56,-.005), .045, .042, NECK, .03))
    for s,k in ((1,'l'),(-1,'r')):
        S, E, Wr, d, n = J[k+'Sh'], J[k+'El'], J[k+'Hand'], J[k+'Adir'], J[k+'Nrm']
        ua, fa, hd = (LUA,LFA,LHAND) if s>0 else (RUA,RFA,RHAND)
        a = W(1,.9)
        pr.append(sp(S+v3(0,-.01,0), .056*a, ua, .05))
        pr.append(rc(S, E, .047*a, .042*a, ua, .03))
        pr.append(rc(E, Wr, .042*a, .037*a, fa, .03))
        pr.append(el(Wr+.05*d, (.04*a,.057*a,.047*a), hd, .025, frame=(n, d, v3(0,0,1))))
    for s,k in ((1,'l'),(-1,'r')):
        H, K, A = J[k+'Hip'], J[k+'Knee'], J[k+'Ank']
        th, ca, ft = (LTH,LCALF,LFOOT) if s>0 else (RTH,RCALF,RFOOT)
        a = W(1,.92)
        pr.append(rc(H+v3(0,.02,0), K, .074*a, .06*a, th, .05))
        pr.append(rc(K, A, .058*a, .05*a, ca, .03))
        sole = A[1]-.066
        fo = rc(A+v3(0,-.018,-.025), A+v3(0,-.024,.12), .05, .046, ft, .03)
        g = fo['f']; fo['f'] = lambda Pp, g=g: np.maximum(g(Pp), sole-Pp[1]); pr.append(fo)
    return pr

def head():
    pr = [el(tuple(HEAD_C), HEAD_R, 20, .03),
          el((0,1.632,.015), (.11,.085,.103), 20, .05),
          sp((0,1.66,.119), .0125, 20, .01)]
    for s in (1,-1): pr.append(el((.114*s,1.662,0), (.018,.03,.021), 20, .015))
    return pr

def hair(style):
    H = 30; pr = [el((0,1.678,-.006), (.127,.142,.124), H, .02)]
    if style=='swoop':
        pr.append(el((.028,1.752,.088), (.075,.032,.045), H, .03))
        pr.append(el((-.05,1.745,.07), (.05,.03,.045), H, .03))
    elif style=='curtains':
        for s in (1,-1):
            pr.append(rc((s*.012,1.795,.112), (s*.075,1.725,.112), .02, .026, H, .02))
            pr.append(rc((s*.075,1.725,.112), (s*.112,1.6,.05), .026, .028, H, .02))
        pr.append(el((0,1.63,-.025), (.138,.115,.128), H, .05))
        pr.append(rc((0,1.83,.13),(0,1.825,.02),.0045,.0045,H,.004)); pr[-1]['op']='s'
    elif style=='pony':
        pr.append(el((.02,1.75,.085), (.08,.03,.04), H, .03))
        pr.append(rc((0,1.74,-.12),(0,1.56,-.15),.045,.03,H,.04))
    elif style=='bun':
        pr.append(el((0,1.755,.085), (.085,.026,.04), H, .03))
        pr.append(sp((0,1.77,-.13), .055, H, .03))
    elif style=='hood':
        pr = [el((0,1.69,-.015), (.152,.165,.15), H, .02),
              rc((0,1.62,-.08),(0,1.42,-.1),.12,.16,H,.06,zs=.7)]
    else:  # neat side part
        pr.append(el((-.03,1.75,.088), (.078,.028,.042), H, .03))
        pr.append(rc((.035,1.82,.11),(.03,1.82,-.04),.0035,.0035,H,.004)); pr[-1]['op']='s'
    return pr

def hair_post(style):
    def post(D, L, xs, ys, zs):
        x = xs[:,None,None]; y = ys[None,:,None]; z = zs[None,None,:]
        ax = np.abs(x)
        if style=='hood':
            face = (z > -.02) & (ax < .105) & (y < 1.79) & (y > 1.5)
            D = np.where(face, np.maximum(D, (np.minimum(1.79-y, .105-ax)).astype(np.float32)), D)
            inner = np.sqrt((x/.128)**2+((y-1.67)/.142)**2+((z-.0)/.125)**2)-1
            D = np.maximum(D, -inner.astype(np.float32)*.12)
        elif style=='curtains':
            face = (z > .03) & (ax < .085) & (y < 1.765 - 1.2*ax**2*0)
            D = np.where(face, np.maximum(D, 1.765 - y).astype(np.float32), D)
        else:
            hl = 1.6 + (1.69-1.6)*np.clip((z+.07)/.05, 0, 1)
            front = 1.735 + (1.69-1.735)*np.clip((ax-.07)/.03, 0, 1)
            hl = np.where(z > .03, np.maximum(hl, front + 0*hl), hl)
            D = np.maximum(D, (hl - y).astype(np.float32))
        return D
    return post

def rules_for(char):
    if char in ('dowie','baden','bob','teacher'):
        return P.cloth_rules({'teacher':'dowie'}.get(char,char))
    def fn(x, y, z, lab):
        shp = np.broadcast(x,y,z).shape if np.ndim(x)>1 else lab.shape
        infl = np.zeros(shp, np.float32); mat = np.zeros(shp, np.int8)
        X = np.broadcast_to(x, shp); Y = np.broadcast_to(y, shp); Z = np.broadcast_to(z, shp)
        hands = (lab==LHAND)|(lab==RHAND); feet = (lab==LFOOT)|(lab==RFOOT)
        torso = (lab==CHEST)|(lab==ABD)|(lab==PELVIS)
        legs = (lab==LTH)|(lab==LCALF)|(lab==RTH)|(lab==RCALF)
        arms = (lab==LUA)|(lab==RUA)|(lab==LFA)|(lab==RFA)
        mat[feet] = MAT['shoe']; infl[feet] = .004
        if char=='witch':
            body = torso|legs|arms|(lab==NECK)
            mat[body] = MAT['top']; infl[body] = .008
        else:  # cofer / anna: jacket, trousers, white shirt v
            V = np.stack([X,Y,Z],-1)
            tfa = np.where(lab==LFA, P.tparam(V,'l','fa'), P.tparam(V,'r','fa'))
            m = (torso & (Y>.94)) | ((lab==LUA)|(lab==RUA)) | (((lab==LFA)|(lab==RFA)) & (tfa<.88))
            mat[m] = MAT['top']; infl[m] = .007
            b = (torso & (Y<=.94)) | legs; mat[b] = MAT['bottom']; infl[b] = .005
            v = (lab==CHEST) & (Z>.02) & (Y>1.2) & (np.abs(X) < (.008+(Y-1.2)*.22))
            mat[v] = MAT['accent']; infl[v] = .004
            n = (lab==NECK) & (Y<1.47); mat[n] = MAT['accent']; infl[n] = .005
        return infl, mat
    return fn

def skirt_mesh(top=1.0, bot=.6, r0=.135, flare=.1, ny=40, nt=160):
    ys_ = np.linspace(top, bot, ny); th = np.linspace(0, 2*np.pi, nt, endpoint=False); Vs = []; Ln = top-bot
    for y in ys_:
        u = (top-y)/Ln; r = r0 + .07*np.clip((top-y)/.06,0,1)**.7 + flare*u**1.2
        for t in th: Vs.append((np.sin(t)*r, y, np.cos(t)*r*.86 - .005))
    Vs = np.array(Vs); Fs = []
    for i in range(ny-1):
        for j in range(nt):
            a = i*nt+j; bb = i*nt+(j+1)%nt; c = (i+1)*nt+j; d = (i+1)*nt+(j+1)%nt; Fs += [(a,c,bb),(bb,c,d)]
    Fs = np.array(Fs); Ns = np.zeros_like(Vs); fa, fb, fc = Vs[Fs[:,0]], Vs[Fs[:,1]], Vs[Fs[:,2]]; fn = np.cross(fb-fa, fc-fa)
    for k in range(3): np.add.at(Ns, Fs[:,k], fn)
    Ns /= np.linalg.norm(Ns,axis=1,keepdims=True)
    if (Ns*np.c_[Vs[:,0],np.zeros(len(Vs)),Vs[:,2]+.005]).sum(1).mean() < 0: Fs = Fs[:,::-1]; Ns = -Ns
    u = np.clip((top-Vs[:,1])/Ln,0,1); s = np.clip((Vs[:,0]+.07)/.14,0,1); s = s*s*(3-2*s)
    wl = .6*u**1.6*s; wr = .6*u**1.6*(1-s)
    idx = np.zeros((len(Vs),4),np.uint8); w = np.zeros((len(Vs),4),np.float32)
    idx[:,0]=BI['hips']; idx[:,1]=BI['lHip']; idx[:,2]=BI['rHip']; w[:,0]=1-wl-wr; w[:,1]=wl; w[:,2]=wr
    return pack_mesh('skirt', Vs, Fs, Ns, idx, w, np.full(len(Fs), MAT['top'], np.int8), double=True)

def build(char, sex, hairstyle):
    t0 = time.time(); meshes = []; blobs = []
    rules = rules_for(char)
    pr = body(sex)
    def post(D, L, xs, ys, zs):
        x = xs[:,None,None]; y = ys[None,:,None]; z = zs[None,None,:]
        infl, _ = rules(x, y, z, L); return D - infl*.7
    D, L, xs, ys, zs = evaluate(pr, (-.72,-.002,-.22), (.72,1.6,.24), .0074, post=post)
    V, F, N = polygonise(D, xs, ys, zs, .0074); del D, L
    lab = label_at(pr, V); _, vm = rules(V[:,0], V[:,1], V[:,2], lab)
    idx, w = skin(V, lab)
    m, b = pack_mesh('body', V, F, N, idx, w, tri_mat(F, np.asarray(vm).astype(np.int8))); meshes.append(m); blobs += b
    hp = head()
    D, L, xs, ys, zs = evaluate(hp, (-.15,1.5,-.13), (.15,1.81,.16), .0038)
    V, F, N = polygonise(D, xs, ys, zs, .0038)
    idx = np.zeros((len(V),4),np.uint8); w = np.zeros((len(V),4),np.float32); idx[:,0]=BI['head']; w[:,0]=1
    m, b = pack_mesh('head', V, F, N, idx, w, np.full(len(F), MAT['skin'], np.int8)); meshes.append(m); blobs += b
    hpr = hair(hairstyle)
    D, L, xs, ys, zs = evaluate(hpr, (-.19,1.36,-.22), (.19,1.87,.19), .0038, post=hair_post(hairstyle))
    V, F, N = polygonise(D, xs, ys, zs, .0038)
    idx = np.zeros((len(V),4),np.uint8); w = np.zeros((len(V),4),np.float32); idx[:,0]=BI['head']; w[:,0]=1
    m, b = pack_mesh('hair', V, F, N, idx, w, np.full(len(F), MAT['hair'], np.int8)); meshes.append(m); blobs += b
    if char in ('dowie','teacher'):
        m, b = skirt_mesh(); meshes.append(m); blobs += b
    if char=='witch':
        m, b = skirt_mesh(1.05, .04, .15, .22, ny=60); meshes.append(m); blobs += b
    out = bytearray(); k = 0
    for m in meshes:
        m['off'] = []
        for _ in range(5):
            bb = blobs[k]; k += 1; out += b'\0'*((-len(out)) % 4); m['off'].append(len(out)); out += bb
    meta = dict(char=char, bones=BONES, armA=40, legA=3, meshes=meshes, mii=dict(c=list(HEAD_C), r=list(HEAD_R)))
    hdr = json.dumps(meta).encode(); hdr += b' '*((-len(hdr)-8)%4)
    with open(f'/home/claude/previs/dist/{char}.mesh.wasm','wb') as fo:
        fo.write(b'BOB1'); fo.write(struct.pack('<I', len(hdr))); fo.write(hdr); fo.write(out)
    print(char, 'done', round(time.time()-t0,1), 's', round((len(out)+len(hdr))/1e6,2), 'MB', flush=True)

if __name__ == '__main__':
    cfg = dict(dowie=(1.0,'curtains'), baden=(0.0,'swoop'), bob=(0.0,'neat'), cofer=(0.0,'neat'), teacher=(1.0,'pony'), anna=(1.0,'bun'), witch=(1.0,'hood'))
    for c in (sys.argv[1:] or list(cfg)): build(c, *cfg[c])
