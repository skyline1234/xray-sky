import * as THREE from "three";

const app = document.getElementById("app");
const skySlider = document.getElementById("skySlider");
const blendReadout = document.getElementById("blendReadout");
const sliderNodes = [...document.querySelectorAll(".slider-node")];
const mirrorBtn = document.getElementById("mirrorBtn");
const exploreBtn = document.getElementById("exploreBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
const coordinatesEl = document.getElementById("coordinates");

// ------------------------------------------------------------
// Scene
// ------------------------------------------------------------
const scene = new THREE.Scene();

// A wider field of view shows more of the celestial sphere at once. Changing
// the sphere radius itself would have no visual effect because the observer is
// exactly at its centre.
const CAMERA_FOV = 85;
const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
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
//
// Each source image is a Zenithal Equal Area (ZEA) image of one
// hemisphere, rather than an equirectangular image.  The shader below
// converts every direction on the sphere back to a point in the ZEA disc.
// ------------------------------------------------------------
// Slider order. All maps use the same 2160 x 2160 Galactic ZEA geometry.
const SKY_MAPS = [
  { name: "Optical", file: "./assets/optical.png" },
  { name: "0.2–0.25 keV · Red", file: "./assets/rate_0.2_0.25_s_red_asinh.png" },
  { name: "0.2–2.3 keV · Green", file: "./assets/rate_0.2_2.3_s_green_asinh.png" },
  { name: "0.5–0.6 keV · Purple", file: "./assets/rate_0.5_0.6_s_purple_asinh.png" },
  { name: "0.6–0.7 keV · Blue", file: "./assets/rate_0.6_0.7_s_blue_asinh.png" },
  { name: "RGB composite", file: "./assets/RGB_0.20.25_0.2_2.3_0.60.7.png" }
];

const textureLoader = new THREE.TextureLoader();

function configureTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

const texture = configureTexture(textureLoader.load(SKY_MAPS[0].file));

// WCS calibration from the supplied FITS header:
//   CTYPE  = GLON-ZEA / GLAT-ZEA
//   CRVAL  = (l, b) = (270 deg, 0 deg)
//   CRPIX  = (1080, 1080)
//   CDELT  = (-1/12 deg, +1/12 deg) per pixel
// A 90-degree ZEA radius is sqrt(2) radians on the projection plane. In FITS
// angular units that is sqrt(2) * 180/pi = 81.028... degrees, or 972.34 px.
// FITS pixels are 1-based; a FITS reference pixel at 1080 maps to the centre
// of zero-based raster pixel 1079, hence the half-pixel texture offset.
const ZEA_DISC_CENTER = new THREE.Vector2(1079.5 / 2160, 1079.5 / 2160);
const ZEA_DISC_RADIUS = 972.341 / 2160;
const ZEA_ROTATION = THREE.MathUtils.degToRad(0);
const ZEA_FLIP_X = false;
const ZEA_FLIP_Y = false;

const geometry = new THREE.SphereGeometry(20, 96, 64);
const material = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    skyTextureA: { value: texture },
    skyTextureB: { value: texture },
    textureBlend: { value: 0 },
    discCenter: { value: ZEA_DISC_CENTER },
    discRadius: { value: ZEA_DISC_RADIUS },
    discRotation: { value: ZEA_ROTATION },
    mirrorFullSky: { value: false },
    discFlip: {
      value: new THREE.Vector2(ZEA_FLIP_X ? -1 : 1, ZEA_FLIP_Y ? -1 : 1)
    }
  },
  vertexShader: `
    varying vec3 vSkyDirection;

    void main() {
      vSkyDirection = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D skyTextureA;
    uniform sampler2D skyTextureB;
    uniform float textureBlend;
    uniform vec2 discCenter;
    uniform float discRadius;
    uniform float discRotation;
    uniform bool mirrorFullSky;
    uniform vec2 discFlip;

    varying vec3 vSkyDirection;

    void main() {
      vec3 direction = normalize(vSkyDirection);

      // The ZEA disc is centred on the initial view direction (0, 0, -1).
      // A hemisphere ends 90 degrees away from that centre.
      float cosTheta = clamp(-direction.z, -1.0, 1.0);
      if (cosTheta < 0.0) {
        if (mirrorFullSky) {
          // Reflect the uncovered hemisphere across the ZEA disc boundary.
          cosTheta = -cosTheta;
        } else {
          discard;
        }
      }

      float sinTheta = length(direction.xy);
      vec2 radialDirection = sinTheta > 0.000001
        ? direction.xy / sinTheta
        : vec2(0.0);

      // Lambert azimuthal equal-area / ZEA radial law, normalized so that
      // theta = 90 degrees maps exactly to the edge of the hemisphere disc.
      float normalizedRadius = sqrt(max(0.0, 1.0 - cosTheta));
      vec2 discPosition = radialDirection * normalizedRadius * discFlip;

      float c = cos(discRotation);
      float s = sin(discRotation);
      discPosition = mat2(c, -s, s, c) * discPosition;

      vec2 uv = discCenter + discRadius * discPosition;
      vec4 colorA = texture2D(skyTextureA, uv);
      vec4 colorB = texture2D(skyTextureB, uv);
      vec4 color = mix(colorA, colorB, textureBlend);

      // The PNG is transparent outside its circular footprint. Alpha-aware
      // compositing also prevents dark margin pixels from forming a rim.
      if (color.a < 0.01) {
        discard;
      }
      gl_FragColor = vec4(color.rgb, 1.0);
    }
  `
});
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

