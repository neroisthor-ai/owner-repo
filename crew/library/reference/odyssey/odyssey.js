
(() => {
'use strict';
const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
if (CAPTURE) document.body.classList.add('capture');
const DUR = 30.0;

// ---------- small vector lib ----------
const V = {
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  len:(a)=>Math.hypot(a[0],a[1],a[2]),
  norm:(a)=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];},
  lerp:(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],
};
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
const easeIO=t=>t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const easeIn=t=>t*t*t;
const easeOut=t=>1-Math.pow(1-t,3);
const bump=(t,a,b,c)=>sstep(a,b,t)*(1-sstep(b,c,t));
function mulM(m,v){ // m = [c0,c1,c2] columns
  return [m[0][0]*v[0]+m[1][0]*v[1]+m[2][0]*v[2], m[0][1]*v[0]+m[1][1]*v[1]+m[2][1]*v[2], m[0][2]*v[0]+m[1][2]*v[1]+m[2][2]*v[2]];
}
function lookRot(pos, target, roll){
  const f = V.norm(V.sub(target,pos));
  let r = V.norm(V.cross([0,1,0], f));
  let u = V.cross(f, r);
  if (roll){ const c=Math.cos(roll), s=Math.sin(roll); const r2=V.add(V.mul(r,c),V.mul(u,s)); const u2=V.add(V.mul(u,c),V.mul(r,-s)); r=r2; u=u2; }
  return [r,u,f];
}
function flatM(m){ return new Float32Array([...m[0],...m[1],...m[2]]); }
// smooth noise for handheld camera
function sn(t, seed){ return Math.sin(t*1.13+seed)*0.5+Math.sin(t*2.71+seed*2.3)*0.3+Math.sin(t*5.37+seed*4.1)*0.2; }
function shake(t, amp, speed, seed=0){ return [sn(t*speed,1.3+seed)*amp, sn(t*speed,7.1+seed)*amp*0.8, sn(t*speed,4.4+seed)*amp*0.5]; }
function rng(seed){ return ()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// ---------- GL setup ----------
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', {antialias:false, preserveDrawingBuffer:true, alpha:false, powerPreference:'high-performance'});
if (!gl) { document.getElementById('fatal').hidden = false; return; }
const hasCBF = !!gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');
gl.getExtension('EXT_float_blend');

const src = id => document.getElementById(id).textContent;
const COMMON = src('common');
function compile(type, s){
  const sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){ const log=gl.getShaderInfoLog(sh); console.error(log); throw new Error(log); }
  return sh;
}
function program(fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, src('vs')));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for(let i=0;i<n;i++){ const info=gl.getActiveUniform(p,i); const name=info.name.replace(/\[0\]$/,''); u[name]=gl.getUniformLocation(p, info.name); }
  return {p,u};
}
const DEFS = (params.get('defs')||'').split(',').filter(Boolean).map(d=>'#define '+d+'\n').join('');
const sceneSrc = hq => '#version 300 es\n' + (hq ? '#define HQ\n' : '') + DEFS + COMMON + src('scene');
const P_SCENE = program(sceneSrc(false));
let P_SCENE_HQ = null;
function sceneProgram(hq){ if(!hq) return P_SCENE; if(!P_SCENE_HQ) P_SCENE_HQ = program(sceneSrc(true)); return P_SCENE_HQ; }
const P_PROBE = program('#version 300 es\n' + COMMON + src('probe'));
const P_POST  = program(src('post'));
const P_RESOLVE = program(src('resolve'));

const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);

const noiseTex = gl.createTexture();
{
  const N=256, R=new Uint8Array(N*N), r=rng(1337);
  for(let i=0;i<N*N;i++) R[i]=(r()*256)|0;
  const data=new Uint8Array(N*N*4);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const i=(y*N+x)*4;
    data[i]=R[y*N+x]; data[i+1]=R[((y+17)&255)*N+((x+37)&255)]; data[i+2]=(r()*256)|0; data[i+3]=(r()*256)|0;
  }
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
}

const titleTex = gl.createTexture();
const TITLE_FONT = '"GFS Didot", "DejaVu Serif", Georgia, "Times New Roman", serif';
function makeTitle(w,h){
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const x = c.getContext('2d');
  x.fillStyle='#000'; x.fillRect(0,0,w,h);
  x.fillStyle='#fff'; x.textAlign='center'; x.textBaseline='middle';
  const s = Math.min(h/1080, w/1920*1.0) * (h/w > 0.5 ? 1 : 1.25);
  const spaced = (txt, size, gapEm, y, alpha) => {
    x.font = `${Math.round(size)}px ${TITLE_FONT}`; x.globalAlpha = alpha;
    const gap = gapEm*size; let total=0;
    const ws=[...txt].map(ch=>{const m=x.measureText(ch).width; total+=m+gap; return m;}); total-=gap;
    let cx = w/2 - total/2;
    [...txt].forEach((ch,i)=>{ x.fillText(ch, cx+ws[i]/2, y); cx += ws[i]+gap; });
  };
  spaced('ΟΔΥΣΣΕΙΑ', 96*s, 0.42, h/2 - 18*s, 1);
  spaced('ΡΑΨΩΔΙΑ  Μ', 22*s, 0.5, h/2 + 64*s, 0.62);
  gl.bindTexture(gl.TEXTURE_2D, titleTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
}

// accumulation (linear HDR sum of sub-frames) and resolved HDR with mips for bloom
let accTex=null, accFbo=null, hdrTex=null, hdrFbo=null, W=0, H=0;
function makeTarget(w,h,mips){
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  const levels = mips ? Math.floor(Math.log2(Math.max(w,h)))+1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, hasCBF?gl.RGBA16F:gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER, mips?gl.LINEAR_MIPMAP_LINEAR:gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER, mips?gl.LINEAR:gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return [tex, fbo];
}
function resize(w,h){
  w=Math.max(16,Math.round(w/2)*2); h=Math.max(16,Math.round(h/2)*2);
  if (w===W && h===H) return false;
  W=w; H=h; canvas.width=w; canvas.height=h;
  [accTex,hdrTex].forEach(t=>t&&gl.deleteTexture(t)); [accFbo,hdrFbo].forEach(f=>f&&gl.deleteFramebuffer(f));
  [accTex, accFbo] = makeTarget(w,h,false);
  [hdrTex, hdrFbo] = makeTarget(w,h,true);
  makeTitle(w,h);
  return true;
}

const probeTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, probeTex);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,8,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
const probeFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, probeFbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, probeTex, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const probeBuf = new Uint8Array(32);

// ---------- timeline ----------
const WHIRL_C = [-90, 322];
const whirlAmt = t => 0.04 + 0.96*sstep(6.5, 14.0, t);
function spinAt(t){ // integral of whirl strength * base angular speed
  let s=0; const dt=0.02; for(let x=0;x<t;x+=dt) s+=whirlAmt(x)*0.95*dt; return s;
}
const oarRate = t => 3.4 + 2.6*bump(t,13.5,15.5,19.5) + 1.6*bump(t,26,27,29.5);
function oarPhaseAt(t){ let s=0; const dt=0.02; for(let x=0;x<t;x+=dt) s+=oarRate(x)*dt; return s; }

