uniform vec2 uProbe[8];
out vec4 o;
void main(){
  int i = int(gl_FragCoord.x);
  float c; float h = oceanH(uProbe[i], 16, c);
  float v = clamp((h+60.0)/120.0, 0.0, 1.0);
  float hi = floor(v*255.0);
  float lo = fract(v*255.0);
  o = vec4(hi/255.0, lo, 0.0, 1.0);
}
