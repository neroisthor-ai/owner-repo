// The atmosphere: sky, haze, volumetric clouds, god rays and screen-space ambient occlusion,
// taken from Low Pass (library/reference/low_pass/low-pass.js: skyMaterial, the cloud ray-march,
// the atmosphere composite). Changes from the original: the sun, palette and cloud layer are
// uniforms (Low Pass hard-coded a London dusk at aircraft altitude), the cloud blobs are gone,
// and distances are in room and street scale (occlusion radius, haze falloff).
import { halton } from "./look.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Environment per light mood: where the sun is and what the sky and haze look like. */
export const ENV = {
  day:       { elev: 48, sun: [1.0, 0.95, 0.85], hor0: [0.62, 0.72, 0.86], hor1: [0.95, 0.90, 0.80], zen: [0.12, 0.26, 0.60], haze: 0.00045, cover: 0.45, sunBoost: 0.5 },
  bright:    { elev: 62, sun: [1.0, 0.97, 0.90], hor0: [0.66, 0.76, 0.90], hor1: [0.98, 0.94, 0.86], zen: [0.16, 0.32, 0.70], haze: 0.00030, cover: 0.30, sunBoost: 1.1 },
  warm:      { elev: 11, sun: [1.0, 0.62, 0.32], hor0: [0.50, 0.44, 0.50], hor1: [1.30, 0.62, 0.30], zen: [0.07, 0.12, 0.27], haze: 0.00090, cover: 0.55, sunBoost: 1.0 }, // Low Pass dusk
  cool:      { elev: 30, sun: [0.80, 0.88, 1.0], hor0: [0.50, 0.56, 0.64], hor1: [0.70, 0.76, 0.84], zen: [0.20, 0.28, 0.42], haze: 0.00080, cover: 0.80, sunBoost: 0.5 },
  dim:       { elev: 18, sun: [0.85, 0.80, 0.78], hor0: [0.34, 0.34, 0.38], hor1: [0.52, 0.48, 0.46], zen: [0.12, 0.13, 0.18], haze: 0.00100, cover: 0.85, sunBoost: 0.35 },
  practical: { elev: 24, sun: [0.90, 0.78, 0.62], hor0: [0.22, 0.22, 0.30], hor1: [0.40, 0.34, 0.32], zen: [0.05, 0.07, 0.14], haze: 0.00080, cover: 0.60, sunBoost: 0.3 },
  night:     { elev: -8, sun: [0.30, 0.38, 0.65], hor0: [0.025, 0.035, 0.07], hor1: [0.05, 0.06, 0.11], zen: [0.004, 0.008, 0.026], haze: 0.00070, cover: 0.50, sunBoost: 0.0 },
  moon:      { elev: 38, sun: [0.55, 0.65, 0.95], hor0: [0.03, 0.05, 0.10], hor1: [0.08, 0.10, 0.18], zen: [0.006, 0.012, 0.04], haze: 0.00060, cover: 0.40, sunBoost: 0.18 },
};
export const envFor = (shot) => ENV[shot?.light] ?? ENV.day;

