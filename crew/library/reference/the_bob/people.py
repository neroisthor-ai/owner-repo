"""Sculpt the cast as signed-distance bodies, polygonise, skin to the previs rig, export binary meshes."""
import numpy as np, json, struct, sys, time
from skimage.measure import marching_cubes

D2R = np.pi/180
BONES = ['root','hips','spine','chest','neck','head','lSh','lEl','lHand','rSh','rEl','rHand','lHip','lKnee','lAnk','rHip','rKnee','rAnk']
BI = {b:i for i,b in enumerate(BONES)}
ARM_A = 40*D2R
LEG_A = 3*D2R

def v3(*a): return np.array(a, dtype=np.float64)

# ---------- rig in bind (A) pose ----------
def rig():
    J = {}
    J['hips'] = v3(0, .975, 0); J['spine'] = J['hips']+v3(0,.05,0); J['chest'] = J['spine']+v3(0,.22,0)
    J['neck'] = J['chest']+v3(0,.28,0); J['head'] = J['neck']+v3(0,.085,0)
    for s,k in ((1,'l'),(-1,'r')):
        S = J['chest']+v3(.182*s,.212,-.01); d = v3(np.sin(ARM_A)*s, -np.cos(ARM_A), 0)
        J[k+'Sh'] = S; J[k+'El'] = S+.3*d; J[k+'Hand'] = J[k+'El']+.265*d; J[k+'Adir'] = d
        J[k+'Nrm'] = v3(-np.cos(ARM_A)*s, -np.sin(ARM_A), 0)   # palm normal toward body
        H = J['hips']+v3(.092*s,-.03,0); ld = v3(np.sin(LEG_A)*s, -np.cos(LEG_A), 0)
        J[k+'Hip'] = H; J[k+'Knee'] = H+.45*ld; J[k+'Ank'] = J[k+'Knee']+.43*ld; J[k+'Ldir'] = ld
    return J
J = rig()

# ---------- sdf primitives (numpy, broadcast over x[:,None,None], y[None,:,None], z[None,None,:]) ----------
def length(x,y,z): return np.sqrt(x*x+y*y+z*z)

def sd_ellipsoid(P, c, r, frame=None):
    x,y,z = P[0]-c[0], P[1]-c[1], P[2]-c[2]
    if frame is not None:
        a,b,cc = frame
        x,y,z = x*a[0]+y*a[1]+z*a[2], x*b[0]+y*b[1]+z*b[2], x*cc[0]+y*cc[1]+z*cc[2]
    k0 = length(x/r[0], y/r[1], z/r[2]); k1 = length(x/(r[0]*r[0]), y/(r[1]*r[1]), z/(r[2]*r[2]))
    return k0*(k0-1.0)/np.maximum(k1, 1e-9)

def sd_round_cone(P, a, b, r1, r2, zs=1.0):
    # optional squash on z (zs<1 makes the cross-section flatter front-to-back)
    a = np.asarray(a, float); b = np.asarray(b, float)
    px, py, pz = P[0], P[1], P[2]
    if zs != 1.0:
        pz = (pz - a[2])/zs + a[2]; b = b.copy(); b[2] = (b[2]-a[2])/zs + a[2]
    ba = b-a; l2 = float(ba@ba); rr = r1-r2; a2 = l2-rr*rr; il2 = 1.0/l2
    pax, pay, paz = px-a[0], py-a[1], pz-a[2]
    y = pax*ba[0]+pay*ba[1]+paz*ba[2]; zz = y-l2
    qx, qy, qz = pax*l2-ba[0]*y, pay*l2-ba[1]*y, paz*l2-ba[2]*y
    x2 = qx*qx+qy*qy+qz*qz; y2 = y*y*l2; z2 = zz*zz*l2
    k = np.sign(rr)*rr*rr*x2
    out = (np.sqrt(np.maximum(x2*a2*il2,0))+y*rr)*il2 - r1
    c1 = np.sign(zz)*a2*z2 > k
    c2 = np.sign(y)*a2*y2 < k
    out = np.where(c2, np.sqrt(x2+y2)*il2 - r1, out)
    out = np.where(c1, np.sqrt(x2+z2)*il2 - r2, out)
    d = out
    if zs != 1.0: d = d*zs**0.5
    return d

def sd_sphere(P, c, r): return length(P[0]-c[0], P[1]-c[1], P[2]-c[2]) - r

def smin(a, b, k):
    h = np.maximum(k-np.abs(a-b), 0.0)/k
    return np.minimum(a, b) - h*h*k*0.25

def smax(a, b, k): return -smin(-a, -b, k)

# A primitive: dict(f=callable(P)->d, box=(lo,hi), part=int, k=float, op='u'|'s')
def prim(f, lo, hi, part, k=.02, op='u'):
    return dict(f=f, lo=np.asarray(lo,float), hi=np.asarray(hi,float), part=part, k=k, op=op)

