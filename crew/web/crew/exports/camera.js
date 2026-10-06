// Camera exports for 3D apps: keyed every frame from the viewer's own camera.
import { camFrames, download, baked, projectName, episodeName, shotsOf, toast, eulerZXY, toBlenderPos, toBlenderQuat, focalFromFov } from "./util.js";

const E = window.CrewExt;
const SENSOR_H = 24; // the show's 36x24 sensor

function setup(ctx) {
  const b = baked();
  const shots = shotsOf(b, ctx.shots);
  const cam = camFrames(b, shots, { framing: ctx.framing !== false });
  const tag = `${projectName()}_${episodeName()}_${ctx.shots && ctx.shots !== "all" ? ctx.shots : "all"}`;
  return { b, shots, cam, tag };
}
const f6 = (n) => Number(n).toFixed(6);

E.on(".chan camera export", (ctx) => {
  const { cam, tag } = setup(ctx);
  const lines = cam.frames.map((f) => {
    const [rx, ry, rz] = eulerZXY(f.quat);
    return `${f.n} ${f6(f.pos[0])} ${f6(f.pos[1])} ${f6(f.pos[2])} ${f6(rx)} ${f6(ry)} ${f6(rz)} ${f6(f.fov)}`;
  });
  download(`${tag}.chan`, lines.join("\n") + "\n", "text/plain");
  toast(`Wrote ${cam.frames.length} frames. Columns: frame tx ty tz rx ry rz vfov. Metres, Y up, rotation order ZXY (Nuke's default). The last column is the vertical field of view in degrees; the film back is 36 x 24 mm.`);
});

E.on("Blender camera script", (ctx) => {
  const { b, cam, tag } = setup(ctx);
  const rows = cam.frames.map((f) => {
    const p = toBlenderPos(f.pos), q = toBlenderQuat(f.quat);
    return `[${f.n}, ${f6(p[0])}, ${f6(p[1])}, ${f6(p[2])}, ${f6(q[3])}, ${f6(q[0])}, ${f6(q[1])}, ${f6(q[2])}, ${f6(focalFromFov(f.fov, SENSOR_H))}]`;
  });
  const py = `# Crew camera: ${tag}. Run in Blender's Scripting tab.
import bpy

FPS = ${cam.fps}
# frame, x, y, z, qw, qx, qy, qz, focal length (mm)
KEYS = [
${rows.join(",\n")}
]

scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = KEYS[0][0]
scene.frame_end = KEYS[-1][0]
cam_data = bpy.data.cameras.new("CrewCam")
cam_data.sensor_fit = 'VERTICAL'
cam_data.sensor_height = ${SENSOR_H}
cam = bpy.data.objects.new("CrewCam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_mode = 'QUATERNION'
for k in KEYS:
    scene.frame_set(k[0])
    cam.location = (k[1], k[2], k[3])
    cam.rotation_quaternion = (k[4], k[5], k[6], k[7])
    cam_data.lens = k[8]
    cam.keyframe_insert("location", frame=k[0])
    cam.keyframe_insert("rotation_quaternion", frame=k[0])
    cam_data.keyframe_insert("lens", frame=k[0])
`;
  download(`${tag}_camera.py`, py, "text/x-python");
  toast(`Wrote a Blender script with ${cam.frames.length} keyed frames. Open it in Blender's Scripting tab and run it.`);
});

E.on("After Effects camera script", (ctx) => {
  const { b, cam, tag } = setup(ctx);
  const K = 100, H = 1080, W = 1920; // 100 px per metre, a 1920 x 1080 comp
  const t = [], pos = [], poi = [], zoom = [];
  const fwd = (q) => { // rotate (0,0,-1) by q
    const [x, y, z, w] = q;
    return [-(2 * (x * z + y * w)), -(2 * (y * z - x * w)), -(1 - 2 * (x * x + y * y))];
  };
  for (const f of cam.frames) {
    const d = fwd(f.quat), p = f.pos;
    const ae = (v) => [v[0] * K, -v[1] * K, -v[2] * K]; // three (Y up, -Z forward) -> AE (Y down, +Z forward)
    t.push(Number(((f.n - 1) / cam.fps).toFixed(5)));
    pos.push(ae(p));
    poi.push(ae([p[0] + d[0] * 5, p[1] + d[1] * 5, p[2] + d[2] * 5]));
    zoom.push(Number(((H / 2) / Math.tan((f.fov * Math.PI) / 360)).toFixed(3)));
  }
  const jsx = `// Crew camera: ${tag}. File > Scripts > Run Script File in After Effects.
(function () {
  var comp = app.project.items.addComp("Crew ${tag.replace(/"/g, "")}", ${W}, ${H}, 1, ${(cam.frames.length / cam.fps).toFixed(5)}, ${cam.fps});
  var cam = comp.layers.addCamera("Crew camera", [${W / 2}, ${H / 2}]);
  var T = ${JSON.stringify(t)};
  cam.property("Transform").property("Position").setValuesAtTimes(T, ${JSON.stringify(pos)});
  cam.property("Transform").property("Point of Interest").setValuesAtTimes(T, ${JSON.stringify(poi)});
  cam.property("Camera Options").property("Zoom").setValuesAtTimes(T, ${JSON.stringify(zoom)});
  comp.openInViewer();
})();
`;
  download(`${tag}_camera.jsx`, jsx, "text/javascript");
  toast(`Wrote an After Effects script with ${cam.frames.length} keyed frames (100 px per metre, 1920 x 1080 comp).`);
});

E.on("glTF camera export", async (ctx) => {
  const { shots, cam, tag } = setup(ctx);
  const THREE = await import("three");
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const cm = new THREE.PerspectiveCamera(cam.frames[0]?.fov ?? 40, 16 / 9, 0.1, 1000);
  cm.name = "CrewCam";
  const scene = new THREE.Scene();
  scene.add(cm);
  const t = cam.frames.map((f) => (f.n - 1) / cam.fps);
  const clip = new THREE.AnimationClip("camera", -1, [
    new THREE.VectorKeyframeTrack("CrewCam.position", t, cam.frames.flatMap((f) => f.pos)),
    new THREE.QuaternionKeyframeTrack("CrewCam.quaternion", t, cam.frames.flatMap((f) => f.quat)),
  ]);
  const glb = await new Promise((ok, fail) => new GLTFExporter().parse(scene, ok, fail, { binary: true, animations: [clip] }));
  download(`${tag}_camera.glb`, new Blob([glb], { type: "model/gltf-binary" }));
  const zooms = new Set(cam.frames.map((f) => f.fov.toFixed(2))).size > 1;
  toast(`Wrote a glTF camera with position and rotation animation over ${shots.length} shot${shots.length === 1 ? "" : "s"}.${zooms ? " glTF can't animate the lens, so zooms are not in the file. Use the .chan or Blender export if you need them." : ""}`);
});

E.on("FBX camera export", () => {
  toast("The browser can't write FBX. Use the glTF export (Unreal and most 3D apps import .glb), or the .chan, Blender or After Effects exports.", "info");
});
E.wired("Camera to 3D apps");
