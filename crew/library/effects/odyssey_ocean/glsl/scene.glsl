uniform vec2  uRes;
uniform vec2  uTile;
uniform vec2  uJitter;
uniform vec2  uLens;
uniform float uLensR;
uniform float uFocusD;
uniform float uSeed;
uniform vec3  uCamPos;
uniform mat3  uCamRot;
uniform float uTanV;
uniform vec3  uShipPos;
uniform mat3  uShipRot;
uniform float uOarPhase;
uniform float uFlash;
uniform vec3  uBoltPos;
uniform vec3  uBolt[40];
uniform float uBoltVis;
uniform float uFog;
uniform float uFogBank;
uniform float uSpray;
uniform float uExposure;
uniform float uAmb;
uniform float uFire;
uniform float uScylla;
uniform vec3  uNeck[48];
uniform vec4  uNeckB[6];
uniform vec4  uHeadF[6];
uniform vec4  uMen[6];
uniform vec3  uMenUp[6];
uniform vec4  uMenPose[6];
uniform vec4  uHeroPose;
uniform vec3  uEyes[12];
uniform float uMenOn;
uniform float uSail;
uniform float uYard;
out vec4 o;

const vec3 SUN = vec3(-0.33, 0.045, 0.94);
float gT = 0.0;

vec3 hash33(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
// cellular noise: x = F1, y = F2-F1 (small near cell borders)
vec2 cell3(vec3 p){
  vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 g = vec3(float(x),float(y),float(z));
    vec3 r = g + hash33(i+g) - f;
    float d = dot(r,r);
    if(d < d1){ d2 = d1; d1 = d; } else if(d < d2) d2 = d;
  }
  d1 = sqrt(d1); d2 = sqrt(d2);
  return vec2(d1, d2-d1);
}
// perturb a normal by the gradient of value noise at a given scale
vec3 bumpN(vec3 n, vec3 p, float sc, float amt){
  vec3 ps = p*sc; float h = 0.3;
  vec3 g = vec3(n3(ps+vec3(h,0,0))-n3(ps-vec3(h,0,0)), n3(ps+vec3(0,h,0))-n3(ps-vec3(0,h,0)), n3(ps+vec3(0,0,h))-n3(ps-vec3(0,0,h)))/(2.0*h);
  return normalize(n - amt*(g - n*dot(g,n)));
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h)-r; }
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba=b-a; float l2=dot(ba,ba); float rr=r1-r2; float a2=l2-rr*rr; float il2=1.0/l2;
  vec3 pa=p-a; float y=dot(pa,ba); float z=y-l2;
  vec3 xv=pa*l2-ba*y; float x2=dot(xv,xv); float y2=y*y*l2; float z2=z*z*l2;
  float k=sign(rr)*rr*rr*x2;
  if(sign(z)*a2*z2>k) return sqrt(x2+z2)*il2-r2;
  if(sign(y)*a2*y2<k) return sqrt(x2+y2)*il2-r1;
  return (sqrt(x2*a2*il2)+y*rr)*il2-r1;
}
float sdEllipsoid(vec3 p, vec3 r){ float k0=length(p/r); float k1=length(p/(r*r)); return k0*(k0-1.0)/max(k1,1e-4); }
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0); }
float smin(float a, float b, float k){ float h=max(k-abs(a-b),0.0)/k; return min(a,b)-h*h*k*0.25; }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,s,-s,c); }

#define UMIN(dd, mm) { float _d = (dd); if(_d < d){ d = _d; m = (mm); } }

// ---------------- people ----------------
// pose: x right arm raise, y left arm raise, z head pitch (+ looks up), w flail
// style id: 0 Odysseus, 1 helmsman, 2..7 crew
vec2 sdHuman(vec3 q, vec4 pose, float sid){
  float bnd = length((q - vec3(0.0,0.95,0.0))*vec3(1.0,0.62,1.0)) - 0.78;
  if(bnd > 0.35) return vec2(bnd, 11.0);
  float tt = uTime + sid*1.731;
  float d = 1e5, m = 11.0;
  bool hero = sid < 0.5;
  bool helm = hero || mod(sid, 2.0) < 0.5;
  bool cuirass = hero || sid > 5.5;
  bool shield = sid > 1.5 && mod(sid, 2.0) < 0.5;
  bool spear = hero || sid > 2.5 && mod(sid,2.0) > 0.5;
  float tunicMat = mod(sid, 3.0) < 1.0 ? 13.0 : (mod(sid, 3.0) < 2.0 ? 18.0 : 19.0);
  float fl = pose.w;
  float sway = sin(tt*1.3)*0.02;
  q.x -= sway*q.y;

  // torso: chest wider than deep, tapering waist
  vec3 qt = q*vec3(1.0, 1.0, 1.45);
  vec3 qs2 = vec3(abs(q.x), q.y, q.z);
  float torso = sdEllipsoid(q - vec3(0.0,1.28,0.005), vec3(0.165,0.16,0.112));
  torso = smin(torso, sdEllipsoid(q - vec3(0.0,1.08,0.0), vec3(0.135,0.15,0.098)), 0.07);
  torso = smin(torso, sdEllipsoid(q - vec3(0.0,0.95,-0.005), vec3(0.158,0.10,0.108)), 0.06);
  torso = smin(torso, sdRoundCone(qs2, vec3(0.0,1.49,-0.02), vec3(0.165,1.425,-0.015), 0.055, 0.05), 0.05);
  torso = smin(torso, length(qs2 - vec3(0.195,1.405,0.0)) - 0.066, 0.04);
  torso += (n3(q*vec3(18.0,9.0,18.0))-0.5)*0.008;
  UMIN(torso, tunicMat);
  if(!cuirass && sid > 1.5){
    // linothorax: layered linen corselet with shoulder yoke
    float lino = sdEllipsoid(q - vec3(0.0,1.18,0.0), vec3(0.185,0.27,0.13));
    lino = max(lino, max(0.93 - q.y, q.y - 1.43));
    float yoke = sdBox(vec3(abs(q.x)-0.12, q.y-1.44, q.z), vec3(0.075,0.02,0.13));
    lino = min(lino, yoke);
    lino -= smoothstep(0.0,0.01, abs(fract(q.y*14.0)-0.5)-0.45)*0.003;
    UMIN(lino, 13.0);
  }
  if(cuirass){
    float cu = max(sdRoundCone(qt, vec3(0.0,1.04,0.0), vec3(0.0,1.31,0.02), 0.145, 0.185)/1.45, max(0.96 - q.y, q.y - 1.47));
    cu += 0.004*smoothstep(0.0, 0.01, abs(q.x) - 0.002);
    UMIN(cu, 4.0);
  }
  // kilt / tunic skirt with pleats
  float sk = sdRoundCone(q, vec3(0.0,0.97,0.0), vec3(0.0,0.60,0.0), 0.15, 0.20);
  sk = max(sk, q.y - 0.99);
  sk += sin(atan(q.x, q.z)*26.0)*0.004;
  UMIN(sk, hero ? 15.0 : tunicMat);

  // legs
  for(int s=0;s<2;s++){
    float sx = s==0 ? -1.0 : 1.0;
    float kb = 0.06 + 0.04*sin(tt*1.1 + sx);
    vec3 hj = vec3(0.095*sx, 0.90, 0.0), kn = vec3(0.105*sx, 0.50, kb), an = vec3(0.10*sx, 0.09, -0.01);
    float leg = sdRoundCone(q, hj, kn, 0.078, 0.052);
    leg = smin(leg, sdRoundCone(q, kn, an, 0.05, 0.034), 0.03);
    leg = smin(leg, sdEllipsoid(q - vec3(0.10*sx, 0.27, kb*0.6-0.04), vec3(0.05,0.09,0.055)), 0.03);
    UMIN(leg, 11.0);
    if(helm){ UMIN(sdRoundCone(q, kn+vec3(0.0,-0.02,0.02), an+vec3(0.0,0.06,0.012), 0.058, 0.04), 4.0); }
    UMIN(sdEllipsoid(q - vec3(0.10*sx, 0.04, 0.05), vec3(0.048,0.04,0.12)), 15.0);
  }
  // arms
  vec3 wristR = vec3(0.0), wristL = vec3(0.0);
  for(int s=0;s<2;s++){
    float sx = s==0 ? -1.0 : 1.0;
    float a = s==0 ? pose.y : pose.x;
    float sp = 0.12;
    if(fl > 0.0){ a += fl*sin(tt*7.0 + sx*1.7)*0.9; sp += fl*(0.5+0.4*sin(tt*5.3+sx)); }
    vec3 sh = vec3(0.205*sx, 1.40, -0.01);
    vec3 u1 = normalize(vec3(sx*sp, -cos(a), sin(a)));
    vec3 el = sh + u1*0.29;
    float a2 = a + 0.35 + (fl > 0.0 ? fl*sin(tt*6.0+sx)*0.6 : 0.0);
    vec3 u2 = normalize(vec3(sx*sp*0.5, -cos(a2), sin(a2)));
    vec3 wr = el + u2*0.26;
    float arm = sdRoundCone(q, sh, el, 0.05, 0.04);
    arm = smin(arm, sdEllipsoid(q - (sh + u1*0.15 + vec3(0.0,0.0,0.012)), vec3(0.048,0.06,0.05)), 0.03);
    arm = smin(arm, sdRoundCone(q, el, wr, 0.044, 0.028), 0.02);
    arm = smin(arm, sdEllipsoid(q - (el + u2*0.07), vec3(0.042,0.06,0.042)), 0.02);
    arm = smin(arm, sdRoundCone(q, wr, wr + u2*0.085, 0.03, 0.022), 0.015);
    arm = smin(arm, sdCapsule(q, wr + vec3(0.0,-0.01,0.02), wr + u2*0.04 + vec3(0.0,0.0,0.045), 0.011), 0.01);
    UMIN(arm, 11.0);
    if(s==0) wristL = wr; else wristR = wr;
  }
  // neck & head
  UMIN(sdRoundCone(q, vec3(0.0,1.43,0.0), vec3(0.0,1.56,0.01), 0.058, 0.048), 11.0);
  vec3 hq = q - vec3(0.0,1.55,0.0);
  hq.yz = rot(-pose.z)*hq.yz;
  float skull = sdEllipsoid(hq - vec3(0.0,0.12,0.0), vec3(0.083,0.108,0.098));
  skull = smin(skull, sdRoundCone(hq, vec3(0.0,0.12,0.088), vec3(0.0,0.085,0.112), 0.014, 0.011), 0.012);
  vec3 hs = vec3(abs(hq.x), hq.yz);
  skull = smin(skull, sdEllipsoid(hs - vec3(0.083,0.11,0.0), vec3(0.012,0.028,0.018)), 0.01);
  UMIN(skull, 11.0);
  float beard = sdEllipsoid(hq - vec3(0.0,0.045,0.04), vec3(0.072,0.062,0.07)) + (n3(hq*90.0)-0.5)*0.008;
  beard = max(beard, -(hq.y - 0.005) - 0.05);
  UMIN(beard, 14.0);
  if(helm){
    float shell = abs(sdEllipsoid(hq - vec3(0.0,0.125,-0.005), vec3(0.104,0.128,0.118))) - 0.006;
    shell = max(shell, -hq.y + 0.0);
    vec3 fo = hq - vec3(0.0, 0.085, 0.09);
    float opening = sdBox(fo, vec3(0.064, 0.042, 0.08));
    opening = max(opening, -sdBox(fo - vec3(0.0,0.03,0.0), vec3(0.011,0.03,0.09)));
    opening = min(opening, sdBox(hq - vec3(0.0,0.02,0.09), vec3(0.022,0.06,0.08)));
    shell = max(shell, -opening);
    UMIN(shell, 4.0);
    if(hero){
      float crest = sdEllipsoid(hq - vec3(0.0,0.31,-0.03), vec3(0.022,0.075,0.19));
      crest = max(crest, -(hq.y - 0.27));
      crest += (n3(hq*120.0 + vec3(0.0,0.0,tt*2.0))-0.5)*0.012;
      UMIN(crest, 16.0);
      UMIN(sdCapsule(hq, vec3(0.0,0.24,0.06), vec3(0.0,0.26,-0.12), 0.012), 4.0);
    }
  } else {
    float hair = sdEllipsoid(hq - vec3(0.0,0.14,-0.02), vec3(0.09,0.10,0.10)) + (n3(hq*70.0)-0.5)*0.012;
    hair = max(hair, -(hq.y - 0.10 + hq.z*0.6));
    UMIN(hair, 14.0);
  }
  // cloak: a cloth sheet from the shoulders, catching the wind
  if(sid < 1.5){
    float y = q.y;
    float drop = clamp(1.43 - y, 0.0, 1.2);
    float flut = (sin(tt*4.3 + y*5.0 + q.x*6.0)*0.03 + (n3(vec3(q.x*4.0, y*3.0, tt*1.7))-0.5)*0.14)*drop;
    float zc = -0.13 - drop*0.17 - flut - drop*drop*0.12 - sin(q.x*26.0 + n3(vec3(q.x*3.0,y*2.0,tt))*3.0)*0.02*drop;
    float xc = q.x - flut*0.6;
    float cl = abs(q.z - zc) - 0.011;
    cl = max(cl, abs(xc) - (0.21 + drop*0.16));
    cl = max(cl, max(y - 1.44, 0.28 - y));
    UMIN(cl*0.6, sid < 0.5 ? 7.0 : 20.0);
  }
  if(spear){
    vec3 sb = vec3(0.30, 0.0, 0.16);
    vec3 st = vec3(0.32, 2.55, 0.28);
    if(!hero){ sb = wristR + vec3(0.0,-0.9,-0.1); st = wristR + vec3(0.05,1.5,0.35); }
    UMIN(sdCapsule(q, sb, st, 0.017), 8.0);
    vec3 dirS = normalize(st - sb);
    UMIN(sdRoundCone(q, st, st + dirS*0.28, 0.03, 0.002), 4.0);
  }
  if(shield){
    vec3 c = wristL + vec3(-0.08, 0.05, 0.08);
    vec3 nrm = normalize(vec3(-0.6, 0.15 + pose.y*0.3, 0.8));
    vec3 lp = q - c;
    float h = dot(lp, nrm);
    float r = length(lp - nrm*h);
    float sh = max(r - 0.45, abs(h - 0.06*(1.0 - r*r/0.2)) - 0.018);
    UMIN(sh, 4.0);
  }
  return vec2(d, m);
}