function shipXZ(t){
  const z = 188 + 6.6*t + 1.2*sstep(13,19,t)*(t-13);
  let x = -16 - 12*sstep(6, 14.6, t);
  x = lerp(x, 29, sstep(14.4, 19.6, t));
  x += -2.5*sstep(22, 30, t);
  return [x, z];
}
const LIGHTNING = [
  {t:0.66, I:4.6, p:[-340, 760, 2300]},
  {t:3.15, I:2.4, p:[520, 620, 2600]},
  {t:6.15, I:3.6, p:[-820, 560, 2100]},
  {t:10.35,I:3.2, p:[1100, 700, 2500]},
  {t:13.55,I:3.0, p:[-620, 820, 1500]},
  {t:16.25,I:2.2, p:[260, 620, 3000]},
  {t:23.25,I:9.0, p:[760, 920, 640]},
  {t:25.55,I:4.5, p:[420, 820, 1250]},
  {t:26.85,I:5.5, p:[900, 700, 580]},
  {t:28.45,I:3.2, p:[-1000, 620, 2100]},
];
function flashEnv(x){
  if (x < 0) return 0;
  let f = Math.exp(-x/0.045);
  if (x > 0.085) f += 0.75*Math.exp(-(x-0.085)/0.06);
  if (x > 0.20) f += 0.45*Math.exp(-(x-0.20)/0.11);
  f += 0.06*Math.exp(-x/0.6);
  return f;
}
const bolts = LIGHTNING.map((L,k)=>{ // jagged world-space bolt with a branch
  const r = rng(100+k*31);
  const pts=[]; const N=22;
  const top=L.p, bottom=[L.p[0]+(r()-0.5)*600, 0, L.p[2]+(r()-0.5)*300];
  let off=[0,0,0];
  for(let i=0;i<=N;i++){
    const f=i/N; const p=V.lerp(top,bottom,f);
    off=V.add(off,[(r()-0.5)*90,(r()-0.5)*20,(r()-0.5)*60]);
    pts.push(V.add(p, V.mul(off, Math.sin(f*Math.PI)*0.9+0.1)));
  }
  const bi = 6 + ((r()*6)|0); const br=[pts[bi]]; let o2=[0,0,0];
  for(let i=1;i<=10;i++){ o2=V.add(o2,[(r()-0.3)*80,-(40+r()*40),(r()-0.5)*50]); br.push(V.add(pts[bi],o2)); }
  return {main:pts, branch:br};
});
function lightningAt(t){
  let best=null, bestV=0;
  for(let k=0;k<LIGHTNING.length;k++){
    const L=LIGHTNING[k]; const v=L.I*flashEnv(t-L.t);
    if (v>bestV){bestV=v; best=k;}
  }
  let sum=0; for(const L of LIGHTNING) sum+=L.I*flashEnv(t-L.t);
  const k = best===null?0:best;
  const x = best===null?1e3:(t-LIGHTNING[k].t);
  const vis = (x>=0 && x<0.32) ? clamp(flashEnv(x),0,1.4)*Math.min(1,LIGHTNING[k].I/3) : 0;
  return {flash:sum, k, pos:LIGHTNING[k].p, vis};
}

// probes ocean height under the hull, returns ship transform
// ---------- ocean height on the CPU (mirrors the shader) ----------
const WDIR = [[-0.37908,-0.92537],[0.99432,-0.10645],[0.99038,-0.13838],[0.74041,-0.67215],[-0.22408,-0.97457],[0.88637,-0.46298],[0.93573,-0.35272],[0.84249,-0.53872],[0.85075,-0.52556],[-0.44157,-0.89722],[0.13313,-0.99110],[0.99986,0.01656],[0.41355,-0.91048],[-0.11449,-0.99342],[0.16123,-0.98692],[0.99401,-0.10929],[0.92184,-0.38758],[0.66567,-0.74624],[0.20616,-0.97852],[0.64781,-0.76180],[0.71194,-0.70224],[-0.54960,-0.83543],[0.45121,-0.89242],[-0.45174,-0.89215],[0.56232,-0.82692],[-0.01163,-0.99993],[0.96159,-0.27447],[0.83651,-0.54795],[-0.53393,-0.84553],[-0.50774,-0.86151],[-0.42983,-0.90291],[0.64105,-0.76750],[0.46869,-0.88336],[0.97364,-0.22810],[0.99540,-0.09578],[-0.10856,-0.99409],[0.81714,-0.57644],[-0.38677,-0.92218],[-0.54833,-0.83626],[0.99956,0.02957]];
function wavesJS(px, pz, t, it){
  let freq=0.034, amp=1, h=0, w=0, spd=t*Math.sqrt(9.81*0.034);
  for(let i=0;i<it;i++){
    const d=WDIR[i];
    const x=(d[0]*px+d[1]*pz)*freq - spd;
    spd*=1.0908712;
    const e=Math.exp(Math.sin(x)-1), dx=e*Math.cos(x);
    h+=e*amp; w+=amp;
    px+=d[0]*dx*amp*0.30/freq; pz+=d[1]*dx*amp*0.30/freq;
    freq*=1.19; amp*=0.79;
  }
  return h/w;
}
function oceanHJS(px, pz, t, it, W, S){
  const vx=px-WHIRL_C[0], vz=pz-WHIRL_C[1]; const r=Math.hypot(vx,vz)+1e-3;
  const prof=1/(1+r*r/(46*46)); const ang=S*prof; const cs=Math.cos(ang), sn=Math.sin(ang);
  const wv=wavesJS(WHIRL_C[0]+cs*vx-sn*vz, WHIRL_C[1]+sn*vx+cs*vz, t, it);
  const damp=1-0.82*W*Math.exp(-r/60);
  const h=(wv-0.30)*8.5*damp;
  const funnel=W*(36*Math.pow(1+r*r/(14*14),-1.25)+6*Math.exp(-r/85));
  const th=Math.atan2(vz,vx);
  const spiral=Math.sin(th*3+Math.log(r)*5.5-S*2.2)*W*1.1*sstep(6,30,r)*Math.exp(-r/130);
  return h-funnel+spiral;
}