// ------------------------------------------------------------
// Continuous sky-image blending and hemisphere controls
// ------------------------------------------------------------
const textureCache = new Map([[0, texture]]);
const textureLoads = new Map();
let activePair = [0, 0];
let blendRequestId = 0;

function loadSkyTexture(index) {
  if (textureCache.has(index)) {
    return Promise.resolve(textureCache.get(index));
  }
  if (textureLoads.has(index)) return textureLoads.get(index);

  const promise = new Promise((resolve, reject) => {
    textureLoader.load(
      SKY_MAPS[index].file,
      (loadedTexture) => {
        configureTexture(loadedTexture);
        textureCache.set(index, loadedTexture);
        textureLoads.delete(index);
        resolve(loadedTexture);
      },
      undefined,
      (error) => {
        textureLoads.delete(index);
        reject(error);
      }
    );
  });

  textureLoads.set(index, promise);
  return promise;
}

function updateBlendReadout(lowerIndex, upperIndex, fraction) {
  const sliderPosition = lowerIndex + fraction;
  for (const node of sliderNodes) {
    const nodePosition = Number(node.dataset.value);
    node.classList.toggle("is-active", Math.abs(sliderPosition - nodePosition) < 0.001);
  }

  if (lowerIndex === upperIndex || fraction < 0.0005) {
    blendReadout.textContent = `${SKY_MAPS[lowerIndex].name} 100%`;
    return;
  }

  const lowerPercent = Math.round((1 - fraction) * 100);
  const upperPercent = 100 - lowerPercent;
  blendReadout.textContent =
    `${SKY_MAPS[lowerIndex].name} ${lowerPercent}% · ` +
    `${SKY_MAPS[upperIndex].name} ${upperPercent}%`;
}

function trimTextureCache(lowerIndex, upperIndex) {
  const keep = new Set([
    lowerIndex,
    upperIndex,
    Math.max(0, lowerIndex - 1),
    Math.min(SKY_MAPS.length - 1, upperIndex + 1)
  ]);

  for (const [index, cachedTexture] of textureCache) {
    if (!keep.has(index)) {
      cachedTexture.dispose();
      textureCache.delete(index);
    }
  }
}

