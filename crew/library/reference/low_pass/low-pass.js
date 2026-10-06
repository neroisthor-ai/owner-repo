(function(){
'use strict';
const errEl=document.getElementById('err');
if(typeof THREE==='undefined'){ errEl.style.display='flex'; errEl.textContent='The 3D engine did not load. Check your connection and reload the page.'; return; }
const statusEl=document.getElementById('status');

/* ---------- basics ---------- */
const V3=THREE.Vector3, UP=new V3(0,1,0), ZAX=new V3(0,0,1);
const TOTAL=40;const BRG=[];
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const R=rng(20260924);

const stageEl=document.getElementById('stage');
let renderer;
try{ renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:!!window.__testMode}); }
catch(e){ errEl.style.display='flex'; errEl.textContent='This browser could not start WebGL, which the film needs. Try a recent Chrome, Safari or Firefox.'; return; }
const HQ=renderer.capabilities.isWebGL2&&!!THREE.DataTexture3D&&!!THREE.UnrealBloomPass&&!!THREE.FullScreenQuad&&!!THREE.FXAAShader;
renderer.setClearColor(0x000000);
renderer.outputEncoding=HQ?THREE.LinearEncoding:THREE.sRGBEncoding;
renderer.toneMapping=HQ?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
stageEl.insertBefore(renderer.domElement,stageEl.firstChild);

const scene=new THREE.Scene();
if(!HQ)scene.fog=new THREE.FogExp2(new THREE.Color(0.60,0.44,0.36),0.00014);
const camera=new THREE.PerspectiveCamera(40,2.39,3,30000);
const SUN_DIR=new V3(-1,0.12,0.38).normalize();
const SUN_COL=new THREE.Color(1.0,0.60,0.34);

function canvasTex(w,h,draw,srgb){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');draw(g,w,h);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;if(srgb!==false)t.encoding=THREE.sRGBEncoding;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;}
function rep(tex,rx,ry){const t=tex.clone();t.repeat.set(rx,ry);t.needsUpdate=true;return t;}

const NOISE=`
float h13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float vn3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(h13(i),h13(i+vec3(1,0,0)),f.x),mix(h13(i+vec3(0,1,0)),h13(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h13(i+vec3(0,0,1)),h13(i+vec3(1,0,1)),f.x),mix(h13(i+vec3(0,1,1)),h13(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm3(vec3 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){s+=a*vn3(p);p*=2.03;a*=0.5;}return s;}
`;
const HAZE=`
vec3 hazeCol(vec3 rd,vec3 sun){vec2 dh=normalize(rd.xz+1e-5),sh=normalize(sun.xz);float toward=pow(0.5+0.5*dot(dh,sh),2.2);
 vec3 c=mix(vec3(0.50,0.44,0.50),vec3(1.30,0.62,0.30),toward);float s=max(dot(rd,sun),0.0);c+=vec3(1.0,0.55,0.25)*pow(s,9.0)*0.6;return c;}
`;

/* ---------- sky + env ---------- */
function skyMaterial(forEnv){
  return new THREE.ShaderMaterial({
    uniforms:{uSun:{value:SUN_DIR}},side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:!forEnv,
    vertexShader:`varying vec3 vDir;void main(){vDir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position=${forEnv?'p':'p.xyww'};}`,
    fragmentShader:`uniform vec3 uSun;varying vec3 vDir;${HAZE}
    void main(){vec3 d=normalize(vDir);float s=max(dot(d,uSun),0.0);float y=d.y;
      vec2 dh=normalize(d.xz+1e-5),sh=normalize(uSun.xz);float toward=pow(0.5+0.5*dot(dh,sh),2.2);
      vec3 hor=mix(vec3(0.50,0.44,0.50),vec3(1.30,0.62,0.30),toward);float h=clamp(y,0.0,1.0);
      vec3 col=mix(hor,vec3(0.07,0.12,0.27),pow(h,0.42));
      col+=vec3(0.30,0.10,0.02)*exp(-h*12.0)*toward;
      col+=vec3(1.0,0.55,0.25)*pow(s,9.0)*0.6+vec3(1.0,0.74,0.45)*pow(s,80.0)*1.7;
      col=mix(hazeCol(d,uSun)*0.92,col,smoothstep(-0.02,0.04,y));
      col+=vec3(22.0,14.0,7.0)*smoothstep(0.99986,0.99993,s);
      gl_FragColor=vec4(col,1.0);
      ${forEnv?'#include <encodings_fragment>':'#include <tonemapping_fragment>\n#include <encodings_fragment>'}
    }`
  });
}
const sky=new THREE.Mesh(new THREE.SphereGeometry(20000,48,24),skyMaterial(false));
sky.renderOrder=-10;sky.frustumCulled=false;scene.add(sky);
{
  const envScene=new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(900,48,24),skyMaterial(true)));
  const ground=new THREE.Mesh(new THREE.CircleGeometry(880,32),new THREE.MeshBasicMaterial({color:new THREE.Color(0.10,0.075,0.06)}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-40;envScene.add(ground);
  const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(envScene,0,1,2000).texture;pm.dispose();
}

/* ---------- light ---------- */
const sun=new THREE.DirectionalLight(SUN_COL,2.6);
sun.castShadow=true;sun.shadow.mapSize.set(renderer.capabilities.maxTextureSize>=8192?4096:2048,renderer.capabilities.maxTextureSize>=8192?4096:2048);sun.shadow.bias=-0.0004;sun.shadow.normalBias=1.5;
sun.shadow.camera.near=10;sun.shadow.camera.far=9000;scene.add(sun);scene.add(sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.35,0.42,0.6),new THREE.Color(0.22,0.15,0.10),0.24));
function setShadowFocus(p,ext){sun.target.position.copy(p);sun.position.copy(p).addScaledVector(SUN_DIR,4200);const c=sun.shadow.camera;if(c.right!==ext){c.left=-ext;c.right=ext;c.top=ext;c.bottom=-ext;c.updateProjectionMatrix();}}

/* ---------- geography: real Thames centreline ---------- */
const LAT0=51.5055,LON0=-0.0754,KX=69296,KZ=111200;
const geo=(lat,lon)=>new V3((lon-LON0)*KX,0,-(lat-LAT0)*KZ);
const RIVER_LL=[[51.4950,-0.0290],[51.5035,-0.0300],[51.5078,-0.0380],[51.5068,-0.0520],[51.5042,-0.0640],[51.5052,-0.0730],[51.5056,-0.0760],[51.5070,-0.0820],
 [51.5079,-0.0877],[51.5087,-0.0944],[51.5094,-0.0990],[51.5098,-0.1045],[51.5097,-0.1110],[51.5086,-0.1165],[51.5066,-0.1200],[51.5036,-0.1215],[51.5008,-0.1222],
 [51.4975,-0.1232],[51.4945,-0.1243],[51.4905,-0.1258],[51.4875,-0.1275],[51.4852,-0.1330],[51.4840,-0.1420],[51.4845,-0.1500],[51.4832,-0.1600],[51.4815,-0.1680],
 [51.4790,-0.1740],[51.4740,-0.1790],[51.4680,-0.1830]];
const HW=122,WATER_Y=1.0,LAND_Y=4.2;
const riverCurve=new THREE.CatmullRomCurve3(RIVER_LL.map(p=>geo(p[0],p[1])),false,'centripetal');
const RL=riverCurve.getLength(),RN=Math.ceil(RL/5),RDS=RL/RN;
const RP=riverCurve.getSpacedPoints(RN);
function tangents(px,pz){const n=px.length,tx=new Float32Array(n),tz=new Float32Array(n);for(let i=0;i<n;i++){const a=Math.max(0,i-1),b=Math.min(n-1,i+1);let dx=px[b]-px[a],dz=pz[b]-pz[a];const l=Math.hypot(dx,dz)||1;tx[i]=dx/l;tz[i]=dz/l;}return{tx,tz};}
const RIV={px:Float32Array.from(RP.map(p=>p.x)),pz:Float32Array.from(RP.map(p=>p.z))};Object.assign(RIV,tangents(RIV.px,RIV.pz));
function smoothLUT(W){const k=Math.round(W/RDS),n=RIV.px.length,px=new Float32Array(n),pz=new Float32Array(n);
  for(let i=0;i<n;i++){let sx=0,sz=0,c=0;for(let j=-k;j<=k;j+=2){const q=clamp(i+j,0,n-1);const w=1-Math.abs(j)/(k+1);sx+=RIV.px[q]*w;sz+=RIV.pz[q]*w;c+=w;}px[i]=sx/c;pz[i]=sz/c;}
  const L={px,pz};Object.assign(L,tangents(px,pz));return L;}
function lutAt(L,s,out,tan){const n=L.px.length;const f=s/RDS;
  if(f<=0){out.set(L.px[0]+L.tx[0]*s,0,L.pz[0]+L.tz[0]*s);if(tan)tan.set(L.tx[0],0,L.tz[0]);return out;}
  if(f>=n-1){const e=s-(n-1)*RDS;out.set(L.px[n-1]+L.tx[n-1]*e,0,L.pz[n-1]+L.tz[n-1]*e);if(tan)tan.set(L.tx[n-1],0,L.tz[n-1]);return out;}
  const i=Math.floor(f),k=f-i;out.set(lerp(L.px[i],L.px[i+1],k),0,lerp(L.pz[i],L.pz[i+1],k));
  if(tan)tan.set(lerp(L.tx[i],L.tx[i+1],k),0,lerp(L.tz[i],L.tz[i+1],k)).normalize();return out;}
function nearestS(x,z){let b=0,bd=1e18;for(let i=0;i<RIV.px.length;i++){const d=(RIV.px[i]-x)**2+(RIV.pz[i]-z)**2;if(d<bd){bd=d;b=i;}}return b*RDS;}
const JET_SM=smoothLUT(260),B2_SM=smoothLUT(420);
const sTB=nearestS(0,0);
const _v=new V3(),_tn=new V3();
function riverFrame(s){const p=lutAt(RIV,s,new V3()),t=new V3();lutAt(RIV,s,_v,t);return{p,t,n:new V3(-t.z,0,t.x)};}
function alignToRiver(obj,s){const f=riverFrame(s);obj.position.set(f.p.x,0,f.p.z);obj.rotation.y=Math.atan2(f.t.z,-f.t.x);return f;}

/* ---------- land mask (river, parks, city zone) ---------- */
const MX0=-13000,MZ0=-10000,MSZ=20000,MRES=2048;
const maskCanvas=document.createElement('canvas');maskCanvas.width=maskCanvas.height=MRES;
const PARKS=[[51.5073,-0.1657,2400,900,0],[51.5040,-0.1420,620,420,0.6],[51.5025,-0.1340,900,260,0.05],[51.4791,-0.1567,900,700,0.2],[51.4965,-0.1252,320,70,1.4],
  [51.5313,-0.1570,1400,1200,0],[51.5082,-0.0762,230,230,0.2],[51.4930,-0.0620,700,500,0],[51.4820,-0.1180,500,350,0.3],[51.5170,-0.1100,300,250,0]];
{
  const g=maskCanvas.getContext('2d');const sc=MRES/MSZ;const P=(x,z)=>[(x-MX0)*sc,(z-MZ0)*sc];
  g.fillStyle='#ff0000';g.fillRect(0,0,MRES,MRES);
  g.lineCap='round';g.lineJoin='round';
  g.strokeStyle='#ff00ff';g.lineWidth=2*4800*sc;g.beginPath();RP.forEach((p,i)=>{const q=P(p.x,p.z);i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]);});g.stroke();
  for(const pk of PARKS){const c=geo(pk[0],pk[1]);const q=P(c.x,c.z);g.save();g.translate(q[0],q[1]);g.rotate(pk[4]);g.fillStyle='#ffffff';g.beginPath();g.ellipse(0,0,pk[2]/2*sc,pk[3]/2*sc,0,0,6.283);g.fill();g.restore();}
  g.strokeStyle='#000000';g.lineWidth=2*HW*sc;g.beginPath();RP.forEach((p,i)=>{const q=P(p.x,p.z);i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]);});g.stroke();
}
const maskData=maskCanvas.getContext('2d').getImageData(0,0,MRES,MRES).data;
function maskAt(x,z){const u=Math.floor((x-MX0)/MSZ*MRES),v=Math.floor((z-MZ0)/MSZ*MRES);if(u<0||v<0||u>=MRES||v>=MRES)return 1|0;const i=(v*MRES+u)*4;return (maskData[i]>127?1:0)|(maskData[i+1]>127?2:0)|(maskData[i+2]>127?4:0);}
const isLand=(x,z)=>(maskAt(x,z)&1)===1;
const onRiver=(x,z)=>!isLand(x,z);
const maskTex=new THREE.CanvasTexture(maskCanvas);maskTex.minFilter=THREE.LinearFilter;maskTex.generateMipmaps=false;

