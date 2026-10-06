// The film look: a port of The Bob's post pipeline (library/reference/the_bob/index_master.html).
//
//   scene -> HDR render target -> [accumulation: lens-disc jitter (true depth of field), sub-pixel
//   jitter (anti-aliasing), time slices on a 180 degree shutter (motion blur)] -> auto exposure ->
//   bloom + halation -> depth of field (single pass mode) -> chromatic aberration -> sun flare ->
//   ACES -> lift/gain, split toning, saturation, contrast -> vignette -> FXAA -> grain.
//
// The shaders are The Bob's, unchanged except where noted. The render targets and materials come
// from the app bundle's own three.js copy (window.__crew.three) so they match its renderer.
import { gradeFor } from "./grades.js";
import { Atmosphere, envFor, sunDir } from "./atmos.js";

const HALF = 1016, FLOAT = 1015, UINT = 1014, LINEAR = 1006, NEAREST = 1003, ADDITIVE = 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const D2R = Math.PI / 180;

/** Halton sequence: low-discrepancy jitter for pixels, lens samples and light jitter. */
export function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

const VS = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

const BRIGHT_FS = `uniform sampler2D tSrc;uniform vec2 uTexel;uniform float uTh;varying vec2 vUv;void main(){vec3 c=texture2D(tSrc,vUv+uTexel*vec2(-1.,-1.)).rgb+texture2D(tSrc,vUv+uTexel*vec2(1.,-1.)).rgb+texture2D(tSrc,vUv+uTexel*vec2(-1.,1.)).rgb+texture2D(tSrc,vUv+uTexel*vec2(1.,1.)).rgb;c*=0.25;c=min(c,vec3(60.));float l=max(max(c.r,c.g),c.b);float k=max(l-uTh,0.)/max(l,1e-4);gl_FragColor=vec4(c*k,1.);}`;
const BLUR_FS = `uniform sampler2D tSrc;uniform vec2 uDir;varying vec2 vUv;void main(){vec3 c=texture2D(tSrc,vUv).rgb*0.2270270;c+=(texture2D(tSrc,vUv+uDir*1.3846154).rgb+texture2D(tSrc,vUv-uDir*1.3846154).rgb)*0.3162162;c+=(texture2D(tSrc,vUv+uDir*3.2307692).rgb+texture2D(tSrc,vUv-uDir*3.2307692).rgb)*0.0702703;gl_FragColor=vec4(c,1.);}`;
const ACC_FS = `uniform sampler2D tSrc;uniform float uW;varying vec2 vUv;void main(){gl_FragColor=vec4(min(texture2D(tSrc,vUv).rgb,vec3(200.))*uW,1.);}`;
const METER_FS = `uniform sampler2D tSrc;varying vec2 vUv;void main(){vec2 px=vec2(1./48.,1./20.);vec2 o=vUv-px*0.5;float s=0.;for(int i=0;i<4;i++)for(int j=0;j<4;j++){vec3 c=texture2D(tSrc,o+px*vec2((float(i)+0.5)/4.,(float(j)+0.5)/4.)).rgb;float l=dot(min(c,vec3(40.)),vec3(0.2126,0.7152,0.0722));s+=log(max(l,1e-4));}float w=1.-0.65*smoothstep(0.12,0.72,length((vUv-0.5)*vec2(1.7,1.)));gl_FragColor=vec4(s/16.,w,0.,1.);}`;
// uMaxC is new: The Bob clamped the blur radius at 18 px (tuned for 1080p); here it scales with the render height.
const COMP_FS = `uniform sampler2D tScene,tDepth,tBloom;uniform vec2 uRes,uSun;uniform float uNear,uFar,uFocus,uDof,uExp,uBloom,uHal,uZoom,uCA,uVig,uSat,uCon,uSplit,uSunVis,uAsp,uMaxC,uStreak,uDirt;uniform vec3 uLift,uGain,uShT,uHiT;varying vec2 vUv;
  float hs(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hs(i),hs(i+vec2(1,0)),f.x),mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x),f.y);}
  float lin(float d){float z=d*2.-1.;return 2.*uNear*uFar/(uFar+uNear-z*(uFar-uNear));}
  float coc(float d){return clamp(abs(d-uFocus)/max(d,1e-3)*uDof,0.,uMaxC);}
  vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.);}
  void main(){vec2 uv=(vUv-0.5)/uZoom+0.5;
    float dc=lin(texture2D(tDepth,uv).r);float cc=uDof>0.?coc(dc):0.;vec3 base=texture2D(tScene,uv).rgb;vec3 col=base;
    if(cc>0.6){vec3 acc=base*0.5;float ws=0.5;for(int i=0;i<SAMPLES;i++){float fi=float(i);float r=sqrt((fi+0.5)/float(SAMPLES))*cc;float a=fi*2.39996323;vec2 su=uv+vec2(cos(a),sin(a))*r/uRes;float zs=lin(texture2D(tDepth,su).r);float sc=coc(zs);if(zs>dc)sc=min(sc,cc*1.5+0.5);float w=smoothstep(r-1.5,r+0.5,sc);acc+=texture2D(tScene,su).rgb*w;ws+=w;}col=acc/ws;}
    vec2 rc=uv-0.5;vec2 cao=rc*uCA*length(rc)*2.;float cm=1.-smoothstep(2.,8.,cc);
    col.r=mix(col.r,texture2D(tScene,uv+cao).r,0.85*cm);col.b=mix(col.b,texture2D(tScene,uv-cao).b,0.85*cm);
    vec3 bl=texture2D(tBloom,uv).rgb;col+=bl*uBloom+bl*vec3(1.0,0.42,0.22)*uHal;
    if(uSunVis>0.001){vec2 as=vec2(uAsp,1.);float occ=0.;for(int k=0;k<5;k++){vec2 o=vec2(float(k-2)*0.006,float(k%2)*0.006-0.003);occ+=step(0.99999,texture2D(tDepth,clamp(uSun+o,0.001,0.999)).r);}occ/=5.;
      vec2 d=(uv-uSun)*as;float L=length(d);vec3 fl=vec3(1.0,0.66,0.36)*exp(-L*6.)*0.7+vec3(1.,0.82,0.6)*exp(-L*30.)*1.6;fl+=vec3(1.0,0.6,0.32)*exp(-abs(d.y)*120.)*exp(-abs(d.x)*2.5)*0.22;
      vec2 ax=vec2(0.5)-uSun;for(int k=0;k<6;k++){float g=0.25+float(k)*0.38;vec2 gp=uSun+ax*g*2.;float gs=0.018+0.02*float(k);float gl=length((uv-gp)*as);float disc=smoothstep(gs,gs*0.6,gl)*0.06;float ring=smoothstep(gs*1.7,gs*1.5,gl)*smoothstep(gs*1.25,gs*1.5,gl)*0.035;vec3 tint=mix(vec3(0.45,0.75,1.0),vec3(1.0,0.55,0.25),fract(float(k)*0.37+0.2));fl+=(disc+ring)*tint;}
      col+=fl*uSunVis*occ*3.;}
    if(uStreak>0.){vec3 st=vec3(0.);for(int i=-12;i<=12;i++){if(i==0)continue;vec3 c=texture2D(tScene,uv+vec2(float(i)*0.011,0.)).rgb;st+=max(c-vec3(3.),vec3(0.))*exp(-abs(float(i))*0.22);}col+=st*vec3(0.30,0.5,1.0)*uStreak;} // Low Pass: anamorphic streaks off bright lights
    if(uDirt>0.&&uSunVis>0.001){float sg=uSunVis*exp(-length((vUv-uSun)*vec2(uAsp,1.))*2.4);float dn=smoothstep(0.55,0.85,vn(vUv*vec2(uAsp,1.)*7.)+0.45*vn(vUv*vec2(uAsp,1.)*21.+3.));col+=vec3(1.,0.72,0.45)*(dn*0.9+0.2)*sg*0.14*uDirt;} // lens dirt catching the sun
    col*=uExp;col=aces(col);col=pow(col,vec3(1./2.2));
    col=col*(uGain-uLift)+uLift;
    float l=dot(col,vec3(0.2126,0.7152,0.0722));
    col*=mix(vec3(1.),uShT,uSplit*(1.-smoothstep(0.,0.55,l)));col*=mix(vec3(1.),uHiT,uSplit*smoothstep(0.4,1.,l));
    l=dot(col,vec3(0.2126,0.7152,0.0722));col=mix(vec3(l),col,uSat);col=mix(col,col*col*(3.-2.*col),uCon);
    vec2 vv=(vUv-0.5)*vec2(uAsp/1.5,1.);col*=1.-uVig*smoothstep(0.25,0.95,length(vv)*1.25);
    gl_FragColor=vec4(clamp(col,0.,1.),1.);}`;
