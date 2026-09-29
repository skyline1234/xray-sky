import * as THREE from "three";

const app = document.getElementById("app");
const previousImageBtn = document.getElementById("previousImageBtn");
const imageBtn = document.getElementById("imageBtn");
const nextImageBtn = document.getElementById("nextImageBtn");
const imageNameEl = document.getElementById("imageName");
const imageCountEl = document.getElementById("imageCount");
const mirrorBtn = document.getElementById("mirrorBtn");
const exploreBtn = document.getElementById("exploreBtn");
const realSkyBtn = document.getElementById("realSkyBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
const coordinatesEl = document.getElementById("coordinates");

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
//
// Each source image is a Zenithal Equal Area (ZEA) image of one
// hemisphere, rather than an equirectangular image.  The shader below
// converts every direction on the sphere back to a point in the ZEA disc.
// ------------------------------------------------------------
// Add the other four maps here after copying them into assets/. Buttons and
// the counter update automatically. All maps must use the same ZEA geometry.
const SKY_MAPS = [
  { name: "0.2–2.3 keV", file: "./assets/sky_0.2-2.3.png" }
  // { name: "Map 2", file: "./assets/sky-map-2.png" },
  // { name: "Map 3", file: "./assets/sky-map-3.png" },
  // { name: "Map 4", file: "./assets/sky-map-4.png" },
  // { name: "Map 5", file: "./assets/sky-map-5.png" }
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
    skyTexture: { value: texture },
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
    uniform sampler2D skyTexture;
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
      vec4 color = texture2D(skyTexture, uv);

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
// Sky image and hemisphere controls
// ------------------------------------------------------------
let currentSkyIndex = 0;
let textureRequestId = 0;

function updateSkyControls() {
  imageNameEl.textContent = SKY_MAPS[currentSkyIndex].name;
  imageCountEl.textContent = `${currentSkyIndex + 1} / ${SKY_MAPS.length}`;

  const hasMultipleMaps = SKY_MAPS.length > 1;
  previousImageBtn.disabled = !hasMultipleMaps;
  nextImageBtn.disabled = !hasMultipleMaps;
  imageBtn.disabled = !hasMultipleMaps;
}

function selectSky(index) {
  const nextIndex = (index + SKY_MAPS.length) % SKY_MAPS.length;
  if (nextIndex === currentSkyIndex) return;

  const requestId = ++textureRequestId;
  const nextMap = SKY_MAPS[nextIndex];
  statusEl.textContent = `Loading ${nextMap.name}…`;

  textureLoader.load(
    nextMap.file,
    (nextTexture) => {
      if (requestId !== textureRequestId) {
        nextTexture.dispose();
        return;
      }

      configureTexture(nextTexture);
      const previousTexture = material.uniforms.skyTexture.value;
      material.uniforms.skyTexture.value = nextTexture;
      previousTexture.dispose();

      currentSkyIndex = nextIndex;
      updateSkyControls();
      statusEl.textContent = `${nextMap.name} loaded`;
    },
    undefined,
    () => {
      if (requestId === textureRequestId) {
        statusEl.textContent = `Could not load ${nextMap.name}`;
      }
    }
  );
}

previousImageBtn.addEventListener("click", () => selectSky(currentSkyIndex - 1));
nextImageBtn.addEventListener("click", () => selectSky(currentSkyIndex + 1));
imageBtn.addEventListener("click", () => selectSky(currentSkyIndex + 1));

mirrorBtn.addEventListener("click", () => {
  const enabled = !material.uniforms.mirrorFullSky.value;
  material.uniforms.mirrorFullSky.value = enabled;
  mirrorBtn.setAttribute("aria-pressed", String(enabled));
  mirrorBtn.textContent = enabled ? "Half Sky" : "Mirror Full Sky";
  statusEl.textContent = enabled ? "Mirrored full sky" : "Original hemisphere";
});

updateSkyControls();

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
// Device orientation modes
//
// Explore mode treats the initial phone pose as neutral. Real Sky mode uses
// absolute device orientation, observer location, and UTC to align the fixed
// Galactic sphere with the physical sky.
//
// The sensor quaternion uses the same coordinate conversion historically used
// by Three.js DeviceOrientationControls:
// alpha = device rotation around z
// beta  = front/back tilt
// gamma = left/right tilt
// ------------------------------------------------------------
let orientationMode = "manual";
let latestOrientation = null;
let referenceDeviceQ = null;
let observerLocation = null;
let hasAbsoluteOrientation = false;

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
  // iOS exposes its compass heading separately. Other browsers generally put
  // the absolute Earth-referenced heading in alpha.
  const alphaDegrees = Number.isFinite(event.webkitCompassHeading)
    ? 360 - event.webkitCompassHeading
    : event.alpha;
  const alpha = alphaDegrees != null ? THREE.MathUtils.degToRad(alphaDegrees) : 0;
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

  const isAbsolute =
    event.type === "deviceorientationabsolute" ||
    event.absolute === true ||
    Number.isFinite(event.webkitCompassHeading);
  const firstAbsoluteReading = isAbsolute && !hasAbsoluteOrientation;

  if (orientationMode === "absolute" && !isAbsolute) return;

  latestOrientation = event;
  hasAbsoluteOrientation = hasAbsoluteOrientation || isAbsolute;

  if (orientationMode === "relative" && !referenceDeviceQ) {
    referenceDeviceQ = deviceEventToQuaternion(event);
    statusEl.textContent = "Explore motion enabled";
  } else if (orientationMode === "absolute" && firstAbsoluteReading) {
    statusEl.textContent = "Real sky aligned";
  }
}

async function requestOrientationPermission(absolute = false) {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    // Passing true additionally requests magnetometer access where supported.
    return DeviceOrientationEvent.requestPermission(absolute);
  }
  return "granted";
}