// ---------------- cliffs ----------------
// 2D cellular: x = edge distance (F2-F1), y = cell hash
vec2 vor2(vec2 x){
  vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0; float id = 0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i),float(j));
    vec2 o = hash33(vec3(n+g, 7.0)).xy;
    vec2 r = g + o - f; float d = dot(r,r);
    if(d < d1){ d2 = d1; d1 = d; id = hash2(n+g); } else if(d < d2) d2 = d;
  }
  return vec2(sqrt(d2)-sqrt(d1), id);
}
float rockRelief(vec3 p, float n){
  // fractured blocks on the face, chamfered into crevices so the field stays continuous
  vec2 vb = vor2(vec2(p.z*0.05 + n*0.8, p.y*0.075));
  float block = mix(-1.6, (vb.y - 0.5)*3.2, smoothstep(0.0, 0.18, vb.x));
  // sedimentary ledges
  float sl = fract(p.y/7.5 + n*0.7);
  float ledge = smoothstep(0.0, 0.12, sl)*1.8 - 0.9;
  // wave-cut notch at the waterline and rubble at the foot
  float notch = -3.2*exp(-pow((p.y-1.2)/2.4, 2.0));
  float rubble = smoothstep(5.0, 0.0, p.y)*(n3(p*0.22)*7.0 + n3(p*0.6)*1.5);
  return block + ledge + notch + rubble;
}
float cliffs(vec3 p){
  float d = 1e5;
  float preR = 40.0 - p.x;
  if(preR > 3.0) d = preR;
  else {
    float n = fbm3(p*vec3(0.011,0.018,0.011), gT > 350.0 ? 3 : 4);
    float rg = 1.0 - abs(fbm3(p*vec3(0.03,0.014,0.03)+3.1, gT > 200.0 ? 2 : 3)*2.0-1.0);
    float rk = n3(p*vec3(0.07,0.11,0.07))*6.0;
    if(gT < 160.0) rk += n3(p*0.23)*1.8 + n3(p*0.6)*0.5; else rk += 1.15;
    float disp = n*18.0 + rg*7.0 + rk + sin(p.y*0.31 + n*7.0)*0.9;
    if(gT < 600.0) disp += rockRelief(p, n);
    float dc = (84.0 - disp) - p.x;
    float top = 160.0 + fbm3(vec3(p.xz*0.009, 1.7), 3)*55.0;
    dc = max(dc, p.y - top);
    dc = max(dc, (205.0 + n*45.0) - p.z);
    dc = max(dc, p.z - (650.0 - n*40.0));
    vec3 cq = (p - vec3(66.0, 62.0, 345.0))/vec3(15.0, 13.0, 22.0);
    float cave = (length(cq)-1.0)*12.0 + (n-0.5)*7.0;
    dc = max(dc, -cave);
    d = dc*0.5;
  }
  float lx = -192.0;
  float preL = p.x + 162.0;
  if(preL > 3.0) d = min(d, preL);
  else {
    float n = fbm3(p*vec3(0.012,0.02,0.012)+7.7, gT > 350.0 ? 3 : 4);
    float rg = 1.0 - abs(fbm3(p*vec3(0.035,0.016,0.035)+1.3, gT > 200.0 ? 2 : 3)*2.0-1.0);
    float rk = n3(p*vec3(0.07,0.11,0.07)+3.0)*6.0;
    if(gT < 160.0) rk += n3(p*0.23+1.0)*1.8 + n3(p*0.6)*0.5; else rk += 1.15;
    float disp = n*16.0 + rg*6.0 + rk + sin(p.y*0.37 + n*6.0)*0.8;
    if(gT < 600.0) disp += rockRelief(p.zxy.yzx + vec3(0.0,0.0,40.0), n);
    float dc = p.x - (lx - 16.0 + disp);
    float top = 66.0 + fbm3(vec3(p.xz*0.012, 4.1), 3)*30.0;
    dc = max(dc, p.y - top);
    dc = max(dc, (190.0 + n*40.0) - p.z);
    dc = max(dc, p.z - (590.0 - n*40.0));
    d = min(d, dc*0.5);
  }
  vec3 tq = p - vec3(-196.0, 74.0, 336.0);
  if(length(tq) < 28.0){
    float tr = sdRoundCone(tq, vec3(0,-6,0), vec3(4.0,9.0,1.0), 1.4, 0.6);
    tr = min(tr, sdCapsule(tq, vec3(4.0,9.0,1.0), vec3(12.0,14.0,-2.0), 0.45));
    tr = min(tr, sdCapsule(tq, vec3(4.0,9.0,1.0), vec3(-3.0,15.0,3.0), 0.4));
    float can = sdEllipsoid(tq - vec3(4.0,15.5,0.5), vec3(11.0,5.0,9.0)) + (n3(tq*0.6)-0.5)*3.5;
    d = min(d, min(tr, can*0.6));
  }
  return d;
}