def rc(a, b, r1, r2, part, k=.02, zs=1.0):
    a = np.asarray(a,float); b = np.asarray(b,float); m = max(r1,r2)+k+.01
    return prim(lambda P: sd_round_cone(P,a,b,r1,r2,zs), np.minimum(a,b)-m, np.maximum(a,b)+m, part, k)

def el(c, r, part, k=.02, frame=None, op='u'):
    c = np.asarray(c,float); m = max(r)+k+.01
    return prim(lambda P: sd_ellipsoid(P,c,r,frame), c-m, c+m, part, k, op)

def sp(c, r, part, k=.02, op='u'):
    c = np.asarray(c,float); m = r+k+.01
    return prim(lambda P: sd_sphere(P,c,r), c-m, c+m, part, k, op)

# ---------- grid evaluation ----------
def evaluate(prims, lo, hi, h, post=None):
    xs = np.arange(lo[0], hi[0]+h, h); ys = np.arange(lo[1], hi[1]+h, h); zs = np.arange(lo[2], hi[2]+h, h)
    D = np.full((len(xs),len(ys),len(zs)), 1.0, np.float32); L = np.zeros(D.shape, np.int16)-1
    for p in prims:
        i0 = max(0, int(np.floor((p['lo'][0]-lo[0])/h))); i1 = min(len(xs), int(np.ceil((p['hi'][0]-lo[0])/h))+1)
        j0 = max(0, int(np.floor((p['lo'][1]-lo[1])/h))); j1 = min(len(ys), int(np.ceil((p['hi'][1]-lo[1])/h))+1)
        k0 = max(0, int(np.floor((p['lo'][2]-lo[2])/h))); k1 = min(len(zs), int(np.ceil((p['hi'][2]-lo[2])/h))+1)
        if i0>=i1 or j0>=j1 or k0>=k1: continue
        P = (xs[i0:i1,None,None], ys[None,j0:j1,None], zs[None,None,k0:k1])
        d = p['f'](P).astype(np.float32)
        if d.shape != (i1-i0, j1-j0, k1-k0): d = np.broadcast_to(d, (i1-i0, j1-j0, k1-k0))
        sub = D[i0:i1,j0:j1,k0:k1]; lab = L[i0:i1,j0:j1,k0:k1]
        if p['op']=='u':
            closer = d < sub
            nd = smin(sub, d, p['k'])
            lab[closer] = p['part']
            D[i0:i1,j0:j1,k0:k1] = nd
        else:
            D[i0:i1,j0:j1,k0:k1] = smax(sub, -d, p['k'])
    if post is not None: D = post(D, L, xs, ys, zs)
    return D, L, xs, ys, zs

def polygonise(D, xs, ys, zs, h):
    verts, faces, normals, _ = marching_cubes(D, level=0.0, spacing=(h,h,h), allow_degenerate=False)
    verts = verts + np.array([xs[0], ys[0], zs[0]])
    # orient by signed volume so triangles wind CCW seen from outside, then make normals agree
    a, b, c = verts[faces[:,0]], verts[faces[:,1]], verts[faces[:,2]]
    vol = np.einsum('ij,ij->i', a, np.cross(b, c)).sum()/6.0
    if vol < 0: faces = faces[:, ::-1]
    a, b, c = verts[faces[:,0]], verts[faces[:,1]], verts[faces[:,2]]
    fn = np.cross(b-a, c-a); acc = np.zeros_like(verts)
    for k in range(3): np.add.at(acc, faces[:,k], fn)
    if (np.einsum('ij,ij->i', acc, normals) < 0).mean() > .5: normals = -normals
    verts, normals = smooth(verts, faces, normals)
    return verts, faces, normals

def smooth(V, F, N, it=6, lam=.5, mu=-.53):
    import scipy.sparse as sp_
    n = len(V); r = np.concatenate([F[:,0],F[:,1],F[:,2],F[:,1],F[:,2],F[:,0]]); c = np.concatenate([F[:,1],F[:,2],F[:,0],F[:,0],F[:,1],F[:,2]])
    A = sp_.csr_matrix((np.ones(len(r)), (r, c)), shape=(n, n)); A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel(); deg[deg==0] = 1
    V = V.copy()
    for i in range(it):
        for f in (lam, mu):
            V = V + f*((A@V)/deg[:,None] - V)
    a, b, c2 = V[F[:,0]], V[F[:,1]], V[F[:,2]]; fn = np.cross(b-a, c2-a); Nn = np.zeros_like(V)
    for k in range(3): np.add.at(Nn, F[:,k], fn)
    Nn /= np.maximum(np.linalg.norm(Nn,axis=1,keepdims=True),1e-12)
    for i in range(2):
        Nn = (A@Nn)/deg[:,None] + Nn; Nn /= np.maximum(np.linalg.norm(Nn,axis=1,keepdims=True),1e-12)
    return V, Nn

