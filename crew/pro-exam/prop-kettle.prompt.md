# Case prop-kettle (3D model)

Paste everything below the line into Gemini 3.1 Pro (thinking on high), then save its whole reply as prop-kettle.reply.txt next to this file.

---

You are building a 3D prop for an animated film. Props are JavaScript builder functions that use three.js plus a few helpers. Write ONE function, exactly as specified, and nothing else.

AVAILABLE (already imported for you, do not import anything):
- `THREE` : the three.js namespace (r17x)
- `mat(color, opts?)` : cached MeshStandardMaterial; opts are material params, e.g. `{ roughness: 0.4, metalness: 0.8 }`
- `mesh(geometry, material, parent, x?, y?, z?)` : adds a mesh to parent at that position, returns it
- `box(parent, w, h, d, material, x?, y?, z?)` : a box whose BOTTOM sits at y (not centred)
- `cyl(parent, rTop, rBottom, h, material, x?, y?, z?, segments = 16)` : a cylinder whose BOTTOM sits at y
- `group(parent, x?, y?, z?, rotationY?)` : a child THREE.Group
- `finish(g, id, meta)` : labels the prop; always `return finish(g, "<id>", { ... })`

CONVENTIONS: units are metres. +y is up, +z is the front (towards camera), +x is the right. The prop stands on y = 0 and its bounding box is centred on x = 0, z = 0.

EXAMPLE (a library prop, for style only):
```js
export function bedside_lamp({ on = false } = {}) {
  const g = new THREE.Group();
  cyl(g, 0.05, 0.07, 0.04, mat("#3a2a1a"), 0, 0, 0);
  cyl(g, 0.012, 0.012, 0.2, mat("#3a2a1a"), 0, 0.04, 0, 8);
  mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.24, 16, 1, true), mat("#e8dcc0", { side: THREE.DoubleSide }), g, 0, 0.3, 0);
  return finish(g, "bedside_lamp", { onSurface: true });
}
```

THE PROP: a stovetop kettle.
- Function: `export function stovetop_kettle({ color = "#b83a2e" } = {})`, returning `finish(g, "stovetop_kettle", { onSurface: true })`.
- Body: enamel in `color`, round, about 19 cm across and 13 cm tall, a little narrower at the top than at the bottom, sitting directly on y = 0. Slightly glossy.
- Lid: on top of the body, same colour, with a small black knob.
- Spout: on the RIGHT side (+x), rising outwards at roughly 45 degrees from the lower half of the body; its tip is about 16 cm above the ground.
- Handle: black, arching OVER the top of the kettle from front to back (along z), its highest point about 24 cm above the ground.
- Whole prop bounding box: about 26 cm wide (x, including the spout), 24 cm tall (y), 19 cm deep (z). Lowest point exactly at y = 0. The bounding box must be centred on x = 0 and z = 0, so place the body to account for the spout.
- Limits: at most 6 distinct materials, at most 8,000 triangles, no textures, no lights, no randomness.

Reply with the code only, in one ```js block.