// ---------- ship dynamics: buoyant rigid body, integrated once and cached ----------
// The course over the ground is art-directed (shipXZ); heave, pitch, roll, yaw lag and surge are simulated.
const SIM = (()=>{
  const dt = 1/120, T0 = -8, T1 = DUR + 1;
  const n = Math.ceil((T1-T0)/dt)+1;
  const out = {dt, T0, n, heave:new Float32Array(n), pitch:new Float32Array(n), roll:new Float32Array(n), yaw:new Float32Array(n), surge:new Float32Array(n)};
  // hull sample stations (ship-local x, z) along the waterline footprint
  const pts=[]; for(let z=-15;z<=15.01;z+=2.5){ const hb=2.55*Math.sqrt(Math.max(1-(z/17)**2,0)); pts.push([0,z]); if(Math.abs(z)<13){ pts.push([-hb*0.9,z]); pts.push([hb*0.9,z]); } }
  let sz2=0, sx2=0; pts.forEach(q=>{ sz2+=q[2-1]*q[1]; sx2+=q[0]*q[0]; });
  const wH=2*Math.PI/2.6, zH=0.45, wP=2*Math.PI/3.4, zP=0.32, wR=2*Math.PI/4.6, zR=0.2, wY=2*Math.PI/3.2, zY=0.7, wS=2*Math.PI/5, zS=0.5;
  let h=null, hv=0, pt=0, pv=0, rl=0, rv=0, yw=null, yv=0, su=0, sv=0;
  let spin=0, oar=0;
  for(let i=0;i<n;i++){
    const t = T0 + i*dt;
    const tc = Math.max(t,0);
    const W = whirlAmt(tc);
    const [x,z] = shipXZ(tc); const [x2,z2] = shipXZ(tc+0.05);
    const yawPath = Math.atan2(x2-x, z2-z);
    if (yw===null) yw = yawPath;
    const cy=Math.cos(yw), sy=Math.sin(yw);
    // least-squares plane of the water under the hull: mean height, slope along and across
    let m=0, gz=0, gx=0;
    for(const q of pts){
      const wx = x + cy*q[0] + sy*(q[1]+su), wz = z - sy*q[0] + cy*(q[1]+su);
      const hh = oceanHJS(wx, wz, t, 12, W, spin);
      m+=hh; gz+=hh*q[1]; gx+=hh*q[0];
    }
    m/=pts.length; gz/=sz2; gx/=sx2;
    if (h===null){ h=m-0.35; pt=-Math.atan(gz); rl=Math.atan(gx); }
    const heaveT = m - 0.35;
    const pitchT = -Math.atan(gz)*0.85;          // + lowers the bow
    let rollT = Math.atan(gx)*0.55;              // + raises starboard
    // heel: wind on the sail, outward lean in the hard turn, the bank of the funnel
    const sail = 1 - sstep(18.5, 19.7, tc);
    const turnRate = (Math.atan2(...shipXZdiff(tc+0.1)) - Math.atan2(...shipXZdiff(tc-0.1)))/0.2;
    rollT += -0.045*sail + 0.35*turnRate;
    rollT = clamp(rollT, -0.2, 0.2);
    // stroke surge: each pull shoves the hull forward
    oar += oarRate(tc)*dt;
    const strokeF = Math.max(0, -Math.cos(oar))*3.2 - 1.0;
    hv += (wH*wH*(heaveT-h) - 2*zH*wH*hv)*dt; h += hv*dt;
    pv += (wP*wP*(pitchT-pt) - 2*zP*wP*pv)*dt; pt += pv*dt;
    rv += (wR*wR*(rollT-rl) - 2*zR*wR*rv)*dt; rl += rv*dt;
    let dy = yawPath - yw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yv += (wY*wY*dy - 2*zY*wY*yv + gx*0.25)*dt; yw += yv*dt;
    sv += (strokeF - wS*wS*su - 2*zS*wS*sv - gz*3.0)*dt; su += sv*dt;
    spin += W*0.95*dt*(t>=0?1:0);
    out.heave[i]=h; out.pitch[i]=pt; out.roll[i]=rl; out.yaw[i]=yw; out.surge[i]=su;
  }
  return out;
})();
function shipXZdiff(t){ const a=shipXZ(t), b=shipXZ(t+0.05); return [b[0]-a[0], b[1]-a[1]]; }
function simAt(arr, t){ const f=(t-SIM.T0)/SIM.dt; const i=clamp(Math.floor(f),0,SIM.n-2); const u=clamp(f-i,0,1); return arr[i]*(1-u)+arr[i+1]*u; }
const shipCache = new Map();
function shipAt(t){
  const key = Math.round(t*10000);
  if (shipCache.has(key)) return shipCache.get(key);
  const [x0,z0] = shipXZ(t);
  const yaw = simAt(SIM.yaw,t), pitch = simAt(SIM.pitch,t), roll = simAt(SIM.roll,t), heave = simAt(SIM.heave,t), surge = simAt(SIM.surge,t);
  const x = x0 + Math.sin(yaw)*surge, z = z0 + Math.cos(yaw)*surge;
  const cy=Math.cos(yaw), sy=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch), cr=Math.cos(roll), sr=Math.sin(roll);
  let right=[cr,sr,0], up=[-sr,cr,0], fwd=[0,0,1];
  const pitchM=v=>[v[0], v[1]*cp - v[2]*sp, v[1]*sp + v[2]*cp];
  const yawM=v=>[v[0]*cy + v[2]*sy, v[1], -v[0]*sy + v[2]*cy];
  right=yawM(pitchM(right)); up=yawM(pitchM(up)); fwd=yawM(pitchM(fwd));
  const s={pos:[x, heave, z], R:[right,up,fwd], yaw};
  shipCache.set(key,s); if(shipCache.size>256) shipCache.delete(shipCache.keys().next().value);
  return s;
}
const toWorld=(ship,l)=>V.add(ship.pos, mulM(ship.R,l));
const deckY = z=>2.4+1.7*Math.pow(Math.min(Math.abs(z)/17,1),3);
const floorY = z=>deckY(z) - lerp(1.05, 0.55, sstep(11.5, 12.5, Math.abs(z)));

// crew who will be taken (ship-local)
const CREW = [[-0.22,8.3],[0.25,5.6],[-0.2,2.9],[0.22,-1.6],[-0.25,-4.3],[0.2,-7.1]];
const STRIKE0 = 25.05, STRIKE_GAP = 0.31;
const strikeStart = i=>STRIKE0 + [0,2,4,1,3,5][i]*STRIKE_GAP;
const CAVE=[60,62,345];
function bez(p0,p1,p2,p3,s){ const a=1-s; return V.add(V.add(V.mul(p0,a*a*a),V.mul(p1,3*a*a*s)),V.add(V.mul(p2,3*a*s*s),V.mul(p3,s*s*s))); }

function headPlan(i, t, ship){
  const base=[CAVE[0]+12, CAVE[1]+((i%3)-1)*3.2, CAVE[2]+(Math.floor(i/3)-0.5)*7+((i%3)-1)*2.0];
  const hidden=V.add(base,[-3,0,0]);
  const hover=[38-6*(i%2)+3*Math.sin(t*0.7+i), 74+9*Math.sin(i*1.7)+2.5*Math.sin(t*0.9+i*2), 326+i*7.5+2*Math.sin(t*0.6+i*3)];
  const e = easeIO(sstep(21.25+i*0.26, 23.2+i*0.22, t));
  let head = V.lerp(hidden, hover, e);
  let jaw = 0.15 + 0.35*e*(0.5+0.5*Math.sin(t*2.3+i));
  let carry = false;
  const s0 = strikeStart(i);
  const local = [CREW[i][0], floorY(CREW[i][1])+1.4, CREW[i][1]];
  if (t > s0-0.35){
    const target = toWorld(ship, local);
    const d = clamp((t-(s0-0.35))/0.42,0,1);
    head = V.lerp(head, target, easeIn(d));
    jaw = lerp(jaw, 1.1, sstep(0,0.7,d));
    if (t > s0+0.07){ jaw = lerp(1.1, 0.25, sstep(s0+0.07, s0+0.16, t)); carry = true; }
    if (t > s0+0.12){
      const l = easeOut(clamp((t-(s0+0.12))/1.5,0,1));
      const lift=[46-4*(i%2), 98+8*Math.sin(i*2.1), 334+i*6.5];
      head = V.lerp(target, lift, l);
      const l2 = sstep(s0+1.6, s0+4.5, t);
      head = V.lerp(head, [56, 115+i*3, 340+i*3], l2*0.6);
    }
  }
  return {head, jaw, base, carry, emerge:e};
}

