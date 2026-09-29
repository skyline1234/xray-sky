import * as THREE from "three";

const app = document.getElementById("app");
const motionBtn = document.getElementById("motionBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");

// ------------------------------------------------------------
// Scene
// ------------------------------------------------------------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

// ------------------------------------------------------------
// Inside-out sky sphere
// Replace assets/sky.jpg with your own 2:1 equirectangular texture.
// ------------------------------------------------------------
const texture = new THREE.TextureLoader().load("./assets/sky.jpg");
texture.colorSpace = THREE.SRGBColorSpace;

const geometry = new THREE.SphereGeometry(20, 96, 64);
const material = new THREE.MeshBasicMaterial({
  map: texture,
  side: THREE.BackSide
});
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

// ------------------------------------------------------------
// Manual drag state
// ------------------------------------------------------------
let yaw = 0;
let pitch = 0;
let pointerDown = false;
let lastX = 0;
let lastY = 0;

const DRAG_SPEED = 0.004;

renderer.domElement.addEventListener("pointerdown", (e) => {
  pointerDown = true;
  lastX = e.clientX;
  lastY = e.clientY;
  renderer.domElement.setPointerCapture?.(e.pointerId);
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!pointerDown) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;

  yaw -= dx * DRAG_SPEED;
  pitch -= dy * DRAG_SPEED;

  const limit = THREE.MathUtils.degToRad(85);
  pitch = THREE.MathUtils.clamp(pitch, -limit, limit);

  lastX = e.clientX;
  lastY = e.clientY;
});

function endPointer(e) {
  pointerDown = false;
  renderer.domElement.releasePointerCapture?.(e.pointerId);
}
renderer.domElement.addEventListener("pointerup", endPointer);
renderer.domElement.addEventListener("pointercancel", endPointer);

// ------------------------------------------------------------
// Device orientation
//
// This uses the same basic coordinate conversion historically used
// by Three.js DeviceOrientationControls:
// alpha = device rotation around z
// beta  = front/back tilt
// gamma = left/right tilt
//
// The initial phone pose is treated as the neutral pose.
// ------------------------------------------------------------
let motionEnabled = false;
let latestOrientation = null;
let referenceDeviceQ = null;

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

function getScreenOrientationRad() {
  if (screen.orientation && typeof screen.orientation.angle === "number") {
    return THREE.MathUtils.degToRad(screen.orientation.angle);
  }
  if (typeof window.orientation === "number") {
    return THREE.MathUtils.degToRad(window.orientation);
  }
  return 0;
}

function deviceEventToQuaternion(event) {
  const alpha = event.alpha != null ? THREE.MathUtils.degToRad(event.alpha) : 0;
  const beta  = event.beta  != null ? THREE.MathUtils.degToRad(event.beta)  : 0;
  const gamma = event.gamma != null ? THREE.MathUtils.degToRad(event.gamma) : 0;
  const orient = getScreenOrientationRad();

  const q = new THREE.Quaternion();

  euler.set(beta, alpha, -gamma, "YXZ");
  q.setFromEuler(euler);
  q.multiply(q1);
  q.multiply(q0.setFromAxisAngle(zee, -orient));

  return q;
}

function onDeviceOrientation(event) {
  // Some browsers fire the event but provide null values.
  if (event.alpha == null && event.beta == null && event.gamma == null) return;

  latestOrientation = event;

  if (!referenceDeviceQ) {
    referenceDeviceQ = deviceEventToQuaternion(event);
    statusEl.textContent = "Motion enabled";
  }
}

async function enableMotion() {
  try {
    // iOS Safari requires this call to happen from a user gesture.
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const result = await DeviceOrientationEvent.requestPermission();

      if (result !== "granted") {
        statusEl.textContent = "Motion denied — drag instead";
        return;
      }
    }

    window.addEventListener("deviceorientation", onDeviceOrientation, true);
    motionEnabled = true;
    referenceDeviceQ = null;

    motionBtn.textContent = "Motion Enabled";
    hintEl.textContent = "Move your phone or drag to fine-tune";
    statusEl.textContent = "Waiting for sensor…";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Motion unavailable — drag instead";
  }
}

motionBtn.addEventListener("click", enableMotion);

// ------------------------------------------------------------
// Reset
// ------------------------------------------------------------
resetBtn.addEventListener("click", () => {
  yaw = 0;
  pitch = 0;

  // Recenter gyro using the current phone pose.
  if (latestOrientation) {
    referenceDeviceQ = deviceEventToQuaternion(latestOrientation);
  }

  statusEl.textContent = motionEnabled ? "View recentered" : "Manual view reset";
});

// ------------------------------------------------------------
// Camera orientation
// ------------------------------------------------------------
const qManual = new THREE.Quaternion();
const qRelativeDevice = new THREE.Quaternion();
const qReferenceInverse = new THREE.Quaternion();

function updateCameraQuaternion() {
  // Manual drag offset
  const manualEuler = new THREE.Euler(pitch, yaw, 0, "YXZ");
  qManual.setFromEuler(manualEuler);

  if (motionEnabled && latestOrientation && referenceDeviceQ) {
    const currentQ = deviceEventToQuaternion(latestOrientation);

    // Relative rotation from initial phone pose:
    // qRelative = inverse(qReference) * qCurrent
    qReferenceInverse.copy(referenceDeviceQ).invert();
    qRelativeDevice.copy(qReferenceInverse).multiply(currentQ);

    // Gyro movement plus a manual touch/mouse offset.
    camera.quaternion.copy(qRelativeDevice).multiply(qManual);
  } else {
    camera.quaternion.copy(qManual);
  }
}

// ------------------------------------------------------------
// Render loop
// ------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  updateCameraQuaternion();
  renderer.render(scene, camera);
}
animate();

// ------------------------------------------------------------
// Resize
// ------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
});
