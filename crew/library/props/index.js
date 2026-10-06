// The prop registry: id -> { ...meta, build(opts) }. Builders return a THREE.Group
// standing on y=0 (see core.js). Import this in the renderer; the SCENE compiler
// reads meta.js only (no three.js).
import { PROP_META, PROP_IDS } from "./meta.js";
import * as interior from "./interior.js";
import * as vehicles from "./vehicles.js";
import * as exterior from "./exterior.js";
import * as structures from "./structures.js";

const MODULES = { interior, vehicles, exterior, structures };

export const PROPS = Object.fromEntries(PROP_IDS.map((id) => {
  const meta = PROP_META[id];
  const build = MODULES[meta.module][id];
  if (typeof build !== "function") throw new Error(`prop ${id}: no builder ${id}() in ${meta.module}.js`);
  return [id, { ...meta, build }];
}));

export { PROP_META, PROP_IDS };

/** Build a prop by id. Throws on unknown ids so a typo in a set never renders as a silent empty box. */
export function buildProp(id, opts = {}) {
  const p = PROPS[id];
  if (!p) throw new Error(`unknown prop "${id}"`);
  return p.build(opts);
}

/** Build a baked set box (from /api/state baked.sets[].boxes): the prop model scaled to the box and placed. */
export function buildBox(box, THREE) {
  const p = PROPS[box.prop];
  if (!p) return null;
  const g = p.build();
  const s = new THREE.Group();
  s.add(g);
  const k = (a, b) => (b > 0.05 && a > 0.05 ? a / b : 1);
  if (!box.dress) g.scale.set(k(box.w, p.size[0]), 1, k(box.d, p.size[2]));
  else if (box.scale && box.scale !== 1) g.scale.setScalar(box.scale);
  g.position.set(-p.center[0] * g.scale.x, 0, -p.center[1] * g.scale.z); // centre the model's bounding box on the box
  s.position.set(box.cx, box.y ?? 0, box.cz);
  s.rotation.y = box.ry;
  return s;
}