function scyllaAt(t, ship){
  const necks=new Float32Array(48*3), nb=new Float32Array(24), hf=new Float32Array(24), eyes=new Float32Array(36);
  const men=new Float32Array(24), menUp=new Float32Array(18);
  for(let i=0;i<6;i++){
    const hp = headPlan(i,t,ship);
    const H=hp.head, B=hp.base;
    const shipC = V.add(ship.pos,[0,3,0]);
    const P1 = V.add(B, [-26, -4+i, (i-2.5)*2]);
    const toB = V.sub(B,H);
    const P2 = V.add(V.add(H, V.mul(toB,0.25)), [8, 20, 0]);
    const pts=[];
    for(let j=0;j<8;j++){
      const s=j/7; let p=bez(B,P1,P2,H,s);
      const tg = V.norm(V.sub(bez(B,P1,P2,H,Math.min(1,s+0.02)), bez(B,P1,P2,H,Math.max(0,s-0.02))));
      const pr = V.norm(V.cross(tg,[0,1,0]));
      const wv = Math.sin(s*Math.PI*2.2 - t*2.4 + i*1.3)*2.4*s*(1-s)*4;
      p = V.add(p, V.add(V.mul(pr,wv), [0, Math.sin(s*Math.PI*1.7 - t*1.9 + i)*1.6*s*(1-s)*4, 0]));
      pts.push(p);
    }
    pts[7]=H;
    pts.forEach((p,j)=>{ necks[(i*8+j)*3]=p[0]; necks[(i*8+j)*3+1]=p[1]; necks[(i*8+j)*3+2]=p[2]; });
    let c=[0,0,0]; pts.forEach(p=>c=V.add(c,p)); c=V.mul(c,1/8);
    let rad=0; pts.forEach(p=>rad=Math.max(rad,V.len(V.sub(p,c)))); rad+=17;
    nb.set([c[0],c[1],c[2],rad], i*4);
    let tgt = shipC;
    const s0=strikeStart(i);
    let fwd = V.norm(V.lerp(V.norm(V.sub(H,pts[6])), V.norm(V.sub(tgt,H)), 0.65));
    if (hp.carry) fwd = V.norm(V.lerp(V.norm(V.sub(H,pts[6])), [0,-0.4,0], 0.3));
    hf.set([fwd[0],fwd[1],fwd[2],hp.jaw], i*4);
    const r=V.norm(V.cross([0,1,0],fwd)), u=V.cross(fwd,r);
    const S=2.2;
    for(const sx of [-1,1]){
      const e=V.add(H, V.add(V.mul(r,0.66*sx*S), V.add(V.mul(u,0.55*S), V.mul(fwd,1.25*S))));
      eyes.set(e, (i*2+(sx>0?1:0))*3);
    }
    // crew member i
    const local=[CREW[i][0], floorY(CREW[i][1]), CREW[i][1]];
    let mp = toWorld(ship, local), mu = ship.R[1];
    if (t > s0+0.07){
      const jawPt = V.add(H, V.add(V.mul(fwd, 2.6*S), V.mul(u, -0.6*S)));
      mp = V.add(jawPt, [0,-1.0,0]);
      const sway = Math.sin(t*5+i)*0.5;
      mu = V.norm([Math.sin(sway)*0.6, 0.6, Math.cos(sway+i)*0.6]);
    }
    men.set([mp[0],mp[1],mp[2],1], i*4); menUp.set(mu, i*3);
  }
  return {necks,nb,hf,eyes,men,menUp};
}

// ---------- shots ----------
const CUTS=[0,4,8,12,17,21,25,28,30];
function shotIndex(t){ for(let i=CUTS.length-2;i>=0;i--) if(t>=CUTS[i]) return i; return 0; }

function shotCam(si, t){
  const ship = shipAt(t);
  const L = l=>toWorld(ship,l);
  if (window.__camOv){ const o=window.__camOv; const pos = o.local ? L(o.pos) : o.pos; const tgt = o.local ? L(o.tgt) : o.tgt;
    return {pos, rot:lookRot(pos,tgt,0), tanV:Math.tan((o.fov||30)*Math.PI/360), focus:V.len(V.sub(tgt,pos)), ap:o.ap||0}; }
  let pos, tgt, fov=26, focus=60, ap=0, roll=0;
  switch(si){
    case 0: { // cold open: low skimming aerial over the swell, banking onto the ship
      const u = easeIO(clamp(t/4,0,1));
      pos = V.add(bez([-34,13,36],[-26,11,90],[-14,9.5,135],[-11,9,158], u), shake(t,0.35,0.5));
      const sh = shipAt(t).pos;
      tgt = V.lerp([-6,22,420], V.add(sh,[0,5,0]), easeIO(sstep(0.8,3.6,t)));
      fov=lerp(27,22,u); focus=V.len(V.sub(sh,pos)); ap=0; roll=lerp(-0.10,0.0,u); break;
    }
    case 1: { // dolly aft over the rowers to Odysseus on the stern deck
      const u=easeIO(clamp((t-4)/4,0,1));
      pos = V.add(L([0.55, lerp(3.8,3.55,u), lerp(7.6,-1.2,u)]), shake(t,0.035,1.2,2));
      const od = L([0.35, floorY(-12.6)+1.7, -12.6]);
      tgt = V.add(od, [0, 0.35*(1-u), 0]);
      fov=lerp(34,28,u); focus=V.len(V.sub(od,pos)); ap=8; roll=0.015*Math.sin(t*1.1); break;
    }
    case 2: { // over Odysseus' shoulder: the strait, the turning sea, the fog on the right
      const u=(t-8)/4;
      pos = V.add(L([1.45, floorY(-13.9)+1.95, lerp(-14.1,-13.7,u)]), shake(t,0.03,0.9,5));
      tgt = V.add(L([-15, -4.0, 70]), [-5*u, 0, 0]);
      fov=27; focus=150; ap=6; break;
    }
    case 3: { // crane up and over
      const u=easeIO(clamp((t-12)/5,0,1));
      const a = L([-9,3.8,-24]);
      const b = V.add(ship.pos,[28,108,-52]);
      const mid = V.add(V.lerp(a,b,0.5),[18,10,-10]);
      pos = bez(a, V.lerp(a,mid,0.7), V.lerp(mid,b,0.4), b, u);
      const lookA = L([0,3,30]);
      const lookB = V.add(V.lerp(ship.pos,[WHIRL_C[0],-8,WHIRL_C[1]],0.45),[0,-6,0]);
      tgt = V.lerp(lookA, lookB, easeIO(clamp((t-12.3)/4.2,0,1)));
      fov=lerp(26,33,u); focus=V.len(V.sub(ship.pos,pos)); ap=1.5; break;
    }
    case 4: { // quiet beat in the fog
      const u=(t-17)/4;
      pos = V.add([lerp(40,38,u), 3.4, lerp(360,353,u)], shake(t,0.04,0.6,8));
      tgt = V.add(shipAt(t).pos, [-2,5.5,4]);
      fov=17; focus=V.len(V.sub(ship.pos,pos)); ap=3; break;
    }
    case 5: { // from down in the hull: the crew look up, the camera follows them to the cliff
      const u=(t-21)/4;
      pos = V.add(L([0.3, floorY(-3.2)+1.25, lerp(-3.2,-2.8,u)]), shake(t,0.035,0.9,11));
      const low = L([12, 9, 10]);
      const cave = [54, 50, 343];
      const high = [40, 76, 344];
      tgt = t < 21.9 ? V.lerp(low, cave, easeIO(sstep(21.0,21.9,t))) : V.lerp(cave, high, easeIO(sstep(21.9,23.6,t)));
      fov=lerp(31,29,u);
      const crewHead = L([0.22, floorY(-1.6)+1.7, -1.6]);
      focus = lerp(V.len(V.sub(crewHead,pos)), V.len(V.sub(tgt,pos)), easeIO(sstep(21.5,22.3,t)));
      ap=7; roll=-0.03; break;
    }
    case 6: { // the strike, from the stern behind the brazier, whip pans after the heads
      pos = V.add(L([-0.6, floorY(-11)+1.6, -11.0]), shake(t,0.2,2.6,13));
      let acc=[0,0,0], ws=0;
      for(let k=0;k<5;k++){
        const tt=t-k*0.025;
        for(let i=0;i<6;i++){
          const w=Math.exp(-Math.pow((tt-(strikeStart(i)+0.05))/0.28,2))+1e-4;
          const hp=headPlan(i,tt,shipAt(tt));
          acc=V.add(acc,V.mul(hp.head,w)); ws+=w;
        }
      }
      tgt = V.add(V.mul(acc,1/ws), V.mul(shake(t,1.0,3.5,21),1));
      tgt = V.lerp(tgt, L([0,5,8]), 0.2);
      fov=32; focus=V.len(V.sub(tgt,pos)); ap=4; roll=0.06*Math.sin(t*2.1); break;
    }
    default: { // pull back high
      const u=easeOut(clamp((t-28)/1.2,0,1));
      pos = V.lerp(L([-14,10,-34]), V.add(ship.pos,[-70,140,-210]), u);
      tgt = V.lerp(L([0,4,0]), V.lerp(ship.pos,[WHIRL_C[0],0,WHIRL_C[1]],0.4), u);
      fov=lerp(28,40,u); focus=V.len(V.sub(ship.pos,pos)); ap=0.5; break;
    }
  }
  return {pos, rot:lookRot(pos,tgt,roll), tanV:Math.tan(fov*Math.PI/360), focus, ap};
}