async function setSkyBlend(rawValue) {
  const value = THREE.MathUtils.clamp(Number(rawValue), 0, SKY_MAPS.length - 1);
  const lowerIndex = Math.floor(value);
  const upperIndex = Math.min(lowerIndex + 1, SKY_MAPS.length - 1);
  const fraction = upperIndex === lowerIndex ? 0 : value - lowerIndex;
  const requestId = ++blendRequestId;

  updateBlendReadout(lowerIndex, upperIndex, fraction);

  if (activePair[0] === lowerIndex && activePair[1] === upperIndex) {
    material.uniforms.textureBlend.value = fraction;
    return;
  }

  statusEl.textContent =
    `Loading ${SKY_MAPS[lowerIndex].name} / ${SKY_MAPS[upperIndex].name}…`;

  try {
    const [textureA, textureB] = await Promise.all([
      loadSkyTexture(lowerIndex),
      loadSkyTexture(upperIndex)
    ]);
    if (requestId !== blendRequestId) return;

    material.uniforms.skyTextureA.value = textureA;
    material.uniforms.skyTextureB.value = textureB;
    material.uniforms.textureBlend.value = fraction;
    activePair = [lowerIndex, upperIndex];
    statusEl.textContent = "Blend ready";

    trimTextureCache(lowerIndex, upperIndex);
    const preloadIndex = Math.min(SKY_MAPS.length - 1, upperIndex + 1);
    loadSkyTexture(preloadIndex).catch(() => {});
  } catch (error) {
    console.error(error);
    if (requestId === blendRequestId) {
      statusEl.textContent = "Could not load one of the sky images";
    }
  }
}

skySlider.max = String(SKY_MAPS.length - 1);
skySlider.addEventListener("input", (event) => setSkyBlend(event.target.value));
for (const node of sliderNodes) {
  node.addEventListener("click", () => {
    skySlider.value = node.dataset.value;
    setSkyBlend(node.dataset.value);
  });
}

// Load the first adjacent map in the background so the first blend is smooth.
loadSkyTexture(1).catch(() => {});

mirrorBtn.addEventListener("click", () => {
  const enabled = !material.uniforms.mirrorFullSky.value;
  material.uniforms.mirrorFullSky.value = enabled;
  mirrorBtn.setAttribute("aria-pressed", String(enabled));
  mirrorBtn.textContent = enabled ? "Half Sky" : "Mirror Full Sky";
  statusEl.textContent = enabled ? "Mirrored full sky" : "Original hemisphere";
});


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
// Gravity-aligned device orientation
//
// The phone's gravity-based tilt and roll are preserved so Galactic latitude
// b=0 stays parallel to the physical horizon. On activation, only the heading
// around the vertical axis is recentered; longitude therefore remains a
// relative reference rather than an absolute compass direction.
//
// The sensor quaternion uses the same coordinate conversion historically used
// by Three.js DeviceOrientationControls:
// alpha = device rotation around z
// beta  = front/back tilt
// gamma = left/right tilt
// ------------------------------------------------------------
let motionEnabled = false;
let latestOrientation = null;
let headingCalibrated = false;

const zee = new THREE.Vector3(0, 0, 1);
const worldUp = new THREE.Vector3(0, 1, 0);
const deviceForward = new THREE.Vector3();
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const qHeadingOffset = new THREE.Quaternion();

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

function calibrateHeading(event) {
  const deviceQ = deviceEventToQuaternion(event);
  deviceForward.set(0, 0, -1).applyQuaternion(deviceQ);

  // Project the viewing direction onto the physical horizon. A phone pointed
  // almost straight up/down has no stable heading, so retain the last heading
  // (or identity on first use) until a horizontal component is available.
  const horizontalLength = Math.hypot(deviceForward.x, deviceForward.z);
  if (horizontalLength < 0.01) {
    if (!headingCalibrated) qHeadingOffset.identity();
    return;
  }

  const heading = Math.atan2(-deviceForward.x, -deviceForward.z);
  qHeadingOffset.setFromAxisAngle(worldUp, -heading);
  headingCalibrated = true;
}