const FINAL_FS = `uniform sampler2D tSrc;uniform vec2 uRes;uniform float uT,uGrain,uCam,uFade,uAA,uWarp;varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  vec3 fxaa(vec2 uv){vec2 i=1./uRes;vec3 nw=texture2D(tSrc,uv+vec2(-1.,-1.)*i).rgb,ne=texture2D(tSrc,uv+vec2(1.,-1.)*i).rgb,sw=texture2D(tSrc,uv+vec2(-1.,1.)*i).rgb,se=texture2D(tSrc,uv+vec2(1.,1.)*i).rgb,m=texture2D(tSrc,uv).rgb;
    vec3 L=vec3(0.299,0.587,0.114);float a=dot(nw,L),b=dot(ne,L),c=dot(sw,L),d=dot(se,L),e=dot(m,L);float mn=min(e,min(min(a,b),min(c,d))),mx=max(e,max(max(a,b),max(c,d)));
    vec2 dir=vec2(-((a+b)-(c+d)),((a+c)-(b+d)));float red=max((a+b+c+d)*0.03125,1./128.);float rcp=1./(min(abs(dir.x),abs(dir.y))+red);dir=clamp(dir*rcp,-8.,8.)*i;
    vec3 A=0.5*(texture2D(tSrc,uv+dir*(1./3.-0.5)).rgb+texture2D(tSrc,uv+dir*(2./3.-0.5)).rgb);vec3 B=A*0.5+0.25*(texture2D(tSrc,uv-dir*0.5).rgb+texture2D(tSrc,uv+dir*0.5).rgb);float lb=dot(B,L);return (lb<mn||lb>mx)?A:B;}
  void main(){vec2 uv=vUv;
    if(uCam>0.)uv.x+=uCam*0.0006*sin(uv.y*24.+uT*7.);
    if(uWarp>0.){uv.x+=uWarp*0.012*sin(uv.y*38.+uT*31.);uv.y+=uWarp*0.01*sin(uT*7.3);uv=(uv-0.5)*(1.+uWarp*0.04*sin(uT*3.))+0.5;}
    vec3 col=uAA>0.5?fxaa(uv):texture2D(tSrc,uv).rgb;
    if(uCam>0.){vec2 px=1./uRes;vec3 bl=(texture2D(tSrc,uv+vec2(3.,0.)*px).rgb+texture2D(tSrc,uv+vec2(7.,0.)*px).rgb+texture2D(tSrc,uv-vec2(2.,0.)*px).rgb)/3.;vec3 L=vec3(0.299,0.587,0.114);col=mix(col,vec3(dot(col,L))+(bl-vec3(dot(bl,L))),0.45*uCam);}
    vec2 g=floor(vUv*uRes);float n=(h(g+fract(uT*7.13)*vec2(91.7,47.3))+h(g*1.37+fract(uT*3.71)*vec2(13.1,71.9))-1.);float l=dot(col,vec3(0.3,0.59,0.11));
    col+=n*uGrain*(0.55+0.45*(1.-l));if(uWarp>0.){float bnd=step(0.93,fract(vUv.y*2.5-uT*0.9));col=mix(col,vec3(h(vUv*400.+uT)),bnd*uWarp*0.5);col*=1.-uWarp*0.15;}col*=uFade;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`;