function look(t, si){ // per-shot look parameters
  const P = {exposure:1.0, amb:1.0, fog:1.0, fogBank:0.3, rain:0.7, wet:0, spray:0, fire:1.0};
  switch(si){
    case 0: P.rain=0.55; P.fog=1.1; P.fire=1.2; break;
    case 1: P.rain=1.0; P.wet=0.45; P.spray=0.9*(0.35+bump(t,4.9,5.3,6.3)+bump(t,6.6,7.0,7.9)); P.exposure=1.15; break;
    case 2: P.rain=0.85; P.wet=0.35; P.spray=0.6*(0.3+bump(t,9.2,9.6,10.6)); P.fogBank=0.6; break;
    case 3: P.rain=0.65; P.fogBank=0.6; P.exposure=1.05; break;
    case 4: P.rain=0.18; P.fogBank=1.25; P.fog=1.4; P.exposure=1.25; P.amb=1.1; break;
    case 5: P.rain=0.35; P.fogBank=1.2; P.fog=1.25; P.exposure=1.25; P.amb=1.35; break;
    case 6: P.rain=1.0; P.wet=0.9; P.fogBank=1.1; P.fog=1.2; P.spray=0.35; P.exposure=1.2; P.amb=1.35; break;
    default: P.rain=0.7; P.fogBank=1.0; P.fog=1.1; break;
  }
  // exposure: black open, lightning reveal, fade up
  if (t < 0.62) P.exposure = 0;
  else if (t < 2.6) P.exposure *= lerp(0.18, 1.0, sstep(0.95, 2.6, t));
  return P;
}

function stateAt(t){
  t = clamp(t, 0, DUR-1e-4);
  const si = shotIndex(t);
  const ship = shipAt(t);
  const cam = shotCam(si, t);
  const prev = shotCam(si, t - 1/48);
  const lt = lightningAt(t);
  const lk = look(t, si);
  const sc = (t > 20.8 && si>=5) ? scyllaAt(t, ship) : null;
  return {t, si, ship, cam, prev, lt, lk, sc};
}

// ---------- people ----------
function crewPose(i, t){
  const sw = Math.sin(t*1.1 + i*1.7)*0.08;
  let p = [0.45+sw, 0.35-sw, 0.05 + 0.04*Math.sin(t*0.7+i), 0];
  if (t > 21.3){
    const k = sstep(21.4 + i*0.15, 22.7 + i*0.15, t);
    p = [lerp(p[0], 1.25 + 0.25*(i%2), k), lerp(p[1], 1.05, k), lerp(p[2], 0.55 + 0.1*(i%3), k), 0];
  }
  if (t > strikeStart(i) + 0.07) p = [2.3, 2.1, -0.35, 1.0];
  return p;
}
function heroPose(t){
  const up = sstep(21.4, 22.6, t)*0.42;
  return [0.55, 0.12 + 0.05*Math.sin(t*0.9), 0.06 + up + 0.03*Math.sin(t*0.6), 0];
}

// ---------- render ----------
function setCommon(p, t){
  gl.uniform1f(p.u.uTime, t);
  gl.uniform1f(p.u.uWhirl, whirlAmt(t));
  gl.uniform1f(p.u.uSpin, spinAt(t));
  gl.uniform2f(p.u.uWhirlC, WHIRL_C[0], WHIRL_C[1]);
}
const activeH = () => Math.min(H, W/2.39);
const boltArr = new Float32Array(40*3);
function projectBolt(st){
  boltArr.fill(0);
  if (st.lt.vis <= 0) return 0;
  const b = bolts[st.lt.k];
  const cam = st.cam; const aH = activeH(); const y0=(H-aH)/2; const asp = W/aH;
  const proj = p => { const d=V.sub(p,cam.pos); const l=[V.dot(d,cam.rot[0]),V.dot(d,cam.rot[1]),V.dot(d,cam.rot[2])];
    if (l[2] < 1) return null;
    const nx=l[0]/(l[2]*cam.tanV*asp), ny=l[1]/(l[2]*cam.tanV); return [(nx*0.5+0.5)*W, (ny*0.5+0.5)*aH+y0]; };
  let idx=0;
  const push=(poly)=>{ for(let i=0;i<poly.length && idx<40;i++){ const q=proj(poly[i]); if(!q){ idx++; continue; }
      boltArr[idx*3]=q[0]; boltArr[idx*3+1]=q[1]; boltArr[idx*3+2]=(i<poly.length-1)?1:0; idx++; } };
  push(b.main); push(b.branch);
  return st.lt.vis;
}
function halton(i, b){ let f=1, r=0; while(i>0){ f/=b; r+=f*(i%b); i=Math.floor(i/b); } return r; }
function lensSample(k){
  const u = halton(k+1,5)*2-1, v = halton(k+1,7)*2-1;
  if (u===0 && v===0) return [0,0];
  let r, th;
  if (Math.abs(u) > Math.abs(v)){ r=u; th=(Math.PI/4)*(v/u); } else { r=v; th=Math.PI/2 - (Math.PI/4)*(u/v); }
  return [r*Math.cos(th), r*Math.sin(th)];
}

