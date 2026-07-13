# openplace Template Overlay

A template overlay and image-preparation userscript for openplace.

> Important: This userscript runs only on `https://openplace.live/beta*`. It does not run on the main openplace site.

## What it does

- Adds image templates over the openplace beta map.
- Moves, resizes, locks, reorders, hides, and changes template opacity.
- Opens an image editor with palette selection, dithering, preview zoom, resize sampling, and saved presets.
- Supports large source images while using a safe working resolution for browser stability.
- Shows upload progress and clear upload errors.
- Uses the selected map pixel as the placement point when adding an image.
- Provides selected-color display mode for individual templates.
- Includes error comparison, easy paint, coordinate jump/copy, painted-area download, and keyboard panning.

## Install

1. Install a userscript manager for your browser.
2. Open [openplace-Template-Overlay.production.user.js](./openplace-Template-Overlay.production.user.js).
3. Select **Raw** on GitHub.
4. Let your userscript manager install the script.
5. Open `https://openplace.live/beta`.

Only install userscripts from sources you trust.

### Chrome, Brave, Chromium, and Opera

Install [Violentmonkey](https://violentmonkey.github.io/get-it/) or [Tampermonkey](https://www.tampermonkey.net/index.php?browser=chrome&locale=en). Then open the production script's Raw link and confirm the installation.

### Microsoft Edge

Install [Violentmonkey from Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/violentmonkey/eeagobfjdenkkddmbclomhiblgggliao) or [Tampermonkey for Edge](https://www.tampermonkey.net/index.php?browser=edge&locale=en). Then open the production script's Raw link and confirm the installation.

### Firefox

Install [Violentmonkey from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/) or [Tampermonkey for Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/). Then open the production script's Raw link and confirm the installation.

### Safari

Install [Tampermonkey for Safari](https://www.tampermonkey.net/index.php?browser=safari&locale=en) from the App Store, then open the production script's Raw link and confirm the installation.

## Use

1. Open the **Templates** panel from the button in the lower-left corner.
2. Select **Add image**, or drag an image onto the page.
3. If a map pixel is selected first, the template starts with its top-left corner at that pixel.
4. Drag a template to move it. Turn on **Edit mode** to resize it with handles.
5. Expand a template card for its per-template controls.
6. To show one paint color only, select a color in the openplace palette, then choose **Selected color only** in that template's controls.

The image editor can convert an image to the openplace palette before adding it as a new template or replacing an existing template.


## License

MPL-2.0