/** Sun direction (towards the sun) for a mood, with its azimuth taken from the viewer's key light. */
export function sunDir(T, keyPos, env) {
  const az = Math.atan2(keyPos.x, keyPos.z), el = (env.elev * Math.PI) / 180;
  return new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

// ---- shaders ------------------------------------------------------------------------------

const HAZE = `
uniform vec3 uHor0,uHor1;
vec3 hazeCol(vec3 rd,vec3 sun){vec2 dh=normalize(rd.xz+1e-5),sh=normalize(sun.xz);float toward=pow(0.5+0.5*dot(dh,sh),2.2);
 vec3 c=mix(uHor0,uHor1,toward);float s=max(dot(rd,sun),0.0);c+=uSunCol*pow(s,9.0)*0.6;return c;}
`;
const COMMON = `uniform mat4 uInvProj,uCamWorld;uniform vec3 uCam,uSun,uSunCol;
  vec3 worldAt(vec2 uv,float d){vec4 c=vec4(uv*2.0-1.0,d*2.0-1.0,1.0);vec4 v=uInvProj*c;v/=v.w;return (uCamWorld*vec4(v.xyz,1.0)).xyz;}${HAZE}`;

const SKY_VS = `varying vec3 vDir;void main(){vDir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position=p.xyww;}`;
const SKY_FS = `uniform vec3 uSun,uSunCol,uZen;uniform float uSunBoost;varying vec3 vDir;${HAZE}
  void main(){vec3 d=normalize(vDir);float s=max(dot(d,uSun),0.0);float y=d.y;
    vec2 dh=normalize(d.xz+1e-5),sh=normalize(uSun.xz);float toward=pow(0.5+0.5*dot(dh,sh),2.2);
    vec3 hor=mix(uHor0,uHor1,toward);float h=clamp(y,0.0,1.0);
    vec3 col=mix(hor,uZen,pow(h,0.42));
    col+=uSunCol*0.25*exp(-h*12.0)*toward*uSunBoost;
    col+=uSunCol*pow(s,9.0)*0.6*uSunBoost+uSunCol*pow(s,80.0)*1.7*uSunBoost;
    col=mix(hazeCol(d,uSun)*0.92,col,smoothstep(-0.02,0.04,y));
    col+=uSunCol*22.0*smoothstep(0.99986,0.99993,s)*uSunBoost;
    gl_FragColor=vec4(col,1.0);}`;

// cloud layer: a noise-driven deck between uY0 and uY1 (Low Pass's "h2" layer), Henyey-Greenstein phase,
// powder term, four light-march samples. Everything else in Low Pass's cloud shader is unchanged.
const CLOUD_FS = `precision highp sampler3D;uniform sampler2D tDepth;uniform sampler3D tNoise;uniform float uTime,uCover,uY0,uY1;uniform int uSteps;varying vec2 vUv;
  ${COMMON}
  float hg(float m,float g){float g2=g*g;return (1.0-g2)/(12.566*pow(1.0+g2-2.0*g*m,1.5));}
  float cov(vec3 p){float h2=(p.y-uY0)/(uY1-uY0);if(h2<=0.0||h2>=1.0)return 0.0;float m=texture(tNoise,vec3(p.xz*0.00018,0.37)).r;float lo=mix(0.48,0.22,uCover);
    return smoothstep(lo,lo+0.2,m)*smoothstep(0.0,0.15,h2)*smoothstep(1.0,0.4,h2)*0.95;}
  float dens(vec3 p){float c=cov(p);if(c<=0.01)return 0.0;vec3 w=vec3(uTime*5.0,0.0,uTime*2.0);
    float n=texture(tNoise,(p+w)*0.0015).r;float s=clamp((n-(1.0-c))/max(c,0.05),0.0,1.0);if(s<=0.0)return 0.0;
    float d=texture(tNoise,(p+w*1.6)*0.0062).r;return clamp(s-(1.0-d)*0.4*(1.0-s),0.0,1.0);}
  void main(){float depth=texture2D(tDepth,vUv).r;vec3 rd=normalize(worldAt(vUv,1.0)-uCam);
    float sd=depth>=0.99999?1e7:length(worldAt(vUv,depth)-uCam);
    float y0=uY0,y1=uY1,ta,tb;
    if(abs(rd.y)<1e-5){if(uCam.y<y0||uCam.y>y1){gl_FragColor=vec4(0,0,0,1);return;}ta=0.0;tb=1e7;}
    else{float a=(y0-uCam.y)/rd.y,b=(y1-uCam.y)/rd.y;ta=max(min(a,b),0.0);tb=max(a,b);}
    tb=min(tb,min(sd,18000.0));if(tb<=ta){gl_FragColor=vec4(0,0,0,1);return;}
    float dt=(tb-ta)/float(uSteps);float jit=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);float t=ta+dt*jit;
    float T=1.0;vec3 L=vec3(0.0);float mu=dot(rd,uSun);float ph=0.75*hg(mu,0.6)+0.25*hg(mu,-0.25);
    for(int i=0;i<64;i++){if(i>=uSteps||t>tb||T<0.02)break;vec3 p=uCam+rd*t;float d=dens(p);
      if(d>0.0){float sig=d*0.012;float ld=0.0;for(int j=1;j<=4;j++)ld+=dens(p+uSun*float(j)*60.0);float lt=exp(-ld*60.0*0.012);
        float powder=1.0-exp(-sig*120.0);float hn=clamp((p.y-y0)/350.0,0.0,1.0);
        vec3 amb=mix(uHor0*0.55,uHor1*0.6,hn);
        vec3 S=(uSunCol*3.2*lt*ph*mix(1.0,powder,0.5)*7.0+amb)*sig;float st=exp(-sig*dt);L+=T*(S-S*st)/max(sig,1e-6);T*=st;}
      t+=dt;}
    float fd=1.0-exp(-ta*0.00007);L=mix(L,hazeCol(rd,uSun)*(1.0-T),fd*0.85);
    gl_FragColor=vec4(L,T);}`;

// the atmosphere composite: occlusion (10 hemisphere taps), cloud shadow, height haze, clouds, god rays.
// Occlusion radius and haze scale are in metres at room and street scale (Low Pass was 1.2..30 m at aircraft scale).
const ATMOS_FS = `precision highp sampler3D;uniform sampler2D tScene,tDepth,tCloud;uniform sampler3D tNoise;uniform float uTime,uFrame,uAO,uAORad,uHaze,uHazeH,uCloudsOn,uY0,uY1,uCover;uniform mat4 uViewProj;uniform vec2 uSunUV;uniform float uSunVis,uAspect,uRays;varying vec2 vUv;
  ${COMMON}
  float cov(vec3 p){float h2=(p.y-uY0)/(uY1-uY0);if(h2<=0.0||h2>=1.0)return 0.0;float m=texture(tNoise,vec3(p.xz*0.00018,0.37)).r;float lo=mix(0.48,0.22,uCover);
    return smoothstep(lo,lo+0.2,m)*smoothstep(0.0,0.15,h2)*smoothstep(1.0,0.4,h2)*0.95;}
  float hfog(vec3 ro,vec3 rd,float dist){float a=uHaze,b=1.0/uHazeH;float base=a*exp(-max(ro.y,0.0)*b);float f;
    if(abs(rd.y)<1e-4)f=base*dist;else f=base*(1.0-exp(-dist*rd.y*b))/(rd.y*b);return 1.0-exp(-max(f,0.0));}
  float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715))));}
  void main(){vec3 col=texture2D(tScene,vUv).rgb;float depth=texture2D(tDepth,vUv).r;vec3 rd=normalize(worldAt(vUv,1.0)-uCam);
    if(depth<0.99999){vec3 wp=worldAt(vUv,depth);float dist=length(wp-uCam);
      if(uAO>0.0){vec3 n=normalize(cross(dFdx(wp),dFdy(wp)));if(dot(n,uCam-wp)<0.0)n=-n;
        float rad=clamp(dist*0.06,0.12,1.4)*uAORad;float occ=0.0;float rnd=ign(gl_FragCoord.xy+vec2(uFrame*5.3,uFrame*2.1))*6.2832;
        vec3 t1=normalize(abs(n.y)<0.9?cross(n,vec3(0.0,1.0,0.0)):cross(n,vec3(1.0,0.0,0.0)));vec3 t2=cross(n,t1);
        for(int i=0;i<10;i++){float fi=float(i);float a=fi*2.39996+rnd;float r=sqrt((fi+0.5)/10.0);
          vec3 h=t1*cos(a)*r+t2*sin(a)*r+n*sqrt(max(0.0,1.0-r*r));vec3 sp=wp+h*rad*(0.25+0.75*fract(fi*0.618+rnd*0.159));
          vec4 c=uViewProj*vec4(sp,1.0);vec2 suv=c.xy/c.w*0.5+0.5;if(suv.x<0.0||suv.y<0.0||suv.x>1.0||suv.y>1.0)continue;
          vec3 op=worldAt(suv,texture2D(tDepth,suv).r);
          if(length(op-uCam)<length(sp-uCam)-0.02)occ+=1.0-smoothstep(rad*0.8,rad*2.0,length(op-wp));}
        col*=mix(1.0,1.0-occ/10.0,uAO);}
      if(uCloudsOn>0.5){float cs=0.0;for(int k=0;k<4;k++){float y=uY0+(uY1-uY0)*(float(k)+0.5)/4.0;if(wp.y<y)cs+=cov(wp+uSun*((y-wp.y)/max(uSun.y,0.05)));}
        col*=mix(0.6,1.0,exp(-cs*1.8));}
      if(uHaze>0.0)col=mix(col,hazeCol(rd,uSun)*0.85,hfog(uCam,rd,dist));}
    if(uCloudsOn>0.5){vec2 ct=1.0/vec2(textureSize(tCloud,0));vec4 cl=texture2D(tCloud,vUv)*0.4+(texture2D(tCloud,vUv+ct*vec2(1,1))+texture2D(tCloud,vUv+ct*vec2(-1,1))+texture2D(tCloud,vUv+ct*vec2(1,-1))+texture2D(tCloud,vUv+ct*vec2(-1,-1)))*0.15;col=col*cl.a+cl.rgb;}
    if(uSunVis>0.0&&uRays>0.0){vec2 d=(uSunUV-vUv)/32.0;vec2 uv=vUv;float acc=0.0,w=1.0;
      for(int i=0;i<32;i++){uv+=d;vec2 cuv=clamp(uv,0.001,0.999);float sky=step(0.99999,texture2D(tDepth,cuv).r);acc+=sky*(uCloudsOn>0.5?texture2D(tCloud,cuv).a:1.0)*w;w*=0.965;}
      acc/=32.0;float fall=exp(-length((vUv-uSunUV)*vec2(uAspect,1.0))*3.2);col+=uSunCol*acc*fall*uSunVis*0.5*uRays;}
    gl_FragColor=vec4(col,1.0);}`;

// ---- 3D noise for the clouds (Low Pass's worley mix), built once on first use -------------------

let NOISE = null;
function makeNoise3D(T, N = 48) {
  const data = new Uint8Array(N * N * N);
  const worley = (cells, seed) => {
    const r = rng(seed), pts = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = r();
    return (x, y, z) => {
      const fx = x * cells, fy = y * cells, fz = z * cells, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      let md = 9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
        const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
        const o = ((wz * cells + wy) * cells + wx) * 3, px = cx + pts[o] - fx, py = cy + pts[o + 1] - fy, pz = cz + pts[o + 2] - fz, d = px * px + py * py + pz * pz;
        if (d < md) md = d;
      }
      return Math.min(1, Math.sqrt(md));
    };
  };
  const w1 = worley(4, 11), w2 = worley(8, 12), w3 = worley(16, 13);
  let i = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    const f = 0.6 * (1 - w1(u, v, w)) + 0.28 * (1 - w2(u, v, w)) + 0.12 * (1 - w3(u, v, w));
    data[i++] = clamp(Math.round((f * 1.25 - 0.12) * 255), 0, 255);
  }
  const t = new T.Data3DTexture(data, N, N, N);
  t.format = 1028; t.type = 1009; t.minFilter = t.magFilter = 1006; t.wrapS = t.wrapT = t.wrapR = 1000; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}