function setSceneUniforms(p, st, k, N){
  const t = st.t;
  setCommon(p,t);
  gl.uniform2f(p.u.uRes, W, H);
  gl.uniform3fv(p.u.uCamPos, st.cam.pos);
  gl.uniformMatrix3fv(p.u.uCamRot, false, flatM(st.cam.rot));
  gl.uniform1f(p.u.uTanV, st.cam.tanV);
  const jit = N > 1 ? [halton(k+1,2)-0.5, halton(k+1,3)-0.5] : [0,0];
  gl.uniform2f(p.u.uJitter, jit[0], jit[1]);
  const useLens = N >= 4 && st.cam.ap > 0.01;
  const ls = lensSample(k);
  gl.uniform2f(p.u.uLens, ls[0], ls[1]);
  gl.uniform1f(p.u.uLensR, useLens ? st.cam.ap*st.cam.focus*st.cam.tanV*0.0025 : 0);
  gl.uniform1f(p.u.uFocusD, st.cam.focus);
  gl.uniform1f(p.u.uSeed, k);
  gl.uniform3fv(p.u.uShipPos, st.ship.pos);
  gl.uniformMatrix3fv(p.u.uShipRot, false, flatM(st.ship.R));
  gl.uniform1f(p.u.uOarPhase, oarPhaseAt(t));
  gl.uniform1f(p.u.uSail, 1.0 - 0.94*sstep(18.5, 19.7, t));
  gl.uniform1f(p.u.uYard, 13.0*sstep(19.7, 20.9, t));
  gl.uniform1f(p.u.uFlash, st.lt.flash);
  gl.uniform3fv(p.u.uBoltPos, st.lt.pos);
  const bv = projectBolt(st);
  gl.uniform3fv(p.u.uBolt, boltArr);
  gl.uniform1f(p.u.uBoltVis, bv);
  gl.uniform1f(p.u.uFog, st.lk.fog);
  gl.uniform1f(p.u.uFogBank, st.lk.fogBank);
  gl.uniform1f(p.u.uSpray, st.lk.spray);
  gl.uniform1f(p.u.uExposure, st.lk.exposure);
  gl.uniform1f(p.u.uAmb, st.lk.amb);
  gl.uniform1f(p.u.uFire, st.lk.fire*(0.9+0.12*Math.sin(t*17.3)+0.08*Math.sin(t*29.1)));
  gl.uniform4fv(p.u.uHeroPose, heroPose(t));
  const poses = new Float32Array(24); for(let i=0;i<6;i++) poses.set(crewPose(i,t), i*4);
  gl.uniform4fv(p.u.uMenPose, poses);
  gl.uniform1f(p.u.uMenOn, 1);
  if (st.sc){
    gl.uniform1f(p.u.uScylla, 1);
    gl.uniform3fv(p.u.uNeck, st.sc.necks);
    gl.uniform4fv(p.u.uNeckB, st.sc.nb);
    gl.uniform4fv(p.u.uHeadF, st.sc.hf);
    gl.uniform3fv(p.u.uEyes, st.sc.eyes);
    gl.uniform4fv(p.u.uMen, st.sc.men);
    gl.uniform3fv(p.u.uMenUp, st.sc.menUp);
  } else {
    gl.uniform1f(p.u.uScylla, 0);
    const men=new Float32Array(24), up=new Float32Array(18);
    for(let i=0;i<6;i++){ const m=toWorld(st.ship,[CREW[i][0],floorY(CREW[i][1]),CREW[i][1]]); men.set([...m,1],i*4); up.set(st.ship.R[1],i*3); }
    gl.uniform4fv(p.u.uMen, men); gl.uniform3fv(p.u.uMenUp, up);
  }
}

function waitGPU(){
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
  return new Promise(res=>{ (function poll(){ const r=gl.clientWaitSync(s,0,0); if(r===gl.TIMEOUT_EXPIRED || r===gl.WAIT_FAILED && false){ setTimeout(poll,2); } else { gl.deleteSync(s); res(); } })(); });
}

// one sub-frame k of N into the accumulation buffer
async function addSample(t, k, N, hq, rowsPerTile, async_){
  const shutter = N > 1 ? ((k*0.618034)%1 - 0.5)/48 : 0;
  const st = stateAt(t + shutter);
  const p = sceneProgram(hq);
  gl.useProgram(p.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, accFbo);
  gl.viewport(0,0,W,H);
  if (k === 0){ gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_ADD);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(p.u.uNoise,0);
  setSceneUniforms(p, st, k, N);
  const rows = rowsPerTile || H;
  for (let y=0; y<H; y+=rows){
    gl.useProgram(p.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, accFbo);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform2f(p.u.uTile, y, Math.min(H, y+rows));
    gl.drawArrays(gl.TRIANGLES,0,3);
    if (async_) await waitGPU(); else if (rows < H) gl.finish();
  }
  gl.disable(gl.BLEND);
}
function resolve(count){
  const p = P_RESOLVE;
  gl.useProgram(p.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, hdrFbo);
  gl.viewport(0,0,W,H);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(p.u.uAcc,0);
  gl.uniform1f(p.u.uInvN, 1/Math.max(count,1));
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.bindTexture(gl.TEXTURE_2D, hdrTex);
  gl.generateMipmap(gl.TEXTURE_2D);
}

function titleAmt(t){ return sstep(29.12, 29.75, t); }
function fadeAmt(t){ return t >= 29.06 ? 0 : 1; }

function drawPost(t, N){
  const st = stateAt(t);
  const p = P_POST;
  gl.useProgram(p.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0,0,W,H);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hdrTex); gl.uniform1i(p.u.uHDR,0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(p.u.uNoise,1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, titleTex); gl.uniform1i(p.u.uTitleTex,2);
  gl.uniform2f(p.u.uRes, W, H);
  gl.uniform1f(p.u.uTime, t);
  gl.uniform3fv(p.u.uCamPos, st.cam.pos);
  gl.uniformMatrix3fv(p.u.uCamRot, false, flatM(st.cam.rot));
  gl.uniform3fv(p.u.uPrevPos, st.prev.pos);
  gl.uniformMatrix3fv(p.u.uPrevRot, false, flatM(st.prev.rot));
  gl.uniform1f(p.u.uTanV, st.cam.tanV);
  gl.uniform1f(p.u.uPrevTanV, st.prev.tanV);
  gl.uniform1f(p.u.uFocus, st.cam.focus);
  gl.uniform1f(p.u.uAperture, st.cam.ap);
  gl.uniform1f(p.u.uPostBlur, N >= 4 ? 0 : 1);
  gl.uniform1f(p.u.uLensWet, st.lk.wet);
  gl.uniform1f(p.u.uRain, st.lk.rain);
  gl.uniform1f(p.u.uTitle, titleAmt(t));
  gl.uniform1f(p.u.uFade, fadeAmt(t));
  gl.uniform1f(p.u.uFlash, st.lt.flash);
  gl.uniform1f(p.u.uAmb, st.lk.amb);
  gl.uniform1f(p.u.uExposure, st.lk.exposure);
  const f=st.cam.rot[2]; gl.uniform1f(p.u.uCamYaw, Math.atan2(f[0],f[2]));
  gl.drawArrays(gl.TRIANGLES,0,3);
}

async function renderFrame(t, N, hq, rowsPerTile, async_){
  if (fadeAmt(t) > 0){
    for (let k=0;k<N;k++) await addSample(t, k, N, hq, rowsPerTile, async_);
    resolve(N);
  }
  drawPost(t, N);
}

// ---------- capture API (used for offline checks) ----------
window.FILM = {
  DUR,
  init(w,h){ resize(w,h); return {W,H,hasCBF}; },
  async frame(t, opts){
    opts = opts || {};
    await renderFrame(t, opts.samples||1, !!opts.hq, opts.rows || (opts.tiles ? Math.ceil(H/opts.tiles) : H), false);
    gl.finish();
    return true;
  },
  png(){ return canvas.toDataURL('image/png'); },
  simStats(){ const r={}; for(const k of ['heave','pitch','roll','yaw','surge']){ let a=1e9,b=-1e9; const arr=SIM[k]; for(let i=Math.round(8/SIM.dt);i<arr.length;i++){a=Math.min(a,arr[i]);b=Math.max(b,arr[i]);} r[k]=[+a.toFixed(3),+b.toFixed(3)]; } return r; },
};
if (CAPTURE) return;