def label_at(prims, V):
    """part label for vertices = primitive with smallest distance"""
    best = np.full(len(V), 1e9); lab = np.zeros(len(V), np.int16)
    P = (V[:,0], V[:,1], V[:,2])
    for p in prims:
        if p['op']!='u': continue
        d = p['f'](P) + (.0019 if p['part']==BROW else .0006 if p['part']==LIPS else 0)
        m = d < best; best[m] = d[m]; lab[m] = p['part']
    return lab

# ---------- cloth helpers ----------
rng = np.random.default_rng(7)
WAVES = [(rng.normal(size=3), rng.uniform(0, 6.28)) for _ in range(10)]
def wrinkle(x, y, z, amp=.0012, f=70):
    s = 0
    for k,ph in WAVES:
        kk = k/np.linalg.norm(k)*f*rng.uniform(.6,1.4) if False else k/np.linalg.norm(k)*f
        s = s + np.sin(x*kk[0]+y*kk[1]+z*kk[2]+ph)
    return s*(amp/np.sqrt(len(WAVES)))

# parts
PELVIS, ABD, CHEST, NECK = 0,1,2,3
LUA, LFA, LHAND, RUA, RFA, RHAND = 4,5,6,7,8,9
LTH, LCALF, LFOOT, RTH, RCALF, RFOOT = 10,11,12,13,14,15
SKIN_HEAD, LIPS, BROW = 20, 21, 22

def body_prims(sex, slim=1.0):
    f = sex  # 1 female
    W = lambda m, w: m*(1-f)+w*f
    pr = []
    s_w = W(1.0, .9)*slim
    # torso
    pr.append(el((0,.94,-.005), (W(.165,.178)*slim, W(.1,.11), W(.115,.125)*slim), PELVIS, .03))
    for s in (1,-1): pr.append(el((.068*s,.9,-.055), (W(.082,.09)*slim,.095,W(.072,.082)*slim), PELVIS, .04))
    pr.append(rc((0,.97,0),(0,1.2,0), W(.13,.115)*slim, W(.14,.122)*slim, ABD, .05, zs=.76))
    pr.append(el((0,1.08,.012), (W(.142,.125)*slim, .12, W(.1,.092)*slim), ABD, .05))
    pr.append(el((0,1.29,0), (W(.16,.142)*s_w, W(.17,.16), W(.112,.102)*slim), CHEST, .05))
    pr.append(el((0,1.3,-.035), (W(.172,.15)*s_w, .15, W(.09,.08)*slim), CHEST, .05))
    if f < .5:
        for s in (1,-1): pr.append(el((.07*s,1.335,.065), (.075,.05,.045), CHEST, .04))
    else:
        for s in (1,-1): pr.append(el((.07*s,1.292,.062), (.06,.056,.05), CHEST, .035))
    for s in (1,-1):
        S = J['lSh' if s>0 else 'rSh']*np.array([1,1,1])
        S = S.copy(); S[0] = S[0]*W(1,.9)
        pr.append(rc((0,1.5,-.03), (S[0]*.85,S[1]-.005,-.02), W(.05,.042), W(.046,.04), CHEST, .04))
    pr.append(rc((0,1.42,-.015),(0,1.58,-.005), W(.058,.05), W(.048,.042), NECK, .03))
    # arms
    for s,k in ((1,'l'),(-1,'r')):
        S, E, Wr, d, n = J[k+'Sh'].copy(), J[k+'El'], J[k+'Hand'], J[k+'Adir'], J[k+'Nrm']
        ua, fa, hd = (LUA,LFA,LHAND) if s>0 else (RUA,RFA,RHAND)
        a = W(1,.86)*slim
        pr.append(el(S+v3(0,-.03,0), (.062*a,.078*a,.062*a), ua, .04))
        pr.append(rc(S, E, .05*a, .038*a, ua, .025))
        pr.append(el(S+.14*d+n*-.004+v3(0,0,.012), (.045*a,.085,.045*a), ua, .03, frame=(np.cross(d,v3(0,0,1)), -d, v3(0,0,1))))
        pr.append(rc(E, E+.11*d, .041*a, .039*a, fa, .02))
        pr.append(rc(E+.1*d, Wr, .039*a, .027*a, fa, .02))
        # hand: palm + fingers + thumb in hand frame (d along, z across, n palm normal)
        hs = W(1,.9)
        z = v3(0,0,1); fr = (n, -d, z)  # local axes x=n (thickness), y=-d (length), z=width
        pr.append(el(Wr+.045*d*hs, (.018*hs,.05*hs,.041*hs), hd, .012, frame=(n, d, z)))
        for i,off in enumerate((.026,.009,-.009,-.025)):
            L = (.083,.093,.088,.07)[i]*hs
            a0 = Wr+.085*d*hs+z*off*hs
            a1 = a0+d*L*.55+n*.006
            a2 = a1+d*L*.45+n*.016
            r = (.0095,.0102,.0098,.0085)[i]*hs
            pr.append(rc(a0,a1,r,r*.92,hd,.008)); pr.append(rc(a1,a2,r*.92,r*.8,hd,.006))
        t0 = Wr+.03*d*hs+z*.03*hs+n*.008
        t1 = t0+d*.035*hs+z*.022*hs+n*.018
        t2 = t1+d*.03*hs+z*.006*hs+n*.016
        pr.append(rc(t0,t1,.013*hs,.011*hs,hd,.012)); pr.append(rc(t1,t2,.011*hs,.009*hs,hd,.006))
    # legs
    for s,k in ((1,'l'),(-1,'r')):
        H, K, A, d = J[k+'Hip'], J[k+'Knee'], J[k+'Ank'], J[k+'Ldir']
        th, ca, ft = (LTH,LCALF,LFOOT) if s>0 else (RTH,RCALF,RFOOT)
        a = W(1,.92)*slim
        pr.append(rc(H+v3(.01*s,.02,0), K, W(.086,.09)*a, .053*a, th, .04))
        pr.append(el(H+.2*d+v3(0,0,.022), (.066*a,.15,.068*a), th, .04))
        pr.append(sp(K+v3(0,0,.008), .051*a, th, .025))
        pr.append(rc(K, A, .052*a, .034*a, ca, .025))
        pr.append(el(K+.13*d+v3(0,0,-.026), (.05*a,.1,.05*a), ca, .03))
        pr.append(sp(A, .036*a, ca, .02))
        # shoe
        sole = A[1]-.066
        heel = A+v3(0,-.03,-.035); toe = A+v3(0,-.036,.165)
        fA = rc(heel, toe, .043, .036, ft, .02)
        fB = rc(A+v3(0,.0,.0), A+v3(0,-.02,.1), .046, .04, ft, .03)
        for P0 in (fA, fB):
            g = P0['f']
            P0['f'] = (lambda g: (lambda P: np.maximum(g(P), (sole - P[1]))))(g)
            pr.append(P0)
    return pr