/* ---------- land + water ---------- */
const landMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.95,metalness:0});
landMat.onBeforeCompile=(sh)=>{
  sh.uniforms.uMask={value:maskTex};
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>','#include <begin_vertex>\nvWP=(modelMatrix*vec4(transformed,1.0)).xyz;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vWP;uniform sampler2D uMask;${NOISE}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    vec2 muv=vec2((vWP.x-(${MX0.toFixed(1)}))/${MSZ.toFixed(1)},1.0-(vWP.z-(${MZ0.toFixed(1)}))/${MSZ.toFixed(1)});
    vec4 mk=(muv.x>0.0&&muv.y>0.0&&muv.x<1.0&&muv.y<1.0)?texture2D(uMask,muv):vec4(1.0,0.0,0.0,1.0);
    if(mk.r<0.5)discard;
    float n1=fbm3(vec3(vWP.xz*0.012,0.0)),n2=vn3(vec3(vWP.xz*0.08,3.0));
    vec3 pave=vec3(0.17,0.16,0.15)*(0.75+0.5*n1)*(0.9+0.2*n2);
    vec3 grass=vec3(0.11,0.16,0.06)*(0.7+0.6*n1)+vec3(0.05,0.04,0.0)*n2;
    vec2 rp=mat2(0.95,0.31,-0.31,0.95)*vWP.xz;vec2 cell=floor(rp/64.0);float ch=fract(sin(dot(cell,vec2(12.9898,78.233)))*43758.5453);
    vec2 cf=fract(rp/64.0);float street=step(0.14,cf.x)*step(0.14,cf.y);
    vec3 far=mix(vec3(0.13,0.12,0.12),mix(vec3(0.40,0.30,0.24),vec3(0.55,0.52,0.47),ch)*(0.6+0.5*n2),street);
    vec3 base=mix(far,pave,step(0.5,mk.b));
    diffuseColor.rgb=mix(base,grass,step(0.5,mk.g)*step(0.5,mk.b)+step(0.5,mk.g)*(1.0-step(0.5,mk.b))*0.0);`);
};
const land=new THREE.Mesh(new THREE.PlaneGeometry(60000,60000),landMat);land.rotation.x=-Math.PI/2;land.position.set(-3000,LAND_Y,0);land.receiveShadow=true;scene.add(land);

// embankment walls along both banks
{
  const pos=[],idx=[];const n=RIV.px.length;let v=0;
  for(const side of [-1,1]){
    for(let i=0;i<n;i+=2){const nx=-RIV.tz[i],nz=RIV.tx[i];const x=RIV.px[i]+nx*HW*side,z=RIV.pz[i]+nz*HW*side;
      pos.push(x,-1,z,x,LAND_Y+1.0,z,x+nx*side*1.2,LAND_Y+1.0,z+nz*side*1.2);}
    const cnt=Math.floor((n+1)/2);
    for(let i=0;i<cnt-1;i++){const a=v+i*3,b=v+(i+1)*3;idx.push(a,b,a+1,b,b+1,a+1,a+1,b+1,a+2,b+1,b+2,a+2);}
    v+=cnt*3;
  }
  const ge=new THREE.BufferGeometry();ge.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));ge.setIndex(idx);ge.computeVertexNormals();
  const wall=new THREE.Mesh(ge,new THREE.MeshStandardMaterial({color:0x8d8170,roughness:0.95,side:THREE.DoubleSide}));wall.receiveShadow=true;scene.add(wall);
}

const reflTexMat=new THREE.Matrix4();
const waterMat=new THREE.ShaderMaterial({
  uniforms:{uTime:{value:0},uSun:{value:SUN_DIR},uJet:{value:new THREE.Vector4(0,0,0,0)},uJetDir:{value:new THREE.Vector2(-1,0)},tRefl:{value:null},uTexMat:{value:reflTexMat},uReflOn:{value:0}},
  vertexShader:`varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform float uTime,uReflOn;uniform vec3 uSun;uniform vec4 uJet;uniform vec2 uJetDir;uniform sampler2D tRefl;uniform mat4 uTexMat;varying vec3 vW;
  ${NOISE}
  float wake(vec2 p){vec2 r=p-uJet.xy;float along=dot(r,-uJetDir);vec2 perp=vec2(-uJetDir.y,uJetDir.x);float across=dot(r,perp);
    return exp(-abs(across)/(9.0+max(along,0.0)*0.12))*smoothstep(-25.0,5.0,along)*exp(-max(along,0.0)/260.0)*uJet.z;}
  float hgt(vec2 p){float t=uTime;float h=0.22*sin(dot(p,vec2(0.08,0.03))+t*1.3)+0.16*sin(dot(p,vec2(-0.05,0.11))+t*1.7)+0.1*sin(dot(p,vec2(0.19,-0.07))+t*2.3);
    h+=0.35*fbm3(vec3(p*0.09,t*0.35));float wk=wake(p);h+=wk*(1.6*fbm3(vec3(p*0.45,t*7.0))-0.5);return h;}
  void main(){vec2 p=vW.xz;float e=0.6;float h0=hgt(p);
    vec3 n=normalize(vec3(-(hgt(p+vec2(e,0.0))-h0)/e,1.0,-(hgt(p+vec2(0.0,e))-h0)/e));n=normalize(mix(vec3(0,1,0),n,0.7));
    vec3 v=normalize(cameraPosition-vW);float fr=0.02+0.98*pow(1.0-max(dot(n,v),0.0),5.0);
    vec3 r=reflect(-v,n);r.y=abs(r.y);float s=max(dot(r,uSun),0.0);
    vec2 dh=normalize(r.xz+1e-5),sh=normalize(uSun.xz);float toward=pow(0.5+0.5*dot(dh,sh),2.2);
    vec3 sk=mix(mix(vec3(0.50,0.44,0.50),vec3(1.30,0.62,0.30),toward),vec3(0.07,0.12,0.27),pow(clamp(r.y,0.0,1.0),0.42));
    sk+=vec3(1.0,0.6,0.3)*pow(s,12.0)*0.7;
    if(uReflOn>0.5){vec4 rc=uTexMat*vec4(vW,1.0);vec2 ruv=rc.xy/rc.w+n.xz*0.11;sk=texture2D(tRefl,ruv).rgb;}
    sk+=vec3(12.0,8.0,4.0)*pow(s,700.0);
    vec3 col=mix(vec3(0.040,0.043,0.032),sk*0.9,fr*0.8);
    col+=vec3(1.0,0.72,0.45)*pow(s,90.0)*0.8*fr;
    float wk=wake(p);col=mix(col,vec3(0.85,0.78,0.7),clamp(wk*smoothstep(0.55,0.9,fbm3(vec3(p*0.5,uTime*6.0))),0.0,0.85));
    gl_FragColor=vec4(col,1.0);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
  }`
});
const water=new THREE.Mesh(new THREE.PlaneGeometry(60000,60000),waterMat);water.rotation.x=-Math.PI/2;water.position.set(-3000,WATER_Y,0);scene.add(water);

/* ---------- occupancy grid (prevents overlaps) ---------- */
const OX0=-13000,OZ0=-8000,OW=2000,OH=1700,OC=10;
const occ=new Uint8Array(OW*OH);
function fpPoints(cx,cz,w,d,ang,fn){const c=Math.cos(ang),s=Math.sin(ang);const nx=Math.max(1,Math.ceil(w/7)),nz=Math.max(1,Math.ceil(d/7));
  for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){const lx=(i/nx-0.5)*w,lz=(j/nz-0.5)*d;if(fn(cx+lx*c+lz*s,cz-lx*s+lz*c)===false)return false;}return true;}
function occIdx(x,z){const u=Math.floor((x-OX0)/OC),v=Math.floor((z-OZ0)/OC);if(u<0||v<0||u>=OW||v>=OH)return -1;return v*OW+u;}
function claim(cx,cz,w,d,ang,pad){pad=pad||0;
  const ok=fpPoints(cx,cz,w+pad,d+pad,ang,(x,z)=>{const i=occIdx(x,z);if(i<0||occ[i])return false;if(!isLand(x,z))return false;});
  if(!ok)return false;fpPoints(cx,cz,w,d,ang,(x,z)=>{const i=occIdx(x,z);if(i>=0)occ[i]=1;});return true;}
function reserve(cx,cz,w,d,ang){fpPoints(cx,cz,w,d,ang,(x,z)=>{const i=occIdx(x,z);if(i>=0)occ[i]=1;});}

/* ---------- textures ---------- */

function panelTex(base,seam,scratch,seed){
  const r=rng(seed);
  return canvasTex(512,512,(g,w,h)=>{
    g.fillStyle=base;g.fillRect(0,0,w,h);
    for(let i=0;i<180;i++){g.fillStyle=`rgba(0,0,0,${0.02+r()*0.05})`;g.beginPath();g.ellipse(r()*w,r()*h,8+r()*60,6+r()*40,r()*3,0,6.3);g.fill();}
    for(let i=0;i<60;i++){g.fillStyle=`rgba(0,0,0,${0.03+r()*0.04})`;g.fillRect(r()*w,r()*h,1+r()*2,30+r()*120);}
    g.strokeStyle=seam;g.lineWidth=1.3;
    for(let i=0;i<46;i++){const x=r()*w,y=r()*h,ww=30+r()*140,hh=24+r()*110;g.strokeRect(x,y,ww,hh);
      g.fillStyle=seam;for(let k=0;k<ww;k+=7){g.fillRect(x+k,y+3,1.2,1.2);} }
    g.strokeStyle=scratch;g.lineWidth=0.7;
    for(let i=0;i<220;i++){const x=r()*w,y=r()*h,a=r()*6.3,l=3+r()*18;g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);g.stroke();}
  });
}
const f16Tex=panelTex('#b9bcbf','rgba(40,44,48,0.55)','rgba(235,238,240,0.35)',11);
const b2Tex=panelTex('#c8c8ca','rgba(30,30,32,0.6)','rgba(255,255,255,0.55)',23);


function heightToNormal(srcCanvas,strength){const w=srcCanvas.width,h=srcCanvas.height;const d=srcCanvas.getContext('2d').getImageData(0,0,w,h).data;
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');const out=g.createImageData(w,h);
  const H=(x,y)=>d[(((y+h)%h)*w+((x+w)%w))*4]/255;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=(H(x+1,y)-H(x-1,y))*strength,dy=(H(x,y+1)-H(x,y-1))*strength;const l=Math.hypot(dx,dy,1);const i=(y*w+x)*4;
    out.data[i]=(-dx/l*0.5+0.5)*255;out.data[i+1]=(dy/l*0.5+0.5)*255;out.data[i+2]=(1/l*0.5+0.5)*255;out.data[i+3]=255;}
  g.putImageData(out,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}
function gothicPanel(forH){const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
  g.fillStyle=forH?'#808080':'#d9bf8f';g.fillRect(0,0,256,256);
  if(!forH)for(let i=0;i<2000;i++){g.fillStyle=`rgba(${R()<0.5?70:255},${R()<0.5?55:240},40,${0.04+R()*0.05})`;g.fillRect(R()*256,R()*256,2,2);}
  for(let b=0;b<4;b++){const x=b*64;
    g.fillStyle=forH?'#e0e0e0':'#e6cc98';g.fillRect(x,0,7,256);g.fillRect(x+57,0,7,256);
    g.fillStyle=forH?'#b0b0b0':'#cdb384';g.fillRect(x+30,0,4,256);
    for(let r=0;r<2;r++){const y=18+r*128;g.fillStyle=forH?'#202020':'#2e2a25';g.beginPath();g.moveTo(x+12,y+100);g.lineTo(x+12,y+22);g.quadraticCurveTo(x+12,y+4,x+32,y);g.quadraticCurveTo(x+52,y+4,x+52,y+22);g.lineTo(x+52,y+100);g.closePath();g.fill();
      g.fillStyle=forH?'#909090':'rgba(210,190,150,0.9)';g.fillRect(x+30,y+4,4,96);g.fillRect(x+12,y+50,40,3);}
  }
  g.fillStyle=forH?'#f0f0f0':'#e8d2a4';g.fillRect(0,122,256,9);g.fillRect(0,250,256,6);
  return c;}
const gpAlb=new THREE.CanvasTexture(gothicPanel(false));gpAlb.encoding=THREE.sRGBEncoding;gpAlb.wrapS=gpAlb.wrapT=THREE.RepeatWrapping;
const gpNrm=heightToNormal(gothicPanel(true),5);
function gothicMat(rx,ry,color){const m=new THREE.MeshStandardMaterial({color:color||0xffffff,map:rep(gpAlb,rx,ry),normalMap:rep(gpNrm,rx,ry),roughness:0.85});m.normalScale.set(1.2,1.2);return m;}

/* ---------- city fabric (block-based, London typologies) ---------- */
// styles: 0 terrace brick, 1 stone office, 2 glass curtain, 3 modern resi, 4 stucco, 5 plant room
const bGeo=new THREE.BoxGeometry(1,1,1);bGeo.translate(0,0.5,0);
const roofGeo=(()=>{const g=new THREE.BufferGeometry();const p=[-0.5,0,-0.5, 0.5,0,-0.5, 0,1,-0.5, -0.5,0,0.5, 0.5,0,0.5, 0,1,0.5];
  const ix=[0,2,1, 3,4,5, 0,3,5, 0,5,2, 1,2,5, 1,5,4];g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);const ng=g.toNonIndexed();ng.computeVertexNormals();ng.rotateY(Math.PI/2);return ng;})();
const bMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.85,metalness:0.03});
bMat.onBeforeCompile=(sh)=>{
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 aStyle;varying vec2 vStyle;varying vec3 vLoc;varying vec3 vLN;varying vec3 vSc;varying vec3 vWP;')
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    vStyle=aStyle;vLoc=position;vLN=objectNormal;
    #ifdef USE_INSTANCING
      vSc=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));vWP=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;
    #else
      vSc=vec3(1.0);vWP=(modelMatrix*vec4(position,1.0)).xyz;
    #endif`);
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vStyle;varying vec3 vLoc;varying vec3 vLN;varying vec3 vSc;varying vec3 vWP;
    float bh(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
    float bn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(bh(vec3(i,0.0)),bh(vec3(i+vec2(1,0),0.0)),f.x),mix(bh(vec3(i+vec2(0,1),0.0)),bh(vec3(i+vec2(1,1),0.0)),f.x),f.y);}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    float st=floor(vStyle.x+0.5),seed=vStyle.y;
    bool sideX=abs(vLN.x)>0.5;float roofM=step(0.5,vLN.y);
    float W=sideX?vSc.z:vSc.x;float u=(sideX?vLoc.z:vLoc.x)*W;float hh=vLoc.y*vSc.y;float H=vSc.y;
    float sx=3.0,fy=3.3,ww=1.3,wh=1.9,gf=3.6;
    if(st>0.5&&st<1.5){sx=3.2;fy=3.9;ww=1.9;wh=2.2;gf=5.0;}
    if(st>1.5&&st<2.5){sx=1.6;fy=3.9;ww=1.5;wh=3.4;gf=5.0;}
    if(st>2.5&&st<3.5){sx=3.4;fy=3.1;ww=2.3;wh=2.0;gf=3.4;}
    if(st>3.5&&st<4.5){sx=3.4;fy=3.8;ww=1.4;wh=2.5;gf=4.2;}
    float cn=max(1.0,floor((W-1.0)/sx));float sxa=W/cn;float cu=(u+W*0.5)/sxa;float fu=fract(cu);
    float cv=(hh-gf)/fy;float fv=fract(cv);
    float inWin=step(abs(fu-0.5),ww/sxa*0.5)*step(abs(fv-0.5),wh/fy*0.5);
    float frame=step(abs(fu-0.5),ww/sxa*0.5+0.09)*step(abs(fv-0.5),wh/fy*0.5+0.06)*(1.0-inWin);
    #if __VERSION__ >= 300
    float aa=clamp(max(fwidth(cu),fwidth(cv))*1.6-0.25,0.0,1.0);
    #else
    float aa=0.0;
    #endif
    inWin=mix(inWin,(ww/sxa)*(wh/fy)*0.9,aa);frame=mix(frame,0.0,aa);
    float body=step(gf,hh)*step(hh,H-1.3)*(1.0-roofM)*step(st,4.5);
    float shop=step(0.6,hh)*step(hh,gf-0.7)*step(0.25,fract(u/5.0+0.13))*(1.0-roofM)*step(st,4.5)*step(0.5,bh(vec3(seed,3.0,1.0)));
    float bWin=clamp(inWin*body+shop,0.0,1.0);
    float grime=bn(vWP.xz*0.05+vWP.y*0.02)*0.5+bn(vec2(u*0.5,hh*0.06)+seed)*0.5;
    vec3 base=diffuseColor.rgb*(0.82+0.3*grime);
    base*=1.0-0.18*smoothstep(3.0,0.0,hh)*(1.0-roofM);
    base=mix(base,base*0.8,step(abs(fract(hh/fy)-0.02),0.02)*body*0.6);
    vec3 roofC=vec3(0.26,0.26,0.27)*(0.6+0.8*bh(vec3(floor(vWP.xz/9.0),seed)));
    base=mix(base,roofC,roofM);
    if(st>1.5&&st<2.5){base=mix(base,vec3(0.18,0.2,0.22),1.0-roofM);}
    vec3 frameC=(st<0.5)?vec3(0.85,0.84,0.8):base*1.25;
    base=mix(base,frameC,frame*body);
    float isTrad=(st<1.5||(st>3.5&&st<4.5))?1.0:0.0;float notCW=1.0-step(1.5,st)*step(st,2.5);
    float corn=step(H-1.6,hh)*step(hh,H-1.0)*(1.0-roofM)*isTrad;float cornSh=step(H-2.2,hh)*step(hh,H-1.6)*(1.0-roofM)*isTrad;
    base=mix(base,base*1.22+0.02,corn);base*=1.0-0.4*cornSh;base=mix(base,base*1.18,step(abs(hh-gf+0.25),0.22)*(1.0-roofM)*isTrad);
    float wy=(fv-0.5)*fy/wh+0.5,wx=(fu-0.5)*sxa/ww+0.5;
    float recess=inWin*body*(smoothstep(0.78,1.0,wy)*0.75+smoothstep(0.14,0.0,wx)*0.45)*notCW*(1.0-aa);
    float blind=step(0.7,bh(vec3(floor(cu),floor(cv),seed+7.0)))*notCW*(1.0-aa)+0.3*aa*notCW;
    vec3 winC=mix(vec3(0.035,0.04,0.05),vec3(0.17,0.15,0.12)*(0.6+0.8*bh(vec3(floor(cv),floor(cu),seed))),blind);
    float lit=bWin*step(0.955,bh(vec3(floor(cu),floor(cv),seed)))*(1.0-aa)+bWin*0.04*aa;
    diffuseColor.rgb=mix(base,winC,bWin*0.92);diffuseColor.rgb*=1.0-recess*0.6;
    float bW=bWin*(1.0-blind*0.75);`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,0.07,bW);')
   .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,0.55,bW);')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.0,0.62,0.3)*lit*0.9;');
};
const roofMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.8,metalness:0.05});
roofMat.onBeforeCompile=(sh)=>{sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWP2;').replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\nvWP2=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;\n#else\nvWP2=(modelMatrix*vec4(position,1.0)).xyz;\n#endif');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWP2;').replace('#include <color_fragment>','#include <color_fragment>\nfloat rw=fract(vWP2.y/0.26);float cl=fract(sin(dot(floor(vec2(vWP2.x+vWP2.z,vWP2.y/0.26)/vec2(0.45,1.0)),vec2(12.99,78.23)))*43758.55);diffuseColor.rgb*=(0.78+0.22*smoothstep(0.0,0.18,rw))*(0.88+0.24*cl);');};
const TILE=1500;
const tiles=new Map();
function tileOf(x,z){const k=Math.floor(x/TILE)+'_'+Math.floor(z/TILE);let t=tiles.get(k);if(!t){t={cx:(Math.floor(x/TILE)+0.5)*TILE,cz:(Math.floor(z/TILE)+0.5)*TILE,b:[],r:[],maxH:0};tiles.set(k,t);}return t;}
function addB(x,z,w,d,h,ang,col,style,y0){const t=tileOf(x,z);t.b.push([x,y0||LAND_Y,z,w,h,d,ang,col[0],col[1],col[2],style,R()*97]);t.maxH=Math.max(t.maxH,h);}
function addRoof(x,z,w,d,rh,ang,y0,col){const t=tileOf(x,z);t.r.push([x,y0,z,w,rh,d,ang,col[0],col[1],col[2]]);}
const DIST=[
  {n:'city',c:geo(51.5140,-0.0880),r:950},{n:'cw',c:geo(51.5045,-0.0200),r:600},{n:'ne',c:geo(51.4820,-0.1300),r:650},
  {n:'west',c:geo(51.5090,-0.1450),r:1900},{n:'wmin',c:geo(51.4970,-0.1330),r:800},{n:'sb',c:geo(51.5035,-0.1000),r:1100},{n:'pim',c:geo(51.4900,-0.1420),r:900}];
function district(x,z){let best=null,bd=1;for(const d of DIST){const q=Math.hypot(x-d.c.x,z-d.c.z)/d.r;if(q<bd){bd=q;best=d.n;}}return best||'res';}
const COL={brickY:[[0.56,0.47,0.33],[0.50,0.41,0.29],[0.60,0.50,0.36]],brickR:[[0.52,0.28,0.20],[0.46,0.25,0.18]],stone:[[0.72,0.68,0.59],[0.65,0.61,0.53],[0.69,0.66,0.59]],
  glass:[[0.24,0.29,0.35],[0.30,0.33,0.35],[0.33,0.30,0.26],[0.22,0.30,0.32]],resi:[[0.56,0.52,0.46],[0.44,0.32,0.25],[0.50,0.47,0.43],[0.38,0.36,0.34]],stucco:[[0.78,0.76,0.70],[0.74,0.72,0.66]]};
const pick=a=>a[(R()*a.length)|0];
function blockSpec(dn){
  const r=R();
  switch(dn){
    case 'city': return r<0.45?{st:2,col:pick(COL.glass),h:[28,70],dep:[18,28],seg:[26,55],tower:0.12}:{st:1,col:pick(COL.stone),h:[22,45],dep:[16,24],seg:[20,45],tower:0.04};
    case 'cw': return {st:2,col:pick(COL.glass),h:[40,90],dep:[22,34],seg:[35,70],tower:0.45};
    case 'ne': return r<0.5?{st:2,col:pick(COL.glass),h:[40,80],dep:[18,26],seg:[30,60],tower:0.35}:{st:3,col:pick(COL.resi),h:[22,45],dep:[14,20],seg:[25,50],tower:0.05};
    case 'west': case 'wmin': return r<0.55?{st:1,col:pick(COL.stone),h:[20,30],dep:[14,22],seg:[18,40]}:(r<0.8?{st:4,col:pick(COL.stucco),h:[16,24],dep:[12,16],seg:[20,40]}:{st:0,col:pick(COL.brickR),h:[14,22],dep:[12,16],seg:[18,36]});
    case 'pim': return r<0.7?{st:4,col:pick(COL.stucco),h:[14,19],dep:[12,15],seg:[25,50],pitch:0.2}:{st:3,col:pick(COL.resi),h:[18,30],dep:[14,18],seg:[25,50]};
    case 'sb': return r<0.4?{st:3,col:pick(COL.resi),h:[16,40],dep:[14,20],seg:[22,45],tower:0.05}:(r<0.7?{st:0,col:pick(COL.brickY),h:[12,20],dep:[12,16],seg:[20,40]}:{st:1,col:pick(COL.stone),h:[18,32],dep:[15,22],seg:[20,40]});
    default: return r<0.62?{st:0,col:pick(R()<0.7?COL.brickY:COL.brickR),h:[9,13],dep:[10,13],seg:[25,45],pitch:0.9}:(r<0.88?{st:3,col:pick(COL.resi),h:[14,28],dep:[12,18],seg:[22,45],tower:0.02}:{st:1,col:pick(COL.stone),h:[16,24],dep:[14,18],seg:[20,40]});
  }
}
function buildCity(){
  const BS=112;
  const tilesD=[];for(let tx=-12000;tx<6500;tx+=1500)for(let tz=-6500;tz<7500;tz+=1500)tilesD.push([tx,tz]);
  for(const [tx,tz] of tilesD){
    const ang=0.55*Math.sin(tx*0.00061+tz*0.00037+1.3)+0.25*Math.cos(tz*0.0009-tx*0.0004);
    const ca=Math.cos(ang),sa=Math.sin(ang);const ox=tx+R()*40,oz=tz+R()*40;
    for(let i=-2;i<16;i++)for(let j=-2;j<16;j++){
      const lx=i*BS,lz=j*BS;const cx=ox+lx*ca+lz*sa,cz=oz-lx*sa+lz*ca;
      if(cx<tx||cx>=tx+1500||cz<tz||cz>=tz+1500)continue;
      const m=maskAt(cx,cz);if(!(m&4))continue;
      const dn=district(cx,cz);const spec=blockSpec(dn);
      const near=isNear(cx,cz);
      const bw=BS-16-R()*12,bd=BS-16-R()*12;
      if(m&2||osmCovered(cx,cz)){continue;}
      if(spec.tower&&R()<spec.tower){const w=26+R()*22,d=26+R()*22;const h=spec.st===2?(dn==='cw'?110+R()*110:70+R()*90):40+R()*50;
        if(claim(cx,cz,w,d,ang,6))addB(cx,cz,w,d,h,ang,spec.col,spec.st);continue;}
      if(!near){ // coarse: two slabs
        const h=lerp(spec.h[0],spec.h[1],R());
        for(const s of [-1,1]){const px=cx+s*bd*0.27*sa,pz=cz+s*bd*0.27*ca;const w=bw,d=bd*0.42;if(claim(px,pz,w,d,ang,2))addB(px,pz,w,d,h*(0.85+R()*0.3),ang,spec.col,spec.st);}
        continue;}
      const bh=lerp(spec.h[0],spec.h[1],R());
      const sides=[[0,-1,bw,bd],[0,1,bw,bd],[-1,0,bd,bw],[1,0,bd,bw]];
      for(let si=0;si<4;si++){const [sxn,szn,len,other]=sides[si];const dep=lerp(spec.dep[0],spec.dep[1],R());
        const run=si<2?len:len-2*dep;let p=-run/2;
        while(p<run/2-4){let L=Math.min(lerp(spec.seg[0],spec.seg[1],R()),run/2-p);if(run/2-p-L<8)L=run/2-p;
          const mid=p+L/2;let lxx,lzz,w,d;
          if(si<2){lxx=mid;lzz=szn*(other/2-dep/2);w=L;d=dep;}else{lxx=sxn*(other/2-dep/2);lzz=mid;w=dep;d=L;}
          const px=cx+lxx*ca+lzz*sa,pz=cz-lxx*sa+lzz*ca;
          let h=bh*(0.82+R()*0.36);if(R()<0.08)h+=spec.st===0?3:8+R()*14;
          const col=spec.col.map(c=>c*(0.88+R()*0.24));
          if(claim(px,pz,w,d,ang,1.5)){
            const pitched=spec.pitch&&R()<spec.pitch;
            addB(px,pz,w,d,h,ang,col,spec.st);
            if(pitched){const rc=R()<0.7?[0.25,0.26,0.29]:[0.45,0.25,0.18];addRoof(px,pz,si<2?w:d,si<2?d:w,2.6+R()*1.6,ang+(si<2?0:Math.PI/2),LAND_Y+h,rc);if(R()<0.65){const L2=si<2?w:d;const o=(R()-0.5)*L2*0.6;const lx2=si<2?o:0,lz2=si<2?0:o;addB(px+lx2*ca+lz2*sa,pz-lx2*sa+lz2*ca,1.0,1.8,3.4,ang+(si<2?0:Math.PI/2),[0.5,0.33,0.25],5,LAND_Y+h+0.8);}}
            else if(spec.st!==0&&R()<0.35){const pw=Math.min(w,d)*0.4,pd=Math.min(w,d)*0.35;addB(px,pz,pw,pd,2.5+R()*2,ang,[0.5,0.5,0.5],5,LAND_Y+h);}
            if((spec.st===1||spec.st===2)&&h>26&&R()<0.45)addB(px,pz,w*0.78,d*0.7,3.5+R()*5,ang,col,spec.st,LAND_Y+h);
          }
          p+=L;}
      }
    }
  }
  const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),sv=new V3(),pv=new V3(),cc=new THREE.Color();
  let total=0;
  for(const t of tiles.values()){
    if(t.b.length){
      const g=bGeo.clone();const st=new Float32Array(t.b.length*2);
      t.b.forEach((b,i)=>{st[i*2]=b[10];st[i*2+1]=b[11];});
      g.setAttribute('aStyle',new THREE.InstancedBufferAttribute(st,2));
      g.boundingSphere=new THREE.Sphere(new V3(t.cx,t.maxH/2,t.cz),TILE*0.75+t.maxH);
      const im=new THREE.InstancedMesh(g,bMat,t.b.length);
      t.b.forEach((b,i)=>{q.setFromAxisAngle(UP,b[6]);pv.set(b[0],b[1],b[2]);sv.set(b[3],b[4],b[5]);m4.compose(pv,q,sv);im.setMatrixAt(i,m4);cc.setRGB(b[7],b[8],b[9]);im.setColorAt(i,cc);});
      im.castShadow=true;im.receiveShadow=true;scene.add(im);total+=t.b.length;
    }
    if(t.r.length){
      const g=roofGeo.clone();g.boundingSphere=new THREE.Sphere(new V3(t.cx,40,t.cz),TILE*0.75+60);
      const im=new THREE.InstancedMesh(g,roofMat,t.r.length);
      t.r.forEach((b,i)=>{q.setFromAxisAngle(UP,b[6]);pv.set(b[0],b[1],b[2]);sv.set(b[3],b[4],b[5]);m4.compose(pv,q,sv);im.setMatrixAt(i,m4);cc.setRGB(b[7]*(0.85+R()*0.3),b[8]*(0.85+R()*0.3),b[9]*(0.85+R()*0.3));im.setColorAt(i,cc);});
      im.castShadow=true;im.receiveShadow=true;scene.add(im);total+=t.r.length;
    }
  }
  return total;
}
// detailed zone = within 1400 m of the flight corridor
const zoneCanvas=document.createElement('canvas');zoneCanvas.width=zoneCanvas.height=512;
{const g=zoneCanvas.getContext('2d');const sc=512/MSZ;g.fillStyle='#000';g.fillRect(0,0,512,512);g.strokeStyle='#fff';g.lineCap='round';g.lineWidth=2*1400*sc;g.beginPath();
  RP.forEach((p,i)=>{const x=(p.x-MX0)*sc,z=(p.z-MZ0)*sc;i?g.lineTo(x,z):g.moveTo(x,z);});g.stroke();}
const zoneData=zoneCanvas.getContext('2d').getImageData(0,0,512,512).data;
function isNear(x,z){const u=Math.floor((x-MX0)/MSZ*512),v=Math.floor((z-MZ0)/MSZ*512);if(u<0||v<0||u>=512||v>=512)return false;return zoneData[(v*512+u)*4]>127;}

/* ---------- landmarks (real positions and dimensions) ---------- */
const M=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:0.8},o||{}));
const stoneTB=gothicMat(1,2,0xefe3c8);
const blueSteel=M(0x86b1d2,{roughness:0.55,metalness:0.35});
const slate=M(0x3b4046,{roughness:0.7,metalness:0.2});
const pierMat=M(0x7a6c58,{roughness:0.95});
const portland=M(0xd8d2c2,{roughness:0.85});
const cwTex=canvasTex(128,128,(g,w,h)=>{g.fillStyle='#e6e6e6';g.fillRect(0,0,w,h);for(let y=0;y<h;y+=32)for(let x=0;x<w;x+=32){const v=120+R()*70|0;g.fillStyle=`rgb(${v},${v},${v+6})`;g.fillRect(x+2,y+4,28,25);}g.fillStyle='#f2f2f2';for(let y=0;y<h;y+=32)g.fillRect(0,y,w,4);});
const glassM=(c,r,rx,ry)=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:r===undefined?0.1:r+0.04,metalness:0.8,envMapIntensity:1.25});m.map=rep(cwTex,rx||5,ry||14);m.roughnessMap=m.map;m.userData.cw=!(rx);return m;};
function add(geo,mat,x,y,z,parent,ry){const me=new THREE.Mesh(geo,mat);me.position.set(x,y,z);if(ry)me.rotation.y=ry;me.castShadow=true;me.receiveShadow=true;(parent||scene).add(me);return me;}
function grp(p,ry){const g=new THREE.Group();g.position.set(p.x,LAND_Y,p.z);g.rotation.y=ry||0;scene.add(g);return g;}
function lm(lat,lon,w,d,ry){const p=geo(lat,lon);reserve(p.x,p.z,w,d,ry||0);return p;}

const darkArch=M(0x1b1916,{roughness:0.9});
function archGeo(w,h,d){const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(-w/2,h-w*0.55);s.quadraticCurveTo(-w/2,h-w*0.08,0,h);s.quadraticCurveTo(w/2,h-w*0.08,w/2,h-w*0.55);s.lineTo(w/2,0);s.lineTo(-w/2,0);return new THREE.ExtrudeGeometry(s,{depth:d||0.4,bevelEnabled:false});}
const ogee=(r,h)=>new THREE.LatheGeometry([[0,0],[r*1.15,0],[r*1.2,h*0.1],[r*1.0,h*0.35],[r*0.55,h*0.6],[r*0.2,h*0.85],[0.05,h]].map(p=>new THREE.Vector2(p[0],p[1])),12);
function inst(geo,mat,mats,parent){const im=new THREE.InstancedMesh(geo,mat,mats.length);mats.forEach((m,i)=>im.setMatrixAt(i,m));im.castShadow=true;im.receiveShadow=true;(parent||scene).add(im);return im;}
const TM=(x,y,z,sx,sy,sz,rx,ry)=>{const m=new THREE.Matrix4();m.compose(new V3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx||0,ry||0,0)),new V3(sx||1,sy||1,sz||1));return m;};
const roadTex=canvasTex(64,256,(g2,w,h)=>{g2.fillStyle='#2a2a2c';g2.fillRect(0,0,w,h);for(let i=0;i<500;i++){g2.fillStyle=`rgba(255,255,255,${R()*0.05})`;g2.fillRect(R()*w,R()*h,1,1);}
  g2.fillStyle='#d8d4c6';g2.fillRect(31,0,2,90);g2.fillRect(31,128,2,90);g2.fillRect(3,0,1.5,h);g2.fillRect(w-4.5,0,1.5,h);});
function towerBridge(){
  const g=new THREE.Group();scene.add(g);alignToRiver(g,sTB);g.position.y=WATER_Y-1;
  const DECK=12,granite=M(0x9b9284,{roughness:0.9}),stoneW=gothicMat(1.2,2.4,0xefe3c8),stoneP=M(0xe8dcc0,{roughness:0.85}),gold=M(0xd6ad5c,{metalness:0.9,roughness:0.3}),white=M(0xeef2f4,{roughness:0.5,metalness:0.3});
  const road=new THREE.MeshStandardMaterial({map:rep(roadTex,1,30),roughness:0.85});
  add(new THREE.BoxGeometry(8.4,0.6,300),road,0,DECK-0.3,0,g);
  for(const x of [-5.4,5.4])add(new THREE.BoxGeometry(2.4,0.9,300),stoneP,x,DECK-0.15,0,g);
  add(new THREE.BoxGeometry(13.4,1.8,300),blueSteel,0,DECK-1.5,0,g);
  for(const x of [-6.8,6.8]){add(new THREE.BoxGeometry(0.45,1.5,300),blueSteel,x,DECK+0.45,0,g);add(new THREE.BoxGeometry(0.6,0.15,300),white,x,DECK+1.25,0,g);}
  const lamps=[];for(let z=-144;z<=144;z+=12)for(const x of [-6.4,6.4])if(Math.abs(Math.abs(z)-39.5)>10)lamps.push(TM(x,DECK+2.5,z,1,1,1));
  inst(new THREE.CylinderGeometry(0.09,0.12,5,6),M(0x2b3a44,{metalness:0.6}),lamps,g);
  const aG=archGeo(1.5,6,0.5),aRoad=archGeo(8.6,11,0.5);
  for(const s of [-1,1]){
    const zc=s*39.5;
    add(new THREE.BoxGeometry(26,12,30),granite,0,2,zc,g);const cw=add(new THREE.CylinderGeometry(15.2,15.2,12,4),granite,0,2,zc,g);cw.rotation.y=Math.PI/4;cw.scale.set(1.25,1,0.7);
    add(new THREE.BoxGeometry(19,10,19),granite,0,11,zc,g);
    add(new THREE.BoxGeometry(17,34,17),stoneW,0,33,zc,g);
    for(const y of [16,27,43,50])add(new THREE.BoxGeometry(18,0.8,18),stoneP,0,y,zc,g);
    add(new THREE.BoxGeometry(15,7,15),stoneW,0,53.5,zc,g);
    for(const f of [-1,1]){const ar=add(aRoad,darkArch,0,DECK,zc+f*9.55,g);if(f<0)ar.rotation.y=Math.PI;}
    for(const f of [-1,1])for(const lv of [19,33])for(const k of [-4,0,4]){const w=add(aG,darkArch,f*8.55,lv,zc+k,g);w.rotation.y=f*Math.PI/2;}
    for(const cx of [-8.2,8.2])for(const cz of [-8.2,8.2]){
      add(new THREE.CylinderGeometry(2.3,2.5,50,8),stoneW,cx,33,zc+cz,g);
      for(const y of [27,43,50])add(new THREE.CylinderGeometry(2.75,2.75,0.7,8),stoneP,cx,y,zc+cz,g);
      add(ogee(2.4,8),slate,cx,58,zc+cz,g);add(new THREE.CylinderGeometry(0.12,0.2,3,6),gold,cx,67.5,zc+cz,g);add(new THREE.SphereGeometry(0.35,8,6),gold,cx,69.2,zc+cz,g);}
    const roof=add(new THREE.ConeGeometry(11.2,13,4),slate,0,63.5,zc,g);roof.rotation.y=Math.PI/4;
    for(const [dx,dz,ry] of [[5.2,0,Math.PI/2],[-5.2,0,-Math.PI/2],[0,5.2,0],[0,-5.2,Math.PI]]){
      const dg=new THREE.Group();dg.position.set(dx,59,zc+dz);dg.rotation.y=ry;g.add(dg);
      add(new THREE.BoxGeometry(3,3.4,1.2),stoneW,0,1.7,0.6,dg);const dr=add(roofGeo,slate,0,3.4,0,dg);dr.scale.set(1.5,2.2,3.4);dr.rotation.y=Math.PI/2;dr.scale.set(3.4,2.2,3.4);
      add(new THREE.PlaneGeometry(1.2,1.8),darkArch,0,1.6,1.25,dg);}
    add(new THREE.CylinderGeometry(1.0,1.2,4,8),stoneP,0,71.5,zc,g);add(new THREE.ConeGeometry(1.3,8,8),slate,0,77.5,zc,g);add(new THREE.CylinderGeometry(0.1,0.18,3,6),gold,0,82.5,zc,g);
    // side-span chains (double chord lattice) + hangers
    for(const cx of [-6.8,6.8]){
      const up=new THREE.CatmullRomCurve3([new V3(cx,47,s*48.5),new V3(cx,30,s*70),new V3(cx,21,s*92),new V3(cx,26,s*114),new V3(cx,33,s*127)]);
      const lo=new THREE.CatmullRomCurve3(up.points.map(p=>new V3(p.x,p.y-2.2,p.z)));
      add(new THREE.TubeGeometry(up,48,0.55,6,false),blueSteel,0,0,0,g);add(new THREE.TubeGeometry(lo,48,0.45,6,false),blueSteel,0,0,0,g);
      const ms=[];for(let k=0;k<=24;k++){const a=up.getPoint(k/24),b=lo.getPoint(k/24);ms.push(TM(cx,(a.y+b.y)/2,a.z,0.25,a.y-b.y,0.25));
        if(k<24){const c=lo.getPoint((k+1)/24);const dz=c.z-a.z,dy=c.y-a.y;ms.push(TM(cx,(a.y+c.y)/2,(a.z+c.z)/2,0.18,0.18,Math.hypot(dz,dy),-Math.atan2(dy,dz)));}
        if(k%3===1){const hl=b.y-DECK;ms.push(TM(cx,DECK+hl/2,b.z,0.2,hl,0.2));}}
      inst(new THREE.BoxGeometry(1,1,1),blueSteel,ms,g);
    }
    // abutment towers
    add(new THREE.BoxGeometry(12,26,12),stoneW,0,19,s*132,g);add(aRoad,darkArch,0,DECK,s*132+(s>0?6.05:-6.05),g).rotation.y=s>0?0:Math.PI;
    for(const cx of [-5.6,5.6])for(const cz of [-5.6,5.6]){add(new THREE.CylinderGeometry(1.2,1.3,29,8),stoneW,cx,19.5,s*132+cz,g);add(ogee(1.3,4.5),slate,cx,34,s*132+cz,g);add(new THREE.CylinderGeometry(0.08,0.12,2,6),gold,cx,39.5,s*132+cz,g);}
    const ar2=add(new THREE.ConeGeometry(8,7,4),slate,0,35.5,s*132,g);ar2.rotation.y=Math.PI/4;
    // cantilever brackets under walkways
    for(const cx of [-5,5])add(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new V3(cx,37,s*30.5),new V3(cx,43.5,s*30.5),new V3(cx,43.8,s*24)),10,0.35,5,false),blueSteel,0,0,0,g);
  }
  // high-level walkways: lattice girders with glazed galleries
  for(const cx of [-5,5]){
    add(new THREE.BoxGeometry(3.2,0.8,62),blueSteel,cx,43.9,0,g);add(new THREE.BoxGeometry(3.2,0.8,62),blueSteel,cx,47.3,0,g);add(new THREE.BoxGeometry(3.6,0.35,62),white,cx,47.9,0,g);
    add(new THREE.BoxGeometry(2.9,2.6,61),glassM(0x2c3a44,0.1,1,1),cx,45.6,0,g);
    const ms=[];for(let k=0;k<=10;k++){const z=-31+k*6.2;for(const sx of [-1.55,1.55]){ms.push(TM(cx+sx,45.6,z,0.35,3.4,0.35));if(k<10)ms.push(TM(cx+sx,45.6,z+3.1,0.22,0.22,7.0,(k%2?1:-1)*Math.atan2(3.4,6.2)));}}
    inst(new THREE.BoxGeometry(1,1,1),blueSteel,ms,g);
  }
  return {g,DECK};
}
function parliament(){
  const ET=geo(51.5007,-0.1246),VT=geo(51.4981,-0.1253);const a=VT.clone().sub(ET).normalize();const e=new V3(a.z,0,-a.x);
  const g=new THREE.Group();g.position.set(ET.x,LAND_Y,ET.z);g.rotation.y=Math.atan2(a.x,a.z);scene.add(g);
  const Lz=ET.distanceTo(VT);reserve((ET.x+VT.x)/2-e.x*28,(ET.z+VT.z)/2-e.z*28,175,Lz+60,g.rotation.y);
  const facade=gothicMat(34,3,0xf2dcae),inner=gothicMat(20,3,0xe8d3a6),towerM=gothicMat(3,10,0xf2dcae),pavM=gothicMat(3,4,0xf2dcae),towerV=gothicMat(3,14,0xf0d9ab);
  const roofM=M(0x4a5157,{roughness:0.5,metalness:0.45}),stoneL=M(0xeed7a8,{roughness:0.85}),gold=M(0xd6ad5c,{roughness:0.3,metalness:0.9});
  const ridge=(x,z,len,w,h,y,alongZ)=>{const m=add(roofGeo,roofM,x,y,z,g);m.scale.set(len,h,w);if(alongZ)m.rotation.y=Math.PI/2;return m;};
  add(new THREE.BoxGeometry(30,26,Lz+30),facade,33,13,Lz/2+5,g);add(new THREE.BoxGeometry(31,1.2,Lz+30),stoneL,33,26.6,Lz/2+5,g);ridge(33,Lz/2+5,Lz+26,26,9,27.2,true);
  const pins=[],shafts=[],crest=[],spT=[],spB=[],chim=[];
  for(const pz of [-2,62,146,230,Lz+8]){add(new THREE.BoxGeometry(32,34,20),pavM,35,17,pz,g);const pr=add(new THREE.ConeGeometry(14,12,4),roofM,35,40,pz,g);pr.rotation.y=Math.PI/4;
    for(const dx of [-16,16])for(const dz of [-9.5,9.5]){shafts.push(TM(35+dx,19,pz+dz,1.0,38,1.0));pins.push(TM(35+dx,40.5,pz+dz,1.3,1.1,1.3));}
    spB.push(TM(35,48,pz,1,1,1));spT.push(TM(35,53,pz,1,1,1));}
  for(let z=-8;z<=Lz+18;z+=6.4)for(const x of [48.5,18.5]){pins.push(TM(x,30.5,z,1,1,1));if(x>40)shafts.push(TM(x+0.4,13.5,z,0.55,27,0.55));}
  for(let z=-6;z<Lz+16;z+=2.2)crest.push(TM(33,36.4,z,1,1,1));
  for(const x of [-8,-45]){add(new THREE.BoxGeometry(18,24,Lz-40),inner,x,12,Lz/2+10,g);ridge(x,Lz/2+10,Lz-44,17,7,24,true);}
  for(const z of [30,95,160,225]){add(new THREE.BoxGeometry(92,23,13),inner,-5,11.5,z,g);ridge(-5,z,90,12,6,23,false);}
  for(let i=0;i<18;i++){const x=R()<0.5?-8:-45,z=20+R()*(Lz-40);spB.push(TM(x,26.5,z,1,1,1));spT.push(TM(x,33,z,1,1,1));}
  for(let i=0;i<46;i++){const x=[-8,-45,-5][i%3],z=i%3===2?[30,95,160,225][i%4]+(R()-0.5)*6:20+R()*(Lz-40);chim.push(TM(x+(R()-0.5)*10,26+R(),z,1,1,1));}
  inst(new THREE.ConeGeometry(0.9,7,6),M(0xf0d8a8),pins,g);inst(new THREE.CylinderGeometry(1,1,1,6),stoneL,shafts,g);inst(new THREE.ConeGeometry(0.25,1.4,4),roofM,crest,g);
  inst(new THREE.CylinderGeometry(1.2,1.4,5,8),stoneL,spB,g);inst(new THREE.ConeGeometry(1.5,9,8),roofM,spT,g);inst(new THREE.BoxGeometry(1.3,4.5,2.6),M(0xd9c294),chim,g);
  // Central Tower
  add(new THREE.CylinderGeometry(9,9,22,8),towerM,-10,34,120,g);add(new THREE.ConeGeometry(9.2,40,8),roofM,-10,65,120,g);
  const cp=[];for(let k=0;k<8;k++){const an=k/8*Math.PI*2+Math.PI/8;cp.push(TM(-10+Math.cos(an)*9.6,49,120+Math.sin(an)*9.6,1,1,1));}inst(new THREE.ConeGeometry(0.8,8,6),stoneL,cp,g);
  add(new THREE.CylinderGeometry(0.12,0.2,4,6),gold,-10,87,120,g);
  // Westminster Hall
  add(new THREE.BoxGeometry(73,14,21),inner,-95,7,25,g);ridge(-95,25,73,22,14,14,false);add(new THREE.BoxGeometry(3,5,3),roofM,-95,30,25,g);
  // Victoria Tower
  add(new THREE.BoxGeometry(21,90,21),towerV,0,45,Lz,g);add(new THREE.BoxGeometry(22.4,3,22.4),stoneL,0,91.5,Lz,g);
  for(const y of [20,45,70])add(new THREE.BoxGeometry(21.6,1,21.6),stoneL,0,y,Lz,g);
  const vp=[];for(let k=-4;k<=4;k++)for(const [sx,sz] of [[1,0],[-1,0],[0,1],[0,-1]])vp.push(TM(sx?sx*11:k*2.4,95,Lz+(sz?sz*11:k*2.4),1,1,1));inst(new THREE.ConeGeometry(0.4,3.2,5),stoneL,vp,g);
  for(const cx of [-10.5,10.5])for(const cz of [-10.5,10.5]){add(new THREE.CylinderGeometry(2.4,2.4,96,8),towerV,cx,48,Lz+cz,g);add(ogee(2.4,9),roofM,cx,96,Lz+cz,g);add(new THREE.CylinderGeometry(0.1,0.18,4,6),gold,cx,107,Lz+cz,g);}
  add(archGeo(9,17,0.5),darkArch,0,0,Lz+10.55,g);
  add(new THREE.CylinderGeometry(0.22,0.3,18,6),M(0xe8e8e8),0,102,Lz,g);
  const flag=new THREE.Mesh(flagGeo(),flagMat());flag.position.set(0,105.5,Lz);flag.rotation.y=0.9;flag.castShadow=true;g.add(flag);
  // Elizabeth Tower
  add(new THREE.BoxGeometry(12,55,12),towerM,0,27.5,0,g);for(const cx of [-6.1,6.1])for(const cz of [-6.1,6.1])add(new THREE.BoxGeometry(1,55,1),stoneL,cx,27.5,cz,g);
  add(new THREE.BoxGeometry(13.6,12,13.6),stoneL,0,61,0,g);add(new THREE.BoxGeometry(11,8,11),M(0xd9c091,{roughness:0.8}),0,71,0,g);
  for(const cx of [-5.8,5.8])for(const cz of [-5.8,5.8]){add(new THREE.CylinderGeometry(0.45,0.5,8,6),stoneL,cx,71,cz,g);add(new THREE.ConeGeometry(0.7,5,6),gold,cx,77.5,cz,g);}
  const r1=add(new THREE.ConeGeometry(8,17,4),M(0x2d3035,{roughness:0.45,metalness:0.6}),0,83.5,0,g);r1.rotation.y=Math.PI/4;
  for(const y of [79,84,88])add(new THREE.CylinderGeometry(6.2*(1-(y-75)/17)+0.3,6.2*(1-(y-75)/17)+0.3,0.35,4),gold,0,y,0,g).rotation.y=Math.PI/4;
  add(new THREE.BoxGeometry(2.6,3,2.6),gold,0,92.5,0,g);add(new THREE.ConeGeometry(0.9,6,6),gold,0,97,0,g);
  const face=M(0xf3e6c7,{emissive:new THREE.Color(1.0,0.86,0.58),emissiveIntensity:1.2,roughness:0.5});const hand=new THREE.MeshBasicMaterial({color:0x111111});
  for(const [dx,dz] of [[0,1],[0,-1],[1,0],[-1,0]]){const fg=new THREE.Group();fg.position.set(dx*6.82,61,dz*6.82);fg.rotation.y=Math.atan2(dx,dz);g.add(fg);
    fg.add(new THREE.Mesh(new THREE.PlaneGeometry(8.6,8.6),gold));const f1=new THREE.Mesh(new THREE.CircleGeometry(3.5,40),face);f1.position.z=0.03;fg.add(f1);
    const rg=new THREE.Mesh(new THREE.RingGeometry(3.3,3.55,40),hand);rg.position.z=0.05;fg.add(rg);
    const hg=new THREE.PlaneGeometry(0.25,2.0);hg.translate(0,0.9,0);const hh=new THREE.Mesh(hg,hand);hh.position.z=0.07;hh.rotation.z=-(6.9/12)*Math.PI*2;fg.add(hh);
    const mg=new THREE.PlaneGeometry(0.18,2.9);mg.translate(0,1.35,0);const mh=new THREE.Mesh(mg,hand);mh.position.z=0.08;mh.rotation.z=-(55/60)*Math.PI*2;fg.add(mh);
    for(const k of [-3,0,3]){const b=add(archGeo(1.8,5.5,0.3),darkArch,k,6.5,0.02,fg);}}
  // Portcullis House
  {const pp=lm(51.5013,-0.1250,60,60,g.rotation.y);const pg=grp(pp,g.rotation.y);add(new THREE.BoxGeometry(58,26,58),M(0x6d6558,{roughness:0.8}),0,13,0,pg);
   const ch=[];for(let k=0;k<7;k++)for(const s of [-1,1])ch.push(TM(-24+k*8,30,s*27,1,1,1));inst(new THREE.CylinderGeometry(1.2,1.2,10,10),M(0x5a4a38,{metalness:0.6,roughness:0.4}),ch,pg);}
  // Westminster Abbey
  const ab=lm(51.4994,-0.1273,170,80,0.05);const ag=grp(ab,0.05);const abM=gothicMat(10,2,0xe2d4b6);
  add(new THREE.BoxGeometry(155,32,26),abM,0,16,0,ag);const ar=add(roofGeo,roofM,0,32,0,ag);ar.scale.set(155,9,26);
  add(new THREE.BoxGeometry(24,30,70),abM,20,15,0,ag);
  for(const z of [-10,10]){add(new THREE.BoxGeometry(14,62,14),gothicMat(2,6,0xe2d4b6),-72,31,z,ag);const pz=[];for(const cx of [-6,6])for(const cz of [-6,6])pz.push(TM(-72+cx,66,z+cz,1,1,1));inst(new THREE.ConeGeometry(0.9,8,6),stoneL,pz,ag);}
  return{ET:new V3(ET.x,85,ET.z),VT};
}
const FLAG_T={value:0};
function flagGeo(){const ge=new THREE.PlaneGeometry(9,4.5,24,8);ge.translate(4.5,0,0);return ge;}
function flagMat(){
  const tex=canvasTex(240,120,(g2,w,h)=>{g2.fillStyle='#012169';g2.fillRect(0,0,w,h);g2.lineCap='butt';
    g2.strokeStyle='#fff';g2.lineWidth=24;g2.beginPath();g2.moveTo(0,0);g2.lineTo(w,h);g2.moveTo(w,0);g2.lineTo(0,h);g2.stroke();
    g2.strokeStyle='#C8102E';g2.lineWidth=8;g2.beginPath();g2.moveTo(0,0);g2.lineTo(w,h);g2.moveTo(w,0);g2.lineTo(0,h);g2.stroke();
    g2.fillStyle='#fff';g2.fillRect(w/2-20,0,40,h);g2.fillRect(0,h/2-20,w,40);g2.fillStyle='#C8102E';g2.fillRect(w/2-12,0,24,h);g2.fillRect(0,h/2-12,w,24);});
  tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
  const m=new THREE.MeshStandardMaterial({map:tex,side:THREE.DoubleSide,roughness:0.9});
  m.onBeforeCompile=(sh)=>{sh.uniforms.uT=FLAG_T;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uT;').replace('#include <begin_vertex>',
    '#include <begin_vertex>\nfloat k=transformed.x/9.0;transformed.z+=sin(transformed.x*0.9-uT*7.0)*0.45*k+sin(transformed.y*1.3+transformed.x*0.5-uT*5.0)*0.15*k;transformed.y-=k*k*0.5;');};
  return m;
}
function shard(){
  const p=lm(51.5045,-0.0865,72,72,0);const g=grp(p,0.35);
  const sm=glassM(0x9fb0c2,0.05,4,70);sm.side=THREE.DoubleSide;
  const H0=318,Hs=[306,286,299,278,302,283,296,290],R0=[34,31,35,30,34,31,35,30];const pos=[],uv=[];
  for(let k=0;k<8;k++){const a0=k*Math.PI/4+0.3,a1=(k+1)*Math.PI/4+0.3,r0=R0[k],r1=R0[(k+1)%8];const f=Hs[k]/H0;
    const b0=[Math.cos(a0)*r0,Math.sin(a0)*r0],b1=[Math.cos(a1)*r1,Math.sin(a1)*r1];const mx=(b0[0]+b1[0])/2,mz=(b0[1]+b1[1])/2,ml=Math.hypot(mx,mz);const o=(k%2)*0.9;const ox=mx/ml*o,oz=mz/ml*o;
    const P=[[b0[0]+ox,0,b0[1]+oz],[b1[0]+ox,0,b1[1]+oz],[b1[0]*(1-f)+ox,Hs[k],b1[1]*(1-f)+oz],[b0[0]*(1-f)+ox,Hs[k],b0[1]*(1-f)+oz]];const U=[[0,0],[1,0],[1,f],[0,f]];
    const v1=new V3(...P[1]).sub(new V3(...P[0])),v2=new V3(...P[2]).sub(new V3(...P[0]));const n=v1.cross(v2);const ord=(n.x*mx+n.z*mz)>0?[0,1,2,0,2,3]:[0,2,1,0,3,2];
    for(const i of ord){pos.push(...P[i]);uv.push(...U[i]);}}
  const ge=new THREE.BufferGeometry();ge.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));ge.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));ge.computeVertexNormals();
  add(ge,sm,0,0,0,g);
  const core=add(new THREE.CylinderGeometry(2.5,30,268,8),M(0x252b31,{roughness:0.4,metalness:0.6}),0,134,0,g);core.rotation.y=0.3;
  const lp=[];for(let k=0;k<8;k++){const an=k*Math.PI/4+0.3+Math.PI/8;for(const [y0,y1] of [[236,306]]){const ra=34*(1-y0/H0),rb=34*(1-y1/H0);lp.push(new V3(Math.cos(an)*ra,y0,Math.sin(an)*ra),new V3(Math.cos(an)*rb,y1,Math.sin(an)*rb));}}
  for(let y=240;y<304;y+=9){const r=33*(1-y/H0);for(let k=0;k<8;k++){const a0=k*Math.PI/4,a1=a0+Math.PI/4;lp.push(new V3(Math.cos(a0)*r,y,Math.sin(a0)*r),new V3(Math.cos(a1)*r,y,Math.sin(a1)*r));}}
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lp),new THREE.LineBasicMaterial({color:0x8d979f})));
  add(new THREE.BoxGeometry(80,20,50),M(0x8a8f96,{metalness:0.5,roughness:0.4}),-45,10,20,g);
  add(new THREE.BoxGeometry(56,70,36),glassM(0x9aa6b0,0.08,4,5),58,35,-40,g);
}
/* ---------- traffic + river boats ---------- */
function mergeGeos(list){const pos=[],nrm=[],uvs=[];for(const ge0 of list){const ge=ge0.index?ge0.toNonIndexed():ge0;pos.push(...ge.attributes.position.array);nrm.push(...ge.attributes.normal.array);uvs.push(...(ge.attributes.uv?ge.attributes.uv.array:new Float32Array(ge.attributes.position.count*2)));}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));return g;}
const wheelGeo=(w,l,r)=>mergeGeos([[-1,-1],[-1,1],[1,-1],[1,1]].map(([sx,sz])=>new THREE.CylinderGeometry(r,r,0.3,10).rotateZ(Math.PI/2).translate(sx*(w/2-0.1),r,sz*(l/2-r*1.6))));
const busTex=canvasTex(256,128,(g2,w,h)=>{g2.fillStyle='#c8102e';g2.fillRect(0,0,w,h);g2.fillStyle='#161a1e';g2.fillRect(6,10,244,34);g2.fillRect(6,62,244,34);
  g2.fillStyle='#c8102e';for(let x=40;x<w;x+=36){g2.fillRect(x,10,4,34);g2.fillRect(x,62,4,34);}g2.fillStyle='#e8e2d0';g2.fillRect(0,52,w,4);g2.fillStyle='#111';g2.fillRect(0,116,w,12);});
const cabTex=canvasTex(128,64,(g2,w,h)=>{g2.fillStyle='#101214';g2.fillRect(0,0,w,h);g2.fillStyle='#30363c';g2.fillRect(10,6,108,20);g2.fillStyle='#101214';g2.fillRect(60,6,4,20);});
const TRAFFIC=[];
function vehicle(type){const g=new THREE.Group();let w,h,l;
  const glass=M(0x0b1016,{roughness:0.04,metalness:0.9});
  const prof=(len,hh,r,y0)=>{const sh=new THREE.Shape();sh.moveTo(-len/2,y0);sh.lineTo(len/2,y0);sh.lineTo(len/2,hh-r);sh.quadraticCurveTo(len/2,hh,len/2-r,hh);sh.lineTo(-len/2+r,hh);sh.quadraticCurveTo(-len/2,hh,-len/2,hh-r);sh.closePath();return sh;};
  const body=(sh,wd,mat)=>{const ge=new THREE.ExtrudeGeometry(sh,{depth:wd,bevelEnabled:true,bevelThickness:0.06,bevelSize:0.06,bevelSegments:2,curveSegments:6});ge.translate(0,0,-wd/2);ge.rotateY(-Math.PI/2);const m=new THREE.Mesh(ge,mat);m.castShadow=true;g.add(m);return m;};
  const box=(bw,bh,bl,x,y,z,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bl),mat);m.position.set(x,y,z);g.add(m);return m;};
  if(type==='bus'){w=2.52;h=4.38;l=11.2;const red=M(0xb3101a,{roughness:0.32,metalness:0.2});body(prof(l,h,0.55,0.38),w,red);
    box(w+0.03,1.05,l-1.2,0,h-1.22,-0.1,glass);box(w+0.03,1.1,l-3.6,0,1.95,-0.9,glass);box(w-0.25,1.0,0.05,0,h-1.22,l/2+0.08,glass);box(w-0.25,1.5,0.05,0,1.75,l/2+0.08,glass);
    const st=box(0.05,2.2,1.6,-(w/2+0.02),2.6,l/2-1.6,glass);st.rotation.x=-0.5;
    box(w+0.04,0.4,l-0.2,0,0.55,0,M(0x151515,{roughness:0.8}));box(1.5,0.3,0.05,0,2.78,l/2+0.09,new THREE.MeshBasicMaterial({color:new THREE.Color(2.2,1.3,0.2)}));
    for(const sx of [-0.9,0.9])box(0.3,0.15,0.05,sx,0.95,l/2+0.09,new THREE.MeshBasicMaterial({color:new THREE.Color(3,3,2.6)}));}
  else if(type==='cab'){w=1.85;h=1.85;l=4.58;const blk=M(0x0c0d0f,{roughness:0.18,metalness:0.7});body(prof(l,1.0,0.25,0.3),w,blk);body(prof(l*0.62,h,0.35,0.9),w*0.94,blk).position.z=-0.25;
    box(w*0.95,0.5,l*0.58,0,1.5,-0.25,glass);box(0.6,0.16,0.3,0,h+0.08,0.4,new THREE.MeshBasicMaterial({color:new THREE.Color(2.4,1.6,0.3)}));}
  else if(type==='van'){w=2.0;h=2.4;l=5.6;const wv=M(0xe9e9e6,{roughness:0.35,metalness:0.3});body(prof(l,h,0.35,0.3),w,wv);box(w-0.1,0.7,0.05,0,1.7,l/2+0.07,glass);box(w+0.02,0.6,1.2,0,1.75,l/2-0.6,glass);}
  else{w=1.82;h=1.45;l=4.5;const c=M(pick([0x9ba3aa,0x20262c,0x5c6770,0xd6d6d2,0x2d4a6b,0x6b1d1d,0x3d4a3a]),{roughness:0.22,metalness:0.75});body(prof(l,0.95,0.3,0.3),w,c);body(prof(l*0.55,h,0.35,0.85),w*0.9,c).position.z=-0.2;box(w*0.92,0.42,l*0.5,0,1.15,-0.2,glass);}
  const wr=type==='bus'?0.5:0.34;g.add(new THREE.Mesh(wheelGeo(w,l,wr),M(0x111111,{roughness:0.9})));return{g,l};}

function addTraffic(parent,lanes,y,z0,z1,per){for(const [x,dir] of lanes){let z=R()*20;for(let i=0;i<per;i++){const type=R()<0.28?'bus':(R()<0.4?'cab':(R()<0.15?'van':'car'));const v=vehicle(type);parent.add(v.g);
  TRAFFIC.push({g:v.g,x,dir,y,z0,len:z1-z0,off:z,spd:7+R()*4});z+=v.l+8+R()*30;}}}
function updateTraffic(t){for(const v of TRAFFIC){let u=((v.off+v.spd*t)%v.len+v.len)%v.len;const z=v.dir>0?v.z0+u:v.z0+v.len-u;v.g.position.set(v.x,v.y,z);v.g.rotation.y=v.dir>0?0:Math.PI;}}
const BOATS=[];
function addBoat(s0,v,side,big){const g=new THREE.Group();const L=big?38:24;
  add(new THREE.BoxGeometry(L,2.4,big?8:6),M(0xf0f0ec,{roughness:0.5}),0,1.2,0,g);add(new THREE.BoxGeometry(L*0.62,2.4,big?7:5),glassM(0x1f2830,0.1,4,1),-L*0.05,3.6,0,g);
  add(new THREE.BoxGeometry(L*0.62,0.3,big?7.4:5.4),M(0x1d4e89,{roughness:0.5}),-L*0.05,4.9,0,g);scene.add(g);BOATS.push({g,s0,v,side});}
function updateBoats(t){for(const b of BOATS){const s=b.s0+b.v*t;const f=riverFrame(s);b.g.position.copy(f.p).addScaledVector(f.n,b.side);b.g.position.y=WATER_Y+0.2;b.g.rotation.y=Math.atan2(f.t.z,-f.t.x)+(b.v>0?0:Math.PI);}}

/* ---------- real London: OpenStreetMap buildings (footprints, heights, roof shapes) ---------- */
const OSMCOV=new Map();const covKey=(x,z)=>Math.floor(x/200)+'_'+Math.floor(z/200);
function osmCovered(x,z){return (OSMCOV.get(covKey(x,z))||0)>=5;}
const osmMat=bMat.clone();osmMat.flatShading=true;osmMat.envMapIntensity=0.8;
osmMat.onBeforeCompile=(sh)=>{bMat.onBeforeCompile(sh);
  sh.vertexShader=sh.vertexShader.replace('attribute vec2 aStyle;varying vec2 vStyle;','attribute vec2 aStyle;attribute vec2 aFac;attribute vec2 aExt;varying vec2 vStyle;varying vec2 vFac;varying vec2 vExt;').replace('vStyle=aStyle;','vStyle=aStyle;vFac=aFac;vExt=aExt;');
  sh.fragmentShader=sh.fragmentShader.replace('varying vec2 vStyle;','varying vec2 vStyle;varying vec2 vFac;varying vec2 vExt;')
   .replace(/float st=floor\(vStyle\.x\+0\.5\),seed=vStyle\.y;[\s\S]*?float H=vSc\.y;/,`float st=floor(vStyle.x+0.5),seed=vStyle.y;vec3 wn=normalize(cross(dFdx(vWP),dFdy(vWP)));float roofM=step(0.3,abs(wn.y));
    float W=1000.0;float u=vFac.x;float hh=vFac.y;float H=vExt.x;
    {float ci=vExt.y;vec3 oc=vec3(floor(ci/65536.0),mod(floor(ci/256.0),256.0),mod(ci,256.0))/255.0;oc=pow(oc,vec3(2.2));float gl=dot(oc,vec3(0.3,0.59,0.11));diffuseColor.rgb=mix(vec3(gl),oc,0.6);}`);};
osmMat.customProgramCacheKey=()=>'osm';
const srgbInt=(c)=>(Math.round(Math.pow(c[0],1/2.2)*255)<<16)|(Math.round(Math.pow(c[1],1/2.2)*255)<<8)|Math.round(Math.pow(c[2],1/2.2)*255);
function buildOSM(){
  const D=window.__OSM;if(!D)return 0;const byTile=new Map();let n=0;
  for(const r of D){const p=r[0];let m=p.length>>1;if(m>=2&&p[0]===p[2*m-2]&&p[1]===p[2*m-1])m--;if(m<3)continue;
    let cx=0,cz=0,A=0;for(let i=0;i<m;i++){cx+=p[2*i];cz+=p[2*i+1];const j=(i+1)%m;A+=p[2*i]*p[2*j+1]-p[2*j]*p[2*i+1];}cx/=m*10;cz/=m*10;
    if(!isLand(cx,cz)||Math.hypot(cx,cz)<185)continue;const oi=occIdx(cx,cz);if(oi>=0&&occ[oi])continue;
    const k=covKey(cx,cz);OSMCOV.set(k,(OSMCOV.get(k)||0)+1);
    const tk=Math.floor(cx/TILE)+'_'+Math.floor(cz/TILE);if(!byTile.has(tk))byTile.set(tk,[]);byTile.get(tk).push([r,m,cx,cz,A>0]);n++;}
  for(const arr of byTile.values())for(const [r] of arr){const p=r[0];for(let i=0;i<p.length;i+=2){const oi=occIdx(p[i]/10,p[i+1]/10);if(oi>=0)occ[oi]=1;}}
  const dn=(x,z)=>district(x,z);
  for(const [tk,arr] of byTile){
    const pos=[],fac=[],sty=[],ext=[],idx=[];let maxH=0;const [ta,tb]=tk.split('_').map(Number);
    for(const [r,m,cx,cz,flip] of arr){const p=r[0];const h=r[1]/10,b=r[2]/10,rs=r[3],rh=r[4]/10;let col=r[5];
      const Hw=Math.max(b+1,rs&&rs!==4&&rs!==7?h-rh:h);maxH=Math.max(maxH,h);
      const d=dn(cx,cz);let st;
      if(h>=60)st=R()<0.7?2:1;else if(h>=30)st=R()<0.45?1:(R()<0.6?2:3);else if(h>=16)st=(d==='west'||d==='wmin'||d==='city')?(R()<0.7?1:4):(d==='pim'?4:(R()<0.5?3:1));else st=(rs===1||rs===2||R()<0.55)?0:(d==='pim'?4:3);
      if(col<0){const pal=st===0?(R()<0.7?COL.brickY:COL.brickR):st===1?COL.stone:st===2?COL.glass:st===4?COL.stucco:COL.resi;col=srgbInt(pick(pal).map(c=>c*(0.88+R()*0.24)));}
      const seed=R()*97,v0=pos.length/3;let u=0;
      for(let i=0;i<=m;i++){const q=i%m;const x=p[2*q]/10,z=p[2*q+1]/10;if(i>0){const pq=(i-1)%m;u+=Math.hypot(x-p[2*pq]/10,z-p[2*pq+1]/10);}
        pos.push(x,LAND_Y+b,z,x,LAND_Y+Hw,z);fac.push(u,b,u,Hw);sty.push(st,seed,st,seed);ext.push(Hw,col,Hw,col);}
      for(let i=0;i<m;i++){const b0=v0+i*2,t0=b0+1,b1=b0+2,t1=b0+3;if(flip)idx.push(b0,t1,b1,b0,t0,t1);else idx.push(b0,b1,t1,b0,t1,t0);}
      const tops=[];for(let i=0;i<m;i++)tops.push(v0+i*2+1);
      const up=(a,b2,c)=>{const ax=pos[a*3],az=pos[a*3+2],bx=pos[b2*3]-ax,bz=pos[b2*3+2]-az,cxx=pos[c*3]-ax,czz=pos[c*3+2]-az;return (bz*cxx-bx*czz)>0;};
      const tri=(a,b2,c)=>{if(up(a,b2,c))idx.push(a,b2,c);else idx.push(a,c,b2);};
      if(rs&&rs!==4&&rs!==7&&rh>0){
        if(rs===5||rs===6){let prev=tops;for(const [f,hy] of [[0.72,0.55],[0.38,0.88]]){const ring=[];for(let i=0;i<m;i++){const x=cx+(p[2*i]/10-cx)*f,z=cz+(p[2*i+1]/10-cz)*f;ring.push(pos.length/3);pos.push(x,LAND_Y+Hw+rh*hy,z);fac.push(0,Hw+rh*hy);sty.push(st,seed);ext.push(Hw,col);}
            for(let i=0;i<m;i++){const j=(i+1)%m;tri(prev[i],prev[j],ring[j]);tri(prev[i],ring[j],ring[i]);}prev=ring;}
          const ap=pos.length/3;pos.push(cx,LAND_Y+h,cz);fac.push(0,h);sty.push(st,seed);ext.push(Hw,col);for(let i=0;i<m;i++)tri(prev[i],prev[(i+1)%m],ap);}
        else{const ap=pos.length/3;pos.push(cx,LAND_Y+h,cz);fac.push(0,h);sty.push(st,seed);ext.push(Hw,col);for(let i=0;i<m;i++)tri(tops[i],tops[(i+1)%m],ap);}
      }else{const cont=[];for(let i=0;i<m;i++)cont.push(new THREE.Vector2(p[2*i],p[2*i+1]));let faces=[];try{faces=THREE.ShapeUtils.triangulateShape(cont,[]);}catch(e){}
        for(const f of faces)tri(tops[f[0]],tops[f[1]],tops[f[2]]);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aFac',new THREE.Float32BufferAttribute(fac,2));
    g.setAttribute('aStyle',new THREE.Float32BufferAttribute(sty,2));g.setAttribute('aExt',new THREE.Float32BufferAttribute(ext,2));
    g.setIndex(pos.length/3>65535?new THREE.Uint32BufferAttribute(idx,1):new THREE.Uint16BufferAttribute(idx,1));
    g.boundingSphere=new THREE.Sphere(new V3((ta+0.5)*TILE,maxH/2,(tb+0.5)*TILE),TILE*0.75+maxH);
    const me=new THREE.Mesh(g,osmMat);me.castShadow=true;me.receiveShadow=true;me.matrixAutoUpdate=false;scene.add(me);
  }
  return n;
}
/* ---------- bridges, each in its real design ---------- */
function riverBridge(lat,lon,kind,col,spans){
  const p=geo(lat,lon);const s=nearestS(p.x,p.z);const g=new THREE.Group();scene.add(g);alignToRiver(g,s);
  const L=2*HW+60,DK=LAND_Y+8.8,mat=M(col||0x999999,{roughness:0.55,metalness:0.35}),stone=M(0xcfc6b4,{roughness:0.85}),lampM=M(0x1c2622,{metalness:0.6,roughness:0.45});
  const posts=[],lamps=[];
  if(kind==='foot'){const st=M(0xc9ced2,{metalness:0.85,roughness:0.28});
    add(new THREE.BoxGeometry(4,0.7,L),M(0xa2a8ac,{metalness:0.6,roughness:0.4}),0,LAND_Y+4.3,0,g);
    for(const z of [-72,72]){add(new THREE.BoxGeometry(3,LAND_Y+4,6),pierMat,0,(LAND_Y+4)/2-1,z,g);for(const sx of [-1,1]){const a=add(new THREE.BoxGeometry(0.5,0.5,9),st,sx*4.5,LAND_Y+4.6,z,g);a.rotation.y=Math.PI/2;const y1=add(new THREE.BoxGeometry(0.45,4.5,0.45),st,sx*2.2,LAND_Y+2.8,z,g);y1.rotation.z=-sx*0.55;}}
    for(const sx of [-4.4,-4.0,4.0,4.4]){const c=new THREE.CatmullRomCurve3([new V3(sx,LAND_Y+5.8,-L/2),new V3(sx,LAND_Y+5.0,-72),new V3(sx,LAND_Y+4.0,0),new V3(sx,LAND_Y+5.0,72),new V3(sx,LAND_Y+5.8,L/2)]);add(new THREE.TubeGeometry(c,50,0.13,5,false),st,0,0,0,g);}
    for(let z=-L/2;z<L/2;z+=5)for(const sx of [-4.2,4.2])posts.push(TM(sx,LAND_Y+4.9,z,0.08,1.1,0.08));inst(new THREE.BoxGeometry(1,1,1),st,posts,g);return;}
  if(kind==='susp'){const w=16;add(new THREE.BoxGeometry(w,1.8,L),mat,0,DK-1.2,0,g);add(new THREE.BoxGeometry(w-4,0.3,L),new THREE.MeshStandardMaterial({map:rep(roadTex,2,L/20),roughness:0.85}),0,DK-0.15,0,g);
    for(const z of [-55,55]){add(new THREE.BoxGeometry(w-2,DK,7),pierMat,0,DK/2-2,z,g);for(const x of [-8.5,8.5]){add(new THREE.BoxGeometry(2.2,26,2.2),mat,x,DK+12,z,g);add(new THREE.ConeGeometry(1.4,3,4),M(0xd9b35a,{metalness:0.8,roughness:0.3}),x,DK+26.5,z,g);}add(new THREE.BoxGeometry(w+1,1.4,1.8),mat,0,DK+22,z,g);}
    for(const x of [-8.5,8.5]){const c=new THREE.CatmullRomCurve3([new V3(x,DK+2,-L/2),new V3(x,DK+24,-55),new V3(x,DK+3,0),new V3(x,DK+24,55),new V3(x,DK+2,L/2)]);add(new THREE.TubeGeometry(c,60,0.45,6,false),mat,0,0,0,g);
      for(let z=-50;z<=50;z+=4){const pt=c.getPoint((z+L/2)/L);posts.push(TM(x,(pt.y+DK)/2,z,0.08,pt.y-DK,0.08));}}
    inst(new THREE.BoxGeometry(1,1,1),mat,posts,g);addTraffic(g,[[-2.2,1],[2.2,-1]],DK,-L/2,L/2,2);return;}
  const rail=kind==='rail',w=rail?14:24,n=spans||5;BRG.push({lat,lon,kind,g,DK,w,L});
  add(new THREE.BoxGeometry(w,1.6,L),mat,0,DK-1.4,0,g);
  if(!rail){add(new THREE.BoxGeometry(w-6,0.3,L),new THREE.MeshStandardMaterial({map:rep(roadTex,3,L/20),roughness:0.85}),0,DK-0.45,0,g);for(const x of [-(w/2-1.5),w/2-1.5])add(new THREE.BoxGeometry(3,0.5,L),stone,x,DK-0.35,0,g);}
  else{for(const x of [-3.5,-1.2,1.2,3.5])add(new THREE.BoxGeometry(0.15,0.2,L),M(0x777a7c,{metalness:0.9,roughness:0.3}),x,DK-0.5,0,g);}
  // parapet: balusters for masonry/iron, solid band for concrete
  for(const x of [-(w/2-0.3),w/2-0.3]){add(new THREE.BoxGeometry(0.5,0.25,L),kind==='flat'?stone:mat,x,DK+1.0,0,g);
    if(kind==='flat')add(new THREE.BoxGeometry(0.5,1.1,L),stone,x,DK+0.4,0,g);else for(let z=-L/2;z<L/2;z+=1.1)posts.push(TM(x,DK+0.4,z,0.22,1.1,0.22));}
  for(let z=-L/2+10;z<L/2;z+=kind==='arch'?16:22)for(const x of [-(w/2-0.3),w/2-0.3])lamps.push(TM(x,DK+3.2,z,1,1,1));
  // piers with cutwaters
  const zs=[];for(let k=0;k<=n;k++)zs.push(-L/2+k*L/n);
  for(let k=1;k<n;k++){add(new THREE.BoxGeometry(w-2,DK,6.5),kind==='flat'?stone:pierMat,0,DK/2-2.2,zs[k],g);
    for(const sx of [-1,1]){const cw=add(new THREE.CylinderGeometry(4.6,4.6,DK-1,4),kind==='flat'?stone:pierMat,sx*(w/2-1),(DK-1)/2-1.5,zs[k],g);cw.rotation.y=Math.PI/4;cw.scale.set(1,1,0.72);}}
  // arch ribs + spandrel posts
  if(kind==='arch'||kind==='bfr'||kind==='flat'){const ribX=kind==='flat'?[0]:[-(w/2-1.2),-(w/6),w/6,w/2-1.2];const ribR=kind==='flat'?0:0.55;
    for(let k=0;k<n;k++){const z0=zs[k]+3.2,z1=zs[k+1]-3.2,base=WATER_Y+1.5,crown=DK-2.2;
      const pts=[];for(let i=0;i<=16;i++){const u=i/16;pts.push([lerp(z0,z1,u),base+(crown-base)*(1-Math.pow(2*u-1,2))]);}
      if(kind==='flat'){const sh=new THREE.Shape();sh.moveTo(z0,DK-2.2);pts.forEach(q=>sh.lineTo(q[0],q[1]));sh.lineTo(z1,DK-2.2);sh.closePath();
        const ge=new THREE.ExtrudeGeometry(sh,{depth:w-1,bevelEnabled:false});ge.rotateY(Math.PI/2);ge.translate(-(w-1)/2,0,0);
        const hole=new THREE.Shape();hole.moveTo(z0,base);pts.forEach(q=>hole.lineTo(q[0],q[1]));hole.lineTo(z1,base);
        const sp=new THREE.Shape();sp.moveTo(z0,DK-2.2);sp.lineTo(z0,base);pts.forEach(q=>sp.lineTo(q[0],q[1]));sp.lineTo(z1,DK-2.2);sp.closePath();
        for(const sx of [-1,1]){const sg=new THREE.ShapeGeometry(sp);sg.rotateY(sx*Math.PI/2);const mm=add(sg,stone,sx*(w/2-0.6),0,0,g);}
        continue;}
      for(const x of ribX){const c=new THREE.CatmullRomCurve3(pts.map(q=>new V3(x,q[1],q[0])));add(new THREE.TubeGeometry(c,24,ribR*(Math.abs(x)>w/4?1.2:0.9),6,false),mat,0,0,0,g);
        if(Math.abs(x)>w/4)for(let i=1;i<16;i+=1){const q=pts[i];const hl=DK-2.2-q[1];if(hl>0.6)posts.push(TM(x,q[1]+hl/2,q[0],0.18,hl,0.18));}}
      const band=add(new THREE.BoxGeometry(0.4,1.4,z1-z0),mat,-(w/2-0.1),DK-1.6,(z0+z1)/2,g);add(new THREE.BoxGeometry(0.4,1.4,z1-z0),mat,w/2-0.1,DK-1.6,(z0+z1)/2,g);}
  }
  if(posts.length)inst(new THREE.BoxGeometry(1,1,1),kind==='flat'?stone:mat,posts,g);
  if(lamps.length){inst(new THREE.CylinderGeometry(0.1,0.16,5.5,6),lampM,lamps,g);const lh=lamps.map(m=>{const e=m.clone();e.multiply(new THREE.Matrix4().makeTranslation(0,3.0,0));return e;});inst(new THREE.BoxGeometry(0.55,0.8,0.55),M(0xf2e2c0,{emissive:new THREE.Color(0.6,0.45,0.2),emissiveIntensity:0.6}),lh,g);}
  if(rail){const tr=[];for(const x of [-w/2+0.3,w/2-0.3]){add(new THREE.BoxGeometry(0.5,0.6,L),mat,x,DK+5.6,0,g);for(let z=-L/2;z<L/2;z+=6){tr.push(TM(x,DK+2.8,z,0.4,5.6,0.4));tr.push(TM(x,DK+2.8,z+3,0.25,0.25,6.6,-Math.atan2(5.6,6)*((z/6)%2?1:-1)));}}inst(new THREE.BoxGeometry(1,1,1),mat,tr,g);
    if(Math.abs(lon+0.1203)<0.001){const wt=M(0xeef0f2,{metalness:0.5,roughness:0.35});for(const sx of [-1,1]){const fx=sx*(w/2+4.5);add(new THREE.BoxGeometry(4.2,0.6,L),M(0xd4d8da,{metalness:0.4}),fx,DK-0.3,0,g);
      const cab=[];for(const z of [-75,0,75]){const py=add(new THREE.CylinderGeometry(0.35,0.5,32,8),wt,fx+sx*3,DK+14,z,g);py.rotation.z=-sx*0.3;
        const top=new V3(fx+sx*3-sx*Math.sin(0.3)*16*-1,DK+14+15.3,z);for(const dz of [-24,-12,12,24]){const a=top,b=new V3(fx,DK,z+dz);cab.push(a,b);}}
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cab),new THREE.LineBasicMaterial({color:0xdfe3e6})));}}}
  if(kind==='bfr'){add(new THREE.BoxGeometry(18,1.6,L),M(0x6b5d4f),-26,DK-1.4,0,g);const pv=add(new THREE.BoxGeometry(20,0.4,L-40),glassM(0x2b3440,0.2,2,20),-26,DK+6,0,g);pv.rotation.z=0.12;
    const cl=[];for(let z=-L/2+20;z<L/2-20;z+=12)for(const x of [-34,-18])cl.push(TM(x,DK+2.8,z,0.5,6,0.5));inst(new THREE.BoxGeometry(1,1,1),M(0x9a2f2a),cl,g);
    for(let k=1;k<n;k++)for(const x of [-34,-18])add(new THREE.CylinderGeometry(2,2.4,DK,10),M(0x8a2b25,{roughness:0.5,metalness:0.4}),x,DK/2-2,zs[k],g);}
  if(!rail)addTraffic(g,[[-7,1],[-3.5,1],[3.5,-1],[7,-1]],DK-0.3,-L/2,L/2,n>=6?3:2);
}

function londonEye(){
  const p=geo(51.5033,-0.1196);const s=nearestS(p.x,p.z);const f=riverFrame(s);reserve(p.x,p.z,140,60,0);
  const g=new THREE.Group();g.position.set(p.x,LAND_Y,p.z);g.rotation.y=Math.atan2(f.t.x,f.t.z)+Math.PI/2;scene.add(g);
  const white=M(0xe8ecef,{roughness:0.4,metalness:0.6});
  const wheel=new THREE.Group();wheel.position.y=70;g.add(wheel);
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(60,0.9,6,120),white));wheel.add(new THREE.Mesh(new THREE.TorusGeometry(56.5,0.55,6,120),white));
  const pts=[];for(let k=0;k<64;k++){const an=k/64*Math.PI*2;pts.push(new V3(0,0,0),new V3(Math.cos(an)*57,Math.sin(an)*57,0));}
  for(let k=0;k<96;k++){const a1=k/96*Math.PI*2,a2=(k+1)/96*Math.PI*2;pts.push(new V3(Math.cos(a1)*60,Math.sin(a1)*60,0),new V3(Math.cos(a2)*56.5,Math.sin(a2)*56.5,0));}
  wheel.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xd9dfe4,transparent:true,opacity:0.6})));
  const capM=glassM(0xcfe3ee,0.05,1,1);
  for(let k=0;k<32;k++){const an=k/32*Math.PI*2;const c=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),capM);c.scale.set(2.2,2.2,4.4);c.position.set(Math.cos(an)*62.5,Math.sin(an)*62.5,0);wheel.add(c);}
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(3,3,8,12).rotateX(Math.PI/2),white));
  for(const sd of [-1,1]){const leg=add(new THREE.CylinderGeometry(1.2,1.7,84,8),white,sd*18,35,-24,g);leg.rotation.z=sd*0.24;leg.rotation.x=-0.3;}
  return wheel;
}
function stPauls(){
  const p=lm(51.5138,-0.0984,170,100,0);const g=grp(p,0);const pm=portland,lead=M(0x7d837f,{roughness:0.45,metalness:0.5});
  add(new THREE.BoxGeometry(150,30,34),pm,0,15,0,g);add(new THREE.BoxGeometry(38,30,90),pm,8,15,0,g);
  add(new THREE.CylinderGeometry(21,21,14,32),pm,8,37,0,g);
  const col=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9,0.9,12,8),pm,32);const mm=new THREE.Matrix4();
  for(let i=0;i<32;i++){const an=i/32*Math.PI*2;mm.makeTranslation(8+Math.cos(an)*23,50,Math.sin(an)*23);col.setMatrixAt(i,mm);}col.castShadow=true;g.add(col);
  add(new THREE.CylinderGeometry(23.5,23.5,2,32),pm,8,57,0,g);add(new THREE.CylinderGeometry(18,19,8,32),pm,8,61,0,g);
  const dm=add(new THREE.SphereGeometry(18,40,20,0,Math.PI*2,0,Math.PI/2),lead,8,65,0,g);dm.scale.y=1.3;
  add(new THREE.CylinderGeometry(3,3.4,14,12),pm,8,95,0,g);add(new THREE.ConeGeometry(2.4,10,12),pm,8,107,0,g);add(new THREE.SphereGeometry(1.2,10,8),M(0xd6ad5c,{metalness:0.9,roughness:0.3}),8,113,0,g);
  for(const z of [-15,15]){add(new THREE.BoxGeometry(12,52,12),pm,-70,26,z,g);add(new THREE.CylinderGeometry(4,5,10,10),pm,-70,57,z,g);add(new THREE.ConeGeometry(3,6,10),lead,-70,65,z,g);}
}
function box(lat,lon,w,d,h,mat,ry,extra){if(mat.userData.cw){mat.map=rep(cwTex,Math.max(1,w/12.8),Math.max(1,h/16));mat.roughnessMap=mat.map;}const p=lm(lat,lon,w,d,ry||0);const g=grp(p,ry||0);add(new THREE.BoxGeometry(w,h,d),mat,0,h/2,0,g);if(extra)extra(g,w,d,h);return g;}
function deformBox(w,d,h,segs,fn){const ge=new THREE.BoxGeometry(1,1,1,1,segs,1);ge.translate(0,0.5,0);const p=ge.attributes.position;
  for(let i=0;i<p.count;i++){const y=p.getY(i);const r=fn(p.getX(i),y,p.getZ(i));p.setXYZ(i,r[0]*w,r[1]*h,r[2]*d);}ge.computeVertexNormals();return ge;}
function skyline(){
  // Tower of London
  const tl=lm(51.5081,-0.0759,240,240,0.2);const tg=grp(tl,0.2);const ragstone=M(0xcfc4ad,{roughness:0.9});
  add(new THREE.BoxGeometry(36,28,32),ragstone,0,14,0,tg);
  for(const cx of [-17,17])for(const cz of [-15,15]){add(new THREE.CylinderGeometry(3,3,36,10),ragstone,cx,18,cz,tg);const cap=add(new THREE.SphereGeometry(3.4,12,8,0,Math.PI*2,0,Math.PI/2),M(0x6b6f72,{metalness:0.5,roughness:0.5}),cx,36,cz,tg);cap.scale.y=1.6;}
  for(const [w,d,x,z] of [[150,6,0,-75],[150,6,0,75],[6,150,-75,0],[6,150,75,0]])add(new THREE.BoxGeometry(w,11,d),ragstone,x,5.5,z,tg);
  for(const cx of [-75,75])for(const cz of [-75,75])add(new THREE.CylinderGeometry(7,7,16,12),ragstone,cx,8,cz,tg);
  // HMS Belfast (moored off south bank)
  {const s=nearestS(geo(51.5066,-0.0813).x,geo(51.5066,-0.0813).z);const f=riverFrame(s);const g=new THREE.Group();scene.add(g);g.position.copy(f.p).addScaledVector(f.n,-62);g.position.y=WATER_Y;g.rotation.y=Math.atan2(f.t.z,-f.t.x);
   const grey=M(0x6b7278,{roughness:0.6,metalness:0.3});add(new THREE.BoxGeometry(187,9,20),grey,0,1,0,g);add(new THREE.BoxGeometry(60,8,14),grey,5,9,0,g);add(new THREE.BoxGeometry(22,8,11),grey,5,16,0,g);
   add(new THREE.CylinderGeometry(0.7,0.7,36,6),grey,30,27,0,g);add(new THREE.CylinderGeometry(0.7,0.7,30,6),grey,-30,24,0,g);add(new THREE.CylinderGeometry(3,3,10,10),grey,15,17,0,g);add(new THREE.CylinderGeometry(3,3,10,10),grey,-15,17,0,g);
   for(const x of [-70,-50,55,75])add(new THREE.BoxGeometry(8,3,7),grey,x,7,0,g);}
  shard();
  {const p=lm(51.5049,-0.0786,60,60,0);const g=grp(p,0.4);const prof=[];for(let k=0;k<=24;k++){const a=k/24*Math.PI;prof.push(new THREE.Vector2(Math.sin(a)*23*(1-0.15*k/24),(1-Math.cos(a))*24));}
   const ch=add(new THREE.LatheGeometry(prof,36),glassM(0x8e9ba6,0.08,8,12),0,0,0,g);ch.rotation.x=-0.22;ch.scale.set(1,1,0.85);}
  for(const [la,lo,w,d,h] of [[51.5053,-0.0808,40,34,42],[51.5045,-0.0818,44,36,38],[51.5052,-0.0828,40,36,46],[51.5041,-0.0800,36,30,34]])box(la,lo,w,d,h,R()<0.5?glassM(0x94a0a8,0.1):M(0xc9c1b1),0.35);
  for(let k=0;k<7;k++){const la=51.5036-k*0.00018,lo=-0.0728+k*0.00055;const q=geo(la,lo);if(claim(q.x,q.z,34,26,0.25,2))addB(q.x,q.z,34,26,20+R()*6,0.25,pick(COL.brickY),0);}
  box(51.5064,-0.0735,90,50,32,M(0x8f8a82,{roughness:0.9}),0.2);
  box(51.5028,-0.0866,34,30,143,M(0x9a958c),0.2); // Guy's tower
  // City cluster
  const gl=[0xa7b4c0,0x8fa0ae,0xb3b8ba,0x9aa9a8,0xa89e90];
  box(51.5147,-0.0829,62,56,278,glassM(gl[0],0.07),0.12);
  box(51.5163,-0.0808,42,38,202,glassM(gl[1],0.08),0.1,(g)=>add(new THREE.CylinderGeometry(0.8,0.8,28,6),M(0x777777),0,216,0,g));
  box(51.5153,-0.0843,50,44,183,glassM(0x7d8791,0.15),0.3);
  box(51.5157,-0.0815,54,44,172,glassM(gl[3],0.08),0.15);
  box(51.5140,-0.0838,42,38,204,glassM(gl[4],0.1),0.1);
  box(51.5211,-0.0790,44,40,164,glassM(gl[2],0.08),0.05);
  box(51.5143,-0.0817,40,36,118,M(0x9b958b),0.1);
  {const p=lm(51.5145,-0.0803,56,56,0);const prof=[];const H=180;for(let k=0;k<=30;k++){const y=k/30*H;const t=y/H;const r=Math.max(0.3,26*Math.sin(Math.min(1,0.18+t*0.84)*Math.PI*0.97)*(t>0.97?0.4:1));prof.push(new THREE.Vector2(r,y));}
   const tex=canvasTex(512,512,(g2,w,h)=>{g2.fillStyle='#223036';g2.fillRect(0,0,w,h);g2.strokeStyle='#7f9aa4';g2.lineWidth=5;for(let i=-12;i<12;i++){g2.beginPath();g2.moveTo(i*64,0);g2.lineTo(i*64+512,512);g2.stroke();g2.beginPath();g2.moveTo(i*64+512,0);g2.lineTo(i*64,512);g2.stroke();}
     g2.fillStyle='rgba(20,30,34,0.7)';for(let i=0;i<8;i++){g2.beginPath();g2.moveTo(i*64,0);g2.lineTo(i*64+40,0);g2.lineTo(i*64+40+512,512);g2.lineTo(i*64+512,512);g2.fill();}});
   tex.repeat.set(2,3);add(new THREE.LatheGeometry(prof,40),new THREE.MeshStandardMaterial({map:tex,roughness:0.12,metalness:0.7,envMapIntensity:1.2}),p.x,LAND_Y,p.z);}
  {const p=lm(51.5135,-0.0822,62,52,0.1);const g=grp(p,0.1);const ge=deformBox(60,48,225,12,(x,y,z)=>[x,y,z>0?z-(y)*0.62:z]);add(ge,glassM(0xb6bcc0,0.08,5,14),0,0,0,g);}
  {const p=lm(51.5128,-0.0795,46,40,0.4);const g=grp(p,0.4);add(deformBox(44,40,190,10,(x,y,z)=>[x,y,z>0?z-y*0.5:z]),glassM(0x9aa7b3,0.08,4,12),0,0,0,g);}
  {const p=lm(51.5113,-0.0836,78,66,0.15);const g=grp(p,0.15);add(deformBox(58,52,160,16,(x,y,z)=>[x*(1+0.12*y),y*(y>0.99?1-0.1*(z+0.5):1),z*(1+0.45*Math.pow(y,1.5))]),glassM(0x9aa5ad,0.1,5,10),0,0,0,g);}
  // Canary Wharf
  {const p=lm(51.5049,-0.0195,52,52,0);const g=grp(p,0);const ocs=glassM(0xb8bec4,0.18,4,14);add(new THREE.BoxGeometry(50,232,50),ocs,0,116,0,g);const py=add(new THREE.ConeGeometry(34,24,4),ocs,0,244,0,g);py.rotation.y=Math.PI/4;}
  box(51.5039,-0.0175,48,48,200,glassM(0x8f9aa3,0.1),0);box(51.5057,-0.0176,48,48,200,glassM(0x9aa1a6,0.1),0);
  box(51.5033,-0.0237,40,40,220,glassM(0x8fa3b5,0.08),0.3);box(51.5020,-0.0248,38,38,239,glassM(0xa4acb3,0.08),0.2);box(51.5028,-0.0150,46,40,156,glassM(0x8c969e,0.1),0.1);
  box(51.5060,-0.0230,42,36,150,glassM(0x94a2ab,0.1),0);box(51.5012,-0.0180,44,40,180,glassM(0x9fa8ae,0.1),0);
  // South Bank / Westminster fabric landmarks
  box(51.5076,-0.0994,150,72,35,M(0x6b4a39,{roughness:0.9}),0.12,(g)=>add(new THREE.BoxGeometry(15,99,15),M(0x6b4a39,{roughness:0.9}),0,49.5,0,g));
  box(51.5081,-0.1080,60,32,38,M(0x6e4d3b),0.1,(g)=>add(new THREE.BoxGeometry(10,67,10),M(0x6e4d3b),20,33,0,g));
  box(51.5070,-0.1142,110,60,24,M(0x8d8a84,{roughness:0.95}),0.35);
  box(51.5110,-0.1172,230,34,26,portland,0.3);
  box(51.5040,-0.1160,56,30,107,M(0xa8a39a),0.5);
  box(51.5020,-0.1190,170,110,30,M(0xcfc2a8),0.35,(g)=>{const r=add(new THREE.BoxGeometry(172,7,112),M(0x7a3a2b,{roughness:0.7}),0,33,0,g);});
  box(51.4990,-0.1180,40,160,40,M(0xd4d0c8),0.1);box(51.4975,-0.1182,40,120,45,M(0xd4d0c8),0.1);
  box(51.5014,-0.1419,110,90,24,portland,0.05);
  {const p=lm(51.5215,-0.1389,24,24,0);const g=grp(p,0);const bt=glassM(0x7f8a92,0.2,5,9);add(new THREE.CylinderGeometry(9,11,140,20),bt,0,70,0,g);add(new THREE.CylinderGeometry(12,12,30,20),M(0xdcdcdc),0,152,0,g);add(new THREE.CylinderGeometry(3,3,24,8),M(0xdcdcdc),0,179,0,g);}
  // Vauxhall / Nine Elms / Battersea
  {const p=lm(51.4872,-0.1244,80,70,0.5);const g=grp(p,0.5);const cr=M(0xdcd3b6),gg=glassM(0x3d5a4a,0.15,6,1);
   for(let i=0;i<5;i++){add(new THREE.BoxGeometry(80-i*12,9,70-i*10),cr,0,4.5+i*9,0,g);add(new THREE.BoxGeometry(78-i*12,4,68-i*10),gg,0,10+i*9,0,g);}}
  {const p=lm(51.4855,-0.1260,40,40,0);const g=grp(p,0);add(new THREE.CylinderGeometry(19,21,181,24),glassM(0x8fa1af,0.08,10,11),0,90.5,0,g);add(new THREE.CylinderGeometry(4,4,12,8),M(0xdddddd),0,187,0,g);}
  box(51.4826,-0.1330,70,70,65,glassM(0x9ea9b0,0.15),0.3);
  box(51.4838,-0.1300,40,40,140,glassM(0x93a4ae,0.1),0.2);box(51.4845,-0.1270,36,36,120,glassM(0xa3aeb4,0.1),0.4);box(51.4832,-0.1360,36,34,110,glassM(0x8c9ba5,0.1),0.1);
  {const p=lm(51.4816,-0.1445,170,110,0.35);const g=grp(p,0.35);const brick=M(0x7a4a36,{roughness:0.9});add(new THREE.BoxGeometry(160,50,100),brick,0,25,0,g);add(new THREE.BoxGeometry(150,12,40),brick,0,56,0,g);
   const fl=canvasTex(128,32,(g2,w,h)=>{g2.fillStyle='#e9e3d2';g2.fillRect(0,0,w,h);g2.fillStyle='#bdb6a3';for(let x=0;x<w;x+=8)g2.fillRect(x,0,2,h);});fl.repeat.set(3,1);
   const cm=new THREE.MeshStandardMaterial({color:0xffffff,map:fl,roughness:0.75});
   for(const cx of [-68,68])for(const cz of [-44,44]){add(new THREE.CylinderGeometry(4.3,5.2,103,20,1,true),cm,cx,51.5,cz,g);add(new THREE.CylinderGeometry(4.35,4.35,3,20),M(0x2a2826),cx,101,cz,g);add(new THREE.CylinderGeometry(5.6,5.6,6,20),M(0xdcd6c4),cx,3,cz,g);}}
}

/* ---------- trees ---------- */
function trees(){
  const pts=[];
  const embank=(s0,s1,side,step)=>{for(let s=s0;s<s1;s+=step){const f=riverFrame(s);const off=HW+12+R()*3;pts.push([f.p.x+f.n.x*off*side,f.p.z+f.n.z*off*side,1]);}};
  const sWB=nearestS(geo(51.5008,-0.1222).x,geo(51.5008,-0.1222).z);
  embank(sWB-1600,sWB-40,1,11);embank(sWB-1500,sWB+600,-1,13);embank(sWB+2100,sWB+4200,1,12);embank(sTB-300,sTB+900,1,14);
  for(const pk of PARKS){const c=geo(pk[0],pk[1]);const n=Math.floor(pk[2]*pk[3]/900);
    for(let i=0;i<n;i++){const a=R()*6.283,r=Math.sqrt(R());const lx=Math.cos(a)*r*pk[2]/2,lz=Math.sin(a)*r*pk[3]/2;const c2=Math.cos(pk[4]),s2=Math.sin(pk[4]);const x=c.x+lx*c2-lz*s2,z=c.z+lx*s2+lz*c2;
      if(Math.sin(x*0.013+2)*Math.cos(z*0.011)>0.25||!isLand(x,z))continue;pts.push([x,z,0.8+R()*0.6]);}}
  const ge=mergeGeos([new THREE.IcosahedronGeometry(0.8,1).translate(0,0.15,0),new THREE.IcosahedronGeometry(0.6,1).translate(0.45,-0.1,0.2),new THREE.IcosahedronGeometry(0.6,1).translate(-0.35,-0.05,-0.35),new THREE.IcosahedronGeometry(0.5,1).translate(0.1,0.55,0.1),new THREE.CylinderGeometry(0.07,0.1,1.2,5).translate(0,-0.9,0)]);const p=ge.attributes.position;for(let i=0;i<p.count;i++){p.setXYZ(i,p.getX(i)*(0.85+R()*0.3),p.getY(i)*(0.8+R()*0.3),p.getZ(i)*(0.85+R()*0.3));}ge.computeVertexNormals();
  const mat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.95,flatShading:false});
  const byTile=new Map();for(const t of pts){const k=Math.floor(t[0]/TILE)+'_'+Math.floor(t[1]/TILE);if(!byTile.has(k))byTile.set(k,[]);byTile.get(k).push(t);}
  const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),sv=new V3(),pv=new V3(),cc=new THREE.Color();
  for(const [k,arr] of byTile){const [a,b]=k.split('_').map(Number);const g=ge.clone();g.boundingSphere=new THREE.Sphere(new V3((a+0.5)*TILE,20,(b+0.5)*TILE),TILE*0.8);
    const im=new THREE.InstancedMesh(g,mat,arr.length);
    arr.forEach((t,i)=>{const s=(5+R()*3.5)*t[2];q.setFromAxisAngle(UP,R()*6);pv.set(t[0],LAND_Y+s*1.1+2,t[1]);sv.set(s,s*1.15,s);m4.compose(pv,q,sv);im.setMatrixAt(i,m4);
      const y=R();cc.setRGB(lerp(0.10,0.22,y*y),lerp(0.15,0.18,y),lerp(0.05,0.04,y));im.setColorAt(i,cc);});
    im.castShadow=true;im.receiveShadow=true;scene.add(im);}
  return pts.length;
}

/* ---------- volumetric cloud noise ---------- */
function makeNoise3D(N){
  const data=new Uint8Array(N*N*N);
  function worley(cells,seed){const r=rng(seed);const pts=new Float32Array(cells*cells*cells*3);for(let i=0;i<pts.length;i++)pts[i]=r();
    return (x,y,z)=>{const fx=x*cells,fy=y*cells,fz=z*cells;const ix=Math.floor(fx),iy=Math.floor(fy),iz=Math.floor(fz);let md=9;
      for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const cx=ix+dx,cy=iy+dy,cz=iz+dz;const wx=((cx%cells)+cells)%cells,wy=((cy%cells)+cells)%cells,wz=((cz%cells)+cells)%cells;
        const o=((wz*cells+wy)*cells+wx)*3;const px=cx+pts[o]-fx,py=cy+pts[o+1]-fy,pz=cz+pts[o+2]-fz;const d=px*px+py*py+pz*pz;if(d<md)md=d;}
      return Math.min(1,Math.sqrt(md));};}
  const w1=worley(4,11),w2=worley(8,12),w3=worley(16,13);
  let i=0;for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){const u=x/N,v=y/N,w=z/N;
    const f=0.6*(1-w1(u,v,w))+0.28*(1-w2(u,v,w))+0.12*(1-w3(u,v,w));data[i++]=clamp(Math.round((f*1.25-0.12)*255),0,255);}
  const t=new THREE.DataTexture3D(data,N,N,N);t.format=THREE.RedFormat;t.type=THREE.UnsignedByteType;t.minFilter=t.magFilter=THREE.LinearFilter;
  t.wrapS=t.wrapT=t.wrapR=THREE.RepeatWrapping;t.unpackAlignment=1;t.needsUpdate=true;return t;
}

/* ---------- build world ---------- */
const TBR=towerBridge();addTraffic(TBR.g,[[-1.9,1],[1.9,-1]],TBR.DECK,-150,150,6);
[[51.5079,-0.0877,'flat',0xb9b4aa,3],[51.5087,-0.0944,'arch',0x5f7f6c,3],[51.5095,-0.0985,'foot',0,0],[51.5098,-0.1045,'bfr',0x9a2f2a,5],[51.5085,-0.1168,'flat',0xd6d0c2,5],
 [51.5066,-0.1203,'rail',0x5b6168,0],[51.5008,-0.1222,'arch',0x44704d,7],[51.4945,-0.1243,'arch',0xa33a30,5],[51.4875,-0.1275,'arch',0x9a3a33,5],[51.4845,-0.1500,'susp',0xe6e8e8,0],[51.4822,-0.1665,'susp',0xe8cfcf,0],[51.5093,-0.0916,'rail',0x5d5f62,0]]
 .forEach(b=>riverBridge(b[0],b[1],b[2],b[3],b[4]));
const PARL=parliament();
const eyeWheel=londonEye();
stPauls();
skyline();
const nOSM=buildOSM();
const nBuild=buildCity();
const nTrees=trees();
const BIRD_T={value:0};const BIRDS=(()=>{const ge=new THREE.BufferGeometry();ge.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0.25,-0.5,0,-0.05,0,0,-0.2, 0,0,0.25,0,0,-0.2,0.5,0,-0.05],3));ge.computeVertexNormals();
  const m=new THREE.MeshStandardMaterial({color:0x2a2a2c,side:THREE.DoubleSide,roughness:0.9});
  m.onBeforeCompile=(sh)=>{sh.uniforms.uT=BIRD_T;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uT;').replace('#include <begin_vertex>','#include <begin_vertex>\nfloat ph=instanceMatrix[3].x*0.37+instanceMatrix[3].z*0.23;transformed.y+=sin(uT*13.0+ph)*abs(transformed.x)*0.9;');};
  const N=90;const im=new THREE.InstancedMesh(ge,m,N);im.frustumCulled=false;scene.add(im);
  const b=[];for(let i=0;i<N;i++){const fl=i<60?0:1;b.push({fl,a:R()*6.28,r:20+R()*60,h:18+R()*40,sp:0.3+R()*0.3,ph:R()*6.28});}
  const C=[new V3(-160,0,30),lutAt(RIV,sTB+3800,new V3())];return{im,b,C};})();
function updateBirds(t){const m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new V3(),sc=new V3(1.1,1.1,1.1);
  BIRDS.b.forEach((o,i)=>{const c=BIRDS.C[o.fl];const scat=o.fl===0?sstep(3.6,6,t):sstep(15.2,18,t);const a=o.a+t*o.sp*(1+scat*2);const r=o.r*(1+scat*3);
    p.set(c.x+Math.cos(a)*r,WATER_Y+o.h+Math.sin(t*0.7+o.ph)*3+scat*60,c.z+Math.sin(a)*r);q.setFromAxisAngle(UP,-a);m.compose(p,q,sc);BIRDS.im.setMatrixAt(i,m);});
  BIRDS.im.instanceMatrix.needsUpdate=true;BIRD_T.value=t;}
addBoat(sTB+300,-5,48,true);addBoat(sTB+3700,4,-42,false);addBoat(sTB+2200,-8,52,true);addBoat(sTB+5200,6,34,false);

/* ---------- aircraft ---------- */
/* ---------- aircraft ---------- */
const plumeMat=()=>new THREE.ShaderMaterial({
  uniforms:{uTime:{value:0},uAmt:{value:1}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
  vertexShader:`varying vec2 vUv;varying float vF;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.0);vec3 n=normalize(mat3(modelMatrix)*normal);vF=abs(dot(n,normalize(cameraPosition-w.xyz)));gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform float uTime,uAmt;varying vec2 vUv;varying float vF;${NOISE}
  void main(){float l=vUv.y;float fl=0.75+0.25*vn3(vec3(vUv.x*6.0,l*8.0-uTime*40.0,uTime*9.0));
   vec3 core=vec3(0.55,0.72,1.6);vec3 mid=vec3(2.4,1.1,0.35);vec3 tip=vec3(0.9,0.28,0.05);
   vec3 c=mix(core,mid,smoothstep(0.0,0.3,l));c=mix(c,tip,smoothstep(0.35,1.0,l));
   float dia=0.5+0.5*sin(l*38.0);c+=vec3(1.2,0.8,0.5)*pow(dia,6.0)*smoothstep(0.55,0.05,l)*0.9;
   float a=pow(vF,1.4)*(1.0-smoothstep(0.55,1.0,l))*fl*uAmt;gl_FragColor=vec4(c,clamp(a,0.0,1.0));}`
});
function vaporMat(mode){
  return new THREE.ShaderMaterial({
    defines:{MODE:mode},uniforms:{uTime:{value:0},uAmt:{value:0},uPoly:{value:B2_POLY_V}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`varying vec2 vUv;varying vec3 vL;varying vec3 vN;varying vec3 vV;void main(){vUv=uv;vL=position;vec4 w=modelMatrix*vec4(position,1.0);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform float uTime,uAmt;uniform vec2 uPoly[12];varying vec2 vUv;varying vec3 vL;varying vec3 vN;varying vec3 vV;${NOISE}
    bool inPoly(vec2 p){bool c=false;vec2 b=uPoly[11];for(int i=0;i<12;i++){vec2 a=uPoly[i];if(((a.y>p.y)!=(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))c=!c;b=a;}return c;}
    void main(){float a=0.0;vec3 col=vec3(1.0,0.93,0.84);
     #if MODE==0
      float fr=pow(1.0-abs(dot(normalize(vN),normalize(vV))),1.3);float n=fbm3(vec3(vL.x*1.6,vL.y*1.6,vL.z*0.7+uTime*16.0));
      float prof=smoothstep(1.0,0.86,vUv.y)*smoothstep(0.0,0.65,vUv.y);a=uAmt*prof*(0.2+0.8*fr)*smoothstep(0.3,0.75,n)*0.95;
     #elif MODE==1
      float n=fbm3(vec3(vL.x*1.3,vL.z*0.4+uTime*11.0,uTime*0.7));a=uAmt*smoothstep(0.38,0.82,n)*0.75;
     #else
      if(!inPoly(vL.xz))discard;float n=fbm3(vec3(vL.x*0.22,vL.z*0.12+uTime*2.6,uTime*0.25));a=uAmt*smoothstep(0.45,0.9,n)*0.55;
     #endif
     gl_FragColor=vec4(col,a);}`
  });
}
const B2_POLY=[[0,11.4],[-26.2,-5.9],[-25.8,-7.0],[-17.5,-2.4],[-10.5,-8.2],[-5.2,-3.6],[0,-8.6],[5.2,-3.6],[10.5,-8.2],[17.5,-2.4],[25.8,-7.0],[26.2,-5.9]];
const B2_POLY_V=B2_POLY.map(p=>new THREE.Vector2(p[0],p[1]));

function buildF16(){
  const g=new THREE.Group();
  const paint=new THREE.MeshStandardMaterial({color:0x6f777f,map:rep(f16Tex,3,2),roughness:0.5,metalness:0.35,envMapIntensity:1.1});
  const paintM=new THREE.MeshStandardMaterial({color:0x6f777f,map:rep(f16Tex,0.14,0.14),roughness:0.5,metalness:0.35,envMapIntensity:1.1});
  const dark=new THREE.MeshStandardMaterial({color:0x2b2c2e,roughness:0.6,metalness:0.4});
  const scorch=new THREE.MeshStandardMaterial({color:0x2c231c,roughness:0.45,metalness:0.85});
  const P=[[0,7.6],[0.18,7.1],[0.38,6.3],[0.55,5.3],[0.68,4.2],[0.76,2.8],[0.8,1.0],[0.8,-2.0],[0.76,-4.5],[0.68,-6.0],[0.58,-6.9],[0.56,-7.0]].map(p=>new THREE.Vector2(p[0],p[1]));
  const fus=new THREE.LatheGeometry(P,28);fus.rotateX(Math.PI/2);fus.scale(1.08,0.9,1);
  const fm=new THREE.Mesh(fus,paint);fm.castShadow=true;g.add(fm);
  const spine=new THREE.Mesh(new THREE.SphereGeometry(1,20,12),paint);spine.scale.set(0.48,0.38,3.4);spine.position.set(0,0.55,-0.8);g.add(spine);
  const intake=new THREE.Mesh(new THREE.CylinderGeometry(0.56,0.64,3.4,18,1,true).rotateX(Math.PI/2),paint);intake.scale.set(1.15,0.72,1);intake.position.set(0,-0.8,1.1);g.add(intake);
  const ib=new THREE.Mesh(new THREE.CircleGeometry(0.54,18),new THREE.MeshBasicMaterial({color:0x050505}));ib.scale.set(1.15,0.72,1);ib.position.set(0,-0.8,2.75);g.add(ib);
  function flat(pts,mirror,depth,y,mat){const sh=new THREE.Shape(pts.map(p=>new THREE.Vector2(mirror?-p[0]:p[0],p[1])));const ge=new THREE.ExtrudeGeometry(sh,{depth,bevelEnabled:true,bevelThickness:0.04,bevelSize:0.04,bevelSegments:1});ge.rotateX(Math.PI/2);ge.translate(0,y+depth/2,0);const me=new THREE.Mesh(ge,mat);me.castShadow=true;g.add(me);return pts;}
  const WING=[[0.6,4.9],[1.0,2.2],[4.95,-1.5],[4.95,-2.6],[0.6,-3.4]];
  const STAB=[[0.5,-4.9],[2.9,-6.4],[2.9,-7.2],[0.5,-7.3]];
  for(const mir of [false,true]){flat(WING,mir,0.12,-0.12,paintM);flat(STAB,mir,0.08,-0.25,paintM);}
  const finS=new THREE.Shape([[-3.6,0.5],[-6.0,3.7],[-6.9,3.7],[-7.1,0.5]].map(p=>new THREE.Vector2(p[0],p[1])));
  const fin=new THREE.ExtrudeGeometry(finS,{depth:0.14,bevelEnabled:true,bevelThickness:0.03,bevelSize:0.03,bevelSegments:1});fin.rotateY(-Math.PI/2);fin.translate(0.07,0,0);
  const finM=new THREE.Mesh(fin,paintM);finM.castShadow=true;g.add(finM);
  for(const s of [-1,1]){
    const ms=new THREE.Mesh(new THREE.CylinderGeometry(0.065,0.065,2.9,8).rotateX(Math.PI/2),new THREE.MeshStandardMaterial({color:0xdadcd8,roughness:0.5}));ms.position.set(s*5.02,-0.02,-1.4);g.add(ms);
    const tank=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),paint);tank.scale.set(0.3,0.3,1.8);tank.position.set(s*2.4,-0.65,-0.6);g.add(tank);
  }
  const wht=new THREE.MeshStandardMaterial({color:0xdadcd8,roughness:0.45});
  for(const s of [-1,1]){
    const vf=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.55,1.3),paint);vf.position.set(s*0.55,-0.8,-5.1);vf.rotation.z=s*0.45;g.add(vf);
    const nc=new THREE.Mesh(new THREE.ConeGeometry(0.065,0.4,8).rotateX(Math.PI/2),wht);nc.position.set(s*5.02,-0.02,0.25);g.add(nc);
    for(const [fz,fs] of [[-2.6,0.3],[-0.1,0.18]]){const f1=new THREE.Mesh(new THREE.BoxGeometry(fs*2,0.015,fs),wht);f1.position.set(s*5.02,-0.02,fz);g.add(f1);const f2=new THREE.Mesh(new THREE.BoxGeometry(0.015,fs*2,fs),wht);f2.position.set(s*5.02,-0.02,fz);g.add(f2);}
    const py=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.35,1.3),paint);py.position.set(s*3.4,-0.33,-1.0);g.add(py);
    const am=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,3.6,8).rotateX(Math.PI/2),wht);am.position.set(s*3.4,-0.62,-0.9);g.add(am);
    const an=new THREE.Mesh(new THREE.ConeGeometry(0.09,0.4,8).rotateX(Math.PI/2),wht);an.position.set(s*3.4,-0.62,1.1);g.add(an);
    for(const r of [0,Math.PI/2]){const af=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.015,0.35),wht);af.position.set(s*3.4,-0.62,-2.5);af.rotation.z=r+Math.PI/4;g.add(af);}
  }
  const pit=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.035,0.9,6).rotateX(Math.PI/2),dark);pit.position.set(0,0,8.0);g.add(pit);
  const bow=new THREE.Mesh(new THREE.TorusGeometry(0.42,0.035,6,18,Math.PI),dark);bow.position.set(0,0.62,2.35);bow.scale.set(1,1.05,1);g.add(bow);
  const spl=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.05,0.5),paint);spl.position.set(0,-0.42,2.7);g.add(spl);
  const noz=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.57,1.3,22,1,true).rotateX(Math.PI/2),scorch);noz.position.set(0,0,-7.55);g.add(noz);
  const sootRing=new THREE.Mesh(new THREE.CylinderGeometry(0.585,0.6,0.9,22,1,true).rotateX(Math.PI/2),new THREE.MeshStandardMaterial({color:0x201a15,roughness:0.9}));sootRing.position.set(0,0,-6.75);g.add(sootRing);
  const glow=new THREE.Mesh(new THREE.CircleGeometry(0.48,20),new THREE.MeshBasicMaterial({color:new THREE.Color(3.0,1.3,0.45),toneMapped:false}));glow.rotation.y=Math.PI;glow.position.set(0,0,-7.7);g.add(glow);
  const canopy=new THREE.Mesh(new THREE.SphereGeometry(1,28,16),new THREE.MeshStandardMaterial({color:0x9b8a5c,roughness:0.03,metalness:0.9,transparent:true,opacity:0.55,envMapIntensity:1.6}));
  canopy.scale.set(0.44,0.64,1.8);canopy.position.set(0,0.64,3.4);g.add(canopy);
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(0.17,16,12),new THREE.MeshStandardMaterial({color:0xdedad2,roughness:0.5}));helmet.position.set(0,0.98,3.25);g.add(helmet);
  const visor=new THREE.Mesh(new THREE.SphereGeometry(0.175,16,12,-0.9,1.8,0.9,1.0),new THREE.MeshStandardMaterial({color:0xffc55a,roughness:0.02,metalness:1.0,envMapIntensity:2.5}));visor.rotation.y=0;visor.position.copy(helmet.position);g.add(visor);
  // afterburner
  const plume=plumeMat();
  const pl=new THREE.Mesh(new THREE.ConeGeometry(0.5,7.5,24,1,true).rotateX(-Math.PI/2),plume);pl.position.set(0,0,-7.8-3.75);pl.renderOrder=5;g.add(pl);
  const pl2=new THREE.Mesh(new THREE.ConeGeometry(0.36,3.4,20,1,true).rotateX(-Math.PI/2),plume);pl2.position.set(0,0,-7.8-1.7);pl2.renderOrder=6;g.add(pl2);
  const light=new THREE.PointLight(new THREE.Color(1.0,0.55,0.2),0,60,2);light.position.set(0,0,-10);g.add(light);
  // vapor
  const vc=vaporMat(0);
  const cone=new THREE.Mesh(new THREE.CylinderGeometry(1.1,3.2,4.6,40,6,true).rotateX(Math.PI/2),vc);cone.position.set(0,0.1,0.3);cone.renderOrder=7;g.add(cone);
  const vw=vaporMat(1);
  for(const mir of [false,true]){const sh=new THREE.Shape(WING.map(p=>new THREE.Vector2(mir?-p[0]:p[0],p[1])));const ge=new THREE.ShapeGeometry(sh);ge.rotateX(Math.PI/2);ge.translate(0,0.14,0);const me=new THREE.Mesh(ge,vw);me.renderOrder=7;g.add(me);}
  scene.add(g);
  return {g,plume,light,vc,vw,tips:[new V3(5.05,0,-2.1),new V3(-5.05,0,-2.1)],nozzle:new V3(0,0,-7.8)};
}
function buildB2(){
  const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(0.085,0.087,0.095),map:rep(b2Tex,5,2),roughnessMap:rep(b2Tex,5,2),roughness:0.62,metalness:0.25,envMapIntensity:0.9});
  const poly=B2_POLY;
  const inPoly=(x,z)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a[1]>z)!==(b[1]>z))&&(x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]))c=!c;}return c;};
  const segD=(x,z)=>{let d=1e9;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];const vx=b[0]-a[0],vz=b[1]-a[1];const t=clamp(((x-a[0])*vx+(z-a[1])*vz)/(vx*vx+vz*vz),0,1);d=Math.min(d,Math.hypot(x-a[0]-vx*t,z-a[1]-vz*t));}return d;};
  function surf(top){
    const ge=new THREE.PlaneGeometry(54,21,180,72);ge.rotateX(top?-Math.PI/2:Math.PI/2);ge.translate(0,0,1.4);
    const pos=ge.attributes.position;
    for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);let y=0;
      if(inPoly(x,z)){const e=Math.pow(clamp(segD(x,z)/3.4,0,1),0.55);const ax=Math.abs(x);
        if(top){y=e*(0.35+1.35*Math.pow(1-clamp(ax/26.5,0,1),1.4))+1.45*Math.exp(-(x*x/7+(z-4.2)*(z-4.2)/24))*e+0.8*Math.exp(-((ax-5.2)*(ax-5.2)/3+(z+0.3)*(z+0.3)/16))*e;}
        else{y=-e*(0.25+0.75*(1-clamp(ax/26.5,0,1)));}}
      pos.setY(i,y);}
    ge.computeVertexNormals();
    const m=mat.clone();m.map=mat.map;m.roughnessMap=mat.roughnessMap;
    m.onBeforeCompile=(sh)=>{sh.uniforms.uPoly={value:B2_POLY_V};
      sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vPl;').replace('#include <begin_vertex>','#include <begin_vertex>\nvPl=position.xz;');
      sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vPl;uniform vec2 uPoly[12];
        bool inPoly(vec2 p){bool c=false;vec2 b=uPoly[11];for(int i=0;i<12;i++){vec2 a=uPoly[i];if(((a.y>p.y)!=(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))c=!c;b=a;}return c;}`)
        .replace('void main() {','void main() {\nif(!inPoly(vPl))discard;');};
    const me=new THREE.Mesh(ge,m);g.add(me);return ge;
  }
  const topGeo=surf(true);surf(false);
  const blk=new THREE.MeshStandardMaterial({color:0x040405,roughness:0.3,metalness:0.5});
  for(const s of [-1,1]){
    const intake=new THREE.Mesh(new THREE.BoxGeometry(2.4,0.35,0.9),blk);intake.position.set(s*5.2,1.35,2.2);intake.rotation.y=s*0.35;g.add(intake);
    const ex=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.12,3.2),blk);ex.position.set(s*5.4,0.62,-4.2);g.add(ex);
  }
  for(let k=0;k<4;k++){const w=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.5),blk);w.position.set(-1.35+k*0.9,2.05,7.1);w.rotation.x=-0.95;w.rotation.y=(k<2?1:-1)*0.15;g.add(w);}
  const vm=vaporMat(2);const vg=topGeo.clone();vg.translate(0,0.25,0);const vmesh=new THREE.Mesh(vg,vm);vmesh.renderOrder=7;g.add(vmesh);
  scene.add(g);
  return {g,vm,tips:[new V3(26.0,0.05,-6.4),new V3(-26.0,0.05,-6.4)]};
}
const F16=buildF16();
const B2=buildB2();
function acPaint(mat,kind){if(mat.userData.ac)return;mat.userData.ac=1;const prev=mat.onBeforeCompile&&mat.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile?mat.onBeforeCompile:null;
  mat.onBeforeCompile=(sh,r)=>{if(prev)prev(sh,r);
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLp;varying vec3 vLn;').replace('#include <begin_vertex>','#include <begin_vertex>\nvLp=position;vLn=objectNormal;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vLp;varying vec3 vLn;'+NOISE)
     .replace('#include <color_fragment>',`#include <color_fragment>
      vec3 p=vLp*${kind?'0.35':'1.0'};vec3 cs=vec3(0.9,0.7,1.1);vec3 gq=abs(fract(p/cs)-0.5)*cs;float line=1.0-smoothstep(0.0,0.014,min(min(gq.x,gq.y),gq.z));
      float streak=vn3(vec3(p.x*5.0,p.y*5.0,p.z*0.35));float mot=fbm3(p*1.7);float wear=smoothstep(0.62,0.8,fbm3(p*3.1));
      diffuseColor.rgb*=1.0-line*0.25;diffuseColor.rgb*=0.86+0.2*streak+0.12*(mot-0.5);
      ${kind?'':'diffuseColor.rgb*=mix(1.14,0.86,smoothstep(-0.3,0.4,vLn.y));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.09,0.08,0.07),smoothstep(-4.8,-7.4,vLp.z)*0.7);'}`)
     .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+(wear-0.3)*0.25+line*0.15,0.05,1.0);');};
  mat.customProgramCacheKey=()=>'ac'+kind+(prev?'p':'');mat.needsUpdate=true;}