// ---------- interactive player ----------
const $ = id => document.getElementById(id);
const ui = $('ui'), playBtn=$('play'), scrub=$('scrub'), tc=$('tc'), qSel=$('q'), muteBtn=$('mute'), startEl=$('start'), shotEl=$('shot'), refineEl=$('refine');
const FPS = 24;
let playing=false, tNow=0, last=performance.now(), quality=parseFloat(qSel.value), muted=false;
let busy=false;        // master render owns the GPU
let accCount=0, accT=-1, accW=0;
const REFINE_SAMPLES = 24;

// soundtrack (AAC embedded as base64, decoded once)
let actx=null, abuf=null, asrc=null, again=null, aStartAt=0;
const AUDIO_B64 = window.__AUDIO_B64 || '';
function b64ToBuf(b64){ const bin=atob(b64); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u.buffer; }
const audioReady = (async ()=>{
  if (!AUDIO_B64) return null;
  try {
    actx = new (window.AudioContext||window.webkitAudioContext)({sampleRate:48000});
    abuf = await actx.decodeAudioData(b64ToBuf(AUDIO_B64));
    again = actx.createGain(); again.connect(actx.destination);
    return abuf;
  } catch(e){ console.warn('audio', e); return null; }
})();
function audioStart(at){
  if (!abuf || !actx) return;
  audioStop();
  actx.resume();
  asrc = actx.createBufferSource(); asrc.buffer = abuf; asrc.connect(again);
  asrc.start(0, Math.min(at, abuf.duration-0.01));
  aStartAt = actx.currentTime - at;
}
function audioStop(){ if (asrc){ try{ asrc.stop(); }catch(e){} asrc.disconnect(); asrc=null; } }

const SHOTS = ['The strait','Odysseus','The bow','Charybdis','Into the fog','Scylla','The strike','Through'];
function timecode(t){ const f=Math.min(719, Math.floor(t*FPS+1e-6)); const s=Math.floor(f/FPS), fr=f%FPS; return `00:00:${String(s).padStart(2,'0')}:${String(fr).padStart(2,'0')}`; }

function fit(){
  if (busy) return;
  const stage = $('stage').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  let w = stage.width, h = stage.width/2.39;
  if (h > stage.height){ h = stage.height; w = h*2.39; }
  resize(w*dpr*quality, h*dpr*quality);
  canvas.style.width = w+'px'; canvas.style.height = h+'px';
  accT = -1;
}
new ResizeObserver(fit).observe($('stage'));
qSel.onchange = ()=>{ quality=parseFloat(qSel.value); fit(); };
function setPlay(v){
  if (busy) return;
  playing=v; playBtn.textContent = v?'Pause':'Play';
  playBtn.setAttribute('aria-pressed', v?'true':'false');
  if (v && !muted) audioStart(tNow); else audioStop();
  last=performance.now(); accT=-1;
}
playBtn.onclick=()=>{ if(tNow>=DUR-0.01) tNow=0; setPlay(!playing); };
muteBtn.onclick=()=>{ muted=!muted; muteBtn.textContent=muted?'Sound off':'Sound on'; if(muted) audioStop(); else if(playing) audioStart(tNow); };
scrub.oninput=()=>{ tNow=parseFloat(scrub.value); accT=-1; if(playing && !muted) audioStart(tNow); };
startEl.onclick=()=>{ startEl.hidden=true; tNow=0; setPlay(true); };
addEventListener('keydown', e=>{
  if (busy || e.target.tagName==='SELECT' || e.target.tagName==='INPUT' && e.target.type!=='range') return;
  if (e.code==='Space'){ e.preventDefault(); if(!startEl.hidden) startEl.hidden=true; setPlay(!playing); }
  if (e.code==='ArrowRight'){ setPlay(false); tNow=Math.min(DUR-1/FPS, tNow+1/FPS); accT=-1; }
  if (e.code==='ArrowLeft'){ setPlay(false); tNow=Math.max(0, tNow-1/FPS); accT=-1; }
});
// shot markers under the scrubber
{
  const m = $('marks');
  CUTS.slice(0,-1).forEach((c,i)=>{
    const b=document.createElement('button'); b.type='button'; b.className='mark';
    b.style.left = (c/DUR*100)+'%'; b.style.width = ((CUTS[i+1]-c)/DUR*100)+'%';
    b.innerHTML = `<span>${i+1}</span> ${SHOTS[i]}`;
    b.title = `Shot ${i+1}: ${SHOTS[i]}`;
    b.onclick=()=>{ setPlay(false); tNow=c+0.5; accT=-1; };
    m.appendChild(b);
  });
}

async function loop(now){
  if (!busy){
    if (playing){
      if (asrc && !muted) tNow = actx.currentTime - aStartAt;
      else tNow += (now-last)/1000;
      if (tNow >= DUR){ tNow = DUR-0.001; setPlay(false); }
      await renderFrame(tNow, 1, false, H, false);
      accT = -1;
      refineEl.textContent = 'Live preview';
    } else {
      // paused: refine progressively towards the final look
      if (accT !== tNow || accW !== W){ accT = tNow; accW = W; accCount = 0; }
      if (accCount < REFINE_SAMPLES){
        if (fadeAmt(tNow) > 0){
          await addSample(tNow, accCount, REFINE_SAMPLES, true, Math.max(32, Math.round(400000/W)), false);
          accCount++;
          resolve(accCount);
        } else accCount = REFINE_SAMPLES;
        drawPost(tNow, REFINE_SAMPLES);
        refineEl.textContent = accCount < REFINE_SAMPLES ? `Refining ${accCount}/${REFINE_SAMPLES}` : 'Final quality';
      }
    }
    scrub.value = tNow.toFixed(3);
    tc.textContent = timecode(tNow);
    shotEl.textContent = `Shot ${shotIndex(tNow)+1} · ${SHOTS[shotIndex(tNow)]}`;
  }
  last = now;
  requestAnimationFrame(loop);
}
fit();
requestAnimationFrame(loop);
document.fonts && document.fonts.load(`96px ${TITLE_FONT}`).then(()=>{ if(W) makeTitle(W,H); }).catch(()=>{});

// ---------- master render (runs on the viewer's GPU, encodes MP4) ----------
const PRESETS = {
  dci4k:  {w:4096, h:1716, label:'DCI 4K Scope', br:120e6},
  uhd:    {w:3840, h:1608, label:'UHD Scope', br:100e6},
  dci2k:  {w:2048, h:858,  label:'DCI 2K Scope', br:45e6},
  hd:     {w:1920, h:804,  label:'HD Scope', br:35e6},
  draft:  {w:1280, h:536,  label:'Draft', br:16e6},
};
let masterBlob=null, masterName='', cancelReq=false, downloads=null;
(async()=>{ try{ downloads = window.claude ? await window.claude.use('downloads') : null; }catch(e){ downloads=null; } $('saveNote').hidden = !!downloads; })();

