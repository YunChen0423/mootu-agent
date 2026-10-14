const MUJOCO_BASE = "https://cdn.jsdelivr.net/npm/@mujoco/mujoco@3.15.0/";
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";
const MODEL_URL = "/mujoco/exact-physics-model.xml";
const VISUALS_URL = "/mujoco/visuals-exact-v4.bin.gz";
const SETTLE_SECONDS = 0.5;
const NECK_SEGMENT_COUNT = 3;
const OFF = [0.16, 0.16, 0.19, 1];
const RELAY = [1, 0.88, 0.22, 1];
const SELECTED = [0.20, 1, 0.42, 1];
const VOTE_A = [1, 0.55, 0.08, 1];
const VOTE_B = [0.10, 0.62, 1, 1];
const APPROACH_DISTANCE = 0.020;
const NAVIGATION_DURATION = 3;
const SPEAKER_NAVIGATION_DURATION = 1.2;

const PODS = [
  [0, 0.040], [-0.046, 0.025], [-0.046, -0.025],
  [0, -0.040], [0.046, -0.025], [0.046, 0.025]
];
const POD_LAYOUTS = Object.freeze({
  1: [0], 2: [1, 5], 3: [1, 5, 0], 4: [1, 5, 2, 4],
  5: [1, 5, 2, 4, 0], 6: [0, 1, 2, 3, 4, 5]
});

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

