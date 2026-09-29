# Minimal interactive X-ray Sky

A zero-build-step Three.js prototype for an interactive hemispheric sky view.

The CSS and JavaScript references in `index.html` include a small version query
to prevent mobile browsers from combining a new HTML file with an older cached
script. Bump this value whenever a deployed update changes the UI/API contract.

## What it already does

- inverse-projects the supplied circular ZEA hemisphere onto the inside of a sphere;
- continuously crossfades among six same-geometry ZEA images with a slider;
- optionally mirrors the source hemisphere across its boundary to fill the sky;
- shows the current Galactic longitude and latitude from the supplied WCS;
- mouse drag;
- touch drag;
- mobile device-orientation control;
- relative phone-motion exploration;
- iOS motion permission button;
- reset/recenter;
- static files only, suitable for GitHub Pages.

## Files

```text
index.html
style.css
main.js
assets/sky_0.2-2.3.png
```

`assets/sky_0.2-2.3.png` is a circular Zenithal Equal Area (ZEA) projection
covering one hemisphere. The other hemisphere is intentionally left black.

The ZEA inverse projection is performed in `main.js`. Its calibration constants
are grouped near the texture setup:

```text
ZEA_DISC_CENTER
ZEA_DISC_RADIUS
ZEA_ROTATION
ZEA_FLIP_X
ZEA_FLIP_Y
```

Use the rotation and flip settings to match the source image's WCS orientation.
The PNG alone does not retain FITS/WCS metadata, so known sky features or the
original FITS header are needed for definitive Galactic-coordinate calibration.

## Sky image slider

The slider order is defined by `SKY_MAPS` near the top of `main.js`:

```js
const SKY_MAPS = [
  { name: "Optical", file: "./assets/optical.png" },
  // ...the four single-band maps...
  { name: "RGB composite", file: "./assets/RGB_0.20.25_0.2_2.3_0.60.7.png" }
];
```

At integer slider positions one map is shown at 100%. Between integers the
fragment shader samples the two adjacent maps and continuously interpolates
their opacity. The UI reports both percentages. Only nearby textures are kept
in the GPU cache to reduce mobile memory use.

All source images must have the same ZEA disc centre, radius, orientation, and dimensions.
The **Mirror Full Sky** control reflects the supplied hemisphere into the
uncovered half; this is a visual mirror, not additional measured sky data.

For reliable mobile loading:

- use short filenames without spaces;
- keep the extension and capitalization identical to the filename in Git;
- export each map as a 2160 x 2160 PNG using the same WCS and crop;
- compress large PNGs before publishing when possible;
- after changing JavaScript, bump the `?v=` value for `main.js` in `index.html`.

## Galactic WCS calibration

The current map is calibrated from its FITS header as Galactic ZEA with:

```text
CRVAL  = (270 deg, 0 deg)
CRPIX  = (1080, 1080)
CDELT  = (-0.0833333 deg, +0.0833333 deg)
```

The initial view therefore points to `l = 270 deg, b = 0 deg`; screen/image
right is decreasing Galactic longitude and image up is increasing Galactic
latitude. The ZEA hemisphere radius is derived from the WCS as 972.34 pixels.
The 1-based FITS reference pixel is also converted to the corresponding PNG
pixel centre, including its half-pixel texture-coordinate offset.

This assumes the PNG was exported using the normal astronomical lower-origin
orientation. PNG files do not retain FITS WCS metadata. If the export pipeline
flipped the raster vertically or horizontally, compare a known source with the
original FITS display and change `ZEA_FLIP_X` or `ZEA_FLIP_Y` accordingly.

## Run locally

Because this uses JavaScript modules, do not open `index.html` directly with `file://`.

From this folder:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Mouse/touch drag works locally.

For phone motion/orientation, deploy to an **HTTPS** site (for example GitHub Pages) and test there.

## GitHub Pages deployment

1. Create a GitHub repository.
2. Upload these files to the repository root.
3. Open:
   `Settings -> Pages`
4. Under **Build and deployment**, choose:
   `Deploy from a branch`
5. Select:
   `main` and `/ (root)`
6. Save.

GitHub will give you an HTTPS URL such as:

```text
https://USERNAME.github.io/xray-sky/
```

Open that URL on your phone.

## iPhone behavior

On iPhone/Safari:

1. open the HTTPS page;
2. tap **Enable Motion**;
3. approve Motion & Orientation access;
4. move the phone.

If permission is denied, drag still works.

Motion mode treats the phone pose at activation as a neutral pose. It controls
the virtual sky relatively and does not claim to match the physical sky.

## Important next step

Before publishing, compare the rendered hemisphere with the original FITS/WCS
data and verify:

- Galactic longitude direction;
- north/south;
- image is not mirrored.