/** Thin lens: blur radius in pixels (per unit of |d-S|/d) for the single-pass shader. f, S in mm. */
export function cocFactor(focalMm, fstop, focusM, rtH, sensorH) {
  const S = Math.max(focusM, 0.3) * 1000, f = focalMm;
  const diameterMm = (f * f) / (fstop * Math.max(S - f, 1));
  return 0.5 * diameterMm * (rtH / sensorH);
}

export class Pipeline {
  constructor(renderer) {
    const T = window.__crew.three;
    this.T = T;
    this.renderer = renderer;
    this.quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new T.Scene();
    this.quad = new T.Mesh(new T.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const V2 = T.Vector2, V3 = T.Vector3;
    const mk = (uniforms, fragmentShader, extra = {}) => new T.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader, ...extra });
    this.bright = mk({ tSrc: { value: null }, uTexel: { value: new V2() }, uTh: { value: 1 } }, BRIGHT_FS);
    this.blur = mk({ tSrc: { value: null }, uDir: { value: new V2() } }, BLUR_FS);
    this.acc = mk({ tSrc: { value: null }, uW: { value: 1 } }, ACC_FS, { transparent: true, blending: ADDITIVE, depthTest: false, depthWrite: false });
    this.meterMat = mk({ tSrc: { value: null } }, METER_FS);
    this.meterRT = new T.WebGLRenderTarget(48, 20, { type: FLOAT, depthBuffer: false, minFilter: NEAREST, magFilter: NEAREST });
    this.meterBuf = new Float32Array(48 * 20 * 4);
    this.meterOk = true;
    this.samples = 24;
    this.comp = mk({
      tScene: { value: null }, tDepth: { value: null }, tBloom: { value: null }, uRes: { value: new V2() }, uNear: { value: 0.05 }, uFar: { value: 3000 }, uFocus: { value: 5 },
      uDof: { value: 0 }, uMaxC: { value: 18 }, uStreak: { value: 0 }, uDirt: { value: 0 }, uExp: { value: 1 }, uBloom: { value: 0.2 }, uHal: { value: 0.1 }, uZoom: { value: 1 }, uCA: { value: 0.01 }, uVig: { value: 0.4 }, uSat: { value: 1 },
      uCon: { value: 0.2 }, uSplit: { value: 0.5 }, uLift: { value: new V3() }, uGain: { value: new V3(1, 1, 1) }, uShT: { value: new V3(1, 1, 1) }, uHiT: { value: new V3(1, 1, 1) },
      uSun: { value: new V2(-9, -9) }, uSunVis: { value: 0 }, uAsp: { value: 1.78 },
    }, COMP_FS, { defines: { SAMPLES: 24 } });
    this.final = mk({ tSrc: { value: null }, uRes: { value: new V2() }, uT: { value: 0 }, uGrain: { value: 0.06 }, uCam: { value: 0 }, uFade: { value: 1 }, uAA: { value: 1 }, uWarp: { value: 0 } }, FINAL_FS);
    this.W = 0; this.H = 0;
    this.AE = { exp: 1, id: null, t: -1, avg: 0 };
    // additive float blending needs EXT_float_blend; fall back to half float without it
    this.accType = renderer.extensions.has("EXT_float_blend") ? FLOAT : HALF;
  }

  ensure(w, h) {
    if (w === this.W && h === this.H) return;
    const T = this.T;
    [this.rtScene, this.rtAcc, this.rtLDR, this.rtAtm, this.rtCloud, this.rtA, this.rtB].forEach((r) => r && r.dispose());
    this.W = w; this.H = h;
    const lf = { minFilter: LINEAR, magFilter: LINEAR };
    this.rtScene = new T.WebGLRenderTarget(w, h, { type: HALF, ...lf });
    this.rtScene.depthTexture = new T.DepthTexture(w, h);
    this.rtScene.depthTexture.type = UINT;
    this.rtAcc = new T.WebGLRenderTarget(w, h, { type: this.accType, depthBuffer: false, ...lf });
    this.rtLDR = new T.WebGLRenderTarget(w, h, lf);
    this.rtAtm = new T.WebGLRenderTarget(w, h, { type: HALF, depthBuffer: false, ...lf });
    this.rtCloud = new T.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), { type: HALF, depthBuffer: false, ...lf });
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.rtA = new T.WebGLRenderTarget(bw, bh, { type: HALF, ...lf });
    this.rtB = this.rtA.clone();
  }

  dispose() {
    [this.rtScene, this.rtAcc, this.rtLDR, this.rtAtm, this.rtCloud, this.rtA, this.rtB, this.meterRT].forEach((r) => r && r.dispose());
    this.atmos?.dispose();
    [this.bright, this.blur, this.acc, this.meterMat, this.comp, this.final].forEach((m) => m.dispose());
    this.quad.geometry.dispose();
  }

  atmosphere() { return (this.atmos ??= new Atmosphere(this)); }

  pass(mat, target) { this.quad.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(this.quadScene, this.quadCam); }

  /** Log-average luminance of the frame, centre weighted (The Bob's meter). */
  meter(src) {
    if (!this.meterOk) return null;
    this.meterMat.uniforms.tSrc.value = src;
    this.pass(this.meterMat, this.meterRT);
    try { this.renderer.readRenderTargetPixels(this.meterRT, 0, 0, 48, 20, this.meterBuf); } catch { this.meterOk = false; return null; }
    let sum = 0, w = 0;
    for (let i = 0; i < 960; i++) { const l = this.meterBuf[i * 4], ww = this.meterBuf[i * 4 + 1]; if (!isFinite(l) || !isFinite(ww)) continue; sum += l * ww; w += ww; }
    return w > 0 ? Math.exp(sum / w) : null;
  }

  /** Exposure for this frame: the grade's fixed value, or the metered one eased over `tau` seconds within a shot. */
  autoExposure(gr, shotId, t, src) {
    if (!gr.key) return gr.exp;
    const avg = this.meter(src);
    if (!avg) return gr.exp;
    const AE = this.AE;
    AE.avg = avg;
    const target = clamp(gr.key / avg, gr.emin ?? 0.15, gr.emax ?? 10);
    if (AE.id !== shotId || t < AE.t || t - AE.t > 0.3) AE.exp = target;
    else AE.exp += (target - AE.exp) * (1 - Math.exp(-(t - AE.t) / (gr.tau || 0.45)));
    AE.id = shotId; AE.t = t;
    return AE.exp;
  }

  /** Bloom, depth of field, grade, grain: from a scene texture to the canvas. `physical` = already accumulated. */
  post(S, srcTex, physical) {
    const r = this.renderer, gr = S.gr, W = this.W, H = this.H, cam = S.cam;
    const EXPO = this.autoExposure(gr, S.shotId, S.t, srcTex) * (S.expMul || 1);
    this.bright.uniforms.tSrc.value = srcTex;
    this.bright.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.bright.uniforms.uTh.value = gr.th / Math.max(0.2, EXPO);
    this.pass(this.bright, this.rtA);
    const bw = this.rtA.width, bh = this.rtA.height;
    for (const k of [1, 2.2]) {
      this.blur.uniforms.tSrc.value = this.rtA.texture; this.blur.uniforms.uDir.value.set(k / bw, 0); this.pass(this.blur, this.rtB);
      this.blur.uniforms.tSrc.value = this.rtB.texture; this.blur.uniforms.uDir.value.set(0, k / bh); this.pass(this.blur, this.rtA);
    }
    const u = this.comp.uniforms;
    u.tScene.value = srcTex; u.tDepth.value = this.rtScene.depthTexture; u.tBloom.value = this.rtA.texture; u.uRes.value.set(W, H);
    u.uNear.value = cam.near; u.uFar.value = cam.far; u.uFocus.value = S.focus;
    u.uDof.value = physical ? 0 : S.dof; u.uMaxC.value = 18 * (H / 1080); u.uStreak.value = gr.streak ?? 0; u.uDirt.value = gr.dirt ?? 0;
    u.uExp.value = EXPO; u.uBloom.value = gr.bloom; u.uHal.value = gr.hal; u.uZoom.value = S.zoom || 1;
    u.uCA.value = gr.ca; u.uVig.value = gr.vig; u.uSat.value = gr.sat; u.uCon.value = gr.con; u.uSplit.value = gr.split;
    u.uLift.value.set(...gr.lift); u.uGain.value.set(...gr.gain); u.uShT.value.set(...gr.sh); u.uHiT.value.set(...gr.hi); u.uAsp.value = S.aspect;
    cam.clearViewOffset();
    if (S.sun) { // screen position of the sun, and whether it can be seen
      const p = S.sunNdc;
      u.uSun.value.set((p.x + 1) / 2, (p.y + 1) / 2);
      const out = Math.max(Math.abs(p.x), Math.abs(p.y)) - 1;
      u.uSunVis.value = S.sunFacing > 0 ? clamp(1 - out * 4, 0, 1) * sm(S.sunFacing * 3) : 0;
    } else u.uSunVis.value = 0;
    if (this.comp.defines.SAMPLES !== this.samples) { this.comp.defines.SAMPLES = this.samples; this.comp.needsUpdate = true; }
    this.pass(this.comp, this.rtLDR);
    const f = this.final.uniforms;
    f.tSrc.value = this.rtLDR.texture; f.uRes.value.set(W, H); f.uT.value = S.t; f.uGrain.value = gr.grain; f.uCam.value = gr.cam; f.uFade.value = S.fade ?? 1; f.uAA.value = physical ? 0 : 1; f.uWarp.value = S.warp || 0;
    const size = r.getSize(this.size ?? (this.size = new this.T.Vector2()));
    r.setRenderTarget(null);
    r.setViewport(0, 0, size.x, size.y);
    r.setScissorTest(false);
    r.clear();
    this.quad.material = this.final;
    r.render(this.quadScene, this.quadCam);
  }
}