// ---------------- ship ----------------
float deckY(float z){ return 2.4 + 1.7*pow(min(abs(z)/17.0,1.0), 3.0); }
float halfBeam(float z){ float zn = clamp(z/17.0,-1.0,1.0); return 2.55*sqrt(max(1.0-zn*zn,0.0)) + 0.06; }
float floorY(float z){ return deckY(z) - mix(1.05, 0.55, smoothstep(11.5, 12.5, abs(z))); }

// a seated rower pulling his oar; faces aft
vec2 rowerSDF(vec3 qa, float oz, vec3 handle, float ph){
  float fl = floorY(oz);
  vec3 seat = vec3(1.05, fl + 0.48, oz + 0.62);
  float lean = -sin(ph)*0.22;
  vec3 hip = seat + vec3(0.0, 0.08, 0.0);
  vec3 sh  = seat + vec3(0.0, 0.58, -0.08 + lean);
  float d = 1e5, m = 11.0;
  UMIN(sdRoundCone(qa, hip, sh, 0.15, 0.17), 13.0);
  UMIN(length(qa - (sh + vec3(0.0, 0.24, -0.02 + lean*0.3))) - 0.105, 11.0);
  UMIN(sdEllipsoid(qa - (sh + vec3(0.0, 0.19, 0.03 + lean*0.3)), vec3(0.075,0.06,0.07)), 14.0);
  for(int s=0;s<2;s++){
    float sx = s==0 ? -1.0 : 1.0;
    vec3 shs = sh + vec3(0.17*sx, -0.03, 0.0);
    vec3 hd = handle + vec3(0.06*sx, 0.0, 0.0);
    vec3 el = mix(shs, hd, 0.5) + vec3(0.12*sx, -0.12, 0.0);
    UMIN(min(sdRoundCone(qa, shs, el, 0.05, 0.04), sdRoundCone(qa, el, hd, 0.04, 0.03)), 11.0);
    vec3 kn = hip + vec3(0.1*sx, 0.22, -0.42);
    vec3 ft = vec3(hip.x + 0.1*sx, fl + 0.05, hip.z - 0.62);
    UMIN(min(sdRoundCone(qa, hip + vec3(0.09*sx,0.0,0.0), kn, 0.075, 0.055), sdRoundCone(qa, kn, ft, 0.05, 0.04)), 11.0);
  }
  return vec2(d, m);
}

vec2 shipSDF(vec3 q){
  float top = deckY(q.z);
  float w = halfBeam(q.z);
  vec2 cs = vec2(q.x/w, (q.y-top)/(top+1.3));
  float hull = (length(cs)-1.0)*min(w, 2.2)*0.8;
  hull = max(hull, q.y - top);
  hull = max(hull, abs(q.z) - 17.4);
  // open hull: hollow it out above the sunken deck
  float flr = floorY(q.z);
  float wi = max(w - 0.15, 0.05);
  vec2 ci = vec2(q.x/wi, (q.y-top)/(top+1.15));
  float inner = (length(ci)-1.0)*min(wi, 2.0)*0.8;
  float voidV = max(inner, flr - q.y);
  voidV = max(voidV, abs(q.z) - 15.8);
  hull = max(hull, -voidV);
  // strakes: overlapping planks
  hull -= smoothstep(0.0, 0.08, fract(q.y*2.6))*0.012;
  vec2 res = vec2(hull, 2.0);
  // gunwale rail
  vec3 qa = vec3(abs(q.x), q.y, q.z);
  float rail = length(vec2(qa.x - halfBeam(q.z) + 0.05, q.y - top)) - 0.075;
  rail = max(rail, abs(q.z) - 16.8);
  if(rail < res.x) res = vec2(rail, 8.0);

  float ram = sdRoundCone(q, vec3(0.0,-0.15,16.0), vec3(0.0,0.0,20.6), 0.6, 0.16);
  ram = min(ram, sdRoundCone(vec3(abs(q.x), q.y, q.z), vec3(0.0,0.0,18.0), vec3(0.55,0.0,19.6), 0.09, 0.04));
  ram = min(ram, sdCapsule(q, vec3(0.0,0.35,17.0), vec3(0.0,0.35,20.0), 0.08));
  if(ram < res.x) res = vec2(ram, 9.0);

  float wood = sdCapsule(q, vec3(0.0,0.4,16.5), vec3(0.0,5.0,17.9), 0.28);
  wood = min(wood, sdCapsule(q, vec3(0.0,2.3,-16.6), vec3(0.0,5.3,-18.4), 0.34));
  wood = min(wood, sdCapsule(q, vec3(0.0,5.3,-18.4), vec3(0.0,7.5,-17.7), 0.27));
  wood = min(wood, sdCapsule(q, vec3(0.0,7.5,-17.7), vec3(0.0,8.1,-16.0), 0.20));
  wood = min(wood, sdCapsule(q, vec3(0.0,8.1,-16.0), vec3(0.0,7.6,-15.0), 0.14));
  wood = min(wood, sdCapsule(q, vec3(0.0,2.0,1.5), vec3(0.0,15.4,1.5), 0.24));
  wood = min(wood, sdCapsule(q, vec3(-7.7,14.5-uYard,1.75), vec3(7.7,14.5-uYard,1.75), 0.15));
  wood = min(wood, sdCapsule(q, vec3(0.0,15.2,1.5), vec3(0.0,6.0,-16.8), 0.035));
  wood = min(wood, sdCapsule(qa, vec3(0.0,15.0,1.5), vec3(2.4,2.6,-1.5), 0.03));
  wood = min(wood, sdCapsule(qa, vec3(0.0,15.0,1.5), vec3(2.3,2.6,5.0), 0.03));
  // thwarts / benches across the deck
  float bz = (fract((q.z+10.6+0.62)/1.8)-0.5)*1.8;
  float bench = sdBox(vec3(abs(q.x) - (0.55 + min(w,2.3))*0.5, q.y - (flr + 0.45), bz), vec3(max((min(w,2.3)-0.55)*0.5, 0.01), 0.05, 0.15));
  bench = max(bench, abs(q.z) - 11.8);
  wood = min(wood, bench);
  // central gangway
  wood = min(wood, max(sdBox(vec3(q.x, q.y - (flr + 0.12), 0.0), vec3(0.42, 0.06, 1e3)), abs(q.z) - 11.6));
  wood = min(wood, sdCapsule(qa, vec3(2.0,3.7,-13.6), vec3(3.2,-1.3,-18.7), 0.13));
  wood = min(wood, sdEllipsoid(qa - vec3(3.05,-0.9,-18.2), vec3(0.12,1.1,0.55)));
  float zi = clamp(floor((qa.z + 10.6)/1.8 + 0.5), 0.0, 11.0);
  float oz = -10.6 + zi*1.8;
  float ph = uOarPhase - zi*0.06;
  float sweep = sin(ph)*0.42;
  float dip = 0.30 + 0.17*cos(ph);
  vec3 pv = vec3(halfBeam(oz)-0.1, 1.9, oz);
  vec3 od = vec3(cos(dip)*cos(sweep), -sin(dip), cos(dip)*sin(sweep));
  vec3 handle = pv - od*1.25;
  float oar = sdCapsule(qa, handle, pv+od*9.2, 0.07);
  oar = min(oar, sdEllipsoid(qa - (pv+od*8.6), vec3(0.18,0.55,0.18)));
  wood = min(wood, oar);
  if(wood < res.x) res = vec2(wood, 8.0);
  if(abs(qa.z) < 12.5 && qa.x < 2.6 && q.y < top + 1.6){
    vec2 rw = rowerSDF(qa, oz, handle, ph);
    if(rw.x < res.x) res = rw;
  }

  float hh = max(4.05*uSail, 0.25);
  vec3 sq = q - vec3(0.0, 14.3 - hh - uYard, 1.95);
  if(length(sq) < 10.0){
    float bil = (1.8*(1.0 - sq.x*sq.x/52.0)*(0.7 + 0.3*(sq.y+hh)/(2.0*hh))
              + (n3(vec3(sq.xy*0.33, uTime*1.9))-0.5)*0.55
              + sin(sq.x*0.9 - uTime*9.0)*0.05)*uSail;
    float sail = max(abs(sq.z - bil) - 0.05 - (1.0-uSail)*0.32, max(abs(sq.x)-7.3, abs(sq.y)-hh));
    sail *= 0.6;
    if(sail < res.x) res = vec2(sail, 3.0);
  }

  float si = clamp(floor((qa.z + 8.4)/2.1 + 0.5), 0.0, 8.0);
  float sz = -8.4 + si*2.1;
  vec3 sc = vec3(halfBeam(sz)+0.06, 2.45, sz);
  vec3 sl = qa - sc;
  float rr = length(sl.yz);
  float sh = max(rr - 0.66, abs(sl.x - 0.08*(1.0-rr*rr/0.44)) - 0.05);
  sh = min(sh, max(rr - 0.14, abs(sl.x - 0.1) - 0.05));
  if(sh < res.x) res = vec2(sh, 4.0);

  float fb = floorY(-9.6);
  float bz2 = sdRoundCone(q, vec3(0.0,fb+0.12,-9.6), vec3(0.0,fb+0.95,-9.6), 0.13, 0.36);
  bz2 = min(bz2, sdCapsule(vec3(abs(q.x), q.y, abs(q.z+9.6)), vec3(0.18,fb,0.18), vec3(0.12,fb+0.6,0.12), 0.03));
  bz2 = max(bz2, -sdRoundCone(q, vec3(0.0,fb+0.65,-9.6), vec3(0.0,fb+1.15,-9.6), 0.1, 0.30));
  if(bz2 < res.x) res = vec2(bz2, 9.0);

  vec2 h1 = sdHuman(q - vec3(0.35, floorY(-12.6), -12.6), uHeroPose, 0.0);
  if(h1.x < res.x) res = h1;
  vec2 h2 = sdHuman(q - vec3(0.0, floorY(-14.7), -14.7), vec4(1.05, 1.05, 0.05, 0.0), 1.0);
  if(h2.x < res.x) res = h2;
  return res;
}

