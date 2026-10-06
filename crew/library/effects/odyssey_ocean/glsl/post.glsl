#version 300 es
precision highp float;
uniform sampler2D uHDR;
uniform sampler2D uNoise;
uniform sampler2D uTitleTex;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform mat3  uCamRot;
uniform vec3  uPrevPos;
uniform mat3  uPrevRot;
uniform float uTanV;
uniform float uPrevTanV;
uniform float uFocus;
uniform float uAperture;
uniform float uLensWet;
uniform float uRain;
uniform float uTitle;
uniform float uFade;
uniform float uFlash;
uniform float uAmb;
uniform float uExposure;
uniform float uCamYaw;
uniform float uPostBlur;
out vec4 o;

float hash2(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
float n2(vec2 x){ vec2 p=floor(x); vec2 f=fract(x); f=f*f*(3.0-2.0*f); return textureLod(uNoise,(p+f+0.5)/256.0,0.0).x; }

vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }

float coc(float d){
  float s = uRes.y/1080.0;
  return clamp(uAperture*abs(1.0 - uFocus/max(d,0.05))*s, 0.0, 16.0*s);
}

// water drops on the lens
vec3 drops(vec2 uv, out float mask){
  mask = 0.0;
  vec2 off = vec2(0.0);
  float asp = uRes.x/uRes.y;
  for(int L=0; L<2; L++){
    float sc = L==0 ? 6.0 : 13.0;
    vec2 g = uv*vec2(asp,1.0)*sc + vec2(float(L)*7.3, 0.0);
    vec2 id = floor(g);
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 cid = id + vec2(i,j);
      float r1 = hash2(cid + float(L)*13.0), r2 = hash2(cid*1.7+3.1), r3 = hash2(cid*2.3+9.7);
      if(r3 > 0.62*uLensWet) continue;
      float slide = fract(uTime*(0.04 + r1*0.08) + r2)*1.4*step(0.6, r1);
      vec2 c = cid + 0.5 + (vec2(r1, r2)-0.5)*0.7 - vec2(0.0, slide);
      float rad = mix(0.10, 0.34, r3/0.62)*(L==0?1.0:0.8);
      vec2 dv = (g - c)/rad;
      dv.y *= mix(1.0, 0.75, step(0.6, r1));
      float d2 = dot(dv,dv);
      if(d2 < 1.0){
        float hgt = sqrt(1.0 - d2);
        off += -dv*(1.0 - hgt)*0.05*rad;
        mask = max(mask, smoothstep(1.0, 0.75, d2));
      }
    }
  }
  return vec3(off, 0.0);
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc/uRes;
  float activeH = min(uRes.y, uRes.x/2.39);
  float y0 = (uRes.y - activeH)*0.5;
  float aspect = uRes.x/activeH;
  bool inBar = fc.y < y0 || fc.y > y0 + activeH;
  vec3 col = vec3(0.0);
  if(!inBar && uFade > 0.0){
    float dm = 0.0;
    // gentle anamorphic barrel distortion
    vec2 cuv = (uv - 0.5)*vec2(aspect*activeH/uRes.y, activeH/uRes.y);
    vec2 suv = uv + (uv-0.5)*dot(cuv,cuv)*0.018;
    if(uLensWet > 0.01){
      vec3 dd = drops(uv, dm);
      suv += dd.xy*vec2(1.0, uRes.x/uRes.y)*uLensWet;
    }
    vec4 c0 = texture(uHDR, suv);
    float d0 = c0.a;
    // camera reprojection for motion blur
    vec2 ndc = vec2(suv.x*2.0-1.0, ((suv.y*uRes.y)-y0)/activeH*2.0-1.0);
    vec3 rd = normalize(uCamRot*vec3(ndc.x*uTanV*aspect, ndc.y*uTanV, 1.0));
    vec3 pw = uCamPos + rd*min(d0, 20000.0);
    vec3 lp = (pw - uPrevPos)*uPrevRot;
    vec2 vel = vec2(0.0);
    if(lp.z > 0.1){
      vec2 pn = vec2(lp.x/(lp.z*uPrevTanV*aspect), lp.y/(lp.z*uPrevTanV));
      vec2 puv = vec2(pn.x*0.5+0.5, ((pn.y*0.5+0.5)*activeH + y0)/uRes.y);
      vel = suv - puv;
    }
    float vlen = length(vel*uRes);
    float vmax = 70.0*uRes.y/1080.0;
    if(vlen > vmax) vel *= vmax/vlen;

    vel *= uPostBlur;
    float c0c = coc(d0)*uPostBlur;
    vec3 acc = vec3(0.0); float wsum = 0.0;
    const int N = 28;
    float jit = hash2(fc + uTime);
    float maxR = 16.0*uRes.y/1080.0;
    int NT = uPostBlur > 0.5 ? N : 1;
    for(int k=0;k<N;k++){
      if(k >= NT) break;
      float fk = (float(k)+0.5)/float(N);
      float r = sqrt(fk)*max(c0c, 0.0);
      float a = float(k)*2.39996 + jit*6.283;
      vec2 off = vec2(cos(a), sin(a))*r/uRes;
      vec2 mo = vel*((float(k)+jit)/float(N) - 0.5);
      vec2 su = suv + off + mo;
      vec4 s = textureLod(uHDR, su, 0.0);
      float sc = coc(s.a);
      float w = s.a < d0 ? smoothstep(r-1.0, r+1.0, sc) : 1.0;
      w = max(w, 0.02);
      acc += s.rgb*w; wsum += w;
    }
    col = acc/max(wsum, 1e-4);
    if(dm > 0.0){
      vec3 blurred = textureLod(uHDR, suv, 1.6).rgb;
      col = mix(col, blurred*1.05, dm*0.6*uLensWet);
    }
    // chromatic aberration at the frame edges
    vec2 cc = uv - 0.5;
    vec2 ca = cc*dot(cc,cc)*0.012;
    col.r += textureLod(uHDR, suv + ca, 0.0).r - c0.r;
    col.b += textureLod(uHDR, suv - ca, 0.0).b - c0.b;
    col = max(col, 0.0);

    // bloom (mip pyramid) + halation + anamorphic streak
    vec3 bl = vec3(0.0);
    bl += textureLod(uHDR, suv, 1.5).rgb*0.30;
    bl += textureLod(uHDR, suv, 3.0).rgb*0.28;
    bl += textureLod(uHDR, suv, 4.5).rgb*0.22;
    bl += textureLod(uHDR, suv, 6.0).rgb*0.20;
    vec3 hal = max(textureLod(uHDR, suv, 2.0).rgb - 0.6, 0.0)*vec3(1.0,0.35,0.15);
    vec3 st = vec3(0.0);
    for(int k=-7;k<=7;k++){
      float w = exp(-abs(float(k))*0.32);
      st += max(textureLod(uHDR, suv + vec2(float(k)*0.018, 0.0), 3.5).rgb - 1.2, 0.0)*w;
    }
    col += bl*0.085 + hal*0.12 + st*vec3(0.45,0.62,1.0)*0.05;

    // rain streaks, lit by the scene
    if(uRain > 0.01){
      float rs = 0.0;
      for(int L=0;L<3;L++){
        float fl = float(L);
        vec2 q = uv*vec2(uRes.x/uRes.y,1.0);
        q.x += q.y*0.14 + uCamYaw*(0.5 + fl*0.4);
        float cols = 90.0 + fl*80.0;
        float cx = q.x*cols;
        float cid = floor(cx);
        float r1 = hash2(vec2(cid, fl*7.0+1.0)), r2 = hash2(vec2(cid*1.3, fl*3.0+9.0));
        if(r1 > 0.55) continue;
        float y = fract(q.y*(0.7+fl*0.35) + uTime*(1.6 + fl*0.7 + r2*0.4) + r2*7.0);
        float len = 0.10 + r2*0.12;
        float streak = smoothstep(0.0, 0.02, y)*smoothstep(len, len*0.3, y);
        float wpx = (0.6 + fl*0.15)*uRes.y/1080.0;
        float xd = abs(fract(cx)-0.5 + (r2-0.5)*0.6)*uRes.x/cols;
        streak *= smoothstep(wpx, 0.0, xd);
        rs += streak*(0.5/(1.0+fl));
      }
      vec3 rl = vec3(0.16,0.18,0.20)*uAmb + vec3(0.8,0.9,1.0)*uFlash*0.5;
      col += rl*rs*uRain*0.35*uExposure;
    }

    // tonemap + grade
    col = aces(col*1.05);
    float l = dot(col, vec3(0.2126,0.7152,0.0722));
    col = mix(col, col*vec3(0.80,1.02,1.10), (1.0-l)*0.55);
    col = mix(col, col*vec3(1.10,1.00,0.86), smoothstep(0.2,0.9,l)*0.45);
    col = pow(col, vec3(1.0/2.2));
    col = mix(col, col*col*(3.0-2.0*col), 0.22);
    col = mix(vec3(dot(col, vec3(0.2126,0.7152,0.0722))), col, 0.92);
    col = col*0.985 + 0.008;
    // vignette
    vec2 vv = (uv - 0.5)*vec2(1.0, activeH/uRes.y*0.6+0.4);
    col *= 1.0 - dot(vv,vv)*0.9;
    col *= uFade;
  }
  // title card
  if(uTitle > 0.001){
    vec2 tuv = vec2(uv.x, 1.0 - uv.y);
    tuv = (tuv - 0.5)/(1.0 + (1.0-uTitle)*0.035) + 0.5;
    float a = texture(uTitleTex, tuv).r;
    float g = textureLod(uTitleTex, tuv, 3.0).r;
    col += vec3(0.93,0.86,0.70)*a*uTitle + vec3(0.8,0.55,0.25)*g*0.25*uTitle;
  }
  // grain
  float lum = dot(col, vec3(0.333));
  float gr = hash2(fc*1.0 + fract(uTime*24.0)*311.7) + hash2(fc*1.37 - fract(uTime*13.0)*97.1) - 1.0;
  col += gr*0.028*(1.0 - lum*0.6);
  if(inBar) col = vec3(0.0);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}