// ---- the frame: pose the world, work out the camera, run the passes ----------------------

const LOOK_KEY = "crew.look.v2";
export const settings = { dofOverrides: {}, spp: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(LOOK_KEY) ?? "{}")); } catch {}
export function saveSettings() { try { localStorage.setItem(LOOK_KEY, JSON.stringify(settings)); } catch {} }

/** Which subject the lens is focused on at progress p through the shot ("focus pulls"). */
function focusPoint(viewer, shot, p, V3) {
  const plan = settings.focus?.[shot.id] ?? {};
  const pointOf = (id) => {
    const rig = id && id !== "auto" && id !== "none" ? viewer.rigs.get(id) : null;
    return rig?.group.visible ? new V3(rig.group.position.x, (rig.height || 1.7) * 0.93, rig.group.position.z) : null;
  };
  const subj = (shot.subjects ?? []).map(pointOf).find(Boolean);
  let a = pointOf(plan.at) ?? subj ?? null;
  if (!a) for (const [, rig] of viewer.rigs) if (rig.group.visible) { a = new V3(rig.group.position.x, (rig.height || 1.7) * 0.93, rig.group.position.z); break; }
  const b = plan.to && plan.to !== "none" ? pointOf(plan.to) : null;
  if (a && b) return a.lerp(b, sm(p));
  return a;
}