def head_prims(sex):
    f = sex; W = lambda m, w: m*(1-f)+w*f
    pr = []
    pr.append(el((0,1.74,-.015), (W(.076,.073), W(.093,.09), W(.098,.095)), SKIN_HEAD, .03))
    pr.append(el((0,1.70,.03), (W(.066,.062), .075, .07), SKIN_HEAD, .03))
    pr.append(rc((0,1.56,-.012), (0,1.66,-.02), W(.052,.046), .05, SKIN_HEAD, .02))
    for s in (1,-1):
        pr.append(rc((W(.056,.05)*s,1.665,-.025), (W(.026,.019)*s,1.611,.05), W(.019,.015), W(.017,.013), SKIN_HEAD, .02))
        pr.append(el((W(.038,.036)*s,W(1.67,1.674),.062), (W(.024,.026),W(.024,.026),W(.022,.025)), SKIN_HEAD, .02))
        pr.append(el((W(.05,.047)*s,1.695,.06), (.022,.014,.02), SKIN_HEAD, .015))
        pr.append(rc((W(.047,.044)*s,1.736,.08), (0,1.739,W(.09,.087)), W(.012,.008), W(.012,.008), SKIN_HEAD, .015))
        pr.append(el((.077*s,1.708,-.008), (.011,W(.031,.028),.019), SKIN_HEAD, .01))
    pr.append(el((0,1.609,.068), (W(.026,.02),.02,.021), SKIN_HEAD, .02))
    for s in (1,-1): pr.append(el((.046*s,1.65,.04), (.022,.026,.022), SKIN_HEAD, .025))
    pr.append(el((0,1.643,.078), (.035,.03,.018), SKIN_HEAD, .02))
    # eye openings carved before the detail goes on
    for s in (1,-1):
        pr.append(el((.032*s,1.7102,.096), (.0168,.0066,.0125), SKIN_HEAD, .004, op='s'))
    for s in (1,-1):
        pr.append(el((.032*s,1.7192,.0888), (.0168,.0038,.0058), SKIN_HEAD, .004))
        pr.append(el((.012*s,1.676,W(.103,.1)), (.009,.008,.009), SKIN_HEAD, .008))
        pr.append(el((.03*s,1.656,.082), (.014,.012,.011), SKIN_HEAD, .012))
        pr.append(rc((.011*s,1.7395,.0975), (.032*s,W(1.7428,1.7445),.0955), W(.0034,.002), W(.0032,.0019), BROW, .002))
        pr.append(rc((.032*s,W(1.7428,1.7445),.0955), (.056*s,1.7385,.0865), W(.0032,.0019), W(.0024,.0013), BROW, .002))
    pr.append(rc((0,1.727,.0875), (0,W(1.684,1.688),W(.112,.106)), W(.0078,.0068), W(.0105,.0085), SKIN_HEAD, .012))
    pr.append(el((0,1.656,.088), (.016,.013,.009), SKIN_HEAD, .01))
    lf = W(1,1.18)
    pr.append(el((0,1.6462,.0885), (.0205,.0056*lf,.0062*lf), LIPS, .005))
    pr.append(el((0,1.6345,.0875), (.0185,.0066*lf,.0068*lf), LIPS, .005))
    for s in (1,-1):
        pr.append(sp((.086*s,1.71,-.004), .0115, SKIN_HEAD, .006, op='s'))
    pr.append(rc((-.021,1.6428,.093), (0,1.6398,.0955), .0013, .0013, LIPS, .002)); pr[-1]['op']='s'
    pr.append(rc((0,1.6398,.0955), (.021,1.6428,.093), .0013, .0013, LIPS, .002)); pr[-1]['op']='s'
    return pr