function onDeviceOrientation(event) {
  // Some browsers fire the event but provide null values.
  if (event.alpha == null && event.beta == null && event.gamma == null) return;

  latestOrientation = event;

  if (!headingCalibrated) {
    calibrateHeading(event);
    statusEl.textContent = headingCalibrated
      ? "Motion enabled · horizon aligned"
      : "Tilt phone toward the horizon to align";
  }
}

async function requestOrientationPermission() {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    return DeviceOrientationEvent.requestPermission();
  }
  return "granted";
}

function listenForOrientation() {
  window.addEventListener("deviceorientation", onDeviceOrientation, true);
}

async function enableExploreMode() {
  try {
    const result = await requestOrientationPermission();
    if (result !== "granted") {
      statusEl.textContent = "Motion denied — drag instead";
      return;
    }

    motionEnabled = true;
    headingCalibrated = false;
    qHeadingOffset.identity();
    latestOrientation = null;
    listenForOrientation();
    exploreBtn.setAttribute("aria-pressed", "true");
    exploreBtn.textContent = "Motion Enabled";

    hintEl.textContent = "Galactic plane follows the horizon · drag to fine-tune";
    statusEl.textContent = "Waiting for sensor…";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Motion unavailable — drag instead";
  }
}

exploreBtn.addEventListener("click", enableExploreMode);

// ------------------------------------------------------------
// Reset
// ------------------------------------------------------------
resetBtn.addEventListener("click", () => {
  yaw = 0;
  pitch = 0;

  // Recenter longitude only; keep the gravity-derived horizon alignment.
  if (latestOrientation) calibrateHeading(latestOrientation);

  statusEl.textContent = motionEnabled ? "View recentered" : "Manual view reset";
});

// ------------------------------------------------------------
// Camera orientation
// ------------------------------------------------------------
const qManual = new THREE.Quaternion();

function updateCameraQuaternion() {
  // Manual drag offset
  const manualEuler = new THREE.Euler(pitch, yaw, 0, "YXZ");
  qManual.setFromEuler(manualEuler);

  if (motionEnabled && latestOrientation && headingCalibrated) {
    const currentQ = deviceEventToQuaternion(latestOrientation);

    // Preserve physical tilt/roll, remove only the initial heading, and then
    // apply the user's optional drag adjustment in camera-local coordinates.
    camera.quaternion.copy(qHeadingOffset).multiply(currentQ).multiply(qManual);
  } else {
    camera.quaternion.copy(qManual);
  }
}

// ------------------------------------------------------------
// Galactic-coordinate readout
//
// World direction mapping fixed by the FITS WCS:
//   initial view -Z = (l, b) = (270 deg, 0 deg)
//   image right +X = decreasing Galactic longitude
//   image up    +Y = increasing Galactic latitude
// Therefore Galactic Cartesian (x, y, z) = (-world.x, world.z, world.y).
// ------------------------------------------------------------
const viewDirection = new THREE.Vector3();

function updateGalacticCoordinates() {
  camera.getWorldDirection(viewDirection);

  const galacticX = -viewDirection.x;
  const galacticY = viewDirection.z;
  const galacticZ = THREE.MathUtils.clamp(viewDirection.y, -1, 1);

  let longitude = THREE.MathUtils.radToDeg(Math.atan2(galacticY, galacticX));
  if (longitude < 0) longitude += 360;
  const latitude = THREE.MathUtils.radToDeg(Math.asin(galacticZ));
  const latitudeSign = latitude >= 0 ? "+" : "−";

  coordinatesEl.textContent =
    `l = ${longitude.toFixed(1)}° · b = ${latitudeSign}${Math.abs(latitude).toFixed(1)}°`;
}

// ------------------------------------------------------------
// Render loop
// ------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  updateCameraQuaternion();
  updateGalacticCoordinates();
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
