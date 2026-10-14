const MUJOCO_BASE = "https://cdn.jsdelivr.net/npm/@mujoco/mujoco@3.15.0/";
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";
const MODEL_URL = "/mujoco/exact-physics-model.xml";
const VISUALS_URL = "/mujoco/visuals-exact-v4.bin.gz";
const SETTLE_SECONDS = 0.5;
const NECK_SEGMENT_COUNT = 3;

const PODS = [
  [0, 0.040], [-0.046, 0.025], [-0.046, -0.025],
  [0, -0.040], [0.046, -0.025], [0.046, 0.025]
];

const readString = (bytes) => new TextDecoder().decode(bytes);

async function unpackVisuals() {
  const response = await fetch(VISUALS_URL);
  if (!response.ok) throw new Error(`高精度网格下载失败 (${response.status})`);
  if (!globalThis.DecompressionStream) throw new Error("当前浏览器不支持高精度网格解压");
  const decompressed = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const view = new DataView(decompressed);
  const bytes = new Uint8Array(decompressed);
  const meshes = [];
  let offset = 0;
  const count = view.getUint32(offset, true);
  offset += 4;
  for (let meshIndex = 0; meshIndex < count; meshIndex += 1) {
    const nameLength = view.getUint16(offset, true);
    const bodyNameLength = view.getUint16(offset + 2, true);
    const vertexCount = view.getUint32(offset + 4, true);
    const faceCount = view.getUint32(offset + 8, true);
    const indexWidth = view.getUint8(offset + 12);
    offset += 13;
    const name = readString(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    const bodyName = readString(bytes.subarray(offset, offset + bodyNameLength));
    offset += bodyNameLength;
    const localPosition = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
    const localQuaternion = [view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true), view.getFloat32(offset + 24, true)];
    offset += 28;
    const lower = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
    const upper = [view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true)];
    offset += 24;
    const positions = new Float32Array(vertexCount * 3);
    for (let index = 0; index < positions.length; index += 1) {
      const axis = index % 3;
      positions[index] = lower[axis] + (view.getUint16(offset + index * 2, true) / 65535) * (upper[axis] - lower[axis]);
    }
    offset += positions.length * 2;
    const indices = new Uint32Array(faceCount * 3);
    for (let index = 0; index < indices.length; index += 1) {
      indices[index] = indexWidth === 2 ? view.getUint16(offset + index * 2, true) : view.getUint32(offset + index * 4, true);
    }
    offset += indices.length * indexWidth;
    meshes.push({ name, bodyName, localPosition, localQuaternion, positions, indices });
  }
  return meshes;
}

function geometryFor(THREE, mujoco, model, geom) {
  const type = Number(geom.type);
  const size = Array.from(geom.size, Number);
  if (type === mujoco.mjtGeom.mjGEOM_PLANE.value) return new THREE.PlaneGeometry(size[0] ? size[0] * 2 : 1, size[1] ? size[1] * 2 : 1);
  if (type === mujoco.mjtGeom.mjGEOM_SPHERE.value) return new THREE.SphereGeometry(size[0], 24, 16);
  if (type === mujoco.mjtGeom.mjGEOM_BOX.value) return new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
  if (type === mujoco.mjtGeom.mjGEOM_CYLINDER.value) {
    const shape = new THREE.CylinderGeometry(size[0], size[0], size[2] * 2, 28);
    shape.rotateX(Math.PI / 2);
    return shape;
  }
  return new THREE.BufferGeometry();
}