// ---------------- Scylla ----------------
vec2 sdHead(vec3 h, float jaw){
  float skull = sdEllipsoid(h - vec3(0.0,0.3,0.5), vec3(0.85,0.72,1.9));
  vec3 hu = h - vec3(0.0,0.15,0.3); hu.yz = rot(jaw*0.5)*hu.yz;
  float up = sdEllipsoid(hu - vec3(0.0,0.12,2.1), vec3(0.72,0.36,2.7));
  vec3 hl = h - vec3(0.0,-0.15,0.3); hl.yz = rot(-jaw*0.6)*hl.yz;
  float lo = sdEllipsoid(hl - vec3(0.0,-0.18,1.9), vec3(0.62,0.28,2.5));
  float d = smin(skull, up, 0.5);
  d = smin(d, lo, 0.3);
  vec3 hs = vec3(abs(h.x), h.y, h.z);
  d = smin(d, sdRoundCone(hs, vec3(0.55,0.9,0.7), vec3(0.95,1.7,-1.2), 0.30, 0.05), 0.25);
  d = smin(d, sdRoundCone(hs, vec3(0.35,1.0,0.0), vec3(0.45,1.5,-1.9), 0.20, 0.04), 0.2);
  // brow ridges and nostril ridges
  d = smin(d, sdRoundCone(hs, vec3(0.45,0.75,1.6), vec3(0.3,0.55,3.6), 0.14, 0.05), 0.15);
  float mat = 5.0;
  float teeth = 1e5;
  float tz = clamp(floor((hu.z-0.8)/0.34+0.5), 0.0, 11.0);
  float zz = 0.8 + tz*0.34;
  float wz = sqrt(max(1.0 - pow((zz-2.1)/2.7,2.0), 0.0));
  for(int r=0;r<3;r++){
    float rx = (0.60 - 0.16*float(r))*wz;
    vec3 tp = vec3(abs(hu.x)-rx, hu.y+0.12, hu.z-zz);
    teeth = min(teeth, sdRoundCone(tp, vec3(0.0), vec3(0.0,-0.5+0.12*float(r),0.08), 0.06, 0.006));
  }
  float tz2 = clamp(floor((hl.z-0.8)/0.34+0.5), 0.0, 10.0);
  float zz2 = 0.8 + tz2*0.34;
  float wz2 = sqrt(max(1.0 - pow((zz2-1.9)/2.5,2.0), 0.0));
  for(int r=0;r<3;r++){
    float rx = (0.52 - 0.14*float(r))*wz2;
    vec3 tp = vec3(abs(hl.x)-rx, hl.y+0.0, hl.z-zz2);
    teeth = min(teeth, sdRoundCone(tp, vec3(0.0), vec3(0.0,0.42-0.1*float(r),0.06), 0.055, 0.006));
  }
  if(teeth < d){ d = teeth; mat = 10.0; }
  float eye = length(hs - vec3(0.62,0.55,1.25)) - 0.13;
  if(eye < d){ d = eye; mat = 6.0; }
  return vec2(d, mat);
}

vec2 scylla(vec3 p){
  vec2 res = vec2(1e5, 5.0);
  for(int i=0;i<6;i++){
    vec4 b = uNeckB[i];
    float bd = length(p-b.xyz) - b.w;
    if(bd > res.x) { continue; }
    float d = 1e5;
    float lim = min(res.x, 1e4);
    for(int j=0;j<7;j++){
      vec3 a = uNeck[i*8+j], c = uNeck[i*8+j+1];
      float r1 = mix(3.6, 1.35, float(j)/7.0), r2 = mix(3.6, 1.35, float(j+1)/7.0);
      float sb = length(p - (a+c)*0.5) - length(c-a)*0.5 - r1;
      if(sb > min(d, lim) + 1.0) { d = min(d, sb + 0.9); continue; }
      d = smin(d, sdRoundCone(p, a, c, r1, r2), 1.0);
    }
    vec3 hp = uNeck[i*8+7];
    vec3 f = uHeadF[i].xyz;
    vec3 r = normalize(cross(vec3(0.0,1.0,0.0), f));
    vec3 u = cross(f, r);
    vec3 dp = p - hp;
    vec3 h = vec3(dot(dp,r), dot(dp,u), dot(dp,f));
    float S = 2.2;
    float hb = length(h - vec3(0.0,0.0,2.0*S)) - 4.2*S;
    vec2 hd = vec2(hb, 5.0);
    if(hb < min(d, res.x) + 0.5){ hd = sdHead(h/S, uHeadF[i].w); hd.x *= S; }
    float mat = 5.0;
    if(hd.y > 5.5 && hd.x < d) { mat = hd.y; d = hd.x; }
    else d = smin(d, hd.x, 1.0);
    if(d < res.x) res = vec2(d, mat);
  }
  return res;
}

vec2 crew(vec3 p){
  vec2 res = vec2(1e5, 11.0);
  vec3 fwd = uShipRot[2];
  for(int i=0;i<6;i++){
    vec3 dp = p - uMen[i].xyz;
    float bl = length(dp) - 2.6;
    if(bl > res.x) continue;
    vec3 up = uMenUp[i];
    vec3 rt = normalize(cross(up, fwd));
    vec3 fw = cross(rt, up);
    vec3 q = vec3(dot(dp,rt), dot(dp,up), dot(dp,fw));
    vec2 h = sdHuman(q, uMenPose[i], 2.0 + float(i));
    if(h.x < res.x) res = h;
  }
  return res;
}

vec2 map(vec3 p){
  vec2 res = vec2(cliffs(p), 1.0);
  float bs = length(p - uShipPos) - 27.0;
  if(bs < res.x){
    vec3 q = (p - uShipPos)*uShipRot;
    vec2 s = shipSDF(q);
    if(s.x < res.x) res = s;
  }
  if(uMenOn > 0.5){ vec2 c = crew(p); if(c.x < res.x) res = c; }
  if(uScylla > 0.5){ vec2 s = scylla(p); if(s.x < res.x) res = s; }
  return res;
}

vec3 calcNormal(vec3 p, float t){
  gT = t;
  float e = 0.0005*t + 0.0015;
  vec2 k = vec2(1.0,-1.0);
  return normalize(k.xyy*map(p+k.xyy*e).x + k.yyx*map(p+k.yyx*e).x + k.yxy*map(p+k.yxy*e).x + k.xxx*map(p+k.xxx*e).x);
}