F16.g.traverse(o=>{if(o.isMesh&&o.material&&o.material.map&&o.material.map.image===f16Tex.image)acPaint(o.material,0);});
B2.g.traverse(o=>{if(o.isMesh&&o.material&&o.material.map&&o.material.map.image===b2Tex.image)acPaint(o.material,1);});
const NAV=[];function nav(g,x,y,z,c,kind,sz){const m=new THREE.Mesh(new THREE.SphereGeometry(sz||0.12,8,6),new THREE.MeshBasicMaterial({color:c.clone()}));m.position.set(x,y,z);g.add(m);NAV.push({m,c,kind});}
nav(F16.g,5.05,0,-2.0,new THREE.Color(6,0.2,0.1),0);nav(F16.g,-5.05,0,-2.0,new THREE.Color(0.2,6,0.8),0);nav(F16.g,0,3.75,-6.95,new THREE.Color(8,8,8),1,0.1);nav(F16.g,0,-0.95,-1,new THREE.Color(8,0.4,0.2),1,0.1);
nav(B2.g,26.1,0.1,-6.4,new THREE.Color(6,0.2,0.1),0,0.2);nav(B2.g,-26.1,0.1,-6.4,new THREE.Color(0.2,6,0.8),0,0.2);nav(B2.g,0,-0.5,0,new THREE.Color(8,0.5,0.2),1,0.18);
function updateNav(t){for(const n of NAV){const k=n.kind?(((t*1.1)%1)<0.05?1:0):1;n.m.material.color.copy(n.c).multiplyScalar(k);}}



