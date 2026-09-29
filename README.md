# Minimal 360° X-ray Sky

A zero-build-step Three.js prototype for an interactive all-sky view.

## What it already does

- renders a 2:1 equirectangular texture on the inside of a sphere;
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
assets/sky.jpg
```

`assets/sky.jpg` is only a placeholder.

Replace it with your own **2:1 Galactic equirectangular / CAR** image, e.g.

```text
4096 x 2048
```

Do not use a circular ZEA PNG as the sphere texture.

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

Before polishing the UI, replace the placeholder image with a correctly oriented Galactic all-sky texture and verify:

- Galactic longitude direction;
- north/south;
- 0°/360° seam;
- image is not mirrored.