export const noise3D = (T) => (NOISE ??= makeNoise3D(T));

// ---- the stage ----------------------------------------------------------------------------------

export class Atmosphere {
  constructor(pipe) {
    const T = pipe.T;
    this.pipe = pipe;
    this.T = T;
    const V3 = T.Vector3, V2 = T.Vector2, M4 = T.Matrix4;
    this.shared = {
      uInvProj: { value: new M4() }, uCamWorld: { value: new M4() }, uCam: { value: new V3() }, uSun: { value: new V3(0, 1, 0) }, uSunCol: { value: new V3(1, 1, 1) },
      uHor0: { value: new V3() }, uHor1: { value: new V3() },
    };
    const vs = "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}";
    this.noise = noise3D(T);
    this.cloudMat = new T.ShaderMaterial({ uniforms: { ...this.shared, tDepth: { value: null }, tNoise: { value: this.noise }, uTime: { value: 0 }, uCover: { value: 0.5 }, uY0: { value: 1150 }, uY1: { value: 1570 }, uSteps: { value: 36 } }, vertexShader: vs, fragmentShader: CLOUD_FS, depthWrite: false, depthTest: false });
    this.atmosMat = new T.ShaderMaterial({
      uniforms: { ...this.shared, tScene: { value: null }, tDepth: { value: null }, tCloud: { value: null }, tNoise: { value: this.noise }, uTime: { value: 0 }, uFrame: { value: 0 }, uAO: { value: 0.75 }, uAORad: { value: 1 }, uHaze: { value: 0 }, uHazeH: { value: 40 }, uCloudsOn: { value: 0 }, uY0: { value: 1150 }, uY1: { value: 1570 }, uCover: { value: 0.5 },
        uViewProj: { value: new M4() }, uSunUV: { value: new V2() }, uSunVis: { value: 0 }, uAspect: { value: 1.78 }, uRays: { value: 1 } },
      vertexShader: vs, fragmentShader: ATMOS_FS, depthWrite: false, depthTest: false,
    });
    this.frameN = 0;
    this.sky = null;
  }