function listenForOrientation() {
  window.addEventListener("deviceorientation", onDeviceOrientation, true);
  window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
}

function setModeButtons() {
  exploreBtn.setAttribute("aria-pressed", String(orientationMode === "relative"));
  realSkyBtn.setAttribute("aria-pressed", String(orientationMode === "absolute"));
}

async function enableExploreMode() {
  try {
    const result = await requestOrientationPermission(false);
    if (result !== "granted") {
      statusEl.textContent = "Motion denied — drag instead";
      return;
    }

    orientationMode = "relative";
    referenceDeviceQ = null;
    latestOrientation = null;
    listenForOrientation();
    setModeButtons();

    hintEl.textContent = "Move your phone or drag to fine-tune";
    statusEl.textContent = "Waiting for sensor…";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Motion unavailable — drag instead";
  }
}

function requestObserverLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is unavailable"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 300000
    });
  });
}

async function enableRealSkyMode() {
  statusEl.textContent = "Requesting compass and location…";

  try {
    // Both permission prompts originate from this button gesture.
    const [orientationPermission, position] = await Promise.all([
      requestOrientationPermission(true),
      requestObserverLocation()
    ]);

    if (orientationPermission !== "granted") {
      statusEl.textContent = "Compass denied — use Explore";
      return;
    }

    observerLocation = {
      latitude: THREE.MathUtils.degToRad(position.coords.latitude),
      longitude: THREE.MathUtils.degToRad(position.coords.longitude),
      accuracy: position.coords.accuracy
    };
    orientationMode = "absolute";
    latestOrientation = null;
    hasAbsoluteOrientation = false;
    listenForOrientation();
    setModeButtons();

    hintEl.textContent = "Point your phone at the sky or drag to fine-tune";
    statusEl.textContent = `Waiting for compass · GPS ±${Math.round(position.coords.accuracy)} m`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Real sky unavailable — use Explore";
  }
}

