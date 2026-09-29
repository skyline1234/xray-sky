# Minimal interactive X-ray Sky

A zero-build-step Three.js prototype for an interactive hemispheric sky view.

## What it already does

- inverse-projects the supplied circular ZEA hemisphere onto the inside of a sphere;
- switches among any number of same-geometry ZEA images;
- optionally mirrors the source hemisphere across its boundary to fill the sky;
- mouse drag;
- touch drag;
- mobile device-orientation control;
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

## Add more sky images

Copy each additional PNG into `assets/`, then add it to `SKY_MAPS` near the
top of `main.js`:

```js
const SKY_MAPS = [
  { name: "0.2–2.3 keV", file: "./assets/sky_0.2-2.3.png" },
  { name: "Map 2", file: "./assets/sky-map-2.png" }
];
```

The previous/next controls and image counter derive from this list. All source
images must have the same ZEA disc centre, radius, orientation, and dimensions.
The **Mirror Full Sky** control reflects the supplied hemisphere into the
uncovered half; this is a visual mirror, not additional measured sky data.

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

## Important next step

Before publishing, compare the rendered hemisphere with the original FITS/WCS
data and verify:

- Galactic longitude direction;
- north/south;
- image is not mirrored.