float calcAO(vec3 p, vec3 n){
  float occ = 0.0, sca = 1.0;
#ifdef HQ
  for(int i=0;i<5;i++){
    float h = 0.04 + 0.35*float(i);
#else
  for(int i=0;i<3;i++){
    float h = 0.2 + 0.7*float(i);
#endif
    float d = map(p + n*h).x;
    occ += (h-d)*sca; sca *= 0.7;
  }
  return clamp(1.0 - 0.7*occ, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k){
  float res = 1.0, t = mint;
  for(int i=0;i<48;i++){
    gT = t + 30.0;
    float h = map(ro + rd*t).x;
    res = min(res, k*h/t);
    t += clamp(h, 0.03, 3.0);
    if(res < 0.003 || t > maxt) break;
  }
  return clamp(res, 0.0, 1.0);
}

float marchObj(vec3 ro, vec3 rd, float tmin, float tmax, out float mat){
  float t = tmin; mat = 0.0;
  for(int i=0;i<260;i++){
    vec3 p = ro + rd*t;
    gT = t;
    vec2 h = map(p);
    if(h.x < 0.0006*t + 0.0015){ mat = h.y; return t; }
    t += h.x*0.85;
    if(t > tmax) break;
  }
  return 1e9;
}

float marchOcean(vec3 ro, vec3 rd, float tmax){
  float t = 0.0;
  float ceil = 7.5;
  if(ro.y > ceil){ if(rd.y >= -1e-4) return 1e9; t = (ro.y-ceil)/(-rd.y); }
  float tPrev = t;
  for(int i=0;i<200;i++){
    vec3 p = ro + rd*t;
    if(t > tmax) break;
    if(p.y > ceil && rd.y > 0.0) break;
    float c; int it = t > 500.0 ? 6 : (t > 180.0 ? 8 : 11);
    float h = oceanH(p.xz, it, c);
    float d = p.y - h;
    if(d < 0.0){
      float a = tPrev, b = t;
      for(int k=0;k<8;k++){
        float m = (a+b)*0.5; vec3 q = ro + rd*m; float cc;
        if(q.y - oceanH(q.xz, it, cc) < 0.0) b = m; else a = m;
      }
      return (a+b)*0.5;
    }
    tPrev = t;
#ifdef HQ
    t += max(d*0.5, 0.02 + t*0.0028);
#else
    t += max(d*0.55, 0.03 + t*0.0038);
#endif
  }
  return 1e9;
}

vec3 firePos(){ return uShipPos + uShipRot*vec3(0.0, floorY(-9.6)+1.25, -9.6); }

// ---------------- sky ----------------
float landProfile(float az){
  return 0.012 + 0.020*fbm2(vec2(az*7.0, 3.3), 4) + 0.012*fbm2(vec2(az*23.0, 9.1), 3);
}
vec3 skyCol(vec3 rd, bool clouds2D){
  float y = rd.y;
  vec3 hd = normalize(vec3(rd.x, 0.0, rd.z) + 1e-5);
  float sd = max(dot(hd, normalize(vec3(SUN.x,0.0,SUN.z))), 0.0);
  float hz = exp(-max(y,0.0)*7.0);
  vec3 col = mix(vec3(0.010,0.013,0.017), vec3(0.042,0.050,0.057), hz);
  float gap = exp(-abs(y-0.026)*60.0)*pow(sd, 5.0);
  col += vec3(1.0,0.38,0.10)*gap*1.7 + vec3(0.9,0.32,0.10)*exp(-abs(y)*14.0)*pow(sd,2.5)*0.12;
  vec3 bd = normalize(uBoltPos - uCamPos);
  float bdot = max(dot(rd, bd), 0.0);
  if(y > 0.0 && clouds2D){
    vec2 uv = rd.xz/(y + 0.09)*0.85 + vec2(uTime*0.018, uTime*0.032);
    float c = fbm2(uv*1.15, 7);
    float c2 = fbm2(uv*3.1 + 4.0, 4);
    float dens = smoothstep(0.32, 0.72, c*0.8 + c2*0.25);
    float under = smoothstep(0.55, 0.25, c);
    vec3 cc = vec3(0.010,0.012,0.015) + vec3(0.9,0.36,0.10)*gap*0.8*(0.3+under) + vec3(0.025,0.03,0.035)*under*hz;
    col = mix(col, cc, dens*smoothstep(0.0, 0.08, y));
    float fl = uFlash*(0.08 + 2.2*pow(bdot, 6.0))*(0.2 + 1.8*c*c);
    col += vec3(0.55,0.65,0.85)*fl*(0.3 + dens);
  } else if(y <= 0.0) {
    col += vec3(0.5,0.6,0.8)*uFlash*0.03;
  }
  float az = atan(rd.x, rd.z);
  float lp = landProfile(az);
  if(y < lp && y > -0.02){
    float land = smoothstep(lp, lp-0.002, y);
    vec3 lc = vec3(0.045,0.05,0.058) + vec3(0.55,0.25,0.1)*gap*0.25 + vec3(0.4,0.48,0.6)*uFlash*0.12;
    col = mix(col, lc, land*0.9);
  }
  return col;
}

#ifdef HQ
// raymarched storm-cloud deck, lit from within by the lightning and from below by the dusk
vec3 cloudsVol(vec3 rd, vec3 bg, float jit){
  if(rd.y <= 0.004) return bg;
  float y0 = 620.0, y1 = 1550.0;
  float t0 = (y0 - uCamPos.y)/rd.y, t1 = (y1 - uCamPos.y)/rd.y;
  t1 = min(t1, t0 + 14000.0);
  const int STEPS = 48;
  float dt = (t1-t0)/float(STEPS);
  float T = 1.0; vec3 acc = vec3(0.0);
  vec3 hd = normalize(vec3(rd.x,0.0,rd.z));
  float dusk = pow(max(dot(hd, normalize(vec3(SUN.x,0.0,SUN.z))),0.0), 4.0);
  for(int i=0;i<STEPS;i++){
    float t = t0 + dt*(float(i)+jit);
    vec3 p = uCamPos + rd*t;
    float h = (p.y - y0)/(y1 - y0);
    vec3 q = p*0.00105 + vec3(uTime*0.010, uTime*0.004, uTime*0.018);
    float base = fbm3(q, 5);
    float detail = fbm3(q*4.3 + 7.0, 3);
    float dens = smoothstep(0.40, 0.78, base - 0.30*h + 0.12 - detail*0.12);
    dens *= smoothstep(0.0,0.10,h)*smoothstep(1.0,0.55,h);
    if(dens > 0.002){
      vec3 L = vec3(0.010,0.012,0.015)*(0.3+0.9*h)*uAmb
             + vec3(1.0,0.38,0.10)*0.30*dusk*(1.0-h)*exp(-t/12000.0)
             + vec3(0.60,0.70,0.95)*uFlash*1.6*exp(-length(p - uBoltPos)/650.0)
             + vec3(0.50,0.60,0.85)*uFlash*0.05;
      float a = 1.0 - exp(-dens*dt*0.0045);
      acc += T*a*L;
      T *= 1.0 - a;
      if(T < 0.015) break;
    }
  }
  float fade = smoothstep(0.004, 0.06, rd.y);
  return mix(bg, bg*T + acc, fade);
}
#endif

// ---------------- materials / lights ----------------
vec3 lightObj(vec3 p, vec3 n, vec3 rd, vec3 alb, float rough, float specAmt, float ao, float metal, float sss, float shF, float shL){
  vec3 diffAlb = alb*(1.0 - metal);
  vec3 specCol = mix(vec3(1.0), alb*1.7, metal);
  vec3 amb = mix(vec3(0.006,0.007,0.008), vec3(0.045,0.053,0.060), n.y*0.5+0.5)*uAmb;
  vec3 col = diffAlb*amb*ao;
  vec3 sh = normalize(SUN);
  float wrap = sss*0.5;
  float dh = max((dot(n, sh)+wrap)/(1.0+wrap), 0.0);
  col += diffAlb*vec3(1.0,0.52,0.22)*0.22*dh;
  vec3 lb = normalize(uBoltPos - p);
  float db = max((dot(n, lb)+wrap)/(1.0+wrap), 0.0);
  float occ = 1.0;
  if(uBoltPos.x > 150.0 && p.x > 30.0) occ = smoothstep(120.0, 190.0, p.y + (p.x-60.0)*0.4);
  if(uBoltPos.x < -250.0 && p.x < -150.0) occ = smoothstep(40.0, 90.0, p.y);
  vec3 fcol = vec3(0.72,0.82,1.0)*uFlash*0.9*occ*shL;
  col += diffAlb*fcol*db*(0.4+0.6*ao);
  vec3 fp = firePos() - p; float fd2 = dot(fp,fp); vec3 fl = normalize(fp);
  vec3 fire = vec3(1.0,0.45,0.15)*uFire*9.0/(fd2+4.0)*shF;
  col += diffAlb*fire*max((dot(n,fl)+wrap)/(1.0+wrap),0.0);
  // subsurface: warm light bleeding through thin skin and cloth
  col += alb*sss*fire*0.35*pow(max(dot(rd, fl),0.0), 2.0);
  col += alb*sss*fcol*0.25*pow(max(dot(rd, lb),0.0), 2.0);
  float sp = exp2(10.0*(1.0-rough)+1.0);
  float ndv = max(dot(n,-rd),0.0);
  float fr = mix(0.04 + 0.96*pow(1.0-ndv, 5.0), 1.0, metal);
  vec3 hv;
  hv = normalize(lb - rd); col += specCol*fcol*pow(max(dot(n,hv),0.0), sp)*specAmt*fr*4.0;
  hv = normalize(sh - rd); col += specCol*vec3(1.0,0.55,0.25)*0.6*pow(max(dot(n,hv),0.0), sp)*specAmt*fr*4.0;
  hv = normalize(fl - rd); col += specCol*fire*pow(max(dot(n,hv),0.0), sp)*specAmt*fr*2.5;
#ifdef HQ
  vec3 rf = reflect(rd, n);
  col += specCol*skyCol(rf, true)*fr*specAmt*0.5*ao*(1.0 - rough*0.7);
#endif
  col += vec3(0.05,0.058,0.065)*uAmb*pow(1.0-ndv, 4.0)*specAmt*0.4;
  col += vec3(0.6,0.7,0.95)*uFlash*pow(1.0-ndv, 4.0)*pow(max(dot(rd, lb),0.0),2.0)*0.5*occ;
  return col;
}

vec3 shadeObj(vec3 p, vec3 rd, float t, float mat){
  vec3 n = calcNormal(p, t);
  float ao = calcAO(p, n);
  vec3 alb = vec3(0.1); float rough = 0.7; float spec = 0.3; float metal = 0.0; float sss = 0.0;
  vec3 emit = vec3(0.0);
  if(mat < 1.5){ // rock: strata, cracks, salt, lichen, wet base
    float strata = n3(vec3(p.y*0.32, p.x*0.015, p.z*0.015));
    float layer = floor(p.y/7.5 + fbm3(p*vec3(0.011,0.018,0.011),2)*0.7);
    vec3 layerTint = mix(vec3(1.0,0.95,0.88), vec3(0.85,0.88,0.9), hash1(layer*3.7));
    alb = mix(vec3(0.080,0.072,0.064), vec3(0.165,0.148,0.128), strata)*layerTint;
    vec2 vb = vor2(vec2(p.z*0.05, p.y*0.075));
    float crev = 1.0 - smoothstep(0.0, 0.14, vb.x);
    alb *= 1.0 - crev*0.55;
    float seep = smoothstep(0.55, 0.8, n3(vec3(p.x*0.6, p.y*0.02, p.z*0.6)));
    alb = mix(alb, vec3(0.03,0.028,0.025), seep*0.5);
    float iron = smoothstep(0.6, 0.85, n3(vec3(p.x*0.3, p.y*0.04 + 3.0, p.z*0.3)));
    alb = mix(alb, vec3(0.20,0.09,0.04), iron*0.35);
    alb *= 0.65 + 0.7*fbm3(p*0.22, 3);
    float crack = smoothstep(0.03, 0.0, abs(n3(p*vec3(0.2,0.12,0.2))-0.5));
    crack = max(crack, smoothstep(0.025, 0.0, abs(n3(p*0.55+3.0)-0.5))*0.6);
    alb *= 1.0 - 0.65*crack;
    float salt = smoothstep(0.6,0.85, n3(vec3(p.x*0.35, p.y*0.025, p.z*0.35)))*smoothstep(40.0,4.0,p.y);
    alb = mix(alb, vec3(0.30,0.30,0.28), salt*0.45);
    float wet = smoothstep(9.0, 1.0, p.y);
    float algae = smoothstep(5.0, 0.5, p.y);
    alb = mix(alb, vec3(0.02,0.03,0.02), algae*0.7);
    alb *= mix(1.0, 0.5, wet);
    rough = mix(0.82, 0.22, wet); spec = mix(0.12, 0.9, wet);
    float moss = smoothstep(0.55, 0.9, n.y)*smoothstep(20.0, 40.0, p.y);
    float lichen = smoothstep(0.62, 0.8, n3(p*0.7))*(1.0-wet);
    alb = mix(alb, vec3(0.045,0.06,0.035), moss*0.8);
    alb = mix(alb, vec3(0.20,0.19,0.12), lichen*0.35);
#ifdef HQ
    n = bumpN(n, p, 0.6, 0.35);
    n = bumpN(n, p, 1.3, 0.45*(1.0-crack*0.5));
    n = bumpN(n, p, 4.5, 0.25);
    n = bumpN(n, p, 14.0, 0.12);
    ao *= 1.0 - crev*0.5;
#else
    n = bumpN(n, p, 1.3, 0.35);
#endif
  } else if(mat < 2.5){ // hull: tarred planks, painted band and eye, lighter deck
    vec3 q = (p - uShipPos)*uShipRot;
    vec3 nl = n*uShipRot;
    float grain = n3(q*vec3(0.35,9.0,0.35));
    float seam = smoothstep(0.06, 0.0, fract(q.y*2.6));
    alb = vec3(0.020,0.017,0.015)*(0.75+0.5*grain);
    alb *= 1.0 - seam*0.5;
    float band = smoothstep(0.03,0.0, abs(q.y - (deckY(q.z)-0.45)) - 0.12);
    alb = mix(alb, vec3(0.32,0.065,0.035)*(0.8+0.4*grain), band*0.85);
    // apotropaic eye at the bow
    if(q.z > 12.0){
      vec2 e = vec2((q.z - 14.7)/0.62, (q.y - (deckY(14.7)-1.05))/0.30);
      float almond = length(vec2(e.x, e.y/(1.0 - 0.35*abs(e.x)))) ;
      float white = smoothstep(1.0, 0.94, almond);
      float iris = smoothstep(0.42, 0.37, length(e*vec2(1.0,0.55)));
      float rim = smoothstep(1.12, 1.04, almond) - white;
      alb = mix(alb, vec3(0.55,0.06,0.04), rim*0.9);
      alb = mix(alb, vec3(0.62,0.58,0.50), white);
      alb = mix(alb, vec3(0.015), iris);
    }
    rough = 0.32; spec = 0.85;
    bool inside = q.y > floorY(q.z) - 0.05 && nl.x*sign(q.x) < -0.2 && abs(q.x) < halfBeam(q.z) - 0.05;
    if(inside){ // unpainted inner planking, darkened by bilge and use
      alb = vec3(0.085,0.062,0.042)*(0.6+0.6*grain)*(1.0 - seam*0.6);
      alb *= mix(0.55, 1.0, smoothstep(floorY(q.z), floorY(q.z)+0.9, q.y));
      rough = 0.5; spec = 0.5;
    }
    if(nl.y > 0.6 && q.y < deckY(q.z) - 0.25){ // deck boards
      float boards = smoothstep(0.04, 0.0, abs(fract(q.x*4.5)-0.5)-0.46);
      alb = vec3(0.10,0.075,0.05)*(0.6+0.6*n3(q*vec3(6.0,1.0,0.3)))*(1.0 - boards*0.5);
      alb *= 0.7; rough = 0.35; spec = 0.7;
    }
    n = bumpN(n, p, 6.0, 0.08);
  } else if(mat < 3.5){ // sail: striped linen, weave, stains
    vec3 q = (p - uShipPos)*uShipRot;
    float stripe = mix(step(0.5, fract((q.x+7.3)/2.43)), 0.5+0.5*sin(q.x*9.0+q.y*14.0), (1.0-uSail)*0.6);
    alb = mix(vec3(0.33,0.29,0.22), vec3(0.19,0.06,0.04), stripe);
    float weave = 0.5 + 0.5*sin(q.x*160.0)*sin(q.y*160.0);
    alb *= 0.82 + 0.18*weave;
    alb *= 0.5 + 0.55*fbm3(q*0.8, 4);
    alb *= 0.8 + 0.25*n3(vec3(q.x*3.0, q.y*0.15, 0.0));
    alb = mix(alb, vec3(0.10,0.085,0.065), smoothstep(0.6,0.85,n3(q*vec3(0.6,1.2,0.6)))*0.45);
    alb *= mix(1.0, 0.6, smoothstep(0.5, 0.0, (q.y - (14.3-2.0*4.05*uSail-uYard))/3.0));
    rough = 0.92; spec = 0.06; sss = 1.0;
    vec3 lb = normalize(uBoltPos - p);
    emit += alb*vec3(0.7,0.8,1.0)*uFlash*0.55*max(dot(rd, lb),0.0);
    emit += alb*vec3(1.0,0.5,0.2)*0.12*pow(max(dot(rd, normalize(SUN)),0.0),2.0);
  } else if(mat < 4.5){ // bronze with verdigris in the crevices
    alb = vec3(0.30,0.19,0.08)*(0.6+0.5*n3(p*3.0))*(0.8+0.3*n3(p*40.0));
    float pat = smoothstep(0.40, 0.8, n3(p*2.2))*(1.0-ao*0.7) + (1.0-ao)*0.6 + smoothstep(0.6,0.9,n3(p*9.0))*0.3;
    pat = clamp(pat, 0.0, 1.0);
    alb = mix(alb, vec3(0.07,0.15,0.12), pat*0.7);
    rough = mix(0.38, 0.8, pat); spec = 1.0; metal = 1.0 - pat*0.85;
    n = bumpN(n, p, 14.0, 0.06);
  } else if(mat < 5.5){ // Scylla: overlapping scales, wet hide, scars
    vec2 sc = cell3(p*1.25);
    float edge = smoothstep(0.0, 0.16, sc.y);
    float ridge = n3(p*0.4);
    alb = mix(vec3(0.010,0.013,0.011), vec3(0.050,0.055,0.040), ridge);
    alb *= mix(0.65, 1.0, edge);
    alb *= 0.8 + 0.4*n3(p*6.0);
    float scar = smoothstep(0.015, 0.0, abs(n3(p*0.3+5.0)-0.5))*0.6;
    alb = mix(alb, vec3(0.12,0.09,0.08), scar);
    n = bumpN(n, p, 2.4, 0.35);
    n = normalize(n + (vec3(sc.x)-0.5)*0.0 + (vec3(n3(p*7.0), n3(p*7.0+3.0), n3(p*7.0+5.0))-0.5)*0.25*(1.0-edge));
    rough = mix(0.55, 0.22, edge); spec = 1.0;
  } else if(mat < 6.5){
    alb = vec3(0.02); emit = vec3(1.0,0.66,0.18)*3.0; spec = 1.0; rough = 0.1;
  } else if(mat < 7.5){ // Odysseus' crimson wool cloak
    alb = vec3(0.24,0.030,0.024)*(0.7+0.5*fbm3(p*8.0,3));
    alb *= 0.85 + 0.15*sin(p.y*220.0);
    rough = 0.95; spec = 0.08; sss = 0.8;
  } else if(mat < 8.5){ // timber
    alb = vec3(0.075,0.052,0.035)*(0.6+0.6*n3(p*vec3(2.0,9.0,2.0)));
    rough = 0.48; spec = 0.45;
    n = bumpN(n, p, 8.0, 0.06);
  } else if(mat < 9.5){ // bronze ram / brazier
    alb = vec3(0.42,0.25,0.09)*(0.8+0.3*n3(p*4.0));
    float pat = smoothstep(0.5, 0.85, n3(p*1.6))*0.8;
    alb = mix(alb, vec3(0.09,0.22,0.18), pat);
    rough = 0.28 + pat*0.4; spec = 1.5; metal = 1.0 - pat;
  } else if(mat < 10.5){ // teeth
    alb = mix(vec3(0.50,0.46,0.37), vec3(0.30,0.24,0.14), n3(p*9.0));
    rough = 0.3; spec = 0.8; sss = 0.3;
  } else if(mat < 11.5){ // skin: sun-dark, rain-wet
    alb = vec3(0.23,0.145,0.105)*(0.8 + 0.35*n3(p*30.0))*(0.85+0.3*n3(p*4.0));
    alb = mix(alb, vec3(0.20,0.09,0.07), smoothstep(0.55,0.8,n3(p*12.0))*0.35);
    alb = mix(alb, vec3(0.07,0.06,0.05), smoothstep(0.6,0.85,n3(p*7.0))*0.4);
    rough = 0.5 - smoothstep(0.4,0.8,n3(p*20.0))*0.15; spec = 0.4; sss = 1.0;
    n = bumpN(n, p, 90.0, 0.04);
  } else if(mat < 13.5){ // undyed linen
    alb = vec3(0.40,0.36,0.29)*(0.7+0.4*fbm3(p*10.0,3));
    rough = 0.9; spec = 0.1; sss = 0.6;
    n = bumpN(n, p, 40.0, 0.1);
  } else if(mat < 14.5){ // hair and beards
    alb = vec3(0.028,0.020,0.016)*(0.7+0.6*n3(p*vec3(200.0,40.0,200.0)));
    rough = 0.55; spec = 0.5;
  } else if(mat < 15.5){ // leather
    alb = vec3(0.11,0.065,0.035)*(0.7+0.5*n3(p*25.0));
    rough = 0.55; spec = 0.5;
    n = bumpN(n, p, 30.0, 0.08);
  } else if(mat < 16.5){ // horsehair crest
    alb = vec3(0.30,0.035,0.025)*(0.6+0.8*n3(p*vec3(300.0,30.0,30.0)));
    rough = 0.7; spec = 0.3; sss = 0.5;
  } else if(mat < 18.5){ // madder-red tunic
    alb = vec3(0.26,0.07,0.04)*(0.7+0.4*fbm3(p*10.0,3));
    rough = 0.9; spec = 0.1; sss = 0.6;
    n = bumpN(n, p, 40.0, 0.1);
  } else if(mat < 19.5){ // indigo-black wool
    alb = vec3(0.04,0.05,0.075)*(0.7+0.4*fbm3(p*10.0,3));
    rough = 0.92; spec = 0.08; sss = 0.4;
  } else { // dark wool cloak
    alb = vec3(0.05,0.042,0.035)*(0.7+0.5*fbm3(p*8.0,3));
    rough = 0.95; spec = 0.06; sss = 0.6;
  }
  // rain wetness on everything exposed
  float wetTop = smoothstep(0.2, 0.9, n.y)*0.4;
  rough *= 1.0 - wetTop*0.4; spec += wetTop*0.3;
  float shF = 1.0, shL = 1.0;
#ifdef HQ
  vec3 fp = firePos() - p; float fd = length(fp);
  if(fd < 40.0 && uFire > 0.05) shF = softShadow(p + n*0.03, fp/fd, 0.05, fd - 0.4, 10.0);
  if(uFlash > 0.06 && mat > 1.5) shL = 0.25 + 0.75*softShadow(p + n*0.05, normalize(uBoltPos - p), 0.1, 70.0, 6.0);
#endif
  return lightObj(p, n, rd, alb, rough, spec, ao, metal, sss, shF, shL) + emit;
}

float foamField(vec2 xz, float crest, float h){
  float f = 0.0;
  float fn = fbm2(xz*0.35 + vec2(uTime*0.2, -uTime*0.4), 4);
  f += smoothstep(0.66, 0.92, crest)*smoothstep(0.35, 0.75, fn)*1.2;
  vec2 wd = xz*mat2(0.85,0.53,-0.53,0.85);
  float streaks = fbm2(vec2(wd.x*0.9, wd.y*0.06) + vec2(0.0, uTime*0.6), 4);
  f += smoothstep(0.58, 0.78, streaks)*0.55*smoothstep(0.3,0.8,crest+0.2);
  f += smoothstep(0.55, 0.7, fbm2(xz*0.11 - uTime*0.05, 3))*0.06;
  if(uWhirl > 0.01){
    vec2 v = xz - uWhirlC; float r = length(v) + 1e-3;
    float prof = 1.0/(1.0 + r*r/(46.0*46.0));
    float th = atan(v.y, v.x) - uSpin*prof*1.15 + log(r)*1.3;
    vec3 sp = vec3(cos(th)*3.0, sin(th)*3.0, r*0.22);
    float s = fbm3(sp, 4);
    float s2 = n3(vec3(cos(th)*9.0, sin(th)*9.0, r*0.9));
    float streak = smoothstep(0.48, 0.72, s*0.75 + s2*0.35);
    float ring = smoothstep(170.0, 30.0, r)*smoothstep(3.0, 14.0, r);
    f += streak*ring*uWhirl*1.3;
    f += smoothstep(26.0, 8.0, r)*uWhirl*smoothstep(0.4,0.7,s2+s*0.4);
  }
  vec3 q = (vec3(xz.x, 0.0, xz.y) - uShipPos)*uShipRot;
  if(abs(q.z) < 130.0 && abs(q.x) < 40.0){
    float e = length(vec2(q.x/2.9, q.z/18.5));
    float nn = n2(q.xz*1.4 + vec2(0.0, uTime*6.0));
    f += smoothstep(1.35, 1.0, e)*(0.5 + nn)*1.0;
    f += smoothstep(1.8, 1.0, length(vec2(q.x/3.5, (q.z-17.5)/4.0)))*(0.6+nn);
    if(q.z < -15.0){
      float wz = -q.z - 15.0;
      float wid = 2.6 + wz*0.16;
      float wake = smoothstep(wid, wid*0.4, abs(q.x))*exp(-wz/70.0);
      float edge = smoothstep(1.6, 0.0, abs(abs(q.x) - (2.6 + wz*0.33)))*exp(-wz/45.0);
      f += (wake*0.8 + edge*0.6)*(0.4 + n2(q.xz*0.8 + vec2(0.0, uTime*2.0)));
    }
    float ox = abs(q.x);
    if(ox > 8.5 && ox < 12.5 && abs(q.z) < 12.5){
      float zi = floor((q.z + 10.6)/1.8 + 0.5);
      float oz = -10.6 + zi*1.8;
      float ph = uOarPhase - zi*0.06;
      float inw = smoothstep(0.0, 0.6, -cos(ph));
      float dd = length(vec2(ox - 10.4, q.z - oz - sin(ph)*3.2));
      f += smoothstep(1.4, 0.2, dd)*inw*(0.5+n2(q.xz*3.0+uTime*4.0));
    }
  }
  return clamp(f, 0.0, 1.0);
}

vec3 shadeOcean(vec3 p, vec3 rd, float t){
  float c;
#ifdef HQ
  int it = t < 80.0 ? 40 : (t < 300.0 ? 30 : 18);
#else
  int it = t < 80.0 ? 34 : (t < 300.0 ? 26 : 16);
#endif
  float e = 0.025 + t*0.0013;
  float h0 = oceanH(p.xz, it, c);
  float cx; float hx = oceanH(p.xz + vec2(e,0.0), it, cx);
  float cz; float hz = oceanH(p.xz + vec2(0.0,e), it, cz);
  vec3 n = normalize(vec3(h0-hx, e, h0-hz));
  vec2 mq = p.xz*1.6;
  vec3 micro = vec3(n2(mq + uTime*1.5)-0.5, 0.0, n2(mq.yx*1.1 - uTime*1.7)-0.5);
  micro += 0.5*vec3(n2(mq*4.1 - uTime*3.0)-0.5, 0.0, n2(mq.yx*3.7 + uTime*2.6)-0.5);
  n = normalize(n + micro*0.14*smoothstep(70.0, 5.0, t));
  n = normalize(mix(n, vec3(0.0,1.0,0.0), smoothstep(250.0, 1800.0, t)*0.7));
  float ndv = max(dot(n, -rd), 0.0);
  float fres = 0.02 + 0.98*pow(1.0-ndv, 5.0);
  vec3 rf = reflect(rd, n); rf.y = abs(rf.y) + 0.002;
  vec3 refl = skyCol(rf, true);
  float depthDark = smoothstep(-28.0, -3.0, p.y);
  vec3 body = vec3(0.002, 0.009, 0.012)*uAmb;
  float thick = smoothstep(-1.0, 4.0, p.y)*pow(max(dot(rd, normalize(SUN)), 0.0)*0.5+0.5, 2.0);
  body += vec3(0.012, 0.075, 0.065)*thick*(0.30*uAmb + uFlash*0.18);
  body += vec3(0.03, 0.12, 0.10)*uFlash*0.06;
  body *= depthDark;
  vec3 col = mix(body, refl, fres);
  vec3 sh = normalize(SUN);
  col += vec3(1.0,0.48,0.18)*pow(max(dot(rf, sh),0.0), 220.0)*3.2;
  vec3 lb = normalize(uBoltPos - p);
  col += vec3(0.7,0.8,1.0)*uFlash*pow(max(dot(rf, lb),0.0), 60.0)*3.0;
  vec3 fp = firePos() - p; float fd2 = dot(fp,fp);
  col += vec3(1.0,0.45,0.14)*uFire*pow(max(dot(rf, normalize(fp)),0.0), 120.0)*900.0/(fd2+20.0);
  float foam = foamField(p.xz, c, h0);
#ifdef HQ
  // lace: foam breaks into bubbled cells
  vec2 cl = cell3(vec3(p.xz*1.1, uTime*0.35));
  vec2 cl2 = cell3(vec3(p.xz*3.3, uTime*0.6 + 4.0));
  float lace = (1.0 - smoothstep(0.0, 0.20, cl.y))*0.75 + (1.0 - smoothstep(0.0, 0.25, cl2.y))*0.4;
  foam = clamp(foam*mix(clamp(lace,0.0,1.0), 1.0, foam*foam), 0.0, 1.0);
#endif
  vec3 fl = vec3(0.065,0.075,0.082)*uAmb + vec3(0.7,0.8,1.0)*uFlash*0.22*(0.4+0.6*max(dot(n,lb),0.0))
          + vec3(1.0,0.45,0.15)*uFire*8.0/(fd2+3.0) + vec3(0.9,0.42,0.15)*0.05;
  float ft = fbm2(p.xz*1.3 + uTime*0.3, 3);
  col = mix(col, fl*mix(0.55,1.0,ft), foam*smoothstep(0.2,0.6,ft+foam*0.5));
  col *= mix(0.15, 1.0, depthDark);
  return col;
}

// ---------------- volumetrics ----------------
float fogDensity(vec3 p, out float sprayOut){
  float h = exp(-max(p.y, 0.0)/22.0)*0.0016 + exp(-max(p.y,0.0)/220.0)*0.00028;
  float bank = 0.0;
  if(uFogBank > 0.01 && p.x > -20.0 && p.z > 230.0 && p.z < 520.0){
    float m = smoothstep(-20.0, 30.0, p.x)*smoothstep(230.0, 290.0, p.z)*smoothstep(520.0, 440.0, p.z)*exp(-max(p.y-25.0, 0.0)/80.0);
    float nn = n3(p*0.016 + vec3(uTime*0.06, uTime*0.01, uTime*0.04))*0.55 + n3(p*0.045 + vec3(-uTime*0.1, 0.0, uTime*0.05))*0.3 + n3(p*0.12 + vec3(0.0, uTime*0.2, 0.0))*0.15;
    bank = smoothstep(0.30, 0.95, nn)*m*0.019*uFogBank;
  }
  float mist = 0.0;
  if(uWhirl > 0.01){
    float r = length(p.xz - uWhirlC);
    mist = uWhirl*exp(-r/28.0)*exp(-max(p.y + 8.0, 0.0)/12.0)*0.05*(0.4 + n3(p*0.08 + vec3(0.0, uTime*0.4, 0.0)));
  }
  float spray = 0.0;
  if(uSpray > 0.01){
    vec3 q = (p - uShipPos)*uShipRot;
    if(abs(q.z) < 30.0 && abs(q.x) < 14.0 && q.y < 14.0){
      vec3 bq = (q - vec3(0.0,2.5,17.0))*vec3(0.30,0.32,0.22);
      float bow = exp(-dot(bq,bq));
      float side = exp(-pow((abs(q.x)-4.0)/2.5, 2.0))*exp(-max(q.y-1.0,0.0)/2.5)*0.4;
      float nn = n3(q*0.9 + vec3(0.0, -uTime*3.0, -uTime*7.0));
      spray = (bow + side)*smoothstep(0.45, 0.85, nn)*0.25*uSpray;
    }
  }
  sprayOut = spray;
  return (h + bank + mist)*uFog + spray;
}

vec4 fogMarch(vec3 ro, vec3 rd, float tEnd, float jit){
  tEnd = min(tEnd, 1400.0);
  vec3 acc = vec3(0.0); float T = 1.0;
#ifdef HQ
  const int N = 40;
#else
  const int N = 22;
#endif
  float tPrev = 0.0;
  vec3 fpos = firePos();
  for(int i=0;i<N;i++){
    float f = (float(i)+jit)/float(N);
    float t = tEnd*f*f;
    float dt = t - tPrev; tPrev = t;
    vec3 p = ro + rd*t;
    float sp;
    float d = fogDensity(p, sp);
    vec3 lb = normalize(uBoltPos - p);
    float ph = 0.15 + 2.6*pow(max(dot(rd, lb),0.0), 8.0);
    float occ = 1.0;
    if(uBoltPos.x > 150.0 && p.x > 0.0) occ = 0.35 + 0.65*smoothstep(120.0, 200.0, p.y + (p.x-60.0)*0.5);
    vec3 L = vec3(0.034,0.041,0.047)*uAmb
           + vec3(0.62,0.72,0.95)*uFlash*ph*0.20*occ
           + vec3(1.0,0.5,0.2)*0.16*pow(max(dot(rd, normalize(SUN)),0.0), 5.0);
    vec3 fp = fpos - p; float fd2 = dot(fp,fp);
    L += vec3(1.0,0.42,0.12)*uFire*2.2/(fd2+3.0);
    L += vec3(0.20,0.23,0.25)*sp*1.2*uAmb;
    float a = 1.0 - exp(-d*dt);
    acc += T*a*L;
    T *= 1.0 - a;
    if(T < 0.01) break;
  }
  return vec4(acc, T);
}

float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-4),0.0,1.0); return length(pa-ba*h); }

