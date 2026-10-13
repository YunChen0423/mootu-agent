const MUJOCO_BASE = "https://cdn.jsdelivr.net/npm/@mujoco/mujoco@3.15.0/";
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";

const MODEL_XML = `
<mujoco model="mootu_browser_demo">
  <compiler angle="radian"/>
  <option timestep="0.002" integrator="implicitfast" gravity="0 0 0"/>
  <visual><global offwidth="960" offheight="540"/></visual>
  <default>
    <joint damping="0.05" armature="0.00001"/>
    <geom contype="0" conaffinity="0"/>
  </default>
  <worldbody>
    <geom name="table" type="box" pos="0 0 -0.002" size="0.080 0.055 0.002" rgba="0.30 0.30 0.32 1"/>
    <geom name="pod_1_base" type="cylinder" pos="0 0.040 0.0012" size="0.0050 0.0012" rgba="0.10 0.10 0.12 1"/>
    <geom name="pod_1_light" type="sphere" pos="0 0.040 0.0040" size="0.0034" rgba="0.16 0.16 0.19 1"/>
    <geom name="pod_2_base" type="cylinder" pos="-0.046 0.025 0.0012" size="0.0050 0.0012" rgba="0.10 0.10 0.12 1"/>
    <geom name="pod_2_light" type="sphere" pos="-0.046 0.025 0.0040" size="0.0034" rgba="0.16 0.16 0.19 1"/>
    <geom name="pod_3_base" type="cylinder" pos="-0.046 -0.025 0.0012" size="0.0050 0.0012" rgba="0.10 0.10 0.12 1"/>
    <geom name="pod_3_light" type="sphere" pos="-0.046 -0.025 0.0040" size="0.0034" rgba="0.16 0.16 0.19 1"/>
    <geom name="pod_4_base" type="cylinder" pos="0 -0.040 0.0012" size="0.0050 0.0012" rgba="0.10 0.10 0.12 1"/>
    <geom name="pod_4_light" type="sphere" pos="0 -0.040 0.0040" size="0.0034" rgba="0.16 0.16 0.19 1"/>
    <geom name="pod_5_base" type="cylinder" pos="0.046 -0.025 0.0012" size="0.0050 0.0012" rgba="0.10 0.10 0.12 1"/>
    <geom name="pod_5_light" type="sphere" pos="0.046 -0.025 0.0040" size="0.0034" rgba="0.16 0.16 0.19 1"/>
    <geom name="pod_6_base" type="cylinder" pos="0.046 0.025 0.0012" size="0.0050 0.0012" rgba="0.10 0.10 0.12 1"/>
    <geom name="pod_6_light" type="sphere" pos="0.046 0.025 0.0040" size="0.0034" rgba="0.16 0.16 0.19 1"/>
    <geom name="candidate_a" type="cylinder" pos="-0.013 0.020 0.0008" size="0.0040 0.0008" rgba="0.20 0.52 1 1"/>
    <geom name="candidate_b" type="cylinder" pos="0.013 0.020 0.0008" size="0.0040 0.0008" rgba="1 0.55 0.08 1"/>

    <body name="robot" pos="0 0 0.006">
      <joint name="robot_x" type="slide" axis="1 0 0" range="-0.055 0.055"/>
      <joint name="robot_y" type="slide" axis="0 1 0" range="-0.045 0.045"/>
      <joint name="robot_yaw" type="hinge" axis="0 0 1" range="-3.1416 3.1416"/>
      <geom name="body" type="ellipsoid" size="0.009 0.007 0.006" rgba="0.92 0.92 0.89 1" mass="0.03"/>
      <geom name="face_panel" type="box" pos="0 0.006 0.001" size="0.0045 0.0011 0.0032" rgba="0.08 0.09 0.10 1"/>
      <geom name="eye_left" type="sphere" pos="-0.002 0.0073 0.0015" size="0.00065" rgba="1 0.76 0.08 1"/>
      <geom name="eye_right" type="sphere" pos="0.002 0.0073 0.0015" size="0.00065" rgba="1 0.76 0.08 1"/>
      <geom name="wheel_left" type="cylinder" pos="-0.007 0 -0.0045" size="0.0022 0.0016" quat="0.7071 0 0.7071 0" rgba="0.08 0.08 0.09 1"/>
      <geom name="wheel_right" type="cylinder" pos="0.007 0 -0.0045" size="0.0022 0.0016" quat="0.7071 0 0.7071 0" rgba="0.08 0.08 0.09 1"/>
      <body name="neck" pos="0 0 0.006">
        <joint name="neck_pitch" type="hinge" axis="1 0 0" range="-0.5 0.5"/>
        <geom type="cylinder" size="0.0025 0.004" rgba="0.73 0.74 0.72 1"/>
        <body name="head" pos="0 0 0.007">
          <joint name="head_pitch" type="hinge" axis="1 0 0" range="-0.55 0.55"/>
          <joint name="head_yaw" type="hinge" axis="0 0 1" range="-1.1 1.1"/>
          <geom type="ellipsoid" size="0.010 0.008 0.0065" rgba="0.96 0.96 0.93 1" mass="0.008"/>
          <geom type="box" pos="0 0.0072 0" size="0.0065 0.0011 0.004" rgba="0.06 0.07 0.08 1"/>
          <geom type="sphere" pos="-0.0026 0.0085 0.0005" size="0.0007" rgba="1 0.76 0.08 1"/>
          <geom type="sphere" pos="0.0026 0.0085 0.0005" size="0.0007" rgba="1 0.76 0.08 1"/>
        </body>
      </body>
    </body>
  </worldbody>
  <actuator>
    <position name="robot_x_motor" joint="robot_x" kp="6" ctrlrange="-0.055 0.055"/>
    <position name="robot_y_motor" joint="robot_y" kp="6" ctrlrange="-0.045 0.045"/>
    <position name="robot_yaw_motor" joint="robot_yaw" kp="3" ctrlrange="-3.1416 3.1416"/>
    <position name="neck_pitch_motor" joint="neck_pitch" kp="1" ctrlrange="-0.5 0.5"/>
    <position name="head_pitch_motor" joint="head_pitch" kp="1" ctrlrange="-0.55 0.55"/>
    <position name="head_yaw_motor" joint="head_yaw" kp="1" ctrlrange="-1.1 1.1"/>
  </actuator>
</mujoco>`;