def hair_prims(style):
    pr = []
    H = 30
    if style=='long':
        pr.append(el((0,1.748,-.016), (.083,.1,.106), H, .02))
        for s in (1,-1):
            pr.append(rc((.05*s,1.79,.065), (.086*s,1.66,.035), .02, .016, H, .02))
            pr.append(rc((.086*s,1.66,.035), (.09*s,1.56,.0), .016, .014, H, .02))
        pr.append(rc((0,1.74,-.07), (0,1.44,-.075), .088, .07, H, .04, zs=.55))
        for s in (1,-1): pr.append(rc((.05*s,1.7,-.065), (.08*s,1.46,-.055), .05, .04, H, .04, zs=.6))
        pr.append(rc((0,1.86,.07),(0,1.84,-.05),.0032,.0032,H,.004)); pr[-1]['op']='s'
    else:
        tall = .006 if style=='tousled' else 0.0
        pr.append(el((0,1.747,-.018), (.0835,.1+tall,.106), H, .02))
        rr = np.random.default_rng(3 if style=='tousled' else 5)
        n = 16 if style=='tousled' else 8
        for i in range(n):
            th = rr.uniform(-2.2, 2.2); ph = rr.uniform(.15, .9)
            c = v3(np.sin(th)*np.cos(ph)*.07, 1.75+np.sin(ph)*.085, np.cos(th)*np.cos(ph)*.08-.015)
            pr.append(el(c, (rr.uniform(.018,.03),.016,rr.uniform(.02,.035)), H, .02))
        if style=='tousled': pr.append(rc((0.0,1.82,.06),(.025,1.785,.095),.022,.009,H,.02))
        else: pr.append(rc((-.03,1.825,.05),(.04,1.81,.075),.02,.012,H,.02))
    return pr

def hair_post(style):
    def post(D, L, xs, ys, zs):
        x = xs[:,None,None]; y = ys[None,:,None]; z = zs[None,None,:]
        if style=='long':
            front = 1.8 - .055*np.clip(np.abs(x)/.07,0,1)**1.4
            hl = np.where(z < -.03, -10.0, np.where(z < 0.0, np.minimum(1.74, front), front)) + 0*x
            hl = np.where(np.abs(x) > .072, -10.0, hl)
            D = np.maximum(D, (hl - y).astype(np.float32))
            ang = np.arctan2(x, z+.07)
            D = D - (0.0016*np.sin(ang*95) + .001*np.sin(ang*41+1.3) + .0008*np.sin(y*160)).astype(np.float32)
        else:
            hl = 1.64 + (1.79-1.64)*np.clip((z+.07)/.11, 0, 1)
            ears = (np.abs(x) > .062) & (z > -.035) & (z < .06)
            hl = np.where(ears, np.maximum(hl, 1.738), hl)
            hl = hl + .005*np.sin(x*90+1.0)+.003*np.sin(x*210)
            D = np.maximum(D, (hl - y).astype(np.float32))
            ang = np.arctan2(x, z)
            D = D - (.0013*np.sin(ang*70+y*40) + .0009*np.sin(x*300+z*120)).astype(np.float32)
        return D
    return post

# ---------- clothing ----------
def tparam(V, k, seg):
    if seg=='ua': a, d, L = J[k+'Sh'], J[k+'Adir'], .3
    else: a, d, L = J[k+'El'], J[k+'Adir'], .265
    return ((V - a) @ d)/L

MAT = dict(skin=0, top=1, bottom=2, shoe=3, accent=4, hair=5, lips=6, brow=5, tie=7)