void main(){
  vec2 fc = gl_FragCoord.xy;
  if(fc.y < uTile.x || fc.y >= uTile.y){ discard; }
  float activeH = min(uRes.y, uRes.x/2.39);
  float y0 = (uRes.y - activeH)*0.5;
  if(fc.y < y0 - 2.0 || fc.y > y0 + activeH + 2.0){ o = vec4(0.0,0.0,0.0,60000.0); return; }
  vec2 sp = fc + uJitter;
  vec2 ndc = vec2(sp.x/uRes.x*2.0-1.0, (sp.y-y0)/activeH*2.0-1.0);
  float aspect = uRes.x/activeH;
  vec3 rd = normalize(uCamRot*vec3(ndc.x*uTanV*aspect, ndc.y*uTanV, 1.0));
  vec3 ro = uCamPos;
  if(uLensR > 0.0){
    vec3 fwd = uCamRot[2];
    vec3 fpnt = ro + rd*(uFocusD/max(dot(rd, fwd), 0.05));
    ro += (uCamRot[0]*uLens.x + uCamRot[1]*uLens.y)*uLensR;
    rd = normalize(fpnt - ro);
  }
  float jit = fract(hash2(fc + fract(uTime*7.13)*97.0) + uSeed*0.618034);

  float tO = marchOcean(ro, rd, 2600.0);
  float mat;
  float tS = marchObj(ro, rd, 0.3, min(tO, 2200.0), mat);
  vec3 col; float depth;
  if(tS < 1e8 && tS < tO){
    vec3 p = ro + rd*tS;
    col = shadeObj(p, rd, tS, mat);
    depth = tS;
  } else if(tO < 1e8){
    vec3 p = ro + rd*tO;
    col = shadeOcean(p, rd, tO);
    depth = tO;
  } else {
#ifdef HQ
    col = cloudsVol(rd, skyCol(rd, false), jit);
#else
    col = skyCol(rd, true);
#endif
    depth = 60000.0;
  }
  if(depth < 60000.0){
    float hz = 1.0 - exp(-max(depth-200.0,0.0)*0.0011);
    col = mix(col, skyCol(normalize(vec3(rd.x, max(rd.y,0.01), rd.z)), true)*0.9, hz);
  }
  if(uBoltVis > 0.001 && depth > 1200.0){
    float bd = 1e5;
    for(int i=0;i<39;i++){
      if(uBolt[i].z > 0.5){ bd = min(bd, segDist(fc, uBolt[i].xy, uBolt[i+1].xy)); }
    }
    float s = uRes.y/1080.0;
    float core = exp(-bd*bd/(1.6*s*s));
    float halo = 1.0/(1.0 + bd/(9.0*s));
    col += vec3(0.85,0.9,1.0)*uBoltVis*(core*28.0 + halo*halo*2.2);
  }
  vec4 fg = fogMarch(ro, rd, depth, jit);
  col = col*fg.a + fg.rgb;
  if(uScylla > 0.5){
    for(int i=0;i<12;i++){
      vec3 e = uEyes[i] - ro;
      float te = dot(e, rd);
      if(te > 0.0 && te < depth + 1.5){
        float dd = length(e - rd*te);
        float g = 1.0/(1.0 + pow(dd/(0.10 + te*0.0009), 2.0));
        col += vec3(1.0,0.62,0.16)*g*1.4*exp(-te*0.006);
      }
    }
  }
  {
    vec3 e = firePos() - ro;
    float te = dot(e, rd);
    if(te > 0.0 && te < depth + 1.0){
      float dd = length(e - rd*te);
      float fl = uFire*(0.85 + 0.15*sin(uTime*31.0));
      // flame body: flickering licks above the brazier
      vec3 fpw = ro + rd*te - firePos();
      float lick = n3(vec3(fpw.x*6.0, fpw.y*4.0 - uTime*9.0, fpw.z*6.0));
      float core = exp(-pow(dd/0.16, 2.0))*5.0*(0.6+0.8*lick);
      float halo = 1.0/(1.0 + pow(dd/(0.35 + te*0.003), 2.0))*0.22;
      col += vec3(1.0,0.48,0.14)*fl*(core + halo)*exp(-te*0.002);
    }
  }
  col *= uExposure;
  o = vec4(max(col, 0.0), depth);
}