/** Everything the passes need about the camera as the viewer has just posed it. */
function readCamera(viewer, info) {
  const T = window.__crew.three, cam = viewer.cam, V3 = T.Vector3, shot = info.shot;
  cam.updateMatrixWorld();
  const look = window.__crew.look(), body = window.__crew.body();
  const sensorH = body?.h ?? 24;
  const fovR = cam.fov * D2R;
  const mm = (sensorH / 2) / Math.tan(fovR / 2);
  const p = clamp((info.t - shot.cutStart) / Math.max(0.1, shot.cutDur), 0, 1);
  const fp = focusPoint(viewer, shot, p, V3);
  const focus = Math.max(0.3, fp ? cam.position.distanceTo(fp) : (() => { const c = shot.cam?.[Math.min((shot.cam?.length ?? 1) - 1, info.o ?? 0)]; return c ? cam.position.distanceTo(new V3(c[3], c[4], c[5])) : 3; })());
  return { cam, mm, sensorH, focus, fstop: look?.fstop ?? 2.8, dofOn: !!look?.dof };
}

/** Where the sun is for this shot's mood, and whether it can be seen (open sets in daylight only). */
function sunFor(viewer, baked, shot, cam, es) {
  if (!es.open || es.env.sunBoost <= 0.2) return null;
  const T = window.__crew.three;
  const p = cam.position.clone().addScaledVector(es.sun, 500).project(cam);
  return { ndc: p, facing: cam.getWorldDirection(new T.Vector3()).dot(es.sun) };
}