/* ---------- flight paths (follow the real river) ---------- */
function track(keys){
  const n=keys.length,T=keys.map(k=>k[0]),P=keys.map(k=>new V3(k[1],k[2]||0,k[3]||0));
  const Mv=P.map((p,i)=>{if(i===0)return P[1].clone().sub(P[0]).divideScalar(T[1]-T[0]);if(i===n-1)return P[n-1].clone().sub(P[n-2]).divideScalar(T[n-1]-T[n-2]);return P[i+1].clone().sub(P[i-1]).divideScalar(T[i+1]-T[i-1]);});
  return (t,out)=>{out=out||new V3();
    if(t<=T[0])return out.copy(P[0]).addScaledVector(Mv[0],t-T[0]);
    if(t>=T[n-1])return out.copy(P[n-1]).addScaledVector(Mv[n-1],t-T[n-1]);
    let i=0;while(t>T[i+1])i++;const h=T[i+1]-T[i],s=(t-T[i])/h,s2=s*s,s3=s2*s;
    return out.set(0,0,0).addScaledVector(P[i],2*s3-3*s2+1).addScaledVector(Mv[i],(s3-2*s2+s)*h).addScaledVector(P[i+1],-2*s3+3*s2).addScaledVector(Mv[i+1],(s3-s2)*h);};
}
const _s1=new V3();
const jetAltT=track([[-1,32],[0,30],[1.8,25],[3.9,24],[5.2,27],[6.8,38],[8.5,58],[10.5,90],[12.5,118],[14.5,142],[16.5,152],[18.5,160],[21,165]]);
const b2AltT=track([[10,610],[12,570],[15,420],[17.5,285],[20,190],[22,172],[24.5,180],[26.5,235],[29.5,430],[32.5,660],[36,960],[40,1320]]);
const jetS=(t)=>{if(t<=14)return sTB+330*(t-3.9);const d=Math.min(t-14,6);let s=sTB+330*10.1+330*d-13.1667*d*d;if(t>20)s+=172*(t-20);return s;};
const b2S=(t)=>{const s0=sTB+3950;if(t<=26)return s0+172*(t-14.5);const d=Math.min(t-26,6);let s=s0+172*11.5+172*d+4.833*d*d;if(t>32)s+=230*(t-32);return s;};
const jetLat=(t)=>150*sstep(15.0,16.4,t)*(1-sstep(17.2,18.8,t));
const _jt=new V3();
function jetOwn(t,out){lutAt(JET_SM,jetS(t),out,_jt);const l=jetLat(t);out.x+=-_jt.z*l;out.z+=_jt.x*l;out.y=WATER_Y+jetAltT(t,_s1).x;return out;}
function b2Track(t,out){lutAt(B2_SM,b2S(t),out);out.y=b2AltT(t,_s1).x;return out;}
const FORM_OFF=new V3(-42,1.5,-16);
const _q=new THREE.Quaternion(),_o=new V3(),_bp=new V3();
function jetPos(t,out){jetOwn(t,out);const w=sstep(18.4,20.8,t);if(w>0){b2Orient(t,_q);b2Track(t,_bp);_o.copy(FORM_OFF).applyQuaternion(_q).add(_bp);out.lerp(_o,w);}return out;}
function orientFrom(fn,t,gain,roll,q,maxBank){
  const a=new V3(),b=new V3(),c=new V3(),f=new V3(),u=new V3(),x=new V3(),m=new THREE.Matrix4();
  fn(t-0.06,a);fn(t+0.06,b);f.subVectors(b,a).normalize();
  for(const o of [-0.35,0,0.35]){fn(t+o-0.25,a);fn(t+o,c);fn(t+o+0.25,b);u.x+=(b.x-2*c.x+a.x)/0.0625;u.y+=(b.y-2*c.y+a.y)/0.0625;u.z+=(b.z-2*c.z+a.z)/0.0625;}
  u.multiplyScalar(gain/3);u.y+=9.81;u.addScaledVector(f,-u.dot(f));if(u.lengthSq()<1e-6)u.set(0,1,0);u.normalize();
  if(maxBank){const up0=new V3(0,1,0).addScaledVector(f,-f.y).normalize();const cb=clamp(u.dot(up0),-1,1);
    if(Math.acos(cb)>maxBank){const side=u.clone().addScaledVector(up0,-cb).normalize();u.copy(up0).multiplyScalar(Math.cos(maxBank)).addScaledVector(side,Math.sin(maxBank));}}
  x.crossVectors(u,f);m.makeBasis(x,u,f);q.setFromRotationMatrix(m);
  if(roll)q.multiply(new THREE.Quaternion().setFromAxisAngle(ZAX,roll));return q;
}
function b2Orient(t,q){return orientFrom(b2Track,t,1.0,0,q,0.62);}
function jetRoll(t){const s=clamp((t-4.05)/1.25,0,1);return s*s*s*(s*(s*6-15)+10)*Math.PI*2;}
function jetVapor(t){return Math.max(sstep(3.95,4.3,t)*(1-sstep(5.2,5.8,t)),0.5*sstep(6.2,7.0,t)*(1-sstep(8.6,9.6,t)),0.7*sstep(12.6,13.4,t)*(1-sstep(14.2,15.0,t)),0.4*sstep(15.0,15.8,t)*(1-sstep(17.6,18.6,t)),0.35*sstep(18.6,19.4,t)*(1-sstep(20.4,21.2,t)),0.3*sstep(22.5,23.5,t)*(1-sstep(25.5,26.8,t)));}