def cloth_rules(char):
    """returns fn(x,y,z,label)->(inflate, matid) arrays"""
    def fn(x, y, z, lab):
        infl = np.zeros(np.broadcast(x,y,z).shape if np.ndim(x)>1 else lab.shape, np.float32)
        mat = np.zeros(infl.shape, np.int8)
        X = np.broadcast_to(x, infl.shape); Y = np.broadcast_to(y, infl.shape); Z = np.broadcast_to(z, infl.shape)
        def set_(mask, m, inf):
            mat[mask] = m; infl[mask] = inf
        torso = (lab==CHEST)|(lab==ABD)|(lab==PELVIS)
        legs = (lab==LTH)|(lab==LCALF)|(lab==RTH)|(lab==RCALF)
        torso = torso | (((lab==LTH)|(lab==RTH)) & (Y > .955))
        legs = legs & ~torso
        feet = (lab==LFOOT)|(lab==RFOOT)
        V = np.stack([X,Y,Z],-1)
        tL_ua = tparam(V,'l','ua'); tR_ua = tparam(V,'r','ua'); tL_fa = tparam(V,'l','fa'); tR_fa = tparam(V,'r','fa')
        ua = (lab==LUA)|(lab==RUA); fa = (lab==LFA)|(lab==RFA)
        t_ua = np.where(lab==LUA, tL_ua, tR_ua); t_fa = np.where(lab==LFA, tL_fa, tR_fa)
        wr = wrinkle(X, Y, Z)
        set_(feet, MAT['shoe'], .004)
        if char=='baden':
            set_(torso & (Y>.99), MAT['top'], .005); set_(torso & (Y<=.99) & (Y>.958), MAT['accent'], .007)
            set_(torso & (Y<=.958), MAT['bottom'], .006)
            set_(legs, MAT['bottom'], .006)
            set_(ua, MAT['top'], .006)
            set_(fa & (t_fa < .3), MAT['top'], .009)
            set_((lab==NECK) & (Y < 1.462), MAT['top'], .005)
            infl += np.where(mat==MAT['top'], wr, 0) + np.where(mat==MAT['bottom'], wr*1.3, 0)
        elif char=='dowie':
            set_(torso, MAT['top'], .004)
            set_(ua & (t_ua < .32), MAT['top'], .006)
            infl += np.where(mat==MAT['top'], wr*.6, 0)
        elif char=='bob':
            set_(torso & (Y>.94), MAT['top'], .009); set_(torso & (Y<=.94), MAT['bottom'], .006)
            set_(legs, MAT['bottom'], .006)
            set_(ua, MAT['top'], .009); set_(fa & (t_fa < .86), MAT['top'], .009); set_(fa & (t_fa >= .86) & (t_fa < .94), MAT['accent'], .005)
            vneck = (lab==CHEST) & (Z > .02) & (Y > 1.17) & (np.abs(X) < (.006+(Y-1.17)*.2))
            set_(vneck, MAT['accent'], .004)
            tie = vneck & (np.abs(X) < np.where(Y > 1.425, .011, .0045+(Y-1.17)*.018))
            set_(tie, MAT['tie'], .0055)
            set_((lab==NECK) & (Y < 1.47), MAT['accent'], .006)
            infl += np.where(mat==MAT['top'], wr*.7, 0) + np.where(mat==MAT['bottom'], wr, 0)
        return infl, mat
    return fn

def body_post(rules):
    def post(D, L, xs, ys, zs):
        x = xs[:,None,None]; y = ys[None,:,None]; z = zs[None,None,:]
        infl, _ = rules(x, y, z, L)
        return D - infl
    return post

# ---------- skin weights ----------
def seg_dist(V, a, b):
    ab = b-a; t = np.clip(((V-a)@ab)/(ab@ab), 0, 1)
    return np.linalg.norm(V - (a + t[:,None]*ab), axis=1)

def bone_segs():
    S = {}
    S['hips'] = (v3(0,.9,-.01), v3(0,1.0,0)); S['spine'] = (v3(0,1.025,0), v3(0,1.2,0)); S['chest'] = (v3(0,1.27,0), v3(0,1.5,0))
    S['neck'] = (J['neck'], J['head']); S['head'] = (J['head'], J['head']+v3(0,.2,0))
    for k in 'lr':
        S[k+'Sh'] = (J[k+'Sh'], J[k+'El']); S[k+'El'] = (J[k+'El'], J[k+'Hand']); S[k+'Hand'] = (J[k+'Hand'], J[k+'Hand']+.17*J[k+'Adir'])
        S[k+'Hip'] = (J[k+'Hip'], J[k+'Knee']); S[k+'Knee'] = (J[k+'Knee'], J[k+'Ank']); S[k+'Ank'] = (J[k+'Ank'], J[k+'Ank']+v3(0,-.03,.16))
    return S