/** Mood -> environment: sky, sun and haze; the effect switches for the quality tier. */
function envState(viewer, baked, shot, SPP) {
  const env = envFor(shot), open = !!baked.sets?.[shot.set]?.open;
  const T = window.__crew.three;
  const tier = viewer.liveLook ? Math.min(2, Math.max(0, settings.quality | 0)) : 2;
  const A = settings.atmos ?? {};
  const render = SPP > 1;
  return {
    env, open, sun: sunDir(T, viewer.key.position, env),
    ao: A.ao ?? (render || tier >= 1), rays: A.rays ?? (render || tier >= 1), clouds: A.clouds ?? (render || tier >= 2),
    cloudSteps: render ? 48 : 30, aoRadius: 1,
  };
}

function frameState(viewer, info, rc, es) {
  const baked = viewer.baked, shot = info.shot, gr = gradeFor(shot, settings.grade);
  // The Bob's grades were tuned for its own lighting; Crew's room lights are stronger, so closed sets meter darker
  if (!baked.sets?.[shot.set]?.open && !settings.grade?.key) gr.key *= 0.5;
  const sun = sunFor(viewer, baked, shot, rc.cam, es);
  const rt = viewer.look.pipe;
  const dof = rc.dofOn ? cocFactor(rc.mm, rc.fstop, rc.focus, rt.H, rc.sensorH) : 0;
  return { gr, cam: rc.cam, focus: rc.focus, dof, sun: !!sun, sunNdc: sun?.ndc, sunFacing: sun?.facing, aspect: rt.W / rt.H, t: info.t, shotId: shot.id, zoom: 1, fade: 1 };
}

const clampShot = (shot, t, fps) => clamp(t, shot.cutStart, shot.cutStart + Math.max(1 / fps, shot.cutDur) - 1e-4);
const pose = (viewer, t) => { viewer._noDraw = true; try { viewer.frame(t); } finally { viewer._noDraw = false; } };