  /** The sky dome for an open set (a big sphere drawn at the far plane; the viewer adds it to the scene). */
  skyMesh() {
    if (this.sky) return this.sky;
    const T = this.T;
    const mat = new T.ShaderMaterial({ uniforms: { uSun: this.shared.uSun, uSunCol: this.shared.uSunCol, uHor0: this.shared.uHor0, uHor1: this.shared.uHor1, uZen: { value: new T.Vector3() }, uSunBoost: { value: 1 } }, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: 1, depthWrite: false });
    const m = new T.Mesh(new T.SphereGeometry(20000, 48, 24), mat);
    m.renderOrder = -10; m.frustumCulled = false;
    this.sky = m;
    return m;
  }

  dispose() { this.cloudMat.dispose(); this.atmosMat.dispose(); this.sky?.geometry.dispose(); this.sky?.material.dispose(); }

  /**
   * Run the atmosphere on the scene render (pipe.rtScene): -> pipe.rtAtm.texture.
   *   env  one of ENV; opts { open, aoOn, clouds, rays, t, cam, aspect, cloudsFresh }
   */
  apply(env, o) {
    const pipe = this.pipe, r = pipe.renderer, cam = o.cam, sh = this.shared;
    const sun = o.sunDir;
    sh.uSun.value.copy(sun); sh.uSunCol.value.set(...env.sun);
    sh.uHor0.value.set(...env.hor0); sh.uHor1.value.set(...env.hor1);
    sh.uInvProj.value.copy(cam.projectionMatrixInverse); sh.uCamWorld.value.copy(cam.matrixWorld); sh.uCam.value.copy(cam.position);
    if (this.sky) { this.sky.material.uniforms.uZen.value.set(...env.zen); this.sky.material.uniforms.uSunBoost.value = env.sunBoost; this.sky.position.copy(cam.position); }
    const cloudsOn = !!(o.clouds && o.open && sun.y > 0.05 && env.sunBoost > 0.2);
    if (cloudsOn && o.cloudsFresh) {
      const cu = this.cloudMat.uniforms;
      cu.tDepth.value = pipe.rtScene.depthTexture; cu.uTime.value = o.t; cu.uCover.value = env.cover; cu.uSteps.value = o.cloudSteps ?? 36;
      pipe.pass(this.cloudMat, pipe.rtCloud);
    }
    const au = this.atmosMat.uniforms;
    au.tScene.value = pipe.rtScene.texture; au.tDepth.value = pipe.rtScene.depthTexture; au.tCloud.value = pipe.rtCloud.texture;
    au.uTime.value = o.t; au.uFrame.value = (this.frameN++) % 64; au.uAO.value = o.aoOn ? 0.75 : 0; au.uAORad.value = o.aoRadius ?? 1;
    au.uHaze.value = o.open ? env.haze : 0; au.uHazeH.value = 40; au.uCloudsOn.value = cloudsOn ? 1 : 0; au.uCover.value = env.cover;
    au.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const p = sun.clone().multiplyScalar(5000).add(cam.position).project(cam), fwd = cam.getWorldDirection(new this.T.Vector3()), facing = fwd.dot(sun);
    au.uSunUV.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    au.uSunVis.value = o.open && p.z < 1 && env.sunBoost > 0.2 ? clamp((facing - 0.2) / 0.6, 0, 1) : 0;
    au.uAspect.value = o.aspect; au.uRays.value = o.rays ? 1 : 0;
    pipe.pass(this.atmosMat, pipe.rtAtm);
    return { cloudsOn, sunUV: au.uSunUV.value, sunVis: au.uSunVis.value, facing };
  }
}