/* ---------- trails (wingtip vortices) ---------- */
function Trail(maxPts,w0,life,col){
  const pos=new Float32Array(maxPts*2*3),al=new Float32Array(maxPts*2),sd=new Float32Array(maxPts*2);
  for(let i=0;i<maxPts;i++){sd[i*2]=-1;sd[i*2+1]=1;}
  const idx=[];for(let i=0;i<maxPts-1;i++){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('aA',new THREE.BufferAttribute(al,1));geo.setAttribute('aS',new THREE.BufferAttribute(sd,1));geo.setIndex(idx);
  const mat=new THREE.ShaderMaterial({uniforms:{uCol:{value:col}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`attribute float aA;attribute float aS;varying float vA;varying float vS;varying float vD;void main(){vA=aA;vS=aS;vec4 mv=modelViewMatrix*vec4(position,1.0);vD=-mv.z;gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`uniform vec3 uCol;varying float vA;varying float vS;varying float vD;void main(){float a=vA*(1.0-vS*vS)*exp(-vD*0.00032);gl_FragColor=vec4(uCol,a);}`});
  const mesh=new THREE.Mesh(geo,mat);mesh.frustumCulled=false;mesh.renderOrder=8;scene.add(mesh);
  const pts=[];
  this.reset=()=>{pts.length=0;};
  this.push=(p,t,k)=>{pts.unshift({p:p.clone(),t,k});if(pts.length>maxPts)pts.pop();};
  const tmp=new V3(),dir=new V3(),side=new V3(),toC=new V3();
  this.build=(now,cam)=>{
    while(pts.length&&now-pts[pts.length-1].t>life)pts.pop();
    const n=pts.length;
    for(let i=0;i<maxPts;i++){
      if(i<n){const P=pts[i];const age=now-P.t;
        const Q=pts[Math.min(n-1,i+1)],Pp=pts[Math.max(0,i-1)];dir.subVectors(Pp.p,Q.p);if(dir.lengthSq()<1e-6)dir.set(1,0,0);dir.normalize();
        toC.subVectors(cam.position,P.p).normalize();side.crossVectors(dir,toC).normalize();
        const w=w0*(1+age*2.2);
        tmp.copy(P.p).addScaledVector(side,-w);pos.set([tmp.x,tmp.y,tmp.z],i*6);
        tmp.copy(P.p).addScaledVector(side,w);pos.set([tmp.x,tmp.y,tmp.z],i*6+3);
        const a=P.k*Math.pow(1-age/life,1.6)*Math.min(1,age*25+0.1)*(i<n-1?1:0);al[i*2]=al[i*2+1]=a;
      }else{al[i*2]=al[i*2+1]=0;if(n){const P=pts[n-1].p;pos.set([P.x,P.y,P.z,P.x,P.y,P.z],i*6);}}
    }
    geo.attributes.position.needsUpdate=true;geo.attributes.aA.needsUpdate=true;
  };
}
const trailCol=new THREE.Color(1.0,0.94,0.86);
const jetTrails=[new Trail(110,0.16,2.2,trailCol),new Trail(110,0.16,2.2,trailCol)];
const b2Trails=[new Trail(110,0.4,2.6,trailCol),new Trail(110,0.4,2.6,trailCol)];

/* ---------- spray ---------- */
const SPRAY_N=1400;
const sp={pos:new Float32Array(SPRAY_N*3),vel:new Float32Array(SPRAY_N*3),life:new Float32Array(SPRAY_N),max:new Float32Array(SPRAY_N),size:new Float32Array(SPRAY_N),al:new Float32Array(SPRAY_N),next:0,acc:0};
const spGeo=new THREE.BufferGeometry();spGeo.setAttribute('position',new THREE.BufferAttribute(sp.pos,3));spGeo.setAttribute('aSize',new THREE.BufferAttribute(sp.size,1));spGeo.setAttribute('aA',new THREE.BufferAttribute(sp.al,1));
const spMat=new THREE.ShaderMaterial({uniforms:{uScale:{value:500}},transparent:true,depthWrite:false,
  vertexShader:`attribute float aSize;attribute float aA;varying float vA;uniform float uScale;void main(){vA=aA;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=clamp(aSize*uScale/max(-mv.z,1.0),0.0,256.0);gl_Position=projectionMatrix*mv;}`,
  fragmentShader:`varying float vA;void main(){float d=length(gl_PointCoord-0.5)*2.0;float a=vA*smoothstep(1.0,0.1,d);gl_FragColor=vec4(vec3(1.0,0.93,0.84),a);}`});
const spPts=new THREE.Points(spGeo,spMat);spPts.frustumCulled=false;spPts.renderOrder=9;scene.add(spPts);
function sprayReset(){sp.life.fill(0);sp.al.fill(0);sp.acc=0;}
function sprayStep(dt,jp,jv){
  const str=sstep(52,20,jp.y-WATER_Y)*(onRiver(jp.x,jp.z)?1:0);
  sp.acc+=dt*800*str;const vx=jv.x,vz=jv.z;
  while(sp.acc>=1){sp.acc-=1;const i=sp.next;sp.next=(sp.next+1)%SPRAY_N;
    sp.pos[i*3]=jp.x-vx*0.02+(R()-0.5)*16;sp.pos[i*3+1]=WATER_Y+0.5;sp.pos[i*3+2]=jp.z+(R()-0.5)*14;
    const a=R()*6.283,sv=6+R()*22;sp.vel[i*3]=vx*0.12+Math.cos(a)*sv;sp.vel[i*3+1]=8+R()*26*str;sp.vel[i*3+2]=vz*0.12+Math.sin(a)*sv;
    sp.max[i]=1.2+R()*2.2;sp.life[i]=sp.max[i];}
  for(let i=0;i<SPRAY_N;i++){if(sp.life[i]<=0){sp.al[i]=0;continue;}
    sp.life[i]-=dt;const k=Math.max(0,sp.life[i]/sp.max[i]);
    sp.vel[i*3+1]-=9.8*dt;const drag=Math.exp(-dt*1.2);sp.vel[i*3]*=drag;sp.vel[i*3+2]*=drag;
    sp.pos[i*3]+=sp.vel[i*3]*dt;sp.pos[i*3+1]=Math.max(WATER_Y+0.3,sp.pos[i*3+1]+sp.vel[i*3+1]*dt);sp.pos[i*3+2]+=sp.vel[i*3+2]*dt;
    sp.size[i]=2+(1-k)*8;sp.al[i]=0.26*k*Math.min(1,(1-k)*8);}
  spGeo.attributes.position.needsUpdate=true;spGeo.attributes.aSize.needsUpdate=true;spGeo.attributes.aA.needsUpdate=true;
}



/* ---------- camera direction ---------- */
const SHOTS=[{t:0,name:'Tower Bridge',k:'tb'},{t:5.4,name:'Upriver',k:'up'},{t:8.4,name:'Cockpit',k:'pit'},{t:11,name:'Charing Cross',k:'cx'},{t:13.4,name:'Westminster',k:'wm'},{t:15.6,name:'Contact',k:'contact'},{t:18.2,name:'Westminster Bridge',k:'crowd'},{t:20.2,name:'Join up',k:'contact'},{t:22,name:'Echelon right',k:'ech'},{t:27.5,name:'Into the dusk',k:'dusk'}];
const J={p:new V3(),v:new V3(),q:new THREE.Quaternion(),f:new V3()};
const Bq={p:new V3(),v:new V3(),q:new THREE.Quaternion(),f:new V3()};
const camPos=new V3(),camTgt=new V3(),shadowF=new V3();
const _a=new V3(),_b=new V3(),_c=new V3();
const TB_C=new V3(0,32,0);
const CAM_C=(()=>{const f=riverFrame(nearestS(geo(51.4945,-0.1243).x,geo(51.4945,-0.1243).z)+110);return f.p.clone().add(new V3(0,32,0));})();
let FEND=null;const DOFS={f:100,a:0};
function shake(t,a){return _c.set(Math.sin(t*1.9)+0.5*Math.sin(t*4.3+1),Math.sin(t*2.3+2)+0.4*Math.sin(t*5.1),Math.sin(t*1.6+4)).multiplyScalar(a);}
function horiz(v,out){out.set(v.x,0,v.z);if(out.lengthSq()<1e-6)out.set(-1,0,0);return out.normalize();}
function direct(t){
  let fov=38,ext=700,idx=0,near=3,ap=2,foc=0;for(let i=0;i<SHOTS.length;i++)if(t>=SHOTS[i].t)idx=i;
  const k=SHOTS[idx].k;camera.up.set(0,1,0);
  const hf=horiz(Bq.v,new V3()),right=new V3().crossVectors(hf,UP);
  const jf=horiz(J.v,new V3()),jside=new V3().crossVectors(jf,UP);
  if(k==='tb'){const f=riverFrame(sTB+335-t*5);camPos.copy(f.p).addScaledVector(f.n,-21);camPos.y=WATER_Y+7.5+0.4*Math.sin(t*0.9);camPos.add(shake(t,0.25));
    camTgt.copy(TB_C).lerp(_a.copy(J.p).addScaledVector(J.v,0.03),sstep(0.6,4.3,t));fov=36;shadowF.copy(f.p);ext=520;ap=3;}
  else if(k==='up'){const s=(t-5.4)/3.0;camPos.copy(J.p).addScaledVector(jf,-(105-25*s)).addScaledVector(jside,-(50-18*s));camPos.y=Math.max(WATER_Y+12,J.p.y-10+4*s);camPos.add(shake(t,0.5));
    camTgt.copy(J.p).addScaledVector(jf,70);camTgt.y-=4;fov=34;shadowF.copy(J.p).addScaledVector(jf,250);ext=700;ap=2;}
  else if(k==='pit'){near=0.03;camPos.set(0.1,1.17,3.36).applyQuaternion(J.q).add(J.p);camPos.add(shake(t*3,0.012));camTgt.set(-0.05,-0.2,40).applyQuaternion(J.q).add(J.p);
    camera.up.set(0,1,0).applyQuaternion(J.q);fov=48;shadowF.copy(J.p);ext=30;ap=1.4;foc=400;drawHUD(t);}
  else if(k==='cx'){const H=HUNG;camPos.set(10.0,H.DK+1.55,38).add(shake(t,0.05));H.g.localToWorld(camPos);
    const w=sstep(11.5,12.6,t);_a.set(-1.2,H.DK+2.0,Math.min(-123.2+13*t,20));H.g.localToWorld(_a);camTgt.copy(_a).lerp(J.p,w*0.62);fov=lerp(40,52,w);shadowF.copy(camPos);ext=260;ap=6;foc=lerp(camPos.distanceTo(_a),camPos.distanceTo(J.p),w);}
  else if(k==='wm'){const s=(t-13.4)/2.2;camPos.copy(CAM_C).add(shake(t,0.3));camTgt.copy(J.p).lerp(PARL.ET,lerp(0.45,0.2,s));fov=20;shadowF.copy(CAM_C).addScaledVector(_a.copy(PARL.ET).sub(CAM_C).setY(0).normalize(),500);ext=700;ap=5;}
  else if(k==='contact'){const s=sstep(15.6,22,t);camPos.copy(J.p).addScaledVector(jf,-lerp(48,40,s)).addScaledVector(jside,lerp(-26,24,s));camPos.y+=lerp(22,9,s);camPos.add(shake(t,0.6));
    camTgt.copy(J.p).addScaledVector(jf,40).lerp(Bq.p,lerp(0.3,0.5,s));fov=lerp(58,40,s);shadowF.copy(J.p).addScaledVector(jf,200);ext=800;ap=2.5;}
  else if(k==='crowd'){const W=WESTB;camPos.set(-7.2,W.DK+1.35,12).add(shake(t,0.04));W.g.localToWorld(camPos);camTgt.copy(Bq.p).lerp(J.p,0.3);camTgt.y-=camPos.distanceTo(Bq.p)*0.14;
    fov=34;shadowF.copy(camPos);ext=260;ap=14;foc=camPos.distanceTo(Bq.p);}
  else if(k==='ech'){const s=(t-22)/5.5;camPos.copy(Bq.p).addScaledVector(right,170).addScaledVector(hf,90-30*s).add(_a.set(0,-18,0)).add(shake(t,0.7));
    camTgt.copy(Bq.p).lerp(J.p,0.45);fov=31;shadowF.copy(Bq.p);ext=900;ap=2.2;}
  else{const s=sstep(27.5,37,t);
    if(!FEND){const bp=new V3(),bq=new V3();b2Track(27.5,bp);b2Track(27.6,bq);const h=horiz(bq.sub(bp),new V3());const r=new V3().crossVectors(h,UP);FEND=bp.clone().addScaledVector(h,-450).addScaledVector(r,1150);FEND.y=bp.y+700;}
    _a.copy(Bq.p).addScaledVector(hf,-400).addScaledVector(right,120);_a.y-=30;
    camPos.copy(_a).lerp(FEND,s).add(shake(t,0.8*(1-s)));
    camTgt.copy(Bq.p).lerp(J.p,0.4);camTgt.y+=320*s;fov=lerp(36,44,s);shadowF.copy(Bq.p).lerp(_b.copy(Bq.p).addScaledVector(hf,-600),s);shadowF.y=0;ext=lerp(900,2600,s);ap=1.0;}
  if(camera.near!==near){camera.near=near;camera.updateProjectionMatrix();}
  camera.position.copy(camPos);camera.lookAt(camTgt);
  if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
  DOFS.f=foc||Math.max(15,camera.position.distanceTo(camTgt));DOFS.a=ap;DOFS.m=(k==='crowd'||k==='cx')?22:(k==='pit'?16:12);
  shadowF.y=LAND_Y;setShadowFocus(shadowF,ext);
  return idx;
}

/* ---------- people, train, cockpit interior ---------- */
function mergeCol(list){let n=0;const L=list.map(([g0,c])=>{const g=g0.index?g0.toNonIndexed():g0;if(!g.attributes.normal)g.computeVertexNormals();n+=g.attributes.position.count;return[g,c];});
  const pos=new Float32Array(n*3),nrm=new Float32Array(n*3),col=new Float32Array(n*3);let o=0;
  for(const [g,c] of L){pos.set(g.attributes.position.array,o*3);nrm.set(g.attributes.normal.array,o*3);for(let i=0;i<g.attributes.position.count;i++){col[(o+i)*3]=c.r;col[(o+i)*3+1]=c.g;col[(o+i)*3+2]=c.b;}o+=g.attributes.position.count;}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nrm,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));return g;}
const _pc=(hex,j)=>{const c=new THREE.Color(hex);if(j){c.offsetHSL(0,0,(R()-0.5)*j);}return c;};
function limb(a,b,r0,r1,seg){const d=new V3().subVectors(b,a);const len=d.length();const g=new THREE.CylinderGeometry(r1,r0,len,seg||8,1);g.translate(0,len/2,0);
  const q=new THREE.Quaternion().setFromUnitVectors(UP,d.clone().normalize());g.applyMatrix4(new THREE.Matrix4().compose(a,q,new V3(1,1,1)));return g;}
function ball(p,sx,sy,sz,seg){const g=new THREE.SphereGeometry(1,seg||10,Math.max(6,(seg||10)-3));g.scale(sx,sy,sz);g.translate(p.x,p.y,p.z);return g;}
const POSES=['pocket','point','phone','shade','rail','mouth','phone'];
function personBody(pose,k,C){ // returns list of [geo,color] in person-local space (height scale k)
  const L=[];const top=C.top,bot=C.bot,skin=C.skin,shoe=C.shoe;
  const V=(x,y,z)=>new V3(x,y*k,z);
  // legs with slight contrapposto
  const lean=(R()-0.5)*0.06;
  for(const sx of [-1,1]){const hip=V(sx*0.09+lean,0.92,0),knee=V(sx*0.095+lean*0.5,0.5,0.02),ank=V(sx*0.1,0.09,-0.01);
    L.push([limb(hip,knee,0.078,0.062,9),bot],[limb(knee,ank,0.056,0.043,9),bot],[ball(V(sx*0.1,0.045,0.06),0.055,0.045*k,0.13,8),shoe]);}
  L.push([ball(V(lean,0.95,0),0.175,0.12*k,0.12),bot]);
  // torso lathe (waist to shoulders), coat
  const prof=[[0.0,0.88],[0.155,0.9],[0.15,1.0],[0.142,1.08],[0.16,1.2],[0.18,1.3],[0.19,1.38],[0.165,1.45],[0.07,1.5],[0.0,1.5]].map(p=>new THREE.Vector2(p[0],p[1]*k));
  const tor=new THREE.LatheGeometry(prof,12);tor.scale(1,1,0.62);tor.translate(lean*0.5,0,0);L.push([tor,top]);
  if(C.long){const sk=new THREE.CylinderGeometry(0.17,0.23,0.42*k,12,1,true);sk.scale(1,1,0.72);sk.translate(lean*0.5,0.72*k,0);L.push([sk,top]);}
  if(C.bag){const b=new THREE.BoxGeometry(0.28,0.36*k,0.13);b.translate(0,1.22*k,-0.15);L.push([b,C.bagc]);}
  if(C.scarf)L.push([ball(V(0,1.47,0.01),0.085,0.04*k,0.07),C.scarf]);
  L.push([limb(V(0,1.47,0),V(0,1.56,0.01),0.05,0.045,8),skin]);
  // arms
  const arm=(sx,f,ab,b)=>{const sh=V(sx*0.19,1.41,0);L.push([ball(sh,0.07,0.07*k,0.07),top]);
    const d1=new V3(sx*Math.sin(ab),-Math.cos(f),Math.sin(f)).normalize();const el=sh.clone().addScaledVector(d1,0.29*k);
    const d2=new V3(sx*Math.sin(ab)*0.6,-Math.cos(f+b),Math.sin(f+b)).normalize();const wr=el.clone().addScaledVector(d2,0.26*k);
    L.push([limb(sh,el,0.058,0.05,8),top],[limb(el,wr,0.048,0.04,8),top]);const hd=wr.clone().addScaledVector(d2,0.06*k);L.push([ball(hd,0.04,0.075*k,0.028,8),skin]);return hd;};
  const j=()=>(R()-0.5)*0.25;
  let hands;
  switch(pose){
    case 'point':arm(-1,0.1+j(),0.08,0.2);hands=arm(1,2.35+j(),0.15,0.1);break;
    case 'phone':{arm(-1,0.75+j()*0.5,0.25,1.55);const h=arm(1,0.75+j()*0.5,0.25,1.55);const ph=new THREE.BoxGeometry(0.075,0.15,0.012);ph.translate(h.x-0.17,h.y+0.02,h.z+0.02);L.push([ph,new THREE.Color(0.02,0.02,0.025)]);C.phoneAt=new V3(h.x-0.17,h.y+0.02,h.z+0.03);break;}
    case 'shade':arm(-1,0.08+j(),0.1,0.25);arm(1,1.55+j()*0.4,0.35,1.6);break;
    case 'rail':arm(-1,0.62+j()*0.3,0.12,0.35);arm(1,0.62+j()*0.3,0.12,0.35);break;
    case 'mouth':arm(-1,0.1+j(),0.08,0.3);arm(1,0.55,0.45,2.2);break;
    default:arm(-1,-0.12+j()*0.3,0.14,0.35);arm(1,-0.12+j()*0.3,0.14,0.35);}
  return L;}
const TOPS=[0x141922,0x1b1d21,0x4f4233,0x3f434a,0x5a1619,0x2b3629,0x8a7c64,0x222b3f,0x5d6167,0x362519,0x6d6a62,0x1e3d5a];
const BOTS=[0x1d2533,0x16181c,0x3a3d44,0x2b3140,0x5a4a3a,0x44474d];const SKT=[0xe3bea5,0xd1a283,0xa9785a,0x7d5139,0x573725,0xf1d2bd,0xc58e6c];
const HRC=[0x16110d,0x2e2117,0x5a4026,0xa98a58,0x807a74,0x0e0e0e,0x6b3a1e];const HATC=[0x1a1a1a,0x7a1e22,0x2c3e5c,0x6b6b6b,0xc9b48a];
const headGeo=(()=>{const h=ball(new V3(0,0,0),0.092,0.118,0.105,16);const n=new THREE.ConeGeometry(0.02,0.045,6);n.rotateX(Math.PI/2);n.translate(0,-0.01,0.105);
  const e1=ball(new V3(0.09,-0.005,-0.005),0.014,0.028,0.02,6),e2=ball(new V3(-0.09,-0.005,-0.005),0.014,0.028,0.02,6);const j=ball(new V3(0,-0.07,0.03),0.07,0.05,0.07,10);
  return mergeGeos([h,n,e1,e2,j]);})();
const HAIR=[ (()=>{const g=new THREE.SphereGeometry(0.1,16,10,0,Math.PI*2,0,1.95);g.scale(0.99,1.1,1.1);g.translate(0,0.012,-0.012);return g;})(),
  (()=>mergeGeos([(()=>{const g=new THREE.SphereGeometry(0.104,16,10,0,Math.PI*2,0,2.0);g.scale(1,1.12,1.12);g.translate(0,0.012,-0.015);return g;})(),new THREE.BoxGeometry(0.2,0.24,0.06).translate(0,-0.1,-0.085)]))(),
  (()=>mergeGeos([(()=>{const g=new THREE.SphereGeometry(0.106,16,10,0,Math.PI*2,0,1.55);g.scale(1,1.15,1.08);g.translate(0,0.02,-0.005);return g;})(),new THREE.TorusGeometry(0.098,0.018,6,16).rotateX(Math.PI/2).translate(0,0.035,-0.005)]))()];
const PEOPLE=[];
function crowd(parent,list){ // [x,y,z,yaw,poseIndex]
  const bodies=[],heads=[];const pm=new THREE.Matrix4(),q=new THREE.Quaternion(),phones=[];
  list.forEach(p=>{const kid=R()<0.08;const k=kid?0.68:(0.93+R()*0.14);const pose=kid?'pocket':POSES[p[4]%POSES.length];
    const C={top:_pc(pick(TOPS),0.06),bot:_pc(pick(BOTS),0.05),skin:_pc(pick(SKT),0.04),shoe:_pc(R()<0.7?0x141414:0xdcdcdc),long:R()<0.35,bag:R()<0.25,bagc:_pc(pick([0x111111,0x3a2a1c,0x2b3a4a])),scarf:R()<0.18?_pc(pick([0x7a1e22,0xb8a070,0x2c3e5c])):null};
    q.setFromAxisAngle(UP,p[3]);pm.compose(new V3(p[0],p[1],p[2]),q,new V3(1,1,1));
    for(const [g,c] of personBody(pose,k,C)){g.applyMatrix4(pm);bodies.push([g,c]);}
    if(C.phoneAt)phones.push(C.phoneAt.clone().applyMatrix4(pm).toArray().concat([p[3]]));
    const hs=R();heads.push({p:new V3(p[0],p[1]+1.635*k,p[2]),yaw:p[3],k,skin:C.skin,style:hs<0.12?-1:hs<0.55?0:hs<0.8?1:2,hc:_pc(hs>=0.8?pick(HATC):pick(HRC),0.05)});});
  const bm=new THREE.Mesh(mergeCol(bodies),new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.88}));bm.castShadow=true;bm.receiveShadow=true;bm.frustumCulled=false;parent.add(bm);
  if(phones.length){const im=new THREE.InstancedMesh(new THREE.PlaneGeometry(0.066,0.135),new THREE.MeshBasicMaterial({color:new THREE.Color(1.5,1.6,1.9),side:THREE.DoubleSide}),phones.length);const m4=new THREE.Matrix4();
    phones.forEach((a,i)=>{q.setFromAxisAngle(UP,a[3]+Math.PI);m4.compose(new V3(a[0],a[1],a[2]),q,new V3(1,1,1));im.setMatrixAt(i,m4);});im.frustumCulled=false;parent.add(im);}
  const hm=new THREE.InstancedMesh(headGeo,new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.5}),heads.length);hm.castShadow=true;hm.frustumCulled=false;
  heads.forEach((h,i)=>hm.setColorAt(i,h.skin));parent.add(hm);
  const hairM=HAIR.map((g,si)=>{const idx=heads.map((h,i)=>h.style===si?i:-1).filter(i=>i>=0);if(!idx.length)return null;const im=new THREE.InstancedMesh(g,new THREE.MeshStandardMaterial({color:0xffffff,roughness:si===2?0.95:0.75}),idx.length);
    idx.forEach((hi,j)=>im.setColorAt(j,heads[hi].hc));im.castShadow=true;im.frustumCulled=false;parent.add(im);return{im,idx};}).filter(Boolean);
  PEOPLE.push({parent,heads,hm,hairM,react:heads.map(()=>R())});
}
const _hl=new V3(),_hq=new THREE.Quaternion(),_he=new THREE.Euler(0,0,0,'YXZ'),_hm=new THREE.Matrix4(),_hs=new V3();
function updatePeople(t){
  for(const P0 of PEOPLE){const tgtW=(t<17.2?J.p:Bq.p);_hl.copy(tgtW);P0.parent.worldToLocal(_hl);const t0=(WESTB&&P0.parent===WESTB.g)?15.8:11.2;
    const mats=P0.heads.map((h,i)=>{const dx=_hl.x-h.p.x,dy=_hl.y-h.p.y,dz=_hl.z-h.p.z;let yaw=Math.atan2(dx,dz),pitch=-Math.atan2(dy,Math.hypot(dx,dz));
      let ry=yaw-h.yaw;ry=Math.atan2(Math.sin(ry),Math.cos(ry));ry=clamp(ry,-1.2,1.2);pitch=clamp(pitch,-0.95,0.3);
      const idle=Math.sin(t*0.6+i*1.7)*0.35,w=sstep(t0+P0.react[i]*0.8,t0+0.3+P0.react[i]*0.8,t);
      _he.set(lerp(0.15,pitch,w),h.yaw+lerp(idle,ry,w),Math.sin(t*0.9+i)*0.04*(1-w));_hq.setFromEuler(_he);_hs.set(h.k,h.k,h.k);return new THREE.Matrix4().compose(h.p,_hq,_hs);});
    mats.forEach((m,i)=>P0.hm.setMatrixAt(i,m));P0.hm.instanceMatrix.needsUpdate=true;
    for(const hs of P0.hairM){hs.idx.forEach((hi,j)=>hs.im.setMatrixAt(j,mats[hi]));hs.im.instanceMatrix.needsUpdate=true;}}
}

// Southeastern train out of Charing Cross over Hungerford Bridge
let TRAIN=null;
function buildTrain(H){const g=new THREE.Group();H.g.add(g);const L=20,cars=8;
  const white=M(0xd9dde0,{roughness:0.3,metalness:0.35}),blue=M(0x16306e,{roughness:0.4}),yel=M(0xf2c318,{roughness:0.4}),gl=M(0x0b1016,{roughness:0.05,metalness:0.9}),dk=M(0x2a2c30,{roughness:0.7});
  for(let k=0;k<cars;k++){const z=-k*(L+0.8);const sh=new THREE.Shape();sh.moveTo(-L/2,0.6);sh.lineTo(L/2,0.6);sh.lineTo(L/2,3.4);sh.quadraticCurveTo(L/2,3.85,L/2-0.6,3.85);sh.lineTo(-L/2+0.6,3.85);sh.quadraticCurveTo(-L/2,3.85,-L/2,3.4);sh.closePath();
    const ge=new THREE.ExtrudeGeometry(sh,{depth:2.8,bevelEnabled:false,curveSegments:5});ge.translate(0,0,-1.4);ge.rotateY(-Math.PI/2);const b=new THREE.Mesh(ge,white);b.position.set(0,0,z);b.castShadow=true;g.add(b);
    const w1=new THREE.Mesh(new THREE.BoxGeometry(2.84,0.9,L-2),gl);w1.position.set(0,2.35,z);g.add(w1);const b1=new THREE.Mesh(new THREE.BoxGeometry(2.84,0.9,L-0.4),blue);b1.position.set(0,1.1,z);g.add(b1);
    const u=new THREE.Mesh(new THREE.BoxGeometry(2.4,0.6,L-3),dk);u.position.set(0,0.35,z);g.add(u);
    if(k===0){const f=new THREE.Mesh(new THREE.BoxGeometry(2.7,2.2,0.3),yel);f.position.set(0,1.8,z+L/2+0.1);g.add(f);const fw=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.9,0.1),gl);fw.position.set(0,2.6,z+L/2+0.27);g.add(fw);
      for(const sx of [-0.9,0.9]){const hl=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.18,0.05),new THREE.MeshBasicMaterial({color:new THREE.Color(4,4,3.6)}));hl.position.set(sx,1.2,z+L/2+0.27);g.add(hl);}}}
  TRAIN={g,H};}
function updateTrain(t){if(!TRAIN)return;TRAIN.g.position.set(-1.2,TRAIN.H.DK-0.5,-123.2+13*t);}
// cockpit interior + live HUD
const hudCanvas=document.createElement('canvas');hudCanvas.width=hudCanvas.height=256;const hudTex=new THREE.CanvasTexture(hudCanvas);
function buildCockpit(){const g=F16.g;const flight=M(0x4b503d,{roughness:0.9}),panelM=new THREE.MeshBasicMaterial({color:0x08090a});
  const pnl=new THREE.Mesh(new THREE.BoxGeometry(0.72,0.34,0.12),panelM);pnl.position.set(0,0.8,3.98);pnl.rotation.x=-0.35;g.add(pnl);
  const glare=new THREE.Mesh(new THREE.BoxGeometry(0.66,0.05,0.28),panelM);glare.position.set(0,0.97,3.92);g.add(glare);
  const mfd=(x,draw)=>{const c=canvasTex(128,128,draw);const m=new THREE.Mesh(new THREE.PlaneGeometry(0.17,0.17),new THREE.MeshBasicMaterial({map:c,color:new THREE.Color(1.3,1.3,1.3)}));m.position.set(x,0.81,3.91);m.rotation.set(-0.35,Math.PI,0);g.add(m);};
  mfd(-0.2,(c,w,h)=>{c.fillStyle='#020802';c.fillRect(0,0,w,h);c.strokeStyle='#2cff6a';c.lineWidth=1.5;for(let r=20;r<64;r+=14){c.beginPath();c.arc(64,120,r*1.8,3.6,5.8);c.stroke();}c.beginPath();c.moveTo(64,120);c.lineTo(20,40);c.moveTo(64,120);c.lineTo(108,40);c.stroke();c.fillStyle='#2cff6a';c.fillRect(70,50,6,6);c.font='10px monospace';c.fillText('RWS 40',6,12);});
  mfd(0.2,(c,w,h)=>{c.fillStyle='#050704';c.fillRect(0,0,w,h);c.strokeStyle='#5fb0ff';c.lineWidth=5;c.beginPath();c.moveTo(0,70);c.bezierCurveTo(40,60,50,95,80,80);c.bezierCurveTo(100,70,110,40,128,50);c.stroke();c.fillStyle='#ffd24a';c.beginPath();c.moveTo(64,68);c.lineTo(58,82);c.lineTo(70,82);c.fill();c.font='10px monospace';c.fillText('HSD  THAMES',6,12);});
  const hud=new THREE.Mesh(new THREE.PlaneGeometry(0.28,0.28),new THREE.MeshBasicMaterial({map:hudTex,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,color:new THREE.Color(2.6,2.6,2.6)}));hud.position.set(0,1.13,3.86);hud.rotation.y=Math.PI;hud.renderOrder=9;g.add(hud);
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.36,0.26),flight);torso.position.set(0,0.7,3.24);g.add(torso);
  for(const sx of [-1,1]){const st=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.36,0.27),M(0x2b2e28));st.position.set(sx*0.1,0.71,3.24);g.add(st);const sh=new THREE.Mesh(new THREE.SphereGeometry(0.1,10,8),flight);sh.position.set(sx*0.2,0.84,3.24);g.add(sh);}
  const seat=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.42,0.1),M(0x232528));seat.position.set(0,0.96,3.02);g.add(seat);
  const hb=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.05,0.04),M(0xe8c21a));hb.position.set(0,1.18,3.0);g.add(hb);
  const mask=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.07,0.12,10).rotateX(Math.PI/2),M(0x3a3d3f,{roughness:0.6}));mask.position.set(0,0.92,3.4);g.add(mask);
  const hose=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(0,0.7,3.44),new V3(0.08,0.6,3.4),new V3(0.14,0.5,3.3)]),10,0.018,6,false),M(0x2a2c2e));g.add(hose);
  const helmBack=new THREE.Mesh(new THREE.SphereGeometry(0.176,18,12,Math.PI*0.6,Math.PI*0.8,0.4,1.9),M(0x3d4246,{roughness:0.5}));helmBack.position.set(0,0.98,3.25);g.add(helmBack);
  F16.g.traverse(o=>{if(o.isMesh&&o.material&&o.material.opacity===0.55&&o.material.transparent){o.material.side=THREE.DoubleSide;o.material.opacity=0.26;}});
}
function drawHUD(t){const c=hudCanvas.getContext('2d'),w=256;c.clearRect(0,0,w,w);c.strokeStyle=c.fillStyle='#6dff8c';c.lineWidth=2;c.font='bold 15px monospace';
  const e=new THREE.Euler().setFromQuaternion(J.q,'YXZ');const roll=-e.z,pitch=-e.x;
  c.save();c.translate(128,128);c.rotate(roll);for(let k=-3;k<=3;k++){const y=(pitch*57.3-k*5)*6;if(Math.abs(y)>110)continue;c.beginPath();c.moveTo(-60,y);c.lineTo(-22,y);c.moveTo(22,y);c.lineTo(60,y);if(k<0)c.setLineDash([6,5]);c.stroke();c.setLineDash([]);c.fillText(String(Math.abs(k*5)),64,y+5);}c.restore();
  c.beginPath();c.arc(128,128,6,0,6.283);c.moveTo(116,128);c.lineTo(122,128);c.moveTo(134,128);c.lineTo(140,128);c.moveTo(128,122);c.lineTo(128,116);c.stroke();
  const kts=Math.round(J.v.length()*1.944),ft=Math.round((J.p.y-WATER_Y)*3.281/10)*10,hdg=Math.round(((Math.atan2(J.v.x,-J.v.z)*57.3)+360)%360);
  c.strokeRect(8,116,54,24);c.fillText(String(kts),14,134);c.strokeRect(194,116,56,24);c.fillText(String(ft),198,134);
  c.fillText(String(hdg).padStart(3,'0'),110,26);c.beginPath();c.moveTo(60,34);c.lineTo(196,34);c.stroke();for(let k=-4;k<=4;k++){c.beginPath();c.moveTo(128+k*16-((hdg%5)*3.2),34);c.lineTo(128+k*16-((hdg%5)*3.2),40);c.stroke();}
  c.font='12px monospace';c.fillText('M 0.'+String(Math.min(99,Math.round(J.v.length()/3.4))).padStart(2,'0'),10,160);c.fillText((5.2+2.5*Math.sin(t*1.3)).toFixed(1)+'G',10,100);c.fillText('ARM',210,236);
  hudTex.needsUpdate=true;}

const HUNG=BRG.find(b=>Math.abs(b.lat-51.5066)<1e-4),WESTB=BRG.find(b=>Math.abs(b.lat-51.5008)<1e-4);
{const PP=()=>Math.floor(R()*7);const L1=[];for(let z=-70;z<60;z+=0.8+R()*1.1){if(R()<0.12)continue;L1.push([12.9+R()*0.35,HUNG.DK,z,Math.PI/2+(R()-0.5)*0.45,PP()]);if(R()<0.4)L1.push([11.8+R()*0.6,HUNG.DK,z+0.4,Math.PI/2+(R()-0.5)*0.9,PP()]);}crowd(HUNG.g,L1);
 add(new THREE.BoxGeometry(0.07,0.06,2*HW+60),M(0xd9dde0,{metalness:0.6,roughness:0.35}),13.55,HUNG.DK+1.1,0,HUNG.g);{const rp=[];for(let z=-(HW+30);z<HW+30;z+=2)rp.push(TM(13.55,HUNG.DK+0.55,z,0.04,1.1,0.04));inst(new THREE.BoxGeometry(1,1,1),M(0xd9dde0,{metalness:0.6}),rp,HUNG.g);}
 const L2=[];for(let z=-70;z<60;z+=0.75+R()*0.9){if(R()<0.08)continue;L2.push([-11.25+R()*0.3,WESTB.DK-0.1,z,-Math.PI/2+(R()-0.5)*0.45,PP()]);if(R()<0.5)L2.push([-10.2+R()*0.8,WESTB.DK-0.1,z+0.35,-Math.PI/2+(R()-0.5)*0.9,PP()]);}crowd(WESTB.g,L2);}
buildTrain(HUNG);buildCockpit();
/* ---------- simulation ---------- */
const _tp=new V3();let simT=0;
function poseAt(t){
  jetPos(t,J.p);jetPos(t-0.05,_a);jetPos(t+0.05,_b);J.v.subVectors(_b,_a).divideScalar(0.1);
  orientFrom(jetPos,t,1.6,jetRoll(t),J.q,1.25);J.f.set(0,0,1).applyQuaternion(J.q);
  b2Track(t,Bq.p);b2Track(t-0.05,_a);b2Track(t+0.05,_b);Bq.v.subVectors(_b,_a).divideScalar(0.1);
  b2Orient(t,Bq.q);Bq.f.set(0,0,1).applyQuaternion(Bq.q);
  F16.g.position.copy(J.p);F16.g.quaternion.copy(J.q);F16.g.updateMatrixWorld();
  B2.g.position.copy(Bq.p);B2.g.quaternion.copy(Bq.q);B2.g.visible=t>12.3;B2.g.updateMatrixWorld();
}
function stepSim(t,dt){
  poseAt(t);const vap=jetVapor(t),spd=J.v.length();
  const k=0.12+0.88*Math.max(vap,sstep(250,300,spd)*0.35);
  for(let i=0;i<2;i++){_tp.copy(F16.tips[i]).applyMatrix4(F16.g.matrixWorld);jetTrails[i].push(_tp,t,k);}
  const kb=0.1+0.35*sstep(13,15,t)*(1-sstep(20,22,t))+0.3*sstep(28,30,t);
  for(let i=0;i<2;i++){_tp.copy(B2.tips[i]).applyMatrix4(B2.g.matrixWorld);b2Trails[i].push(_tp,t,kb);}
  sprayStep(dt,J.p,J.v);
}
function resetSim(){jetTrails.forEach(x=>x.reset());b2Trails.forEach(x=>x.reset());sprayReset();}
function seekTo(t){resetSim();const t0=Math.max(0,t-2.6);for(let s=t0;s<t;s+=1/40)stepSim(s,1/40);simT=t;}

/* ---------- HDR pipeline: reflections, volumetric clouds, aerial perspective, god rays, bloom, grade, FXAA ---------- */
let P=null;
const QUAL={refl:true,cloudSteps:44};
function buildPipeline(){
  if(!HQ)return;
  try{
    const HF=THREE.HalfFloatType;const mk=(depth)=>new THREE.WebGLRenderTarget(4,4,{type:HF,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:!!depth});
    const rtScene=mk(true);rtScene.depthTexture=new THREE.DepthTexture(4,4);rtScene.depthTexture.type=THREE.FloatType;
    const rtRefl=mk(true),rtCloud=mk(false),rtA=mk(false);
    const rtB=new THREE.WebGLRenderTarget(4,4,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
    const noise=makeNoise3D(64);
    const vs=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
    const common=`uniform mat4 uInvProj,uCamWorld;uniform vec3 uCam,uSun;
      vec3 worldAt(vec2 uv,float d){vec4 c=vec4(uv*2.0-1.0,d*2.0-1.0,1.0);vec4 v=uInvProj*c;v/=v.w;return (uCamWorld*vec4(v.xyz,1.0)).xyz;}${HAZE}`;
    const blobs=[];for(let i=0;i<4;i++)blobs.push(new THREE.Vector4(0,0,0,1));const blobP=[];for(let i=0;i<4;i++)blobP.push(new V3(0,1,0));
    const cloudMat=new THREE.ShaderMaterial({
      uniforms:{tDepth:{value:rtScene.depthTexture},tNoise:{value:noise},uInvProj:{value:new THREE.Matrix4()},uCamWorld:{value:new THREE.Matrix4()},uCam:{value:new V3()},uSun:{value:SUN_DIR},
        uSunCol:{value:new V3(1.0,0.64,0.40).multiplyScalar(3.2)},uTime:{value:0},uBlob:{value:blobs},uBlobP:{value:blobP},uSteps:{value:44}},
      vertexShader:vs,depthWrite:false,depthTest:false,
      fragmentShader:`precision highp sampler3D;uniform sampler2D tDepth;uniform sampler3D tNoise;uniform vec3 uSunCol;uniform float uTime;uniform vec4 uBlob[4];uniform vec3 uBlobP[4];uniform int uSteps;varying vec2 vUv;
      ${common}
      float hg(float m,float g){float g2=g*g;return (1.0-g2)/(12.566*pow(1.0+g2-2.0*g*m,1.5));}
      float cov(vec3 p){float c=0.0;
        for(int i=0;i<4;i++){vec2 q=(p.xz-uBlob[i].xz)/uBlob[i].w;float r=dot(q,q);float h=(p.y-uBlobP[i].x)/uBlobP[i].y;
          float hp=smoothstep(0.0,0.1,h)*smoothstep(1.0,0.35,h);c=max(c,clamp(1.0-r,0.0,1.0)*hp*uBlobP[i].z);}
        float h2=(p.y-1150.0)/420.0;if(h2>0.0&&h2<1.0){float m=texture(tNoise,vec3(p.xz*0.00005,0.37)).r;c=max(c,smoothstep(0.52,0.75,m)*smoothstep(0.0,0.15,h2)*smoothstep(1.0,0.4,h2)*0.95);}
        return c;}
      float dens(vec3 p){float c=cov(p);if(c<=0.01)return 0.0;vec3 w=vec3(uTime*5.0,0.0,uTime*2.0);
        float n=texture(tNoise,(p+w)*0.0015).r;float s=clamp((n-(1.0-c))/max(c,0.05),0.0,1.0);if(s<=0.0)return 0.0;
        float d=texture(tNoise,(p+w*1.6)*0.0062).r;return clamp(s-(1.0-d)*0.4*(1.0-s),0.0,1.0);}
      void main(){float depth=texture2D(tDepth,vUv).r;vec3 rd=normalize(worldAt(vUv,1.0)-uCam);
        float sd=depth>=0.99999?1e7:length(worldAt(vUv,depth)-uCam);
        float y0=430.0,y1=1570.0,ta,tb;
        if(abs(rd.y)<1e-5){if(uCam.y<y0||uCam.y>y1){gl_FragColor=vec4(0,0,0,1);return;}ta=0.0;tb=1e7;}
        else{float a=(y0-uCam.y)/rd.y,b=(y1-uCam.y)/rd.y;ta=max(min(a,b),0.0);tb=max(a,b);}
        tb=min(tb,min(sd,18000.0));if(tb<=ta){gl_FragColor=vec4(0,0,0,1);return;}
        float dt=(tb-ta)/float(uSteps);float jit=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);float t=ta+dt*jit;
        float T=1.0;vec3 L=vec3(0.0);float mu=dot(rd,uSun);float ph=0.75*hg(mu,0.6)+0.25*hg(mu,-0.25);
        for(int i=0;i<64;i++){if(i>=uSteps||t>tb||T<0.02)break;vec3 p=uCam+rd*t;float d=dens(p);
          if(d>0.0){float sig=d*0.012;float ld=0.0;for(int j=1;j<=4;j++)ld+=dens(p+uSun*float(j)*60.0);float lt=exp(-ld*60.0*0.012);
            float powder=1.0-exp(-sig*120.0);float hn=clamp((p.y-y0)/350.0,0.0,1.0);
            vec3 amb=mix(vec3(0.28,0.26,0.32),vec3(0.55,0.58,0.72),hn);
            vec3 S=(uSunCol*lt*ph*mix(1.0,powder,0.5)*7.0+amb)*sig;float st=exp(-sig*dt);L+=T*(S-S*st)/max(sig,1e-6);T*=st;}
          t+=dt;}
        float fd=1.0-exp(-ta*0.00007);L=mix(L,hazeCol(rd,uSun)*(1.0-T),fd*0.85);
        gl_FragColor=vec4(L,T);}`
    });
    const CLOUD_GLSL=`      float cov(vec3 p){float c=0.0;
        for(int i=0;i<4;i++){vec2 q=(p.xz-uBlob[i].xz)/uBlob[i].w;float r=dot(q,q);float h=(p.y-uBlobP[i].x)/uBlobP[i].y;
          float hp=smoothstep(0.0,0.1,h)*smoothstep(1.0,0.35,h);c=max(c,clamp(1.0-r,0.0,1.0)*hp*uBlobP[i].z);}
        float h2=(p.y-1150.0)/420.0;if(h2>0.0&&h2<1.0){float m=texture(tNoise,vec3(p.xz*0.00005,0.37)).r;c=max(c,smoothstep(0.52,0.75,m)*smoothstep(0.0,0.15,h2)*smoothstep(1.0,0.4,h2)*0.95);}
        return c;}
      float dens(vec3 p){float c=cov(p);if(c<=0.01)return 0.0;vec3 w=vec3(uTime*5.0,0.0,uTime*2.0);
        float n=texture(tNoise,(p+w)*0.0015).r;float s=clamp((n-(1.0-c))/max(c,0.05),0.0,1.0);if(s<=0.0)return 0.0;
        float d=texture(tNoise,(p+w*1.6)*0.0062).r;return clamp(s-(1.0-d)*0.4*(1.0-s),0.0,1.0);}
`;
    const atmosMat=new THREE.ShaderMaterial({
      uniforms:{tScene:{value:rtScene.texture},tDepth:{value:rtScene.depthTexture},tCloud:{value:rtCloud.texture},tNoise:{value:noise},uBlob:{value:blobs},uBlobP:{value:blobP},uTime:{value:0},uFrame:{value:0},uAO:{value:0.75},uViewProj:{value:new THREE.Matrix4()},
        uInvProj:{value:cloudMat.uniforms.uInvProj.value},uCamWorld:{value:cloudMat.uniforms.uCamWorld.value},uCam:{value:cloudMat.uniforms.uCam.value},uSun:{value:SUN_DIR},uSunCol:{value:new V3(1.0,0.62,0.36)},uSunUV:{value:new THREE.Vector2()},uSunVis:{value:0},uAspect:{value:2.39}},
      vertexShader:vs,depthWrite:false,depthTest:false,
      fragmentShader:`precision highp sampler3D;uniform sampler2D tScene,tDepth,tCloud;uniform sampler3D tNoise;uniform vec4 uBlob[4];uniform vec3 uBlobP[4];uniform float uTime,uFrame,uAO;uniform mat4 uViewProj;uniform vec3 uSunCol;uniform vec2 uSunUV;uniform float uSunVis,uAspect;varying vec2 vUv;${common}${CLOUD_GLSL}
      float hfog(vec3 ro,vec3 rd,float dist){float a=0.00013,b=1.0/280.0;float base=a*exp(-max(ro.y,0.0)*b);float f;
        if(abs(rd.y)<1e-4)f=base*dist;else f=base*(1.0-exp(-dist*rd.y*b))/(rd.y*b);return 1.0-exp(-max(f,0.0));}
      float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715))));}
      void main(){vec3 col=texture2D(tScene,vUv).rgb;float depth=texture2D(tDepth,vUv).r;vec3 rd=normalize(worldAt(vUv,1.0)-uCam);
        if(depth<0.99999){vec3 wp=worldAt(vUv,depth);float dist=length(wp-uCam);
          vec3 n=normalize(cross(dFdx(wp),dFdy(wp)));if(dot(n,uCam-wp)<0.0)n=-n;
          float rad=clamp(dist*0.012,1.2,30.0);float occ=0.0;float rnd=ign(gl_FragCoord.xy+vec2(uFrame*5.3,uFrame*2.1))*6.2832;
          vec3 t1=normalize(abs(n.y)<0.9?cross(n,vec3(0.0,1.0,0.0)):cross(n,vec3(1.0,0.0,0.0)));vec3 t2=cross(n,t1);
          for(int i=0;i<10;i++){float fi=float(i);float a=fi*2.39996+rnd;float r=sqrt((fi+0.5)/10.0);
            vec3 h=t1*cos(a)*r+t2*sin(a)*r+n*sqrt(max(0.0,1.0-r*r));vec3 sp=wp+h*rad*(0.25+0.75*fract(fi*0.618+rnd*0.159));
            vec4 c=uViewProj*vec4(sp,1.0);vec2 suv=c.xy/c.w*0.5+0.5;if(suv.x<0.0||suv.y<0.0||suv.x>1.0||suv.y>1.0)continue;
            vec3 op=worldAt(suv,texture2D(tDepth,suv).r);
            if(length(op-uCam)<length(sp-uCam)-0.05)occ+=1.0-smoothstep(rad*0.8,rad*2.0,length(op-wp));}
          col*=mix(1.0,1.0-occ/10.0,uAO);
          float cs=0.0;for(int k=0;k<4;k++){float y=(k==3)?1300.0:470.0+float(k)*95.0;if(wp.y<y)cs+=dens(wp+uSun*((y-wp.y)/uSun.y));}
          col*=mix(0.42,1.0,exp(-cs*1.8));
          col=mix(col,hazeCol(rd,uSun)*0.85,hfog(uCam,rd,dist));}
        vec2 ct=1.0/vec2(textureSize(tCloud,0));vec4 cl=texture2D(tCloud,vUv)*0.4+(texture2D(tCloud,vUv+ct*vec2(1,1))+texture2D(tCloud,vUv+ct*vec2(-1,1))+texture2D(tCloud,vUv+ct*vec2(1,-1))+texture2D(tCloud,vUv+ct*vec2(-1,-1)))*0.15;col=col*cl.a+cl.rgb;
        if(uSunVis>0.0){vec2 d=(uSunUV-vUv)/32.0;vec2 uv=vUv;float acc=0.0,w=1.0;
          for(int i=0;i<32;i++){uv+=d;vec2 cuv=clamp(uv,0.001,0.999);float sky=step(0.99999,texture2D(tDepth,cuv).r);acc+=sky*texture2D(tCloud,cuv).a*w;w*=0.965;}
          acc/=32.0;float fall=exp(-length((vUv-uSunUV)*vec2(uAspect,1.0))*3.2);col+=uSunCol*acc*fall*uSunVis*0.5;}
        gl_FragColor=vec4(col,1.0);}`
    });
    const rtAcc=mk(false);
    const accumMat=new THREE.ShaderMaterial({uniforms:{tDiffuse:{value:rtA.texture},uW:{value:0.1}},vertexShader:vs,depthWrite:false,depthTest:false,transparent:true,blending:THREE.AdditiveBlending,
      fragmentShader:`uniform sampler2D tDiffuse;uniform float uW;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(tDiffuse,vUv).rgb*uW,1.0);}`});
    const finalMat=new THREE.ShaderMaterial({
      uniforms:{tDiffuse:{value:rtA.texture},tDepth:{value:rtScene.depthTexture},uTime:{value:0},uA:{value:new THREE.Vector2()},uB:{value:new THREE.Vector2()},uR:{value:0},uS:{value:0},uAspect:{value:2.39},uFade:{value:1},uExp:{value:0.95},
        uSunUV:{value:null},uSunVis:{value:null},uNear:{value:camera.near},uFar:{value:camera.far},uFocus:{value:100},uAp:{value:0},uMaxC:{value:12},uRes:{value:new THREE.Vector2(1920,804)}},
      vertexShader:vs,depthWrite:false,depthTest:false,
      fragmentShader:`uniform vec2 uSunUV;uniform float uSunVis;uniform sampler2D tDiffuse,tDepth;uniform float uTime,uR,uS,uAspect,uFade,uExp,uNear,uFar,uFocus,uAp,uMaxC;uniform vec2 uA,uB,uRes;varying vec2 vUv;
      float hs(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hs(i),hs(i+vec2(1,0)),f.x),mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x),f.y);}
      vec3 RRT(vec3 v){vec3 a=v*(v+0.0245786)-0.000090537;vec3 b=v*(0.983729*v+0.4329510)+0.238081;return a/b;}
      vec3 aces(vec3 c){const mat3 I=mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
        const mat3 O=mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));c*=uExp/0.6;c=I*c;c=RRT(c);c=O*c;return clamp(c,0.0,1.0);}
      vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(0.0031308,c));}
      float linZ(float d){return uNear*uFar/(uFar-d*(uFar-uNear));}
      float cocAt(vec2 uv,out float z){z=linZ(texture2D(tDepth,uv).r);return clamp(uAp*abs(1.0-uFocus/z),0.0,uMaxC);}
      vec3 dof(vec2 uv){vec3 base=texture2D(tDiffuse,uv).rgb;if(uAp<0.05)return base;float z0;float c0=cocAt(uv,z0);vec3 acc=base;float ws=1.0;
        for(int i=1;i<36;i++){float fi=float(i);float r=sqrt(fi/36.0)*uMaxC;float a=fi*2.39996;vec2 o=vec2(cos(a),sin(a))*r/uRes;float zs;float cs=cocAt(uv+o,zs);if(zs>z0)cs=min(cs,c0*1.5+0.5);
          float w=smoothstep(r-1.0,r+0.5,cs);acc+=texture2D(tDiffuse,uv+o).rgb*w;ws+=w;}return acc/ws;}
      void main(){vec2 c0=vUv-0.5;vec2 uv=0.5+c0*(0.985+0.03*dot(c0,c0));
        if(uS>0.0){vec2 p=vec2(uv.x*uAspect,uv.y),a=vec2(uA.x*uAspect,uA.y),b=vec2(uB.x*uAspect,uB.y);vec2 ab=b-a;
          float h=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-7),0.0,1.0);float d=length(p-a-ab*h);float w=uR*(0.7+2.2*h);
          float m=smoothstep(w,0.0,d)*(1.0-h*0.5);vec2 n=vec2(vn(p/max(uR,0.002)*1.8+vec2(0.0,uTime*9.0)),vn(p/max(uR,0.002)*1.8+vec2(17.0,-uTime*11.0)))-0.5;uv+=n*m*uS;}
        vec2 cc=uv-0.5;float r2=dot(cc,cc);
        vec3 col=dof(uv);
        vec3 mid=texture2D(tDiffuse,uv).rgb;col.r+=texture2D(tDiffuse,uv-cc*r2*0.012).r-mid.r;col.b+=texture2D(tDiffuse,uv+cc*r2*0.012).b-mid.b;
        vec3 st=vec3(0.0);for(int i=-12;i<=12;i++){if(i==0)continue;vec3 c=texture2D(tDiffuse,uv+vec2(float(i)*0.011,0.0)).rgb;st+=max(c-vec3(3.0),vec3(0.0))*exp(-abs(float(i))*0.22);}
        col+=st*vec3(0.30,0.5,1.0)*0.035;
        float sg=uSunVis*exp(-length((vUv-uSunUV)*vec2(uAspect,1.0))*2.4);float dirt=smoothstep(0.55,0.85,vn(vUv*vec2(uAspect,1.0)*7.0)+0.45*vn(vUv*vec2(uAspect,1.0)*21.0+3.0));
        col+=vec3(1.0,0.72,0.45)*(dirt*0.9+0.2)*sg*0.14;
        col*=mix(1.0,0.55,smoothstep(0.12,0.9,r2*1.7));
        col=aces(max(col,vec3(0.0)));
        float l=dot(col,vec3(0.2126,0.7152,0.0722));col=mix(vec3(l),col,1.06);col=col*vec3(1.02,1.0,0.97)+vec3(0.0,0.006,0.012)*(1.0-l);
        col=srgb(clamp(col,0.0,1.0));
        col+=(hs(vUv*vec2(1733.0,977.0)+fract(uTime*29.0)*91.0)-0.5)*0.028;
        gl_FragColor=vec4(col*uFade,1.0);}`
    });
    const fxaaMat=new THREE.ShaderMaterial(THREE.FXAAShader);fxaaMat.uniforms.tDiffuse.value=rtB.texture;
    const bloom=new THREE.UnrealBloomPass(new THREE.Vector2(512,256),0.32,0.55,1.5);
    const Q=(m)=>new THREE.FullScreenQuad(m);
    finalMat.uniforms.uSunUV=atmosMat.uniforms.uSunUV;finalMat.uniforms.uSunVis=atmosMat.uniforms.uSunVis;
    P={rtScene,rtRefl,rtCloud,rtA,rtB,rtAcc,accumMat,qAcc:Q(accumMat),cloudMat,atmosMat,finalMat,fxaaMat,bloom,qCloud:Q(cloudMat),qAtmos:Q(atmosMat),qFinal:Q(finalMat),qFxaa:Q(fxaaMat),blobs,blobP,vcam:new THREE.PerspectiveCamera(),clip:[new THREE.Plane(new V3(0,1,0),-WATER_Y)]};
    // cloud formations: Westminster ceiling, punch-through cumulus, backdrop cumulus
    const wc=lutAt(RIV,sTB+4100,new V3());const pp=b2Track(30.8,new V3());const bk=b2Track(37,new V3());
    blobs[0].set(wc.x,0,wc.z,820);blobP[0].set(445,230,0.97);
    blobs[1].set(pp.x,0,pp.z,390);blobP[1].set(470,320,1.0);
    blobs[2].set(bk.x-1500,0,bk.z+1100,700);blobP[2].set(560,380,0.52);
    blobs[3].set(1600,0,-2600,1400);blobP[3].set(650,380,0.7);
  }catch(e){console.error(e);P=null;}
}
buildPipeline();
if(!P)scene.fog=scene.fog||new THREE.FogExp2(new THREE.Color(0.60,0.44,0.36),0.00014);
if(!P){renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.outputEncoding=THREE.sRGBEncoding;}

const _rv=new V3(),_rt=new V3(),_rl=new V3(),_rq=new THREE.Matrix4(),_up=new V3();
function renderReflection(){
  const cam=camera,vc=P.vcam;const nrm=new V3(0,1,0);const rp=new V3(0,WATER_Y,0);
  _rv.copy(rp).sub(cam.position);if(_rv.dot(nrm)>0)return false;
  _rv.reflect(nrm).negate().add(rp);
  _rq.extractRotation(cam.matrixWorld);_rl.set(0,0,-1).applyMatrix4(_rq).add(cam.position);
  _rt.copy(rp).sub(_rl).reflect(nrm).negate().add(rp);
  vc.position.copy(_rv);_up.set(0,1,0).applyMatrix4(_rq).reflect(nrm);vc.up.copy(_up);vc.lookAt(_rt);
  vc.near=cam.near;vc.far=cam.far;vc.projectionMatrix.copy(cam.projectionMatrix);vc.updateMatrixWorld();vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
  reflTexMat.set(0.5,0,0,0.5, 0,0.5,0,0.5, 0,0,0.5,0.5, 0,0,0,1);reflTexMat.multiply(cam.projectionMatrix);reflTexMat.multiply(vc.matrixWorldInverse);
  water.visible=false;renderer.clippingPlanes=P.clip;renderer.setRenderTarget(P.rtRefl);renderer.clear();renderer.render(scene,vc);renderer.clippingPlanes=[];water.visible=true;
  return true;
}

/* ---------- audio ---------- */
let AC=null,A=null,muted=false;
function initAudio(){
  if(AC)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){return;}
  const len=AC.sampleRate*3,buf=AC.createBuffer(1,len,AC.sampleRate),d=buf.getChannelData(0);let last=0;
  for(let i=0;i<len;i++){const w=Math.random()*2-1;last=(last+0.02*w)/1.02;d[i]=last*3.2+w*0.12;}
  const src=()=>{const s=AC.createBufferSource();s.buffer=buf;s.loop=true;s.start(0,Math.random()*2);return s;};
  const master=AC.createGain();master.gain.value=muted?0:0.9;master.connect(AC.destination);
  const comp=AC.createDynamicsCompressor();comp.connect(master);
  const jn=src(),jlp=AC.createBiquadFilter();jlp.type='lowpass';jlp.frequency.value=600;const jg=AC.createGain();jg.gain.value=0;jn.connect(jlp);jlp.connect(jg);jg.connect(comp);
  const wh=AC.createOscillator();wh.type='sawtooth';wh.frequency.value=800;const wlp=AC.createBiquadFilter();wlp.type='lowpass';wlp.frequency.value=2200;const wg=AC.createGain();wg.gain.value=0;wh.connect(wlp);wlp.connect(wg);wg.connect(comp);wh.start();
  const bn=src(),blp=AC.createBiquadFilter();blp.type='lowpass';blp.frequency.value=160;const bg=AC.createGain();bg.gain.value=0;bn.connect(blp);blp.connect(bg);bg.connect(comp);
  const wn=src(),wbp=AC.createBiquadFilter();wbp.type='bandpass';wbp.frequency.value=450;wbp.Q.value=0.6;const wig=AC.createGain();wig.gain.value=0.05;wn.connect(wbp);wbp.connect(wig);wig.connect(comp);
  A={master,jlp,jg,wh,wg,blp,bg,wig};
}
const _rel=new V3();
function updateAudio(t){
  if(!A||!AC)return;const now=AC.currentTime;
  _rel.subVectors(camera.position,J.p);const d=_rel.length();_rel.normalize();
  const vr=clamp(J.v.dot(_rel),-300,300);const dop=clamp(343/(343-vr*0.75),0.45,2.6);
  const vol=clamp(1.5/(1+Math.pow(d/85,1.35)),0,1.4)*(t<TOTAL-1?1:0);
  A.jg.gain.setTargetAtTime(vol,now,0.04);A.jlp.frequency.setTargetAtTime(clamp(250+3800*vol*dop,200,9000),now,0.05);
  A.wh.frequency.setTargetAtTime(720*dop,now,0.03);A.wg.gain.setTargetAtTime(vol*0.035,now,0.04);
  const db=camera.position.distanceTo(Bq.p);const bv=clamp(1.1/(1+Math.pow(db/260,1.3)),0,0.9)*sstep(13.5,15.5,t)*(1-sstep(38,40,t));
  A.bg.gain.setTargetAtTime(bv,now,0.2);A.wig.gain.setTargetAtTime(0.05*(1-sstep(38,40,t)),now,0.3);
}



/* ---------- render ---------- */
let pr=Math.min(window.devicePixelRatio||1,1.5);let EXP=null,FILM=null;
function sizeTo(w,h,ratio){renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  if(P){const W=Math.max(2,Math.floor(w*ratio)),H=Math.max(2,Math.floor(h*ratio));
    [P.rtScene,P.rtA,P.rtB,P.rtAcc].forEach(r=>r.setSize(W,H));P.rtRefl.setSize(W>>1,H>>1);P.rtCloud.setSize(W>>1,H>>1);
    P.bloom.setSize(W,H);P.fxaaMat.uniforms.resolution.value.set(1/W,1/H);P.finalMat.uniforms.uAspect.value=w/h;P.atmosMat.uniforms.uAspect.value=w/h;P.finalMat.uniforms.uRes.value.set(W,H);}}
function resize(){
  if(EXP)return;
  const vw=window.innerWidth,vh=window.innerHeight;const ar=clamp(vw/vh,1.78,2.39);
  let w=vw,h=vw/ar;if(h>vh){h=vh;w=vh*ar;}
  w=Math.floor(w);h=Math.floor(h);stageEl.style.width=w+'px';stageEl.style.height=h+'px';
  renderer.domElement.style.width=w+'px';renderer.domElement.style.height=h+'px';sizeTo(w,h,pr);
}
window.addEventListener('resize',()=>{resize();if(typeof introDirty!=='undefined')introDirty=true;});resize();

const hazeA=new V3(),hazeB=new V3(),_sv=new V3(),_fw=new V3();let FRN=0;
function renderHDR(t,dt,real){
  if(real&&dt>0){
    if(t<simT-0.001||t-simT>0.5)seekTo(t);
    else{let s=simT;const n=Math.max(1,Math.ceil((t-simT)/(1/40)));const h=(t-simT)/n;for(let i=0;i<n;i++){s+=h;stepSim(s,h);}simT=t;}
  }
  poseAt(t);
  const idx=direct(t);
  if(EXP)camera.setViewOffset(EXP.W,EXP.H,EXP.jx,EXP.jy,EXP.W,EXP.H);
  const vap=jetVapor(t),spd=J.v.length();
  const inPit=SHOTS[idx].k==='pit';F16.vc.uniforms.uAmt.value=inPit?0:clamp(vap*0.95+sstep(265,300,spd)*0.35,0,1);F16.vc.uniforms.uTime.value=t;
  F16.vw.uniforms.uAmt.value=inPit?vap*0.4:vap;F16.vw.uniforms.uTime.value=t;
  const burn=0.8+0.2*Math.sin(t*37)*Math.sin(t*23.3)+0.25*(1-sstep(14,18,t));
  F16.plume.uniforms.uTime.value=t;F16.plume.uniforms.uAmt.value=burn;F16.light.intensity=2.2*burn;
  B2.vm.uniforms.uAmt.value=0.55*sstep(13.5,15,t)*(1-sstep(20,22,t))+0.4*sstep(28.5,30.5,t)*(1-sstep(33,35,t));B2.vm.uniforms.uTime.value=t;
  jetTrails.forEach(x=>x.build(t,camera));b2Trails.forEach(x=>x.build(t,camera));
  waterMat.uniforms.uTime.value=t;
  const wk=sstep(60,16,J.p.y-WATER_Y)*(onRiver(J.p.x,J.p.z)?1:0);waterMat.uniforms.uJet.value.set(J.p.x,J.p.z,wk,0);
  _sv.set(J.v.x,0,J.v.z).normalize();waterMat.uniforms.uJetDir.value.set(_sv.x,_sv.z);
  eyeWheel.rotation.z=-t*0.02;updateTraffic(t);updateBoats(t);updateBirds(t);updatePeople(t);updateTrain(t);FLAG_T.value=t;updateNav(t);
  sky.position.copy(camera.position);
  spMat.uniforms.uScale.value=renderer.domElement.height/(2*Math.tan(camera.fov*Math.PI/360));
  camera.updateMatrixWorld();
  renderer.shadowMap.needsUpdate=true;
  if(!P){renderer.toneMappingExposure=1-sstep(37.8,39.8,t);renderer.setRenderTarget(null);renderer.render(scene,camera);if(EXP)camera.clearViewOffset();return idx;}
  const useRefl=QUAL.refl&&camera.position.y<420;
  waterMat.uniforms.uReflOn.value=0;
  if(useRefl&&renderReflection()){waterMat.uniforms.uReflOn.value=1;waterMat.uniforms.tRefl.value=P.rtRefl.texture;}
  renderer.setRenderTarget(P.rtScene);renderer.clear();renderer.render(scene,camera);
  const cu=P.cloudMat.uniforms;cu.uInvProj.value.copy(camera.projectionMatrixInverse);cu.uCamWorld.value.copy(camera.matrixWorld);cu.uCam.value.copy(camera.position);cu.uTime.value=t;cu.uSteps.value=QUAL.cloudSteps;
  renderer.setRenderTarget(P.rtCloud);P.qCloud.render(renderer);
  const au=P.atmosMat.uniforms;_sv.copy(camera.position).addScaledVector(SUN_DIR,5000).project(camera);
  camera.getWorldDirection(_fw);const facing=_fw.dot(SUN_DIR);
  au.uSunUV.value.set(_sv.x*0.5+0.5,_sv.y*0.5+0.5);au.uSunVis.value=_sv.z<1?clamp((facing-0.2)/0.6,0,1):0;
  au.uViewProj.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);au.uFrame.value=(FRN++)%64;au.uTime.value=t;
  renderer.setRenderTarget(P.rtA);P.qAtmos.render(renderer);
  P.bloom.render(renderer,null,P.rtA,dt,false);
  if(EXP)camera.clearViewOffset();
  return idx;
}
function present(t,src){
  const u=P.finalMat.uniforms;u.tDiffuse.value=src;u.uTime.value=t;u.uFade.value=1-sstep(37.8,39.8,t);
  hazeA.copy(F16.nozzle).applyMatrix4(F16.g.matrixWorld);hazeB.copy(hazeA).addScaledVector(J.f,-40);
  const dist=camera.position.distanceTo(hazeA);const a=hazeA.clone().project(camera),b=hazeB.clone().project(camera);
  if(a.z<1&&b.z<1&&Math.abs(a.x)<1.4&&Math.abs(a.y)<1.4){u.uA.value.set(a.x*0.5+0.5,a.y*0.5+0.5);u.uB.value.set(b.x*0.5+0.5,b.y*0.5+0.5);
    u.uR.value=clamp(3.2/dist/(2*Math.tan(camera.fov*Math.PI/360)),0.003,0.16);u.uS.value=0.02*clamp(60/dist,0.15,1);}else u.uS.value=0;
  u.uNear.value=camera.near;u.uFar.value=camera.far;const H=P.rtB.height;u.uFocus.value=DOFS.f;u.uAp.value=DOFS.a*H/1080;u.uMaxC.value=(DOFS.m||12)*H/1080;
  renderer.setRenderTarget(P.rtB);P.qFinal.render(renderer);
  renderer.setRenderTarget(null);P.qFxaa.render(renderer);
}
function frame(t,dt,real){const idx=renderHDR(t,dt,real);if(P)present(t,P.rtA.texture);return idx;}

/* ---------- one-shot HD render: 10-sample motion blur + anti-aliasing, 1920x804 H.264 ---------- */
function halton(i,b){let f=1,r=0;while(i>0){f/=b;r+=f*(i%b);i=Math.floor(i/b);}return r;}
async function renderFilm(){
  const ov=document.getElementById('render'),msg=ov.querySelector('.msg'),bar=ov.querySelector('.pfill'),vid=ov.querySelector('video'),acts=ov.querySelector('.acts'),cBtn=document.getElementById('cancelBtn'),sBtn=document.getElementById('saveBtn');
  ov.classList.add('on');ov.classList.remove('done');vid.style.display='none';acts.style.display='none';cBtn.style.display='none';bar.style.width='0%';
  const fail=(m)=>{msg.textContent=m;acts.style.display='flex';sBtn.style.display='none';ov.classList.add('done');};
  if(!P||typeof VideoEncoder==='undefined'||typeof VideoFrame==='undefined'||typeof Mp4Muxer==='undefined'){fail('HD export needs Chrome or Edge on a computer with a proper graphics card.');return;}
  const W=1920,H=804,FPS=30,SUB=12,N=Math.round(TOTAL*FPS);
  const cfg={codec:'avc1.640028',width:W,height:H,bitrate:30e6,framerate:FPS};
  try{if(!(await VideoEncoder.isConfigSupported(cfg)).supported){cfg.codec='avc1.4d0028';if(!(await VideoEncoder.isConfigSupported(cfg)).supported)throw 0;}}catch(e){fail('This browser cannot encode H.264 video. Try Chrome or Edge.');return;}
  setPlaying(false);if(AC)AC.suspend();cBtn.style.display='';msg.textContent='Warming up…';
  EXP={W,H,jx:0,jy:0,cancel:false};const saveQ=Object.assign({},QUAL);QUAL.refl=true;QUAL.cloudSteps=64;
  sun.shadow.mapSize.set(8192,8192);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
  sizeTo(W,H,1);
  const muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(),video:{codec:'avc',width:W,height:H,frameRate:FPS},fastStart:'in-memory'});
  let encErr=null;const enc=new VideoEncoder({output:(c,m)=>muxer.addVideoChunk(c,m),error:e=>{encErr=e;}});enc.configure(cfg);
  seekTo(0);const t0=performance.now();let i=0;
  try{
    for(;i<N&&!EXP.cancel&&!encErr;i++){
      renderer.setRenderTarget(P.rtAcc);renderer.setClearColor(0x000000,0);renderer.clear();renderer.setClearColor(0x000000,1);
      P.accumMat.uniforms.uW.value=1/SUB;
      for(let k=0;k<SUB;k++){const ts=Math.max(0,(i+((k+0.5)/SUB-0.5)*0.5)/FPS);const hi=i*SUB+k+1;EXP.jx=halton(hi,2)-0.5;EXP.jy=halton(hi,3)-0.5;
        renderHDR(ts,1/(FPS*SUB),true);renderer.setRenderTarget(P.rtAcc);P.qAcc.render(renderer);}
      present(i/FPS,P.rtAcc.texture);
      const vf=new VideoFrame(renderer.domElement,{timestamp:Math.round(i*1e6/FPS),duration:Math.round(1e6/FPS)});enc.encode(vf,{keyFrame:i%(FPS*2)===0});vf.close();
      while(enc.encodeQueueSize>4)await new Promise(r=>setTimeout(r,4));
      const el=(performance.now()-t0)/1000,left=el/(i+1)*(N-i-1);bar.style.width=((i+1)/N*100)+'%';
      msg.textContent=`Rendering frame ${i+1} of ${N}, about ${Math.max(1,Math.ceil(left/60))} min left`;
      await new Promise(r=>setTimeout(r,0));
    }
    await enc.flush();
  }catch(e){encErr=encErr||e;}
  const cancelled=EXP.cancel;EXP=null;Object.assign(QUAL,saveQ);
  sun.shadow.mapSize.set(renderer.capabilities.maxTextureSize>=8192?4096:2048,renderer.capabilities.maxTextureSize>=8192?4096:2048);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}resize();cBtn.style.display='none';
  if(cancelled||encErr||i<N){fail(encErr?'Export failed: '+(encErr.message||encErr):'Export cancelled.');return;}
  muxer.finalize();FILM=new Blob([muxer.target.buffer],{type:'video/mp4'});
  vid.src=URL.createObjectURL(FILM);vid.style.display='block';msg.textContent='Done. Your HD render:';acts.style.display='flex';sBtn.style.display='';ov.classList.add('done');
}
async function saveFilm(){if(!FILM)return;const name='low-pass-over-the-thames.mp4';
  try{if(window.claude&&window.claude.use){const dl=await window.claude.use('downloads');if(dl){await dl.save({filename:name,data:FILM});return;}}}catch(e){if(e&&e.code==='declined')return;}
  const a=document.createElement('a');a.href=URL.createObjectURL(FILM);a.download=name;document.body.appendChild(a);a.click();a.remove();}


/* ---------- UI + loop ---------- */
const introEl=document.getElementById('intro'),hudEl=document.getElementById('hud'),endEl=document.getElementById('end');
const playBtn=document.getElementById('playBtn'),ppBtn=document.getElementById('ppBtn'),ppIcon=document.getElementById('ppIcon'),muteBtn=document.getElementById('muteBtn'),waves=document.getElementById('waves');
const barEl=document.getElementById('bar'),fillEl=barEl.querySelector('.fill'),shotEl=document.getElementById('shot'),againBtn=document.getElementById('againBtn');
SHOTS.slice(1).forEach(s=>{const c=document.createElement('div');c.className='cut';c.style.left=(s.t/TOTAL*100)+'%';barEl.querySelector('.track').appendChild(c);});
let introDirty=true,T=0,playing=false,started=false,last=performance.now(),frames=0,slowAcc=0;
function setPlaying(p){playing=p;ppIcon.setAttribute('d',p?'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z':'M8 5v14l11-7z');ppBtn.setAttribute('aria-label',p?'Pause':'Play');
  if(AC){p?AC.resume():AC.suspend();}}
function start(){initAudio();started=true;introEl.classList.add('gone');hudEl.classList.add('on');endEl.classList.remove('on');T=0;seekTo(0);last=performance.now();setPlaying(true);}
playBtn.addEventListener('click',start);
againBtn.addEventListener('click',start);
document.getElementById('hdBtn').addEventListener('click',()=>{started=true;introEl.classList.add('gone');renderFilm();});
document.getElementById('hdBtn2').addEventListener('click',()=>{endEl.classList.remove('on');renderFilm();});
document.getElementById('cancelBtn').addEventListener('click',()=>{if(EXP)EXP.cancel=true;});
document.getElementById('saveBtn').addEventListener('click',saveFilm);
document.getElementById('closeBtn').addEventListener('click',()=>{document.getElementById('render').classList.remove('on');hudEl.classList.add('on');});
ppBtn.addEventListener('click',()=>{if(T>=TOTAL){start();return;}setPlaying(!playing);last=performance.now();});
muteBtn.addEventListener('click',()=>{muted=!muted;waves.style.display=muted?'none':'';muteBtn.setAttribute('aria-label',muted?'Unmute':'Mute');if(A)A.master.gain.setTargetAtTime(muted?0:0.9,AC.currentTime,0.05);});
function seekFromEvent(e){const r=barEl.getBoundingClientRect();T=clamp((e.clientX-r.left)/r.width,0,1)*TOTAL;seekTo(T);endEl.classList.remove('on');}
barEl.addEventListener('pointerdown',e=>{seekFromEvent(e);barEl.setPointerCapture(e.pointerId);});
barEl.addEventListener('pointermove',e=>{if(e.buttons)seekFromEvent(e);});
barEl.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){T=clamp(T+(e.key==='ArrowRight'?2:-2),0,TOTAL);seekTo(T);e.preventDefault();}});
window.addEventListener('keydown',e=>{if(!started)return;if(e.code==='Space'&&e.target===document.body){e.preventDefault();ppBtn.click();}if(e.key==='m'||e.key==='M')muteBtn.click();});
let idleTimer=0;stageEl.addEventListener('pointermove',()=>{stageEl.classList.remove('idle');clearTimeout(idleTimer);idleTimer=setTimeout(()=>stageEl.classList.add('idle'),2200);});

function loop(now){
  requestAnimationFrame(loop);
  if(EXP){last=now;return;}
  let dt=Math.min(0.05,(now-last)/1000);last=now;
  if(!started){if(introDirty){frame(1.2,0,false);introDirty=false;}return;}
  if(playing){T+=dt;if(T>=TOTAL){T=TOTAL;setPlaying(false);endEl.classList.add('on');}}
  const idx=frame(T,playing?dt:0,true);
  updateAudio(T);
  fillEl.style.width=(T/TOTAL*100)+'%';barEl.setAttribute('aria-valuenow',T.toFixed(1));
  const nm=SHOTS[idx].name;if(shotEl.textContent!==nm)shotEl.textContent=nm;
  if(playing){frames++;slowAcc+=dt;if(frames===90){if(slowAcc/90>0.042){if(QUAL.refl)QUAL.refl=false;else if(QUAL.cloudSteps>28)QUAL.cloudSteps=28;else if(pr>0.6){pr=Math.max(0.6,pr-0.25);resize();}}frames=0;slowAcc=0;}}
}

// testing hook
window.__renderAt=(t)=>{started=true;introEl.classList.add('gone');seekTo(t);frame(t,0,false);};
window.__noLoop=false;

seekTo(1.2);
frame(1.2,0,false);
playBtn.disabled=false;playBtn.textContent='Play';
if(!P)document.getElementById('status').textContent='Running in reduced quality on this device.';
requestAnimationFrame((n)=>{last=n;if(!window.__testMode)loop(n);});

})();