/** How many passes this frame needs: enough for its lens blur and its motion blur, never more than the maximum. */
function frameBudget(viewer, info, SPP, rc, H, W) {
  const shot = info.shot, fps = info.fps, T = window.__crew.three;
  const MINN = Math.min(SPP, 12);
  const cam = viewer.cam;
  const pxr = H / (2 * Math.tan((cam.fov * D2R) / 2));
  const R = rc.dofOn ? ((rc.mm / 1000) / (2 * rc.fstop)) / Math.max(0.3, rc.focus) * pxr : 0;
  const proj = (tt) => {
    pose(viewer, clampShot(shot, tt, fps));
    cam.updateMatrixWorld();
    const f = shot.cam?.[Math.min((shot.cam?.length ?? 1) - 1, Math.round((clampShot(shot, tt, fps) - shot.cutStart) * fps))];
    const P = f ? [new T.Vector3(f[3], f[4], f[5])] : [];
    for (const id of shot.subjects ?? []) {
      const rig = viewer.rigs.get(id);
      if (rig?.group.visible) { const h = rig.height || 1.7; P.push(new T.Vector3(rig.group.position.x, h * 0.93, rig.group.position.z), new T.Vector3(rig.group.position.x, h * 0.55, rig.group.position.z)); }
    }
    return P.map((p) => p.project(cam));
  };
  const A = proj(info.t - 1 / 96), B = proj(info.t + 1 / 96);
  let mv = 0;
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (Math.abs(A[i].z) > 1 || Math.abs(B[i].z) > 1) continue;
    mv = Math.max(mv, Math.hypot((A[i].x - B[i].x) * W / 2, (A[i].y - B[i].y) * H / 2));
  }
  const nt = clamp(Math.ceil(mv / 3), 1, 8);
  const nl = R < 1.5 ? 1 : Math.ceil((R / 2.5) ** 2);
  const n = clamp(Math.max(MINN, nl, nt * 2), MINN, SPP);
  return { n, nt: Math.min(nt, n), R, mv };
}

/** Render the scene into the HDR target, then run the atmosphere on it. Returns the texture to post-process. */
function sceneTo(viewer, pipe, es, o) {
  const r = viewer.renderer, cam = viewer.cam;
  const atm = pipe.atmosphere();
  const sky = atm.skyMesh();
  if (!sky.parent) viewer.scene.add(sky);
  const useSky = es.open;
  sky.visible = useSky;
  setSkyProps(viewer, !useSky);
  if (!o.jittered) { if (viewer.crop) cam.setViewOffset(viewer.crop.fw, viewer.crop.fh, viewer.crop.x, viewer.crop.y, pipe.W, pipe.H); else cam.clearViewOffset(); }
  r.setRenderTarget(pipe.rtScene); r.clear(); r.render(viewer.scene, cam);
  if (!useSky && !es.ao) return pipe.rtScene.texture;
  const ar = atm.apply(es.env, { open: es.open, aoOn: es.ao, aoRadius: es.aoRadius, clouds: es.clouds, rays: es.rays, t: o.t, cam, aspect: pipe.W / pipe.H, sunDir: es.sun, cloudsFresh: o.cloudsFresh, cloudSteps: es.cloudSteps });
  pipe.lastAtm = ar;
  return pipe.rtAtm.texture;
}

/** Library sky models (sky_london...) are replaced by the atmosphere's own sky while the look is on. */
function setSkyProps(viewer, show) {
  const L = viewer.look;
  if (L.skyFor !== viewer.baked) { L.skyFor = viewer.baked; L.skies = []; viewer.scene.traverse((o) => { if (o.userData?.isSky) L.skies.push(o); }); }
  for (const o of L.skies) o.visible = show;
}
export function restoreSky(viewer) {
  const L = viewer.look;
  if (!L) return;
  for (const o of L.skies ?? []) o.visible = true;
  if (L.pipe.atmos?.sky) L.pipe.atmos.sky.visible = false;
}

function ensurePipe(viewer) {
  if (!viewer.look) viewer.look = { pipe: new Pipeline(viewer.renderer), last: null };
  const size = viewer.renderer.getDrawingBufferSize(viewer.look.pipe.size2 ?? (viewer.look.pipe.size2 = new (window.__crew.three.Vector2)()));
  viewer.look.pipe.ensure(Math.max(2, Math.round(size.x)), Math.max(2, Math.round(size.y)));
  return viewer.look.pipe;
}