const PODS = [
  [0, 0.040], [-0.046, 0.025], [-0.046, -0.025],
  [0, -0.040], [0.046, -0.025], [0.046, 0.025]
];

function geometryFor(THREE, mujoco, geom) {
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
  if (type === mujoco.mjtGeom.mjGEOM_ELLIPSOID.value) {
    const shape = new THREE.SphereGeometry(1, 28, 20);
    shape.scale(size[0], size[1], size[2]);
    return shape;
  }
  return new THREE.BufferGeometry();
}

export async function createBrowserMujoco({ canvas }) {
  const [{ default: loadMujoco }, THREE] = await Promise.all([
    import(`${MUJOCO_BASE}mujoco.js`),
    import(THREE_URL)
  ]);
  const mujoco = await loadMujoco({ locateFile: (name) => `${MUJOCO_BASE}${name}` });
  const model = mujoco.MjModel.from_xml_string(MODEL_XML);
  if (!model) throw new Error("MuJoCo model compilation failed");
  const data = new mujoco.MjData(model);
  const option = new mujoco.MjvOption();
  const perturb = new mujoco.MjvPerturb();
  const cameraState = new mujoco.MjvCamera();
  const mjScene = new mujoco.MjvScene(model, 512);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x17181b);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x33343a, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(-0.08, -0.1, 0.18);
  scene.add(keyLight);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
  const actuators = Object.fromEntries(["robot_x", "robot_y", "robot_yaw", "neck_pitch", "head_pitch", "head_yaw"].map((name) => [name, actuatorId(`${name}_motor`)]));
  const podGeomIds = Array.from({ length: 6 }, (_, index) => geomId(`pod_${index + 1}_light`));
  let command = { strategy: "observe", target: null };
  let commandStarted = performance.now();
  let frameId = 0;

  const setColor = (id, rgba) => rgba.forEach((value, index) => { model.geom_rgba[id * 4 + index] = value; });
  const setAction = (next) => {
    command = next || { strategy: "observe", target: null };
    commandStarted = performance.now();
    const target = String(command.target || "").trim().toUpperCase();
    const targetIndex = /^[A-F]$/.test(target) ? target.charCodeAt(0) - 65 : Number(target) >= 1 && Number(target) <= 6 ? Number(target) - 1 : -1;
    podGeomIds.forEach((id, index) => setColor(id, index === targetIndex ? [0.2, 1, 0.42, 1] : [0.16, 0.16, 0.19, 1]));
  };

  const applyControls = (now) => {
    const elapsed = (now - commandStarted) / 1000;
    const strategy = command.strategy || "observe";
    const target = String(command.target || "").trim().toUpperCase();
    const targetIndex = /^[A-F]$/.test(target) ? target.charCodeAt(0) - 65 : -1;
    let x = 0, y = 0, yaw = 0, neck = 0, headPitch = 0, headYaw = 0;
    if (strategy === "invite_quiet_member" && targetIndex >= 0) {
      const [tx, ty] = PODS[targetIndex];
      x = tx * 0.16;
      y = ty * 0.16;
      yaw = Math.atan2(-tx, ty);
      neck = 0.18;
      headPitch = 0.08;
    } else if (strategy === "open_new_direction" || strategy === "prepare_convergence") {
      headYaw = Math.sin(elapsed * 1.45) * (strategy === "open_new_direction" ? 0.65 : 0.42);
      neck = -0.12;
      headPitch = -0.08;
    } else if (strategy === "sustain_flow") {
      neck = 0.14;
      headPitch = Math.sin(elapsed * 5.2) * 0.14;
    } else if (strategy === "advance_decision") {
      neck = 0.18;
      headPitch = Math.max(0, Math.sin(elapsed * 4.2)) * 0.1;
    } else {
      headYaw = Math.sin(now / 1700) * 0.18;
    }
    data.ctrl[actuators.robot_x] = x;
    data.ctrl[actuators.robot_y] = y;
    data.ctrl[actuators.robot_yaw] = yaw;
    data.ctrl[actuators.neck_pitch] = neck;
    data.ctrl[actuators.head_pitch] = headPitch;
    data.ctrl[actuators.head_yaw] = headYaw;
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
        const type = Number(geom.type);
        const size = Array.from(geom.size, Number);
        const key = JSON.stringify([type, size]);
        let geometry = geometryCache.get(key);
        if (!geometry) {
          geometry = geometryFor(THREE, mujoco, geom);
          geometryCache.set(key, geometry);
        }
        const material = new THREE.MeshStandardMaterial({ roughness: 0.54, metalness: 0.08 });
        mesh = new THREE.Mesh(geometry, material);
        mesh.matrixAutoUpdate = false;
        meshes[index] = mesh;
        scene.add(mesh);
      }
      mesh.visible = true;
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
  setAction(command);
  frameId = requestAnimationFrame(animate);

  return {
    setAction,
    reset() {
      mujoco.mj_resetData(model, data);
      mujoco.mj_forward(model, data);
      commandStarted = performance.now();
    },
    dispose() {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      mjScene.delete();
      cameraState.delete();
      perturb.delete();
      option.delete();
      data.delete();
      model.delete();
    }
  };
}