export async function createBrowserMujoco({ canvas, onStatus }) {
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
  // Match run_interaction_demo.sh: distance .17, azimuth -90, elevation -62.
  camera.position.set(0, -0.080, 0.155);
  camera.lookAt(0, 0, 0.005);

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
  const wheelQpos = ["wheel_FL_joint", "wheel_FR_joint"].map((name) => Number(model.jnt_qposadr[jointId(name)]));
  const podGeomIds = Array.from({ length: 6 }, (_, index) => geomId(`pod_${index + 1}_light`));
  const podBaseGeomIds = Array.from({ length: 6 }, (_, index) => geomId(`pod_${index + 1}_base`));
  const candidateGeomIds = [geomId("candidate_a"), geomId("candidate_b")];
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
  const votePattern = ["A", "B", "A", "A", "B", "A"];
  const demo = {
    mode: "icebreaker", phase: "intro", phaseStarted: performance.now(), selectedPod: null,
    navigation: null, arrivedAt: null, navStarted: null, navStart: null, navTarget: null,
    navLast: null, navHeight: null, votes: Array(6).fill(null), winner: null, round: 0,
    externalFocus: false, speaker: null, selectedPodNumber: null,
    activePods: [...POD_LAYOUTS[3]], speakerPodMap: new Map([["A", { pod: 1, number: 1 }], ["B", { pod: 5, number: 2 }], ["C", { pod: 0, number: 3 }]])
  };
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
  const clearNavigation = () => {
    demo.navStarted = null;
    demo.navStart = null;
    demo.navTarget = null;
    demo.navLast = null;
    demo.navHeight = null;
  };
  const wrapAngle = (angle) => (angle + Math.PI) % (Math.PI * 2) - Math.PI;
  const baseYaw = () => {
    const w = Number(data.qpos[freeQpos + 3]);
    const x = Number(data.qpos[freeQpos + 4]);
    const y = Number(data.qpos[freeQpos + 5]);
    const z = Number(data.qpos[freeQpos + 6]);
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  };
  const setScenario = (mode) => {
    const now = performance.now();
    demo.mode = mode === "voting" ? "voting" : "icebreaker";
    demo.phase = demo.mode === "icebreaker" ? "intro" : "open";
    demo.phaseStarted = now;
    demo.selectedPod = null;
    demo.selectedPodNumber = null;
    demo.navigation = null;
    demo.arrivedAt = null;
    demo.votes.fill(null);
    demo.winner = null;
    demo.externalFocus = false;
    demo.speaker = null;
    clearNavigation();
  };
  const configureParticipants = (speakerIds) => {
    const speakers = [...new Set((speakerIds || []).map((speaker) => String(speaker).trim()).filter(Boolean))].slice(0, 6);
    const layout = POD_LAYOUTS[speakers.length] || [];
    demo.activePods = [...layout];
    demo.speakerPodMap = new Map(speakers.map((speaker, index) => [speaker, { pod: layout[index], number: index + 1 }]));
    mujoco.mj_resetData(model, data);
    mujoco.mj_forward(model, data);
    settleSimulation();
    setScenario("icebreaker");
    return speakers.map((speaker, index) => ({ speaker, pod: index + 1 }));
  };
  const focusSpeaker = (speakerId) => {
    const speaker = String(speakerId || "").trim();
    const target = demo.speakerPodMap.get(speaker);
    if (!target) return false;
    if (demo.externalFocus && demo.speaker === speaker && ["moving", "arrived"].includes(demo.navigation)) return true;
    demo.mode = "icebreaker";
    demo.phase = "selected";
    demo.phaseStarted = performance.now();
    demo.selectedPod = target.pod;
    demo.selectedPodNumber = target.number;
    demo.navigation = "moving";
    demo.arrivedAt = null;
    demo.externalFocus = true;
    demo.speaker = speaker;
    clearNavigation();
    return true;
  };
  const setAction = (action) => {
    if (action?.speaker) focusSpeaker(action.speaker);
  };
  const updateDemoState = (now) => {
    const elapsed = (now - demo.phaseStarted) / 1000;
    if (demo.mode === "icebreaker") {
      if (demo.phase === "intro" && elapsed >= 1.5) {
        demo.phase = "relay";
        demo.phaseStarted = now;
      } else if (demo.phase === "relay" && elapsed >= 5.4) {
        demo.phase = "selected";
        demo.phaseStarted = now;
        demo.selectedPod = demo.activePods[demo.round % demo.activePods.length];
        demo.selectedPodNumber = demo.round % demo.activePods.length + 1;
        demo.round += 1;
        demo.navigation = "moving";
        clearNavigation();
      } else if (demo.phase === "selected" && !demo.externalFocus && demo.navigation === "arrived" && now - demo.arrivedAt >= 5000) {
        demo.phase = "returning";
        demo.phaseStarted = now;
        demo.navigation = "moving";
        demo.arrivedAt = null;
        clearNavigation();
      } else if (demo.phase === "returning" && demo.navigation === "home") {
        demo.phase = "relay";
        demo.phaseStarted = now;
        demo.selectedPod = null;
        demo.selectedPodNumber = null;
        demo.navigation = null;
        demo.externalFocus = false;
        demo.speaker = null;
        clearNavigation();
      }
    } else if (demo.phase === "open") {
      const count = Math.min(demo.activePods.length, Math.floor(elapsed / 0.75));
      demo.votes.fill(null);
      demo.activePods.forEach((pod, index) => { demo.votes[pod] = index < count ? votePattern[index] : null; });
      if (elapsed >= 5.5) {
        demo.phase = "result";
        demo.phaseStarted = now;
        demo.winner = "A";
      }
    } else if (elapsed >= 5) {
      demo.phase = "open";
      demo.phaseStarted = now;
      demo.votes.fill(null);
      demo.winner = null;
    }
  };
  const updateDemoVisuals = (now) => {
    const colors = Array.from({ length: 6 }, () => OFF);
    const elapsed = (now - demo.phaseStarted) / 1000;
    if (demo.mode === "icebreaker") {
      if (demo.phase === "intro") {
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * Math.PI * 2);
        for (const index of demo.activePods) colors[index] = [0.45 + 0.45 * pulse, 0.28 + 0.42 * pulse, 0.05, 1];
      } else if (demo.phase === "relay") {
        colors[demo.activePods[Math.floor(elapsed / 0.30) % demo.activePods.length]] = RELAY;
      } else if (demo.selectedPod !== null) {
        colors[demo.selectedPod] = SELECTED;
      }
      setColor(candidateGeomIds[0], [0.35, 0.22, 0.08, 1]);
      setColor(candidateGeomIds[1], [0.08, 0.22, 0.35, 1]);
    } else {
      for (const index of demo.activePods) colors[index] = demo.votes[index] === "A" ? VOTE_A : demo.votes[index] === "B" ? VOTE_B : OFF;
      setColor(candidateGeomIds[0], demo.phase === "result" && demo.winner === "A" ? SELECTED : VOTE_A);
      setColor(candidateGeomIds[1], demo.phase === "result" && demo.winner === "B" ? SELECTED : VOTE_B);
    }
    podGeomIds.forEach((id, index) => setColor(id, demo.activePods.includes(index) ? colors[index] : [0, 0, 0, 0]));
    podBaseGeomIds.forEach((id, index) => setColor(id, demo.activePods.includes(index) ? [0.10, 0.10, 0.12, 1] : [0, 0, 0, 0]));
  };
  const reportDemoStatus = (now) => {
    const elapsed = (now - demo.phaseStarted) / 1000;
    let label;
    if (demo.mode === "icebreaker") {
      if (demo.phase === "intro") label = "破冰启动 · MooTu 发起互动";
      else if (demo.phase === "relay") label = `灯光接力 · Pod ${Math.floor(elapsed / 0.30) % demo.activePods.length + 1}`;
      else if (demo.phase === "selected" && demo.externalFocus) label = `${demo.speaker} 正在发言 · ${demo.navigation === "arrived" ? `已到达 Pod ${demo.selectedPodNumber}` : `前往 Pod ${demo.selectedPodNumber}`}`;
      else if (demo.phase === "selected") label = `选中 Pod ${demo.selectedPodNumber} · ${demo.navigation === "arrived" ? "邀请发言" : "靠近参与者"}`;
      else label = "返回中心";
    } else {
      const a = demo.votes.filter((vote) => vote === "A").length;
      const b = demo.votes.filter((vote) => vote === "B").length;
      label = demo.phase === "open" ? `投票进行中 · A ${a} / B ${b}` : `投票结果 · A 胜出 ${a}:${b}`;
    }
    onStatus?.(label);
  };
  const applyDemoControls = (now) => {
    const elapsed = (now - demo.phaseStarted) / 1000;
    let neckSide = 0, neckPitch = 0, headPitch = 0, headYaw = 0;
    if (demo.mode === "icebreaker" && demo.phase === "selected" && demo.navigation === "arrived") {
      headPitch = 0.14 * Math.max(0, Math.sin(((now - demo.arrivedAt) / 1000) * Math.PI * 0.8));
    } else if (demo.mode === "icebreaker" && !["selected", "returning"].includes(demo.phase)) {
      headYaw = (Math.PI / 10) * Math.sin(elapsed * 1.8);
      headPitch = (Math.PI / 36) * Math.sin(elapsed * 2.5);
      neckSide = (7 * Math.PI / 180) * Math.sin(elapsed * 1.2);
    } else if (demo.mode === "voting" && demo.phase === "result") {
      const [tx, ty] = demo.winner === "A" ? [-0.013, 0.020] : [0.013, 0.020];
      const dx = tx - Number(data.qpos[freeQpos]);
      const dy = ty - Number(data.qpos[freeQpos + 1]);
      headYaw = Math.max(-0.61, Math.min(0.61, wrapAngle(Math.atan2(-dx, dy) - baseYaw())));
    }
    setControl("wheel_FL", 0);
    setControl("wheel_FR", 0);
    for (const index of [1, 2, 3]) {
      setControl(`neck_${index}_pitch`, neckPitch / NECK_SEGMENT_COUNT);
      setControl(`neck_${index}_side`, neckSide / NECK_SEGMENT_COUNT);
    }
    setControl("head_pitch", headPitch);
    setControl("head_yaw", headYaw);
  };
  const smoothstep = (value) => {
    const progress = Math.max(0, Math.min(1, value));
    return progress ** 3 * (progress * (progress * 6 - 15) + 10);
  };
  const applyScriptedNavigation = (now) => {
    if (demo.mode !== "icebreaker" || !["selected", "returning"].includes(demo.phase)) return;
    if (!demo.navStart) {
      const startX = Number(data.qpos[freeQpos]);
      const startY = Number(data.qpos[freeQpos + 1]);
      const startYaw = baseYaw();
      let targetX = 0, targetY = 0, targetYaw = 0;
      if (demo.phase === "selected") {
        const [podX, podY] = PODS[demo.selectedPod];
        targetYaw = Math.atan2(-(podX - startX), podY - startY);
        targetX = podX + Math.sin(targetYaw) * APPROACH_DISTANCE;
        targetY = podY - Math.cos(targetYaw) * APPROACH_DISTANCE;
      }
      demo.navStarted = now;
      demo.navStart = [startX, startY, startYaw];
      demo.navTarget = [targetX, targetY, targetYaw];
      demo.navLast = [...demo.navStart];
      demo.navHeight = Number(data.qpos[freeQpos + 2]);
    }
    const duration = demo.externalFocus ? SPEAKER_NAVIGATION_DURATION : NAVIGATION_DURATION;
    const progress = Math.min(1, (now - demo.navStarted) / (duration * 1000));
    const eased = smoothstep(progress);
    const [startX, startY, startYaw] = demo.navStart;
    const [targetX, targetY, targetYaw] = demo.navTarget;
    const yawDelta = wrapAngle(targetYaw - startYaw);
    const x = startX + (targetX - startX) * eased;
    const y = startY + (targetY - startY) * eased;
    const yaw = startYaw + yawDelta * eased;
    const [lastX, lastY, lastYaw] = demo.navLast;
    const travel = Math.hypot(x - lastX, y - lastY);
    const yawStep = wrapAngle(yaw - lastYaw);
    data.qpos[wheelQpos[0]] -= (travel + yawStep * 0.002366) / 0.000933;
    data.qpos[wheelQpos[1]] -= (travel - yawStep * 0.002366) / 0.000933;
    data.qpos[freeQpos] = x;
    data.qpos[freeQpos + 1] = y;
    data.qpos[freeQpos + 2] = demo.navHeight;
    data.qpos[freeQpos + 3] = Math.cos(yaw / 2);
    data.qpos[freeQpos + 4] = 0;
    data.qpos[freeQpos + 5] = 0;
    data.qpos[freeQpos + 6] = Math.sin(yaw / 2);
    haltBaseMotion();
    demo.navLast = [x, y, yaw];
    mujoco.mj_forward(model, data);
    if (progress >= 1) {
      if (demo.phase === "selected") {
        demo.navigation = "arrived";
        demo.arrivedAt = now;
      } else {
        demo.navigation = "home";
      }
    }
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
    updateDemoState(now);
    updateDemoVisuals(now);
    applyDemoControls(now);
    const targetTime = Number(data.time) + 1 / 60;
    while (Number(data.time) < targetTime) mujoco.mj_step(model, data);
    applyScriptedNavigation(now);
    reportDemoStatus(now);
    updateMeshes();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  };
  mujoco.mj_forward(model, data);
  settleSimulation();
  updateDemoVisuals(performance.now());
  frameId = requestAnimationFrame(animate);

  return {
    setAction,
    setScenario,
    configureParticipants,
    focusSpeaker,
    reset() {
      mujoco.mj_resetData(model, data);
      mujoco.mj_forward(model, data);
      settleSimulation();
      setScenario(demo.mode);
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