async function pickVideoConfig(w,h,br){
  const cands = [
    {codec:'avc1.640034', mux:'avc', extra:{avc:{format:'avc'}}},
    {codec:'avc1.640033', mux:'avc', extra:{avc:{format:'avc'}}},
    {codec:'hvc1.1.6.L156.B0', mux:'hevc', extra:{hevc:{format:'hevc'}}},
    {codec:'vp09.00.51.08', mux:'vp9', extra:{}},
    {codec:'av01.0.16M.08', mux:'av1', extra:{}},
  ];
  for (const c of cands){
    const cfg = Object.assign({codec:c.codec, width:w, height:h, bitrate:br, framerate:24, latencyMode:'quality', bitrateMode:'variable'}, c.extra);
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return {cfg, mux:c.mux}; } catch(e){}
  }
  return null;
}
async function pickAudioConfig(){
  if (!window.AudioEncoder) return null;
  for (const c of [{codec:'mp4a.40.2', mux:'aac'}, {codec:'opus', mux:'opus'}]){
    const cfg = {codec:c.codec, sampleRate:48000, numberOfChannels:2, bitrate:256000};
    try { const s = await AudioEncoder.isConfigSupported(cfg); if (s.supported) return {cfg, mux:c.mux}; } catch(e){}
  }
  return null;
}

function setStatus(msg, kind){ const s=$('mstatus'); s.textContent=msg; s.dataset.kind = kind||''; }

async function master(){
  if (!window.VideoEncoder || !window.Mp4Muxer){ setStatus('This browser cannot encode video here. Use a recent Chrome or Edge on desktop.', 'err'); return; }
  const pr = PRESETS[$('mres').value];
  const N = parseInt($('msamp').value,10);
  const br = pr.br * parseFloat($('mbr').value);
  const vc = await pickVideoConfig(pr.w, pr.h, br);
  if (!vc){ setStatus(`Your GPU's encoder can't do ${pr.w}×${pr.h}. Pick a smaller size.`, 'err'); return; }
  setPlay(false); busy = true; cancelReq = false; masterBlob = null;
  $('mgo').disabled = true; $('mcancel').hidden = false; $('msave').hidden = true; document.body.classList.add('rendering');
  startEl.hidden = true;
  const prevQ = [W,H, canvas.style.width, canvas.style.height];
  resize(pr.w, pr.h);
  const stage = $('stage').getBoundingClientRect();
  let cw = stage.width, ch = cw*pr.h/pr.w; if (ch > stage.height){ ch=stage.height; cw=ch*pr.w/pr.h; }
  canvas.style.width = cw+'px'; canvas.style.height = ch+'px';
  try { sceneProgram(true); } catch(e){ setStatus('The high-quality shader failed to compile on this GPU.', 'err'); busy=false; return; }

  const ac = await pickAudioConfig();
  await audioReady;
  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxOpts = { target, video:{codec:vc.mux, width:pr.w, height:pr.h, frameRate:24}, fastStart:'in-memory', firstTimestampBehavior:'offset' };
  if (ac && abuf) muxOpts.audio = {codec:ac.mux, numberOfChannels:2, sampleRate:48000};
  const muxer = new Mp4Muxer.Muxer(muxOpts);
  let encErr = null;
  const venc = new VideoEncoder({ output:(chunk, meta)=>muxer.addVideoChunk(chunk, meta), error:e=>{ encErr=e; } });
  venc.configure(vc.cfg);
  if (ac && abuf){
    const aenc = new AudioEncoder({ output:(chunk, meta)=>muxer.addAudioChunk(chunk, meta), error:e=>{ console.warn(e); } });
    aenc.configure(ac.cfg);
    const L = abuf.getChannelData(0), R = abuf.getChannelData(1 % abuf.numberOfChannels);
    const total = Math.min(L.length, Math.round(DUR*48000));
    for (let i=0;i<total;i+=1024){
      const n = Math.min(1024, total-i);
      const data = new Float32Array(n*2); data.set(L.subarray(i,i+n),0); data.set(R.subarray(i,i+n),n);
      const ad = new AudioData({format:'f32-planar', sampleRate:48000, numberOfFrames:n, numberOfChannels:2, timestamp:Math.round(i*1e6/48000), data});
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
  }

  const frames = Math.min(Math.round(DUR*FPS), +(params.get('mframes')||1e9));
  const rows = Math.max(32, Math.round(700000/pr.w));
  const t0 = performance.now();
  for (let f=0; f<frames; f++){
    if (cancelReq || encErr) break;
    const t = f/FPS;
    await renderFrame(t, N, true, rows, true);
    await waitGPU();
    const vf = new VideoFrame(canvas, {timestamp: Math.round(f*1e6/FPS), duration: Math.round(1e6/FPS)});
    venc.encode(vf, {keyFrame: f % 24 === 0});
    vf.close();
    while (venc.encodeQueueSize > 3) await new Promise(r=>setTimeout(r,5));
    const el = (performance.now()-t0)/1000, per = el/(f+1), left = per*(frames-f-1);
    $('mbar').style.width = ((f+1)/frames*100)+'%';
    setStatus(`Frame ${f+1} of ${frames} · ${timecode(t)} · ${per.toFixed(1)} s per frame · about ${Math.ceil(left/60)} min left`);
    scrub.value = t; tc.textContent = timecode(t);
  }
  try { await venc.flush(); } catch(e){}
  venc.close();
  busy = false; document.body.classList.remove('rendering');
  $('mgo').disabled = false; $('mcancel').hidden = true;
  if (cancelReq){ setStatus('Render cancelled.'); fit(); return; }
  if (encErr){ setStatus('The encoder stopped: '+encErr.message, 'err'); fit(); return; }
  muxer.finalize();
  masterBlob = new Blob([target.buffer], {type:'video/mp4'});
  window.__masterBlob = masterBlob;
  masterName = `odyssey_scylla_charybdis_${pr.w}x${pr.h}_${N}spp.mp4`;
  setStatus(`Finished: ${pr.label} ${pr.w}×${pr.h}, ${(masterBlob.size/1e6).toFixed(0)} MB, ${vc.cfg.codec.split('.')[0].toUpperCase()}${ac?'':' (no audio track: this browser has no audio encoder)'} in ${((performance.now()-t0)/60000).toFixed(1)} min.`, 'ok');
  $('msave').hidden = false;
  fit();
}
$('mgo').onclick = ()=>{ master().catch(e=>{ console.error(e); busy=false; document.body.classList.remove('rendering'); $('mgo').disabled=false; setStatus('Render failed: '+e.message, 'err'); fit(); }); };
$('mcancel').onclick = ()=>{ cancelReq = true; };
$('msave').onclick = async ()=>{
  if (!masterBlob) return;
  if (!downloads){ setStatus('Saving files is not available in this view. Open the artifact on claude.ai in a desktop browser.', 'err'); return; }
  try { await downloads.save({filename: masterName, data: masterBlob}); setStatus('Saved '+masterName, 'ok'); }
  catch(e){ setStatus(e && e.code==='declined' ? 'Save cancelled.' : 'Could not save: '+(e && (e.message||e.code)), 'err'); }
};
$('still').onclick = async ()=>{
  if (busy) return;
  if (!downloads){ setStatus('Saving files is not available in this view.', 'err'); return; }
  canvas.toBlob(async b=>{
    try { await downloads.save({filename:`odyssey_still_${timecode(tNow).replace(/:/g,'-')}.png`, data:b}); }
    catch(e){ if (e && e.code!=='declined') setStatus('Could not save the still.', 'err'); }
  }, 'image/png');
};
$('mopen').onclick = ()=>{ const d=$('drawer'); d.hidden = !d.hidden; $('mopen').setAttribute('aria-expanded', d.hidden?'false':'true'); };
$('mclose').onclick = ()=>{ $('drawer').hidden = true; $('mopen').setAttribute('aria-expanded','false'); };

})();
