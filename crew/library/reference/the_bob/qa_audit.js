// collision / framing audit: no rendering, just world state
window.__audit=function(ids,step){const D=window.__dbg,T=THREE;const out=[];const box=new T.Box3(),v=new T.Vector3(),rc=new T.Raycaster();
  const cache=new Map();
  function obst(scene){if(cache.has(scene))return cache.get(scene);const L=[];scene.updateMatrixWorld(true);
    scene.traverse(o=>{if(!o.isMesh||o.isSkinnedMesh||o.isInstancedMesh)return;let p=o.parent;while(p){if(p.isBone)return;p=p.parent;}
      const m=o.material;if(!m||Array.isArray(m)||m.transparent||m.isShaderMaterial||m.isSpriteMaterial)return;
      box.setFromObject(o);const sz=box.getSize(new T.Vector3());if(sz.y<0.04&&box.max.y<0.06)return;if(Math.max(sz.x,sz.y,sz.z)<0.12)return;if(Math.max(sz.x,sz.z)>9)return;
      if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();L.push({o,b:box.clone(),sz,gb:o.geometry.boundingBox,inv:new T.Matrix4()});});cache.set(scene,L);return L;}
  const J=['hips','chest','head','lKnee','rKnee','lAnk','rAnk','lHand','rHand','lEl','rEl'];
  for(const sh of D.SHOTS){if(ids&&!ids.includes(sh.id))continue;if(['black','title','card','credits'].includes(sh.scene))continue;
    for(let t=sh.a+0.02;t<sh.b-0.01;t+=step){const S=D.stateAt(t,sh);if(!S||!S.scene)continue;const sc=S.scene;
      const L=obst(sc).filter(x=>x.o.visible&&(()=>{let p=x.o;while(p){if(!p.visible)return false;p=p.parent;}return true;})());
      // refresh boxes for objects that move (doors etc)
      for(const x of L){x.b.setFromObject(x.o);x.inv.copy(x.o.matrixWorld).invert();}
      const inside=(x,pt,m)=>{const q=pt.clone().applyMatrix4(x.inv);const g=x.gb;const sc=new T.Vector3();x.o.getWorldScale(sc);const mx=m/sc.x,my=m/sc.y,mz=m/sc.z;return q.x>g.min.x+mx&&q.x<g.max.x-mx&&q.y>g.min.y+my&&q.y<g.max.y-my&&q.z>g.min.z+mz&&q.z<g.max.z-mz;};
      for(const n in window.__RIGS){const r=window.__RIGS[n];if(r.root.parent!==sc||!r.root.visible)continue;r.root.updateMatrixWorld(true);
        for(const j of J){const b=r[j];if(!b)continue;b.getWorldPosition(v);
          for(const x of L){if(inside(x,v,0.03)){out.push([sh.id,+t.toFixed(2),n,j,'inside',x.sz.toArray().map(q=>+q.toFixed(2)).join('x')+'@'+x.b.getCenter(new T.Vector3()).toArray().map(q=>+q.toFixed(2)).join(',')]);}}
          if(j==='lHand'||j==='rHand'){for(const x of L){const bb=x.b;if(x.sz.y>0.12||bb.max.y<0.65||bb.max.y>0.85)continue;const q=v.clone().applyMatrix4(x.inv),g=x.gb;if(q.x>g.min.x&&q.x<g.max.x&&q.z>g.min.z&&q.z<g.max.z&&v.y<bb.min.y-0.02&&v.y>bb.min.y-0.45)out.push([sh.id,+t.toFixed(2),n,j,'under-table',x.sz.toArray().map(q=>+q.toFixed(2)).join('x')]);}}
        }}
      // camera: inside an obstacle?
      const c=S.c;if(c){for(const x of L){if(inside(x,c.pos,0))out.push([sh.id,+t.toFixed(2),'CAM','pos','inside',x.sz.toArray().map(q=>+q.toFixed(2)).join('x')+'@'+x.b.getCenter(new T.Vector3()).toArray().map(q=>+q.toFixed(2)).join(',')]);}
        // subjects: in frame and visible
        for(const n of (c.subjects||[])){const r=window.__RIGS[n];if(!r||!r.root.visible)continue;const e=D.eyesOf(r);const d=e.clone().sub(c.pos);const dist=d.length();rc.set(c.pos,d.normalize());rc.near=0.05;rc.far=dist-0.25;
          const hits=rc.intersectObjects(L.map(x=>x.o),false);if(hits.length)out.push([sh.id,+t.toFixed(2),n,'eyes','occluded-by',hits[0].object.geometry.type+'@'+hits[0].point.toArray().map(q=>+q.toFixed(2)).join(',')]);}}
    }}
  return out;};