SEGS = bone_segs()
CAND = {PELVIS:['hips','spine','lHip','rHip'], ABD:['hips','spine','chest'], CHEST:['spine','chest','neck','lSh','rSh'], NECK:['chest','neck','head'],
        LUA:['chest','lSh','lEl'], LFA:['lSh','lEl','lHand'], LHAND:['lEl','lHand'], RUA:['chest','rSh','rEl'], RFA:['rSh','rEl','rHand'], RHAND:['rEl','rHand'],
        LTH:['hips','lHip','lKnee'], LCALF:['lHip','lKnee','lAnk'], LFOOT:['lKnee','lAnk'], RTH:['hips','rHip','rKnee'], RCALF:['rHip','rKnee','rAnk'], RFOOT:['rKnee','rAnk']}
PENALTY = {(CHEST,'lSh'):1.7,(CHEST,'rSh'):1.7,(PELVIS,'lHip'):1.25,(PELVIS,'rHip'):1.25,(CHEST,'neck'):1.4}

def skin(V, lab):
    n = len(V); idx = np.zeros((n,4), np.uint8); w = np.zeros((n,4), np.float32)
    for part, bones in CAND.items():
        m = lab==part
        if not m.any(): continue
        Vm = V[m]; ds = []
        for b in bones:
            d = seg_dist(Vm, *SEGS[b])*PENALTY.get((part,b),1.0)
            ds.append(d)
        ds = np.stack(ds,1); ww = 1.0/(ds**6+1e-14); ww /= ww.sum(1,keepdims=True)
        order = np.argsort(-ww,1)[:,:4]
        bi = np.array([BI[b] for b in bones])[order]; wv = np.take_along_axis(ww, order, 1)
        k = wv.shape[1]
        idx[m,:k] = bi; w[m,:k] = wv
    w /= np.maximum(w.sum(1,keepdims=True), 1e-9)
    return idx, w

# ---------- skirt ----------
def skirt():
    ny, nt = 60, 220
    ys = np.linspace(1.0, .56, ny); th = np.linspace(0, 2*np.pi, nt, endpoint=False)
    V = []; Nn = []
    for i,y in enumerate(ys):
        u = (1.0-y)/.44
        r = .132 + (.205-.132)*np.clip((1.0-y)/.06,0,1)**.7 + .1*u**1.25
        for t in th:
            pleat = .011*np.sin(t*9+.4)*u**1.1 + .004*np.sin(t*23)*u
            rx = (r+pleat); rz = (r+pleat)*.86
            V.append((np.sin(t)*rx, y - .006*np.sin(t*9+.4)*u, np.cos(t)*rz - .005))
    V = np.array(V); F = []
    for i in range(ny-1):
        for j in range(nt):
            a = i*nt+j; b = i*nt+(j+1)%nt; c = (i+1)*nt+j; d = (i+1)*nt+(j+1)%nt
            F += [(a,c,b),(b,c,d)]
    F = np.array(F)
    # normals
    Nn = np.zeros_like(V); fa, fb, fc = V[F[:,0]], V[F[:,1]], V[F[:,2]]; fn = np.cross(fb-fa, fc-fa)
    for k in range(3): np.add.at(Nn, F[:,k], fn)
    Nn /= np.linalg.norm(Nn,axis=1,keepdims=True)
    if (Nn*np.c_[V[:,0],np.zeros(len(V)),V[:,2]+.005]).sum(1).mean() < 0: F = F[:,::-1]; Nn = -Nn
    u = np.clip((1.0-V[:,1])/.44,0,1); s = np.clip((V[:,0]+.07)/.14,0,1); s = s*s*(3-2*s)
    wl = .62*u**1.6*s; wr = .62*u**1.6*(1-s); wh = 1-wl-wr
    idx = np.zeros((len(V),4),np.uint8); w = np.zeros((len(V),4),np.float32)
    idx[:,0]=BI['hips']; idx[:,1]=BI['lHip']; idx[:,2]=BI['rHip']; w[:,0]=wh; w[:,1]=wl; w[:,2]=wr
    mat = np.full(len(F), MAT['top'], np.int8)
    return V, F, Nn, idx, w, mat

# ---------- packing ----------
def pack_mesh(name, V, F, N, idx, w, fmat, double=False):
    order = np.argsort(fmat, kind='stable'); F = F[order]; fmat = fmat[order]
    groups = []
    for m in np.unique(fmat):
        ii = np.where(fmat==m)[0]; groups.append(dict(start=int(ii[0])*3, count=int(len(ii))*3, mat=int(m)))
    Nq = np.clip(np.round(N/np.linalg.norm(N,axis=1,keepdims=True)*127),-127,127).astype(np.int8)
    Nq = np.c_[Nq, np.zeros(len(Nq),np.int8)]
    wq = np.round(w*255).astype(np.int32); diff = 255 - wq.sum(1); wq[np.arange(len(wq)), wq.argmax(1)] += diff
    blobs = [np.round(V*10000).astype(np.int16).tobytes(), Nq.tobytes(), idx.astype(np.uint8).tobytes(), wq.clip(0,255).astype(np.uint8).tobytes(), F.astype(np.uint32).tobytes()]
    return dict(name=name, vcount=int(len(V)), icount=int(F.size), groups=groups, double=double), blobs