/** One output frame. A generator so callers can yield to the browser between time slices (renders do, previews don't). */
export function* run(viewer, info) {
  const pipe = ensurePipe(viewer), r = viewer.renderer, scene = viewer.scene, cam = viewer.cam, T = window.__crew.three;
  const SPP = Math.max(1, viewer.lookSpp | 0), fps = info.fps, shot = info.shot;
  pipe.samples = SPP > 1 ? 36 : (window.CrewExt?.look?.dofTaps?.(viewer) ?? 24);
  const base = readCamera(viewer, info);
  const es = envState(viewer, viewer.baked, shot, SPP);
  if (SPP === 1) {
    // single pass: real-time look, lens blur and anti-aliasing happen in the shader
    const tex = sceneTo(viewer, pipe, es, { t: info.t, cloudsFresh: true });
    pipe.post(frameState(viewer, info, base, es), tex, false);
    viewer.look.last = { n: 1 };
    return;
  }
  const BG = frameBudget(viewer, info, SPP, base, pipe.H, pipe.W);
  viewer.look.last = BG;
  const NN = BG.n, nts = BG.nt;
  // clear the accumulator to zero (a zero alpha makes the clear colour black)
  const prevA = r.getClearAlpha();
  r.setRenderTarget(pipe.rtAcc); r.setClearAlpha(0); r.clear(); r.setClearAlpha(prevA);
  let k = 0;
  const fwd = new T.Vector3(), rgt = new T.Vector3(), upv = new T.Vector3(), fpt = new T.Vector3(), bp = new T.Vector3();
  for (let s = 0; s < nts; s++) {
    const sub = clampShot(shot, info.t + ((s + 0.5) / nts - 0.5) / (fps * 2), fps); // 180 degree shutter
    pose(viewer, sub);
    cam.updateMatrixWorld();
    const rc = readCamera(viewer, { ...info, t: sub });
    bp.copy(cam.position);
    const baseUp = cam.up.clone(), baseQuat = cam.quaternion.clone();
    const per = Math.floor(NN / nts) + (s < NN % nts ? 1 : 0);
    const mwu = scene.matrixWorldAutoUpdate;
    scene.updateMatrixWorld();
    if (nts > 1) scene.matrixWorldAutoUpdate = false;
    for (let j = 0; j < per; j++, k++) {
      const jit = { px: [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5], ap: [(0.5 + k * 0.7548777) % 1, (0.5 + k * 0.5698403) % 1] };
      cam.position.copy(bp); cam.quaternion.copy(baseQuat); cam.up.copy(baseUp); cam.updateMatrixWorld();
      cam.getWorldDirection(fwd); rgt.setFromMatrixColumn(cam.matrixWorld, 0); upv.setFromMatrixColumn(cam.matrixWorld, 1);
      if (rc.dofOn) {
        fpt.copy(cam.position).addScaledVector(fwd, rc.focus);
        const lensR = (rc.mm / 1000) / (2 * rc.fstop), a = jit.ap[0] * 6.2832, rr = Math.sqrt(jit.ap[1]) * lensR;
        cam.position.addScaledVector(rgt, Math.cos(a) * rr).addScaledVector(upv, Math.sin(a) * rr);
        cam.up.copy(upv); cam.lookAt(fpt);
      }
      if (viewer.crop) cam.setViewOffset(viewer.crop.fw, viewer.crop.fh, viewer.crop.x + jit.px[0], viewer.crop.y + jit.px[1], pipe.W, pipe.H);
      else cam.setViewOffset(pipe.W, pipe.H, jit.px[0], jit.px[1], pipe.W, pipe.H);
      cam.updateMatrixWorld();
      const tex = sceneTo(viewer, pipe, es, { t: sub, cloudsFresh: j === 0, jittered: true });
      pipe.acc.uniforms.tSrc.value = tex; pipe.acc.uniforms.uW.value = 1 / NN;
      const ac = r.autoClear; r.autoClear = false; pipe.pass(pipe.acc, pipe.rtAcc); r.autoClear = ac;
    }
    scene.matrixWorldAutoUpdate = mwu;
    cam.position.copy(bp); cam.quaternion.copy(baseQuat); cam.up.copy(baseUp); cam.clearViewOffset();
    yield; // let the browser breathe between time slices
  }
  pose(viewer, info.t);
  const rc = readCamera(viewer, info);
  pipe.post(frameState(viewer, info, rc, es), pipe.rtAcc.texture, true);
}

/** Synchronous frame for previews and stills. */
export function render(viewer, info) { const g = run(viewer, info); while (!g.next().done); }

/** Asynchronous frame for renders: yields to the event loop between time slices. */
export async function renderAsync(viewer, info, yieldNow) {
  const g = run(viewer, info);
  for (;;) { const s = g.next(); if (s.done) return; await yieldNow(); }
}

export function disposeLook(viewer) { if (!viewer.look) return; restoreSky(viewer); viewer.look.pipe.dispose(); viewer.look = null; }

/** Which shot a cut time lands in, as the viewer's own frame() decides it. */
export function infoAt(baked, t) {
  let i = 0;
  for (let x = baked.shots.length - 1; x >= 0; x--) if (t >= baked.shots[x].cutStart - 1e-6) { i = x; break; }
  const shot = baked.shots[i];
  return { shot, t, o: Math.max(0, Math.round((t - shot.cutStart) * baked.fps)), fps: baked.fps };
}