function exactGeometryFor(THREE, asset) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(asset.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(asset.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export async function createBrowserMujoco({ canvas }) {
  const [{ default: loadMujoco }, THREE, modelXml, visualMeshes] = await Promise.all([
    import(`${MUJOCO_BASE}mujoco.js`),
    import(THREE_URL),
    fetch(MODEL_URL).then((response) => {
      if (!response.ok) throw new Error(`高精度模型配置下载失败 (${response.status})`);
      return response.text();
    }),
    unpackVisuals()
  ]);
  const mujoco = await loadMujoco({ locateFile: (name) => `${MUJOCO_BASE}${name}` });
  const model = mujoco.MjModel.from_xml_string(modelXml);
  if (!model) throw new Error("MuJoCo 高精度模型编译失败");
  const data = new mujoco.MjData(model);
  const option = new mujoco.MjvOption();
  const perturb = new mujoco.MjvPerturb();
  const cameraState = new mujoco.MjvCamera();
  const mjScene = new mujoco.MjvScene(model, 1024);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x17181b);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303137, 2.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(-0.08, -0.12, 0.2);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffd978, 1.15);
  fillLight.position.set(0.12, 0.02, 0.08);
  scene.add(fillLight);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.001, 2);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -0.155, 0.115);
  camera.lookAt(0, 0, 0.006);

  const screen = canvas.parentElement;
  const resize = () => {
    const width = Math.max(320, screen.clientWidth || 640);
    const height = Math.max(220, screen.clientHeight || 360);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(screen);
  resize();

  const meshes = [];
  const geometryCache = new Map();
  const actuatorId = (name) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR.value, name);
  const geomId = (name) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM.value, name);
  const jointId = (name) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT.value, name);
  const bodyId = (name) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, name);
  const actuators = Object.fromEntries([
    "wheel_FL", "wheel_FR", "neck_1_pitch", "neck_1_side", "neck_2_pitch", "neck_2_side",
    "neck_3_pitch", "neck_3_side", "head_pitch", "head_yaw"
  ].map((name) => [name, actuatorId(`${name}_motor`)]));
  const freeQpos = Number(model.jnt_qposadr[jointId("robot_freejoint")]);
  const freeDof = Number(model.jnt_dofadr[jointId("robot_freejoint")]);
  const wheelDofs = ["wheel_FL_joint", "wheel_FR_joint"].map((name) => Number(model.jnt_dofadr[jointId(name)]));
  const podGeomIds = Array.from({ length: 6 }, (_, index) => geomId(`pod_${index + 1}_light`));
  const exactVisuals = visualMeshes.map((asset) => {
    const geometry = exactGeometryFor(THREE, asset);
    const isWheel = asset.name.startsWith("wheel_");
    const material = new THREE.MeshStandardMaterial({
      color: isWheel ? 0x34363b : 0xeeeeeb,
      roughness: isWheel ? 0.62 : 0.34,
      metalness: isWheel ? 0.16 : 0.04,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const localRotation = new THREE.Quaternion(
      asset.localQuaternion[1], asset.localQuaternion[2], asset.localQuaternion[3], asset.localQuaternion[0]
    );
    const localMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...asset.localPosition), localRotation, new THREE.Vector3(1, 1, 1)
    );
    return {
      mesh,
      geometry,
      material,
      bodyId: bodyId(asset.bodyName),
      localMatrix
    };
  });
  const bodyMatrix = new THREE.Matrix4();
  let command = { strategy: "observe", target: null };
  let commandStarted = performance.now();
  let frameId = 0;

  const setControl = (name, value) => {
    const id = actuators[name];
    if (id >= 0) data.ctrl[id] = value;
  };
  const haltBaseMotion = () => {
    for (let index = 0; index < 6; index += 1) data.qvel[freeDof + index] = 0;
    for (const dof of wheelDofs) data.qvel[dof] = 0;
    setControl("wheel_FL", 0);
    setControl("wheel_FR", 0);
  };
  const settleSimulation = () => {
    data.ctrl.fill(0);
    const settledAt = Number(data.time) + SETTLE_SECONDS;
    while (Number(data.time) < settledAt) mujoco.mj_step(model, data);
    haltBaseMotion();
    mujoco.mj_forward(model, data);
  };
  const setColor = (id, rgba) => rgba.forEach((value, index) => { model.geom_rgba[id * 4 + index] = value; });
  const setAction = (next) => {
    command = next || { strategy: "observe", target: null };
    commandStarted = performance.now();
    const target = String(command.target || "").trim().toUpperCase();
    const targetIndex = /^[A-F]$/.test(target) ? target.charCodeAt(0) - 65 : Number(target) >= 1 && Number(target) <= 6 ? Number(target) - 1 : -1;
    podGeomIds.forEach((id, index) => setColor(id, index === targetIndex ? [0.2, 1, 0.42, 1] : [0.16, 0.16, 0.19, 1]));
  };

  const wrapAngle = (angle) => (angle + Math.PI) % (Math.PI * 2) - Math.PI;
  const applyControls = (now) => {
    const elapsed = (now - commandStarted) / 1000;
    const strategy = command.strategy || "observe";
    const target = String(command.target || "").trim().toUpperCase();
    const targetIndex = /^[A-F]$/.test(target) ? target.charCodeAt(0) - 65 : -1;
    let left = 0, right = 0, neckPitch = 0, neckSide = 0, headPitch = 0, headYaw = 0;
    if (strategy === "invite_quiet_member" && targetIndex >= 0) {
      const [tx, ty] = PODS[targetIndex];
      const x = Number(data.qpos[freeQpos]);
      const y = Number(data.qpos[freeQpos + 1]);
      const q = Array.from(data.qpos.slice(freeQpos + 3, freeQpos + 7), Number);
      const yaw = Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]));
      const error = wrapAngle(Math.atan2(-(tx - x), ty - y) - yaw);
      const distance = Math.hypot(tx - x, ty - y);
      if (Math.abs(error) > 0.12) {
        const turn = Math.sign(error) * Math.min(10, Math.max(5, Math.abs(error) * 8));
        left = -turn;
        right = turn;
      } else if (distance > 0.022) {
        left = -8;
        right = -8;
      }
      neckPitch = 0.055;
      headPitch = 0.08;
      headYaw = Math.max(-0.45, Math.min(0.45, error * 0.5));
    } else if (strategy === "open_new_direction" || strategy === "prepare_convergence") {
      headYaw = Math.sin(elapsed * 1.45) * (strategy === "open_new_direction" ? 0.65 : 0.42);
      neckPitch = -0.04;
      headPitch = -0.08;
    } else if (strategy === "sustain_flow") {
      neckPitch = 0.045;
      headPitch = Math.sin(elapsed * 5.2) * 0.14;
    } else if (strategy === "advance_decision") {
      neckPitch = 0.06;
      headPitch = Math.max(0, Math.sin(elapsed * 4.2)) * 0.1;
    } else {
      headYaw = Math.sin(elapsed / 1.7) * 0.18;
      neckSide = Math.sin(elapsed / 2.3) * 0.012;
    }
    setControl("wheel_FL", left);
    setControl("wheel_FR", right);
    for (const index of [1, 2, 3]) {
      setControl(`neck_${index}_pitch`, neckPitch / NECK_SEGMENT_COUNT);
      setControl(`neck_${index}_side`, neckSide / NECK_SEGMENT_COUNT);
    }
    setControl("head_pitch", headPitch);
    setControl("head_yaw", headYaw);
  };

  const updateMeshes = () => {
    mujoco.mjv_updateScene(model, data, option, perturb, cameraState, mujoco.mjtCatBit.mjCAT_ALL.value, mjScene);
    const geoms = mjScene.geoms;
    const count = Number(geoms.size());
    for (let index = 0; index < count; index += 1) {
      const geom = geoms.get(index);
      const rgba = Array.from(geom.rgba, Number);
      const matrix = Array.from(geom.mat, Number);
      const position = Array.from(geom.pos, Number);
      let mesh = meshes[index];
      if (!mesh) {
        const key = Number(geom.type) === mujoco.mjtGeom.mjGEOM_MESH.value
          ? `mesh:${Number(geom.dataid)}`
          : JSON.stringify([Number(geom.type), Array.from(geom.size, Number)]);
        let geometry = geometryCache.get(key);
        if (!geometry) {
          geometry = geometryFor(THREE, mujoco, model, geom);
          geometryCache.set(key, geometry);
        }
        const material = new THREE.MeshStandardMaterial({ roughness: 0.48, metalness: 0.06, side: THREE.DoubleSide });
        mesh = new THREE.Mesh(geometry, material);
        mesh.matrixAutoUpdate = false;
        meshes[index] = mesh;
        scene.add(mesh);
      }
      mesh.visible = rgba[3] > 0.01;
      mesh.material.color.setRGB(rgba[0], rgba[1], rgba[2]);
      mesh.material.opacity = rgba[3];
      mesh.material.transparent = rgba[3] < 1;
      mesh.matrix.set(
        matrix[0], matrix[1], matrix[2], position[0],
        matrix[3], matrix[4], matrix[5], position[1],
        matrix[6], matrix[7], matrix[8], position[2],
        0, 0, 0, 1
      );
      mesh.matrixWorldNeedsUpdate = true;
      geom.delete();
    }
    for (let index = count; index < meshes.length; index += 1) meshes[index].visible = false;
    geoms.delete();
    for (const visual of exactVisuals) {
      const offset = visual.bodyId * 3;
      const rotationOffset = visual.bodyId * 9;
      bodyMatrix.set(
        Number(data.xmat[rotationOffset]), Number(data.xmat[rotationOffset + 1]), Number(data.xmat[rotationOffset + 2]), Number(data.xpos[offset]),
        Number(data.xmat[rotationOffset + 3]), Number(data.xmat[rotationOffset + 4]), Number(data.xmat[rotationOffset + 5]), Number(data.xpos[offset + 1]),
        Number(data.xmat[rotationOffset + 6]), Number(data.xmat[rotationOffset + 7]), Number(data.xmat[rotationOffset + 8]), Number(data.xpos[offset + 2]),
        0, 0, 0, 1
      );
      visual.mesh.matrix.copy(bodyMatrix).multiply(visual.localMatrix);
      visual.mesh.matrixWorldNeedsUpdate = true;
    }
  };

  const animate = (now) => {
    applyControls(now);
    const targetTime = Number(data.time) + 1 / 60;
    while (Number(data.time) < targetTime) mujoco.mj_step(model, data);
    updateMeshes();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  };
  mujoco.mj_forward(model, data);
  settleSimulation();
  setAction(command);
  frameId = requestAnimationFrame(animate);

  return {
    setAction,
    reset() {
      mujoco.mj_resetData(model, data);
      mujoco.mj_forward(model, data);
      settleSimulation();
      commandStarted = performance.now();
    },
    dispose() {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      for (const geometry of geometryCache.values()) geometry.dispose();
      for (const visual of exactVisuals) {
        visual.geometry.dispose();
        visual.material.dispose();
      }
      mjScene.delete();
      cameraState.delete();
      perturb.delete();
      option.delete();
      data.delete();
      model.delete();
    }
  };
}