def tri_mat(F, vm):
    m = vm[F]  # (nf,3)
    out = m[:,0].copy(); same12 = m[:,1]==m[:,2]; out[same12] = m[same12,1]
    return out

def build(char, sex, slim, hairstyle, hbody=.0045, hhead=.0017, hhair=.002):
    t0 = time.time()
    meshes = []; blobs = []
    rules = cloth_rules(char)
    pr = body_prims(sex, slim)
    D, L, xs, ys, zs = evaluate(pr, (-.72,-.002,-.24), (.72,1.64,.27), hbody, post=body_post(rules))
    V, F, N = polygonise(D, xs, ys, zs, hbody); del D, L
    lab = label_at(pr, V)
    _, vm = rules(V[:,0], V[:,1], V[:,2], lab)
    vm = np.asarray(vm).astype(np.int8)
    idx, w = skin(V, lab)
    m, b = pack_mesh('body', V, F, N, idx, w, tri_mat(F, vm)); meshes.append(m); blobs += b
    print(char, 'body', len(V), 'verts', round(time.time()-t0,1), 's', flush=True)
    # head
    hp = head_prims(sex)
    D, L, xs, ys, zs = evaluate(hp, (-.105,1.54,-.135), (.105,1.865,.142), hhead)
    V, F, N = polygonise(D, xs, ys, zs, hhead); del D, L
    lab = label_at(hp, V)
    vm = np.where(lab==LIPS, MAT['lips'], np.where(lab==BROW, MAT['brow'], MAT['skin'])).astype(np.int8)
    idx = np.zeros((len(V),4),np.uint8); w = np.zeros((len(V),4),np.float32)
    wh = np.clip((V[:,1]-1.57)/.06,0,1); wh = wh*wh*(3-2*wh)
    idx[:,0]=BI['head']; idx[:,1]=BI['neck']; w[:,0]=wh; w[:,1]=1-wh
    m, b = pack_mesh('head', V, F, N, idx, w, tri_mat(F, vm)); meshes.append(m); blobs += b
    print(char, 'head', len(V), 'verts', round(time.time()-t0,1), 's', flush=True)
    # hair
    hpr = hair_prims(hairstyle)
    lo = (-.13,1.32,-.17) if hairstyle=='long' else (-.105,1.6,-.14)
    D, L, xs, ys, zs = evaluate(hpr, lo, (.13,1.88,.135), hhair, post=hair_post(hairstyle))
    V, F, N = polygonise(D, xs, ys, zs, hhair); del D, L
    idx = np.zeros((len(V),4),np.uint8); w = np.zeros((len(V),4),np.float32); idx[:,0]=BI['head']; w[:,0]=1
    m, b = pack_mesh('hair', V, F, N, idx, w, np.full(len(F), MAT['hair'], np.int8)); meshes.append(m); blobs += b
    print(char, 'hair', len(V), 'verts', round(time.time()-t0,1), 's', flush=True)
    if char=='dowie':
        V, F, N, idx, w, fm = skirt()
        m, b = pack_mesh('skirt', V, F, N, idx, w, fm, double=True); meshes.append(m); blobs += b
    # assemble binary
    out = bytearray(); off = 0
    for m in meshes:
        m['off'] = []
    k = 0
    for m in meshes:
        for _ in range(5):
            bb = blobs[k]; k += 1
            pad = (-len(out)) % 4; out += b'\0'*pad
            m['off'].append(len(out)); out += bb
    eyes = dict(l=[.032,1.7105,.0805], r=[-.032,1.7105,.0805], r_=.0123)
    meta = dict(char=char, bones=BONES, armA=40, legA=3, meshes=meshes, eyes=eyes)
    hdr = json.dumps(meta).encode(); hdr += b' '*((-len(hdr)-8)%4)
    with open(f'/home/claude/previs/dist/{char}.bin','wb') as fo:
        fo.write(b'BOB1'); fo.write(struct.pack('<I', len(hdr))); fo.write(hdr); fo.write(out)
    print(char, 'done', round(time.time()-t0,1), 's', 'MB', round((len(out)+len(hdr))/1e6,2), flush=True)

if __name__ == '__main__':
    which = sys.argv[1:] or ['dowie','baden','bob']
    cfg = dict(dowie=(1.0,1.0,'long'), baden=(0.0,1.0,'tousled'), bob=(0.0,.93,'neat'))
    for c in which: build(c, *cfg[c], **({'hhair':.0024} if c=='dowie' else {}))