exploreBtn.addEventListener("click", enableExploreMode);
realSkyBtn.addEventListener("click", enableRealSkyMode);
setModeButtons();

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

  if (orientationMode === "relative") {
    statusEl.textContent = "Explore view recentered";
  } else if (orientationMode === "absolute") {
    statusEl.textContent = "Real-sky fine adjustment reset";
  } else {
    statusEl.textContent = "Manual view reset";
  }
});

// ------------------------------------------------------------
// Camera orientation
// ------------------------------------------------------------
const qManual = new THREE.Quaternion();
const qRelativeDevice = new THREE.Quaternion();
const qReferenceInverse = new THREE.Quaternion();
const qHorizonToSky = new THREE.Quaternion();
const horizonToSkyMatrix = new THREE.Matrix4();
let lastAstronomyUpdate = 0;

// IAU J2000 equatorial-to-Galactic rotation matrix.
const EQUATORIAL_TO_GALACTIC = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [ 0.4941094279, -0.4448296300,  0.7469822445],
  [-0.8676661490, -0.1980763734,  0.4559837762]
];

function multiplyMatrix3(a, b) {
  return a.map((row) => b[0].map((_, column) =>
    row.reduce((sum, value, index) => sum + value * b[index][column], 0)
  ));
}

function updateHorizonToSkyQuaternion(now = new Date()) {
  if (!observerLocation) return;

  const julianDate = now.getTime() / 86400000 + 2440587.5;
  const daysSinceJ2000 = julianDate - 2451545.0;
  const gmstDegrees = 280.46061837 + 360.98564736629 * daysSinceJ2000;
  const localSiderealTime =
    THREE.MathUtils.degToRad(((gmstDegrees % 360) + 360) % 360) +
    observerLocation.longitude;

  const sinL = Math.sin(localSiderealTime);
  const cosL = Math.cos(localSiderealTime);
  const sinPhi = Math.sin(observerLocation.latitude);
  const cosPhi = Math.cos(observerLocation.latitude);

  // Sensor-world coordinates map to local ENU as E=+X, N=-Z, U=+Y.
  // Columns below are the equatorial vectors for sensor +X, +Y, +Z.
  const sensorToEquatorial = [
    [-sinL,  cosPhi * cosL,  sinPhi * cosL],
    [ cosL,  cosPhi * sinL,  sinPhi * sinL],
    [ 0,     sinPhi,        -cosPhi]
  ];
  const sensorToGalactic = multiplyMatrix3(
    EQUATORIAL_TO_GALACTIC,
    sensorToEquatorial
  );

  // Galactic Cartesian (gx, gy, gz) maps into the fixed sky sphere as
  // world=(-gx, gz, gy), matching the FITS WCS/readout convention.
  const sensorToSky = [
    sensorToGalactic[0].map((value) => -value),
    sensorToGalactic[2],
    sensorToGalactic[1]
  ];

  horizonToSkyMatrix.set(
    sensorToSky[0][0], sensorToSky[0][1], sensorToSky[0][2], 0,
    sensorToSky[1][0], sensorToSky[1][1], sensorToSky[1][2], 0,
    sensorToSky[2][0], sensorToSky[2][1], sensorToSky[2][2], 0,
    0, 0, 0, 1
  );
  qHorizonToSky.setFromRotationMatrix(horizonToSkyMatrix);
}

function updateCameraQuaternion() {
  // Manual drag offset
  const manualEuler = new THREE.Euler(pitch, yaw, 0, "YXZ");
  qManual.setFromEuler(manualEuler);

  if (orientationMode === "absolute" && latestOrientation && observerLocation) {
    const now = Date.now();
    if (now - lastAstronomyUpdate > 1000) {
      updateHorizonToSkyQuaternion(new Date(now));
      lastAstronomyUpdate = now;
    }

    const deviceQ = deviceEventToQuaternion(latestOrientation);
    camera.quaternion.copy(qHorizonToSky).multiply(deviceQ).multiply(qManual);
  } else if (orientationMode === "relative" && latestOrientation && referenceDeviceQ) {
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
