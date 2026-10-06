precision highp float;
precision highp int;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uWhirl;
uniform float uSpin;
uniform vec2  uWhirlC;

float hash1(float n){ return fract(sin(n)*43758.5453123); }
float hash2(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }

float n3(vec3 x){
  vec3 p = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  vec2 uv = (p.xy + vec2(37.0,17.0)*p.z) + f.xy;
  vec2 rg = textureLod(uNoise, (uv+0.5)/256.0, 0.0).xy;
  return mix(rg.x, rg.y, f.z);
}
float n2(vec2 x){
  vec2 p = floor(x); vec2 f = fract(x); f = f*f*(3.0-2.0*f);
  return textureLod(uNoise, (p+f+0.5)/256.0, 0.0).x;
}
const mat3 M3 = mat3(0.00,0.80,0.60,-0.80,0.36,-0.48,-0.60,-0.48,0.64);
const mat2 M2 = mat2(0.80,0.60,-0.60,0.80);
float fbm3(vec3 p, int oct){
  float a=0.5, s=0.0, w=0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*n3(p); w+=a; p=M3*p*2.03; a*=0.5; }
  return s/w;
}
float fbm2(vec2 p, int oct){
  float a=0.5, s=0.0, w=0.0;
  for(int i=0;i<9;i++){ if(i>=oct) break; s+=a*n2(p); w+=a; p=M2*p*2.03; a*=0.5; }
  return s/w;
}

// Exponential-sine wave stack with drag (choppy storm swell)
const vec2 WDIR[40] = vec2[40](vec2(-0.37908,-0.92537),vec2(0.99432,-0.10645),vec2(0.99038,-0.13838),vec2(0.74041,-0.67215),vec2(-0.22408,-0.97457),vec2(0.88637,-0.46298),vec2(0.93573,-0.35272),vec2(0.84249,-0.53872),vec2(0.85075,-0.52556),vec2(-0.44157,-0.89722),vec2(0.13313,-0.99110),vec2(0.99986,0.01656),vec2(0.41355,-0.91048),vec2(-0.11449,-0.99342),vec2(0.16123,-0.98692),vec2(0.99401,-0.10929),vec2(0.92184,-0.38758),vec2(0.66567,-0.74624),vec2(0.20616,-0.97852),vec2(0.64781,-0.76180),vec2(0.71194,-0.70224),vec2(-0.54960,-0.83543),vec2(0.45121,-0.89242),vec2(-0.45174,-0.89215),vec2(0.56232,-0.82692),vec2(-0.01163,-0.99993),vec2(0.96159,-0.27447),vec2(0.83651,-0.54795),vec2(-0.53393,-0.84553),vec2(-0.50774,-0.86151),vec2(-0.42983,-0.90291),vec2(0.64105,-0.76750),vec2(0.46869,-0.88336),vec2(0.97364,-0.22810),vec2(0.99540,-0.09578),vec2(-0.10856,-0.99409),vec2(0.81714,-0.57644),vec2(-0.38677,-0.92218),vec2(-0.54833,-0.83626),vec2(0.99956,0.02957));
float waves(vec2 p, int it){
  float freq = 0.034, amp = 1.0, h = 0.0, w = 0.0, spd = uTime*sqrt(9.81*0.034);
  for(int i=0;i<40;i++){
    if(i>=it) break;
    vec2 d = WDIR[i];
    float x = dot(d,p)*freq - spd;
    spd *= 1.0908712;
    float e = exp(sin(x)-1.0);
    float dx = e*cos(x);
    h += e*amp; w += amp;
    p += d*dx*amp*0.30/freq;
    freq *= 1.19; amp *= 0.79;
  }
  return h/w;
}

float oceanH(vec2 p, int it, out float crest){
  vec2 v = p - uWhirlC; float r = length(v) + 1e-3;
  float prof = 1.0/(1.0 + r*r/(46.0*46.0));
  float ang = uSpin*prof;
  float cs = cos(ang), sn = sin(ang);
  vec2 pw = uWhirlC + vec2(cs*v.x - sn*v.y, sn*v.x + cs*v.y);
  float w = waves(pw, it);
  crest = w;
  float damp = 1.0 - 0.82*uWhirl*exp(-r/60.0);
  float h = (w - 0.30)*8.5*damp;
  float funnel = uWhirl*(36.0*pow(1.0 + r*r/(14.0*14.0), -1.25) + 6.0*exp(-r/85.0));
  float th = atan(v.y, v.x);
  float spiral = sin(th*3.0 + log(r)*5.5 - uSpin*2.2)*uWhirl*1.1*smoothstep(6.0,30.0,r)*exp(-r/130.0);
  return h - funnel + spiral;
}
