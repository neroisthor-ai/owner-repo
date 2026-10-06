#version 300 es
precision highp float;
uniform sampler2D uAcc;
uniform float uInvN;
out vec4 o;
void main(){ o = texelFetch(uAcc, ivec2(gl_FragCoord.xy), 0)*uInvN; }
