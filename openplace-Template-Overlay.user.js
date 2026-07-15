// ==UserScript==
// @name         openplace Template Overlay
// @namespace    https://github.com/DaCrazyRaccoon/
// @description  Drag-and-drop image template overlays for openplace, with responsive large-image editing, palette dithering, and grid-aligned resizing.
// @license      MPL-2.0
// @version      1.6.4
// @updateURL    https://raw.githubusercontent.com/DaCrazyRaccoon/openplace-template-tool/main/openplace-Template-Overlay.user.js
// @downloadURL  https://raw.githubusercontent.com/DaCrazyRaccoon/openplace-template-tool/main/openplace-Template-Overlay.user.js
// @homepageURL  https://github.com/DaCrazyRaccoon/openplace-template-tool
// @supportURL   https://github.com/DaCrazyRaccoon/openplace-template-tool/issues
// @match        https://openplace.live/beta*
// @run-at       document-start
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @grant        unsafeWindow
// ==/UserScript==


(() => {
    "use strict";

    const TILE_COUNT = 2048;
    const TILE_SIZE = 1000;
    const ZOOM_LEVEL = 11;
    const N = Math.pow(2, ZOOM_LEVEL);
    const WORLD_PIXELS = TILE_COUNT * TILE_SIZE;

    const MAX_DL_DIM = 4000;
    const MAX_DL_PIXELS = 16_000_000;

    const MAX_WORK_PIXELS = 16_000_000, MAX_WORK_DIM = 8192;
    const SCALE_ALGORITHMS = [["nearest","Nearest-neighbor (crisp)"],["low","Smooth — low quality"],["medium","Smooth — medium quality"],["high","Smooth — high quality"]];

    const LOG = (...a) => console.log("%c[Template]", "color:#3a86ff", ...a);
    const SCRIPT_VERSION = "1.6.4";

    const pageWin = (typeof unsafeWindow !== "undefined" && unsafeWindow) || window;

    const gpxToLng = (gpx) => (gpx / TILE_SIZE) / N * 360 - 180;
    const gpyToLat = (gpy) => {
        const tileYFloat = (gpy / TILE_SIZE);
        return Math.atan(Math.sinh(Math.PI * (1 - 2 * tileYFloat / N))) * 180 / Math.PI;
    };
    const lngToGpx = (lng) => ((lng + 180) / 360 * N) * TILE_SIZE;
    const latToGpy = (lat) => {
        const latRad = lat * Math.PI / 180;
        const tileYFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * N;
        return tileYFloat * TILE_SIZE;
    };

    const gpToTilePixel = (gpx, gpy) => {
        const tx = Math.floor(gpx / TILE_SIZE);
        const ty = Math.floor(gpy / TILE_SIZE);
        const px = Math.floor(gpx - tx * TILE_SIZE) + 1;
        const py = Math.floor(gpy - ty * TILE_SIZE) + 1;
        return { tx, ty, px, py };
    };

    const PAID_PALETTE_INDEX = 32;
    const PALETTE = [
        ["Black",1,[0,0,0]],["Dark Gray",2,[60,60,60]],["Gray",3,[120,120,120]],
        ["Medium Gray",32,[170,170,170]],["Light Gray",4,[210,210,210]],["White",5,[255,255,255]],
        ["Deep Red",6,[96,0,24]],["Dark Red",33,[165,14,30]],["Red",7,[237,28,36]],
        ["Light Red",34,[250,128,114]],["Dark Orange",35,[228,92,26]],["Orange",8,[255,127,39]],
        ["Gold",9,[246,170,9]],["Yellow",10,[249,221,59]],["Light Yellow",11,[255,250,188]],
        ["Dark Goldenrod",37,[156,132,49]],["Goldenrod",38,[197,173,49]],["Light Goldenrod",39,[232,212,95]],
        ["Dark Olive",40,[74,107,58]],["Olive",41,[90,148,74]],["Light Olive",42,[132,197,115]],
        ["Dark Green",12,[14,185,104]],["Green",13,[19,230,123]],["Light Green",14,[135,255,94]],
        ["Dark Teal",15,[12,129,110]],["Teal",16,[16,174,166]],["Light Teal",17,[19,225,190]],
        ["Dark Cyan",43,[15,121,159]],["Cyan",20,[96,247,242]],["Light Cyan",44,[187,250,242]],
        ["Dark Blue",18,[40,80,158]],["Blue",19,[64,147,228]],["Light Blue",45,[125,199,255]],
        ["Dark Indigo",46,[77,49,184]],["Indigo",21,[107,80,246]],["Light Indigo",22,[153,177,251]],
        ["Dark Slate Blue",47,[74,66,132]],["Slate Blue",48,[122,113,196]],["Light Slate Blue",49,[181,174,241]],
        ["Dark Purple",23,[120,12,153]],["Purple",24,[170,56,185]],["Light Purple",25,[224,159,249]],
        ["Dark Pink",26,[203,0,122]],["Pink",27,[236,31,128]],["Light Pink",28,[243,141,169]],
        ["Dark Peach",53,[155,82,73]],["Peach",54,[209,128,120]],["Light Peach",55,[250,182,164]],
        ["Dark Brown",29,[104,70,52]],["Brown",30,[149,104,42]],["Light Brown",50,[219,164,99]],
        ["Dark Tan",56,[123,99,82]],["Tan",57,[156,132,107]],["Light Tan",36,[214,181,148]],
        ["Dark Beige",51,[209,128,81]],["Beige",31,[248,178,119]],["Light Beige",52,[255,197,165]],
        ["Dark Stone",61,[109,100,63]],["Stone",62,[148,140,107]],["Light Stone",63,[205,197,158]],
        ["Dark Slate",58,[51,57,65]],["Slate",59,[109,117,141]],["Light Slate",60,[179,185,209]]
    ].map(([name, index, rgb]) => ({ name, index, rgb }));

    const PALETTE_BY_INDEX = Object.fromEntries(PALETTE.map((c) => [c.index, c]));

    let userExtraColorsBitmap = 0;
    let userFetched = false;

    const isColorUnlocked = (index) => {
        if (index < PAID_PALETTE_INDEX) return true;
        return (userExtraColorsBitmap & (1 << (index - PAID_PALETTE_INDEX))) !== 0;
    };

    const closestInSet = (r, g, b, set) => {
        let best = null, bestD = Infinity;
        for (const c of set) {
            const dr = r - c.rgb[0], dg = g - c.rgb[1], db = b - c.rgb[2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) { bestD = d; best = c; }
        }
        return best;
    };

    const getBackendBase = () => {
        try {
            const u = pageWin.__NUXT__?.config?.public?.backendUrl;
            if (typeof u === "string" && u.length) return u.replace(/\/$/, "");
        } catch (e) {  }
        return location.origin;
    };

    const me = { droplets: null, charges: null, max: null, cooldownMs: null, syncAt: 0 };

    async function fetchUserColors() {
        try {
            const res = await fetch(`${getBackendBase()}/me`, { credentials: "include" });
            if (!res.ok) return;
            const data = await res.json();
            const u = data?.user ?? data;
            const bm = Number(u?.extraColorsBitmap);
            if (Number.isFinite(bm)) userExtraColorsBitmap = bm | 0;
            if (typeof u?.droplets === "number") me.droplets = u.droplets;
            if (u?.charges && typeof u.charges.count === "number") {
                me.charges = u.charges.count;
                me.max = u.charges.max;
                me.cooldownMs = u.charges.cooldownMs;
                me.syncAt = Date.now();
            }
            userFetched = true;
            updateAccountBar();
        } catch (e) {  }
    }

    function estimatedCharges() {
        if (me.charges == null || me.max == null || !me.cooldownMs) return me.charges;
        const gained = (Date.now() - me.syncAt) / me.cooldownMs;
        return Math.min(me.max, me.charges + gained);
    }

    const fmtDuration = (ms) => {
        if (ms <= 0) return "full";
        const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
    };

    let accountBarEl = null;
    function updateAccountBar() {
        if (!accountBarEl) return;
        if (me.charges == null) { accountBarEl.style.display = "none"; return; }
        accountBarEl.style.display = "flex";
        const cur = estimatedCharges();
        const full = (me.max - cur) * me.cooldownMs;
        accountBarEl.innerHTML =
            `<span title="Droplets">💧 ${me.droplets != null ? me.droplets.toLocaleString() : "—"}</span>` +
            `<span title="Charges">⚡ ${Math.floor(cur)}/${me.max}</span>` +
            `<span title="Time to full charges">⏳ ${fmtDuration(full)}</span>`;
    }

    function templateTargetAt(gx, gy) {
        let inBounds = false, target = -1, correct = false;
        for (const t of templates) {
            if (!t.visible) continue;
            const a = t._analysis;
            if (!a || !a.target) continue;
            const wrappedX = unwrapHorizontalNear(gx, a.gx + a.w / 2);
            if (wrappedX < a.gx || gy < a.gy || wrappedX >= a.gx + a.w || gy >= a.gy + a.h) continue;
            inBounds = true;
            const idx = (gy - a.gy) * a.w + (wrappedX - a.gx);
            const tcol = a.target[idx];
            if (tcol >= 0) { target = tcol; correct = !!(a.correct && a.correct[idx]); break; }
        }
        return { inBounds, target, correct };
    }

    function easyPaintKeep(gx, gy, color) {
        const info = templateTargetAt(gx, gy);
        if (!info.inBounds) return true;
        if (info.target < 0) return false;
        if (info.target !== color) return false;
        if (info.correct) return false;
        return true;
    }

    function filterPaintBody(tx, ty, body) {
        const { colors, coords } = body;
        if (!Array.isArray(colors) || !Array.isArray(coords)) return null;
        const nc = [], nco = [];
        let removed = 0;
        for (let i = 0; i < colors.length; i++) {
            const x = coords[2 * i], y = coords[2 * i + 1];
            if (easyPaintKeep(tx * TILE_SIZE + x, ty * TILE_SIZE + y, colors[i])) { nc.push(colors[i]); nco.push(x, y); }
            else removed++;
        }
        if (!removed) return null;
        return { ...body, colors: nc, coords: nco };
    }

    let analysisRefreshTimer = null;
    function scheduleAnalysisRefresh() {
        clearTimeout(analysisRefreshTimer);
        analysisRefreshTimer = setTimeout(() => { try { autoAnalyzeTick(); } catch (e) {} }, 1500);
    }

    function setupPaintFilter() {
        if (pageWin.__rtplPaintHook) return;
        const orig = pageWin.fetch;
        if (typeof orig !== "function") return;
        pageWin.fetch = function (input, init) {
            let isPaint = false;
            try {
                const url = typeof input === "string" ? input : (input && input.url) || "";
                const m = url.match(/\/s0\/pixel\/(\d+)\/(\d+)(?:[/?#]|$)/);
                if (m && init && /post/i.test(init.method || "")) {
                    isPaint = true;
                    if (typeof init.body === "string") {
                        const paintBody = JSON.parse(init.body);
                        if (Array.isArray(paintBody.colors) && paintBody.colors.length) setSelectedPaintColor(paintBody.colors[0]);
                        if (gEasyPaint) {
                            const filtered = filterPaintBody(parseInt(m[1]), parseInt(m[2]), paintBody);
                        if (filtered) {
                            if (filtered.colors.length === 0) {

                                LOG("easy paint: nothing to paint here, request skipped");
                                scheduleAnalysisRefresh();
                                const R = pageWin.Response || Response;
                                return Promise.resolve(new R(JSON.stringify({ painted: 0 }), {
                                    status: 200, headers: { "Content-Type": "application/json" }
                                }));
                            }
                            LOG(`easy paint: painting ${filtered.colors.length} matching pixel(s)`);
                            init = Object.assign({}, init, { body: JSON.stringify(filtered) });
                        }
                        }
                    }
                }
            } catch (e) {  }
            const res = orig.apply(this, [input, init]);
            if (isPaint) { try { res.then(() => scheduleAnalysisRefresh(), () => {}); } catch (e) {  } }
            return res;
        };
        pageWin.__rtplPaintHook = true;
        LOG("paint filter installed");
    }

    const STORE_KEY = "rtpl_templates_v1";
    const SETTINGS_KEY = "rtpl_settings_v1";
    const PRESETS_KEY = "rtpl_presets_v1";
    const hasGM = typeof GM !== "undefined" && GM.getValue && GM.setValue;

    async function rawGet(key) {
        try {
            if (hasGM) return await GM.getValue(key, null);
            return localStorage.getItem(key);
        } catch (e) { return null; }
    }
    async function rawSet(key, value) {
        try {
            if (hasGM) await GM.setValue(key, value);
            else localStorage.setItem(key, value);
        } catch (e) { LOG("save failed (storage may be full)", e); }
    }

    async function storeGet(def) {
        try {
            const v = await rawGet(STORE_KEY);
            return v ? JSON.parse(v) : def;
        } catch (e) { LOG("load failed", e); return def; }
    }
    let saveTimer = null;
    function storeSet() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => rawSet(STORE_KEY, JSON.stringify(templates.map(serialize))), 400);
    }

    const settingsSnapshot = () => ({ editMode, errorMode, gOutlineMode, gShrink, gEasyPaint, gHideCompleted, dlOutline, gPanStep, gColorSort, gMapScaleAlgorithm, gEditorScaleAlgorithm, gSelectedColorMode, selectedPaintColor, panelPosition, fabPosition, panelOpen, performanceMode, walkthroughSeen, lastSeenVersion });
    function saveSettings() {
        rawSet(SETTINGS_KEY, JSON.stringify(settingsSnapshot()));
    }
    async function loadSettings() {
        try {
            const v = await rawGet(SETTINGS_KEY);
            if (!v) return;
            const s = JSON.parse(v);
            if (typeof s.editMode === "boolean") editMode = s.editMode;
            if (typeof s.errorMode === "boolean") errorMode = s.errorMode;
            if (OUTLINE_MODES.includes(s.gOutlineMode)) gOutlineMode = s.gOutlineMode;
            if (typeof s.gShrink === "boolean") gShrink = s.gShrink;

            if (typeof s.gEasyPaint === "boolean") gEasyPaint = s.gEasyPaint;
            else if (typeof s.gSkipCorrect === "boolean") gEasyPaint = s.gSkipCorrect;
            if (typeof s.gHideCompleted === "boolean") gHideCompleted = s.gHideCompleted;
            if (typeof s.dlOutline === "boolean") dlOutline = s.dlOutline;
            if (typeof s.gPanStep === "number" && s.gPanStep > 0) gPanStep = s.gPanStep;
            if (["count", "countAsc", "missing", "missingAsc", "id", "name"].includes(s.gColorSort)) gColorSort = s.gColorSort;
            if (SCALE_ALGORITHMS.some(([v]) => v === s.gMapScaleAlgorithm)) gMapScaleAlgorithm = s.gMapScaleAlgorithm;
            if (SCALE_ALGORITHMS.some(([v]) => v === s.gEditorScaleAlgorithm)) gEditorScaleAlgorithm = s.gEditorScaleAlgorithm;
            if (typeof s.gSelectedColorMode === "boolean") gSelectedColorMode = s.gSelectedColorMode;
            if (PALETTE_BY_INDEX[s.selectedPaintColor]) selectedPaintColor = s.selectedPaintColor;
            if (Number.isFinite(s.panelPosition?.left) && Number.isFinite(s.panelPosition?.top)) panelPosition = { left: s.panelPosition.left, top: s.panelPosition.top };
            if (Number.isFinite(s.fabPosition?.left) && Number.isFinite(s.fabPosition?.top)) fabPosition = { left: s.fabPosition.left, top: s.fabPosition.top };
            if (typeof s.panelOpen === "boolean") panelOpen = s.panelOpen;
            if (typeof s.performanceMode === "boolean") performanceMode = s.performanceMode;
            if (typeof s.walkthroughSeen === "boolean") walkthroughSeen = s.walkthroughSeen;
            if (typeof s.lastSeenVersion === "string") lastSeenVersion = s.lastSeenVersion;
        } catch (e) {  }
    }

    async function loadUserPresets() {
        try {
            const v = await rawGet(PRESETS_KEY);
            const arr = v ? JSON.parse(v) : [];
            if (Array.isArray(arr)) {
                return arr.filter((p) => p && typeof p.name === "string" && Array.isArray(p.colors))
                    .map((p) => ({ name: p.name, colors: p.colors.filter((n) => Number.isInteger(n)) }));
            }
        } catch (e) {  }
        return [];
    }
    function saveUserPresets() { rawSet(PRESETS_KEY, JSON.stringify(userPresets)); }

    const serialize = (t) => ({
        id: t.id, name: t.name, dataUrl: t.dataUrl,
        naturalW: t.naturalW, naturalH: t.naturalH,
        gx: t.gx, gy: t.gy, w: t.w, h: t.h,
        opacity: t.opacity, visible: t.visible, locked: t.locked,
        aspectLock: t.aspectLock, disabled: t.disabled, collapsed: t.collapsed,
        colorUsage: t._usageFor === colorUsageSignature(t) ? t._usage : null,
        colorUsageFor: t._usageFor
    });

    const BACKUP_FORMAT = "openplace-template-overlay-backup";
    function downloadBackup() {
        const backup = { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), templates: templates.map(serialize), settings: settingsSnapshot(), presets: userPresets };
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `openplace-template-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("Backup exported.", "success");
    }

    async function importBackup(file) {
        showToast("Reading backup…", "progress", 0);
        const backup = JSON.parse(await file.text());
        if (!backup || backup.format !== BACKUP_FORMAT || !Array.isArray(backup.templates) || !Array.isArray(backup.presets)) throw new Error("This is not a valid openplace Template Overlay backup.");
        const templatesBackup = backup.templates.filter((t) => t && typeof t.dataUrl === "string" && /^data:image\//.test(t.dataUrl) && Number.isFinite(t.w) && Number.isFinite(t.h) && t.w > 0 && t.h > 0);
        if (!confirm(`Restore ${templatesBackup.length} template${templatesBackup.length === 1 ? "" : "s"}? This replaces your current templates, presets, and settings.`)) { showToast("Backup import cancelled.", "info"); return; }
        clearTimeout(saveTimer);
        await rawSet(STORE_KEY, JSON.stringify(templatesBackup));
        await rawSet(PRESETS_KEY, JSON.stringify(backup.presets));
        await rawSet(SETTINGS_KEY, JSON.stringify(backup.settings && typeof backup.settings === "object" ? backup.settings : {}));
        showToast("Backup restored. Reloading…", "success", 1200);
        setTimeout(() => location.reload(), 300);
    }

    let map = null;

    let templates = [];
    let selectedId = null;
    let nextId = 1;

    let editMode = true;
    let errorMode = false;
    let gOutlineMode = "off";
    const OUTLINE_MODES = ["off", "all", "outer"];
    const OUTLINE_LABELS = { off: "Off", all: "All edges", outer: "Outer edge" };
    let gShrink = true;
    const SHRINK = 3;
    const DOT_FULL_PIXEL_LIMIT = 4_000_000;
    const MIN_TEMPLATE_ZOOM = 9;
    const DOT_ZOOM = 13;
    let gEasyPaint = false;
    let gHideCompleted = false;
    let gPanStep = 150;
    let gColorSort = "count";

    let gMapScaleAlgorithm = "high", gEditorScaleAlgorithm = "high";
    let gSelectedColorMode = false;
    let panelPosition = null, fabPosition = null, panelOpen = false;
    let performanceMode = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    let walkthroughSeen = false, lastSeenVersion = "";

    let lastPixel = null;
    let selectedPaintColor = null;

    function updateSelectedColorTemplates() {
        for (const t of templates) {
            if (!gSelectedColorMode || !t.locked) continue;
            t._gridCanvas = null; t._gridSig = null;
        t._mapPreview = null; t._mapPreviewSig = null; t._mapPreviewPromise = null; t._mapPreviewPromiseSig = null; t._dotGrid = null; t._dotGridSig = null;
            queueTemplateRender(t);
        }
    }

    function setSelectedPaintColor(index) {
        if (!PALETTE_BY_INDEX[index] || selectedPaintColor === index) return;
        selectedPaintColor = index;
        saveSettings();
        updateSelectedColorTemplates();
    }

    function paletteColorFromElement(el) {
        const card = el.closest?.(".palette-card");
        for (let node = el; node && node !== document.body; node = node.parentElement) {
            for (const attr of ["data-color", "data-color-index", "data-palette-index", "value", "aria-label", "title"]) {
                const value = node.getAttribute?.(attr);
                if (!value) continue;
                const numeric = Number(value);
                if (PALETTE_BY_INDEX[numeric]) return numeric;
                const found = PALETTE.find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
                if (found) return found.index;
            }
            if (!card || node === card || !/background(?:-color)?\s*:/.test(node.getAttribute?.("style") || "")) continue;
            const match = getComputedStyle(node).backgroundColor.match(/\d+/g);
            if (match?.length >= 3 && (match.length < 4 || Number(match[3]) > 0)) {
                const color = closestInSet(Number(match[0]), Number(match[1]), Number(match[2]), PALETTE);
                if (color) return color.index;
            }
        }
        return null;
    }

    function attachPaletteSelectionTracking() {
        document.addEventListener("click", (e) => {
            const el = e.target instanceof Element ? e.target : null;
            if (!el?.closest(".palette-card")) return;
            const color = paletteColorFromElement(el);
            if (color != null) setSelectedPaintColor(color);
        }, true);
    }

    const getTpl = (id) => templates.find((t) => t.id === id) || null;
    const selected = () => getTpl(selectedId);

    const renderSig = (t) => {
        const selected = gSelectedColorMode && t.locked ? selectedPaintColor ?? "none" : "all";
        return `${gMapScaleAlgorithm}|${gOutlineMode}|${selected}|${(t.disabled || []).join(",")}`;
    };

    function ensureImg(t) {
        if (t._imgEl) return Promise.resolve(t._imgEl);
        if (!t._imgPromise) t._imgPromise = loadImage(t.dataUrl).then((im) => { t._imgEl = im; return im; });
        return t._imgPromise;
    }

    async function buildSourceImage(t) {
        const img = await ensureImg(t);
        const disabled = t.disabled || [];

        const contentSig = renderSig(t);
        if (t._procCanvas && t._procSig === contentSig) return t._procCanvas;

        const pc = document.createElement("canvas");
        pc.width = t.naturalW; pc.height = t.naturalH;
        const pctx = pc.getContext("2d", { willReadFrequently: true });
        pctx.imageSmoothingEnabled = false;
        pctx.drawImage(img, 0, 0);
        const data = pctx.getImageData(0, 0, pc.width, pc.height);
        const d = data.data;
        const ds = new Set(disabled);
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] <= 128) { d[i + 3] = 0; continue; }
            const c = closestInSet(d[i], d[i + 1], d[i + 2], PALETTE);
            if (!c || ds.has(c.index)) { d[i + 3] = 0; continue; }
            d[i] = c.rgb[0]; d[i + 1] = c.rgb[1]; d[i + 2] = c.rgb[2]; d[i + 3] = 255;
        }
        if (gOutlineMode !== "off") applyOutline(d, pc.width, pc.height, gOutlineMode);
        pctx.putImageData(data, 0, 0);
        t._procCanvas = pc; t._procSig = contentSig;
        return pc;
    }

    function applyOutline(d, w, h, mode) {
        const snap = new Uint8ClampedArray(d);
        const op = (i) => snap[i + 3] > 128;
        const W = w * 4;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                if (!op(i)) continue;
                let edge = false;
                const l = x > 0, r = x < w - 1, u = y > 0, dn = y < h - 1;

                const nb = [
                    l ? i - 4 : -1,
                    r ? i + 4 : -1,
                    u ? i - W : -1,
                    dn ? i + W : -1,
                    (l && u) ? i - W - 4 : -1,
                    (r && u) ? i - W + 4 : -1,
                    (l && dn) ? i + W - 4 : -1,
                    (r && dn) ? i + W + 4 : -1
                ];
                for (const j of nb) {
                    if (j < 0) { edge = true; break; }
                    if (!op(j)) { edge = true; break; }
                    if (mode === "all" &&
                        (snap[j] !== snap[i] || snap[j + 1] !== snap[i + 1] || snap[j + 2] !== snap[i + 2])) {
                        edge = true; break;
                    }
                }
                if (!edge) d[i + 3] = 0;
            }
        }
    }

    const ERR_GREEN = [0, 200, 0];
    const ERR_YELLOW = [255, 224, 0];
    const ERR_RED = [255, 40, 40];

    async function analyzeTemplate(t) {
        const img = await ensureImg(t);

        const tcv = document.createElement("canvas");
        tcv.width = t.w; tcv.height = t.h;
        const tctx = tcv.getContext("2d", { willReadFrequently: true });
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(img, 0, 0, t.naturalW, t.naturalH, 0, 0, t.w, t.h);
        const td = scaledImageData(img, t.naturalW, t.naturalH, t.w, t.h, gMapScaleAlgorithm);

        const set = PALETTE;
        const ds = new Set(t.disabled || []);
        const n = t.w * t.h;
        const target = new Int16Array(n).fill(-1);
        for (let p = 0; p < n; p++) {
            const i = p * 4;
            if (td[i + 3] <= 128) continue;
            const c = closestInSet(td[i], td[i + 1], td[i + 2], set);
            if (!c || ds.has(c.index)) continue;
            target[p] = c.index;
        }

        const { ctx } = await compositeRegion(t.gx, t.gy, t.w, t.h);
        const pd = ctx.getImageData(0, 0, t.w, t.h).data;

        const err = document.createElement("canvas");
        err.width = t.w; err.height = t.h;
        const ectx = err.getContext("2d");
        const eImg = ectx.createImageData(t.w, t.h);
        const ed = eImg.data;

        const perColor = new Map();
        const correctMask = new Uint8Array(n);
        let correct = 0, missing = 0, wrong = 0;

        for (let p = 0; p < n; p++) {
            const ti = target[p];
            if (ti < 0) continue;
            let pc = perColor.get(ti);
            if (!pc) { pc = { total: 0, correct: 0 }; perColor.set(ti, pc); }
            pc.total++;

            const i = p * 4;
            let col;
            if (pd[i + 3] <= 128) {
                missing++; col = ERR_YELLOW;
            } else {
                const painted = closestInSet(pd[i], pd[i + 1], pd[i + 2], PALETTE);
                if (painted && painted.index === ti) { correct++; pc.correct++; correctMask[p] = 1; col = ERR_GREEN; }
                else { wrong++; col = ERR_RED; }
            }
            ed[i] = col[0]; ed[i + 1] = col[1]; ed[i + 2] = col[2]; ed[i + 3] = 255;
        }
        ectx.putImageData(eImg, 0, 0);

        const total = correct + missing + wrong;
        t._analysis = {
            perColor, totals: { correct, missing, wrong, total }, errorCanvas: err, when: Date.now(),

            target, correct: correctMask, gx: t.gx, gy: t.gy, w: t.w, h: t.h
        };
        return t._analysis;
    }

    const colorUsageSignature = (t) => gMapScaleAlgorithm + "|" + t.w + "x" + t.h;

    async function computeColorUsage(t) {
        const sig = colorUsageSignature(t);
        if (t._usage && t._usageFor === sig) return t._usage;
        if (t._usageTask?.sig === sig) return t._usageTask.promise;
        const task = (async () => {
            const img = await ensureImg(t);
            const d = scaledImageData(img, t.naturalW, t.naturalH, t.w, t.h, gMapScaleAlgorithm);
            const counts = new Map();
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] <= 128) continue;
                const c = closestInSet(d[i], d[i + 1], d[i + 2], PALETTE);
                if (c) counts.set(c.index, (counts.get(c.index) || 0) + 1);
            }
            const usage = [...counts.entries()]
                .map(([index, count]) => ({ index, count, name: PALETTE_BY_INDEX[index].name, rgb: PALETTE_BY_INDEX[index].rgb }))
                .sort((a, b) => b.count - a.count);
            t._usage = usage;
            t._usageFor = sig;
            storeSet();
            return usage;
        })();
        const entry = t._usageTask = { sig, promise: task };
        try {
            return await task;
        } finally {
            if (t._usageTask === entry) t._usageTask = null;
        }
    }

    const queuedColorUsage = new Set();
    let colorUsageRunning = false;

    function queueColorUsage(t) {
        if (!t) return;
        queuedColorUsage.add(t);
        if (colorUsageRunning) return;
        colorUsageRunning = true;
        requestAnimationFrame(async () => {
            const template = queuedColorUsage.values().next().value;
            queuedColorUsage.delete(template);
            try {
                await computeColorUsage(template);
            } catch (e) {
                LOG("color count failed", e);
            } finally {
                colorUsageRunning = false;
                if (queuedColorUsage.size) queueColorUsage(queuedColorUsage.values().next().value);
            }
        });
    }

    const loadImage = (url, label = "image") => new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => img.naturalWidth && img.naturalHeight ? res(img) : rej(new Error(`${label} decoded without usable dimensions.`));
        img.onerror = () => rej(new Error(`${label} could not be decoded. It may be corrupt, unsupported, or too large for this browser.`));
        img.src = url;
    });
    function applyScaleAlgorithm(ctx, algorithm) {
        const mode = SCALE_ALGORITHMS.some(([v]) => v === algorithm) ? algorithm : "high";
        ctx.imageSmoothingEnabled = mode !== "nearest"; ctx.imageSmoothingQuality = mode === "nearest" ? "low" : mode;
    }
    function safeWorkingSize(w, h) {
        const scale = Math.min(1, MAX_WORK_DIM / w, MAX_WORK_DIM / h, Math.sqrt(MAX_WORK_PIXELS / (w * h)));
        return { w: Math.max(1, Math.floor(w * scale)), h: Math.max(1, Math.floor(h * scale)), scaled: scale < .999999 };
    }
    function scaledImageData(src, sw, sh, dw, dh, algorithm) {
        if (algorithm === "high" && (dw < sw || dh < sh)) return downscaleData(src, sw, sh, dw, dh, algorithm);
        const cv = document.createElement("canvas"); cv.width = dw; cv.height = dh;
        const ctx = cv.getContext("2d", { willReadFrequently: true }); applyScaleAlgorithm(ctx, algorithm);
        ctx.drawImage(src, 0, 0, sw, sh, 0, 0, dw, dh); return ctx.getImageData(0, 0, dw, dh).data;
    }

    const tileBounds = (tx, ty) => {
        const left = gpxToLng(tx * TILE_SIZE), right = gpxToLng((tx + 1) * TILE_SIZE);
        const top = gpyToLat(ty * TILE_SIZE), bottom = gpyToLat((ty + 1) * TILE_SIZE);
        return [[left, top], [right, top], [right, bottom], [left, bottom]];
    };

    function rasterCoordinates(x0, x1, y0, y1) {
        const left = wrapHorizontal(x0), right = left + x1 - x0;
        const top = gpyToLat(y0), bottom = gpyToLat(y1);
        return [[gpxToLng(left), top], [gpxToLng(right), top], [gpxToLng(right), bottom], [gpxToLng(left), bottom]];
    }

    function refreshCanvasSource(id) {
        const s = map.getSource(id);
        if (s && typeof s.play === "function") {
            s.play();
            map.triggerRepaint();
            setTimeout(() => { if (typeof s.pause === "function") s.pause(); }, 0);
        }
    }

    const setTemplateOpacity = (t) => {
        if (!map) return;
        const op = t.visible ? t.opacity : 0;
        if (t._tiles) for (const e of t._tiles.values()) {
            if (map.getLayer(e.layerId)) map.setPaintProperty(e.layerId, "raster-opacity", op);
        }
        if (t._dotTiles) for (const e of t._dotTiles.values()) {
            if (map.getLayer(e.layerId)) map.setPaintProperty(e.layerId, "raster-opacity", op);
        }
    };

    function removeFilledTiles(t) {
        if (!t._tiles) return;
        for (const e of t._tiles.values()) {
            if (map.getLayer(e.layerId)) map.removeLayer(e.layerId);
            if (map.getSource(e.sourceId)) map.removeSource(e.sourceId);
        }
        t._tiles.clear();
    }
    function removeDotLayer(t) {
        if (!t._dotTiles) return;
        for (const e of t._dotTiles.values()) {
            if (map.getLayer(e.layerId)) map.removeLayer(e.layerId);
            if (map.getSource(e.sourceId)) map.removeSource(e.sourceId);
        }
        t._dotTiles.clear();
    }

    const DOT_SCALE = SHRINK % 2 ? SHRINK : SHRINK + 1;

    const dotFits = (t) => t.w * t.h <= DOT_FULL_PIXEL_LIMIT;
    const largeDotTemplate = (t) => !dotFits(t);

    function wrappedPixelDistance(value) {
        return Math.abs((((value + WORLD_PIXELS / 2) % WORLD_PIXELS) + WORLD_PIXELS) % WORLD_PIXELS - WORLD_PIXELS / 2);
    }

    function visibleLargeDotTile(tx, ty) {
        const canvas = map?.getCanvas?.();
        if (!canvas) return true;
        const scale = screenPerGlobalPx();
        const center = map.getCenter();
        const centerX = lngToGpx(center.lng), centerY = latToGpy(center.lat);
        const halfW = canvas.clientWidth / (2 * scale) + TILE_SIZE;
        const halfH = canvas.clientHeight / (2 * scale) + TILE_SIZE;
        return wrappedPixelDistance(tx * TILE_SIZE + TILE_SIZE / 2 - centerX) <= halfW
            && Math.abs(ty * TILE_SIZE + TILE_SIZE / 2 - centerY) <= halfH;
    }

    const templateBeforeId = () => map.getLayer("openplace-hover-border") ? "openplace-hover-border" : undefined;

    function templateMode(t) {
        if (!map) return "hidden";
        const z = map.getZoom();
        if (z < MIN_TEMPLATE_ZOOM) return "hidden";

        const a = t._analysis;
        if (errorMode && t.visible && a && a.errorCanvas
            && a.w === t.w && a.h === t.h && a.gx === t.gx && a.gy === t.gy) return "err";
        if (t.locked && gShrink && z >= DOT_ZOOM) return "dots";
        return "filled";
    }

    async function updateTemplateTiles(t, version = t._renderVersion || 0) {
        if (!map) return;
        if (!t._tiles) t._tiles = new Map();
        const op = t.visible ? t.opacity : 0;
        const mode = t._mode = templateMode(t);

        if (mode === "hidden") { removeFilledTiles(t); removeDotLayer(t); return; }
        if (mode === "dots") { removeFilledTiles(t); await renderDotLayer(t, op, version); }
        else { removeDotLayer(t); await renderFilledTiles(t, op, mode === "err", version); }
        if (version !== (t._renderVersion || 0)) return;
        restackTemplates();
    }

    function updateTemplateMoveCoordinates(t) {
        if (!map) return;
        const updateTiles = (tiles) => {
            if (!tiles) return;
            for (const [key, e] of tiles) {
                const [tx, ty] = key.split("-").map(Number);
                const tileLeft = tx * TILE_SIZE, tileTop = ty * TILE_SIZE;
                const ix0 = Math.max(t.gx, tileLeft), iy0 = Math.max(t.gy, tileTop);
                const ix1 = Math.min(t.gx + t.w, tileLeft + TILE_SIZE), iy1 = Math.min(t.gy + t.h, tileTop + TILE_SIZE);
                const offX = ix0 - t.gx, offY = iy0 - t.gy, ow = ix1 - ix0, oh = iy1 - iy0;
                if (ow <= 0 || oh <= 0 || e.offX !== offX || e.offY !== offY || e.ow !== ow || e.oh !== oh) continue;
                try {
                    map.getSource(e.sourceId)?.setCoordinates(rasterCoordinates(ix0, ix1, iy0, iy1));
                } catch (_) {}
            }
        };
        updateTiles(t._tiles);
        updateTiles(t._dotTiles);
        map.triggerRepaint();
    }

    function queueTemplateRender(t) {
        t._renderVersion = (t._renderVersion || 0) + 1;
        t._renderAgain = true;
        if (t._renderQueued) return;
        t._renderQueued = true;
        requestAnimationFrame(async () => {
            try {
                while (t._renderAgain) {
                    t._renderAgain = false;
                    await updateTemplateTiles(t, t._renderVersion);
                }
            } catch (e) { LOG("template render failed", e); }
            finally { t._renderQueued = false; if (t._renderAgain) queueTemplateRender(t); }
        });
    }

    function restackTemplates() {
        if (!map) return;
        const before = map.getLayer("openplace-hover-border") ? "openplace-hover-border" : undefined;

        for (let i = templates.length - 1; i >= 0; i--) {
            const t = templates[i];
            const ids = [];
            if (t._tiles) for (const e of t._tiles.values()) ids.push(e.layerId);
            if (t._dotTiles) for (const e of t._dotTiles.values()) ids.push(e.layerId);
            for (const id of ids) if (map.getLayer(id)) { try { map.moveLayer(id, before); } catch (e) {  } }
        }
    }

    function refreshTemplateModes() {
        if (!map) return;
        for (const t of templates) {
            const m = templateMode(t);
            if (m !== t._mode || m === "filled" || m === "err") updateTemplateTiles(t);
        }
    }

    const isPOT = (n) => n >= 1 && (n & (n - 1)) === 0;

    function screenPerGlobalPx() {
        try {
            const a = map.project([gpxToLng(0), gpyToLat(0)]);
            const b = map.project([gpxToLng(1), gpyToLat(0)]);
            const d = Math.abs(b.x - a.x);
            return d > 0 ? d : 1;
        } catch (e) { return 1; }
    }

    async function renderGridCanvas(t, onlyColor = null, includeOutline = true) {
        const img = await ensureImg(t);
        const g = document.createElement("canvas");
        g.width = t.w; g.height = t.h;
        const gctx = g.getContext("2d", { willReadFrequently: true });
        const d = scaledImageData(img, t.naturalW, t.naturalH, t.w, t.h, gMapScaleAlgorithm);
        const ds = new Set(t.disabled || []);
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] <= 128) { d[i + 3] = 0; continue; }
            const c = closestInSet(d[i], d[i + 1], d[i + 2], PALETTE);
            if (!c || ds.has(c.index) || (onlyColor != null && c.index !== onlyColor)) { d[i + 3] = 0; continue; }
            d[i] = c.rgb[0]; d[i + 1] = c.rgb[1]; d[i + 2] = c.rgb[2]; d[i + 3] = 255;
        }
        if (includeOutline && gOutlineMode !== "off") applyOutline(d, t.w, t.h, gOutlineMode);
        gctx.putImageData(new ImageData(d, t.w, t.h), 0, 0);
        return g;
    }

    async function buildGridCanvas(t) {
        const sig = `${renderSig(t)}|${t.w}x${t.h}`;
        if (t._gridCanvas && t._gridSig === sig) return t._gridCanvas;
        const onlyColor = gSelectedColorMode && t.locked ? selectedPaintColor : null;
        const grid = await renderGridCanvas(t, onlyColor);
        t._gridCanvas = grid;
        t._gridSig = sig;
        return grid;
    }

    const mapPreviewSignature = (t) => `${gMapScaleAlgorithm}|${t.naturalW}x${t.naturalH}|${t.w}x${t.h}|${(t.disabled || []).join(",")}`;

    async function createSharePreview(t) {
        const sig = mapPreviewSignature(t);
        if (t._mapPreview && t._mapPreviewSig === sig) return t._mapPreview;
        if (t._mapPreviewPromise && t._mapPreviewPromiseSig === sig) return t._mapPreviewPromise;
        const task = (async () => {
            const grid = await renderGridCanvas(t, null, false);
            const scale = Math.min(1, 512 / Math.max(grid.width, grid.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(grid.width * scale));
            canvas.height = Math.max(1, Math.round(grid.height * scale));
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(grid, 0, 0, canvas.width, canvas.height);
            const preview = canvas.toDataURL("image/png");
            if (mapPreviewSignature(t) === sig) { t._mapPreview = preview; t._mapPreviewSig = sig; }
            return preview;
        })();
        t._mapPreviewPromise = task;
        t._mapPreviewPromiseSig = sig;
        try { return await task; }
        finally { if (t._mapPreviewPromise === task) { t._mapPreviewPromise = null; t._mapPreviewPromiseSig = null; } }
    }
    async function sharedPreviewData(shared) {
        if (typeof shared.r === "string" && /^data:image\/png;base64,/i.test(shared.r)) return shared.r;
        const img = await loadImage(shared.d, "shared template preview");
        const safe = safeWorkingSize(Number(shared.w) || img.naturalWidth, Number(shared.h) || img.naturalHeight);
        return createSharePreview({ dataUrl: shared.d, naturalW: img.naturalWidth, naturalH: img.naturalHeight, w: safe.w, h: safe.h, disabled: Array.isArray(shared.x) ? shared.x : [], _imgEl: img });
    }
    let overlayPreviewQueue = [], overlayPreviewBusy = false;
    const deferOverlayPreview = (fn) => {
        if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 300 });
        else setTimeout(fn, 40);
    };

    function queueOverlayPreview(t, image) {
        if (!image) return;
        const sig = mapPreviewSignature(t);
        if (t._mapPreview && t._mapPreviewSig === sig) { image.src = t._mapPreview; return; }
        if (!t._previewTargets) t._previewTargets = new Set();
        t._previewTargets.add(image);
        if (t._previewQueued) return;
        t._previewQueued = true;
        overlayPreviewQueue.push(t);
        if (overlayPreviewBusy) return;
        overlayPreviewBusy = true;
        const next = async () => {
            const template = overlayPreviewQueue.shift();
            if (!template) { overlayPreviewBusy = false; return; }
            try {
                const preview = await createSharePreview(template);
                for (const target of template._previewTargets || []) if (target.isConnected) target.src = preview;
            } catch (e) { LOG("overlay preview failed", e); }
            finally {
                template._previewQueued = false;
                template._previewTargets?.clear();
                if (overlayPreviewQueue.length) deferOverlayPreview(next);
                else overlayPreviewBusy = false;
            }
        };
        deferOverlayPreview(next);
    }
    function downscaleData(img, sw, sh, dw, dh, algorithm = "high") {
        let cw = sw, ch = sh;
        let canvas = document.createElement("canvas");
        canvas.width = cw; canvas.height = ch;
        let ctx = canvas.getContext("2d", { willReadFrequently: true });
        applyScaleAlgorithm(ctx, algorithm);
        ctx.drawImage(img, 0, 0, cw, ch);
        while (cw > dw || ch > dh) {
            const nw = Math.max(dw, Math.ceil(cw / 2));
            const nh = Math.max(dh, Math.ceil(ch / 2));
            const next = document.createElement("canvas");
            next.width = nw; next.height = nh;
            const nctx = next.getContext("2d", { willReadFrequently: true });
            applyScaleAlgorithm(nctx, algorithm);
            nctx.drawImage(canvas, 0, 0, cw, ch, 0, 0, nw, nh);
            canvas = next; ctx = nctx; cw = nw; ch = nh;
        }
        return ctx.getImageData(0, 0, dw, dh).data;
    }

    async function renderFilledTiles(t, op, useErr, version) {
        const grid = useErr ? t._analysis.errorCanvas : await buildGridCanvas(t);
        if (version !== (t._renderVersion || 0)) return;

        const sig = useErr ? `err|${t.w}x${t.h}|${t._analysis.when}` : t._gridSig;

        const sp = screenPerGlobalPx();
        const scaleDown = sp < 1;

        const txa = Math.floor(t.gx / TILE_SIZE), txb = Math.floor((t.gx + t.w - 1) / TILE_SIZE);
        const tya = Math.floor(t.gy / TILE_SIZE), tyb = Math.floor((t.gy + t.h - 1) / TILE_SIZE);
        const needed = new Set();

        for (let ty = tya; ty <= tyb; ty++) {
            for (let tx = txa; tx <= txb; tx++) {
                if (ty < 0 || ty >= TILE_COUNT) continue;
                const tileLeft = tx * TILE_SIZE, tileTop = ty * TILE_SIZE;

                const ix0 = Math.max(t.gx, tileLeft), iy0 = Math.max(t.gy, tileTop);
                const ix1 = Math.min(t.gx + t.w, tileLeft + TILE_SIZE), iy1 = Math.min(t.gy + t.h, tileTop + TILE_SIZE);
                const ow = ix1 - ix0, oh = iy1 - iy0;
                if (ow <= 0 || oh <= 0) continue;
                const key = `${tx}-${ty}`;
                needed.add(key);

                let cw = scaleDown ? Math.max(1, Math.floor(ow * sp)) : ow;
                let ch = scaleDown ? Math.max(1, Math.floor(oh * sp)) : oh;

                if (isPOT(cw) && isPOT(ch)) cw *= 3;
                const offX = ix0 - t.gx, offY = iy0 - t.gy;

                let e = t._tiles.get(key);
                const fresh = !e;
                if (!e) {
                    const canvas = document.createElement("canvas");
                    const ctx = canvas.getContext("2d", { willReadFrequently: true });
                    e = { canvas, ctx, sourceId: `rtpl-src-${t.id}-${key}`, layerId: `rtpl-lyr-${t.id}-${key}` };
                    t._tiles.set(key, e);
                }

                const dimsChanged = e.cw !== cw || e.ch !== ch;
                const rebuilt = fresh || e.sig !== sig || dimsChanged
                    || e.offX !== offX || e.offY !== offY || e.ow !== ow || e.oh !== oh;
                if (rebuilt) {
                    if (dimsChanged) { e.canvas.width = cw; e.canvas.height = ch; }
                    e.ctx.imageSmoothingEnabled = false;
                    e.ctx.clearRect(0, 0, cw, ch);
                    e.ctx.drawImage(grid, offX, offY, ow, oh, 0, 0, cw, ch);
                    e.sig = sig; e.cw = cw; e.ch = ch; e.offX = offX; e.offY = offY; e.ow = ow; e.oh = oh;
                }

                const coords = rasterCoordinates(ix0, ix1, iy0, iy1);

                if (fresh || dimsChanged || !map.getSource(e.sourceId)) {
                    if (map.getLayer(e.layerId)) map.removeLayer(e.layerId);
                    if (map.getSource(e.sourceId)) map.removeSource(e.sourceId);
                    map.addSource(e.sourceId, { type: "canvas", canvas: e.canvas, coordinates: coords, animate: false });
                    map.addLayer({
                        id: e.layerId, type: "raster", source: e.sourceId,
                        paint: { "raster-opacity": op, "raster-resampling": "nearest", "raster-fade-duration": 0 }
                    }, templateBeforeId());
                } else {
                    try { map.getSource(e.sourceId).setCoordinates(coords); } catch (err) {  }
                    if (rebuilt) refreshCanvasSource(e.sourceId);
                    map.setPaintProperty(e.layerId, "raster-opacity", op);
                }
            }
        }

        for (const [key, e] of [...t._tiles]) {
            if (needed.has(key)) continue;
            if (map.getLayer(e.layerId)) map.removeLayer(e.layerId);
            if (map.getSource(e.sourceId)) map.removeSource(e.sourceId);
            t._tiles.delete(key);
        }
    }

    async function buildDotGrid(t) {
        const sig = `${renderSig(t)}|${t.w}x${t.h}`;
        if (t._dotGrid && t._dotGridSig === sig) return t._dotGrid;
        const grid = await buildGridCanvas(t);
        const gw = t.w, gh = t.h;
        const gctx = grid.getContext("2d", { willReadFrequently: true });
        t._dotGrid = { data: gctx.getImageData(0, 0, gw, gh).data, gw, gh };
        t._dotGridSig = sig;
        return t._dotGrid;
    }

    async function renderDotLayer(t, op, version) {
        if (!t._dotTiles) t._dotTiles = new Map();
        const S = DOT_SCALE;
        const grid = await buildDotGrid(t);
        if (version !== (t._renderVersion || 0)) return;
        const sig = `${t._dotGridSig}|S${S}`;
        const c = Math.floor(S / 2);
        const limited = largeDotTemplate(t);

        const txa = Math.floor(t.gx / TILE_SIZE), txb = Math.floor((t.gx + t.w - 1) / TILE_SIZE);
        const tya = Math.floor(t.gy / TILE_SIZE), tyb = Math.floor((t.gy + t.h - 1) / TILE_SIZE);
        const needed = new Set();

        for (let ty = tya; ty <= tyb; ty++) {
            for (let tx = txa; tx <= txb; tx++) {
                if (ty < 0 || ty >= TILE_COUNT) continue;
                const tileLeft = tx * TILE_SIZE, tileTop = ty * TILE_SIZE;

                const ix0 = Math.max(t.gx, tileLeft), iy0 = Math.max(t.gy, tileTop);
                const ix1 = Math.min(t.gx + t.w, tileLeft + TILE_SIZE), iy1 = Math.min(t.gy + t.h, tileTop + TILE_SIZE);
                const ow = ix1 - ix0, oh = iy1 - iy0;
                if (ow <= 0 || oh <= 0) continue;
                if (limited && !visibleLargeDotTile(tx, ty)) continue;
                const key = `${tx}-${ty}`;
                needed.add(key);

                let e = t._dotTiles.get(key);
                const fresh = !e;
                if (!e) {
                    e = { sourceId: `rtpl-dot-src-${t.id}-${key}`, layerId: `rtpl-dot-lyr-${t.id}-${key}` };
                    t._dotTiles.set(key, e);
                }

                const rebuilt = fresh || e.sig !== sig || e.ix0 !== ix0 || e.iy0 !== iy0 || e.ow !== ow || e.oh !== oh;
                if (rebuilt) {
                    const cv = e.canvas || (e.canvas = document.createElement("canvas"));
                    cv.width = ow * S; cv.height = oh * S;
                    const ctx = cv.getContext("2d");
                    const out = ctx.createImageData(cv.width, cv.height);
                    const od = out.data, W = cv.width, gd = grid.data, gw = grid.gw;
                    const offX = ix0 - t.gx, offY = iy0 - t.gy;
                    for (let y = 0; y < oh; y++) {
                        const gy = offY + y;
                        for (let x = 0; x < ow; x++) {
                            const gi = (gy * gw + (offX + x)) * 4;
                            if (gd[gi + 3] <= 128) continue;
                            const oi = ((y * S + c) * W + (x * S + c)) * 4;
                            od[oi] = gd[gi]; od[oi + 1] = gd[gi + 1]; od[oi + 2] = gd[gi + 2]; od[oi + 3] = 255;
                        }
                    }
                    ctx.putImageData(out, 0, 0);
                    e.sig = sig; e.ix0 = ix0; e.iy0 = iy0; e.offX = offX; e.offY = offY; e.ow = ow; e.oh = oh;
                }

                const coords = rasterCoordinates(ix0, ix1, iy0, iy1);

                if (fresh || !map.getSource(e.sourceId)) {
                    map.addSource(e.sourceId, { type: "canvas", canvas: e.canvas, coordinates: coords, animate: false });
                    map.addLayer({
                        id: e.layerId, type: "raster", source: e.sourceId,
                        paint: { "raster-opacity": op, "raster-resampling": "nearest", "raster-fade-duration": 0 }
                    }, templateBeforeId());
                } else {
                    try { map.getSource(e.sourceId).setCoordinates(coords); } catch (err) {  }
                    if (rebuilt) refreshCanvasSource(e.sourceId);
                    map.setPaintProperty(e.layerId, "raster-opacity", op);
                }
            }
        }

        for (const [key, e] of [...t._dotTiles]) {
            if (needed.has(key)) continue;
            if (map.getLayer(e.layerId)) map.removeLayer(e.layerId);
            if (map.getSource(e.sourceId)) map.removeSource(e.sourceId);
            t._dotTiles.delete(key);
        }
    }

    function removeLayer(id) {
        if (!map) return;
        const t = getTpl(id);
        if (!t) return;
        removeFilledTiles(t);
        removeDotLayer(t);
    }

    const isImageFile = (f) => !!f && (/^image\//.test(f.type || "") || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name || ""));
    function importError(f, e) { return `Couldn't import “${f?.name || "image"}”: ${e?.message || "unknown browser error"}`; }

    async function canvasToPreparedImage(canvas) {
        const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The browser could not encode the resized image.")), "image/png"));
        const objectUrl = URL.createObjectURL(blob);
        try {
            const img = await loadImage(objectUrl, "processed image");
            const dataUrl = await fileToDataUrl(blob);
            return { dataUrl, img };
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    async function decodedFrameToImage(frame, w, h) {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        applyScaleAlgorithm(ctx, "high");
        ctx.drawImage(frame, 0, 0, w, h);
        frame.close?.();
        return canvasToPreparedImage(canvas);
    }

    async function readImageDimensions(file) {
        const bytes = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
        const be32 = (offset) => ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
        if (bytes.length >= 29 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return { w: be32(16), h: be32(20), png: { bitDepth: bytes[24], colorType: bytes[25], interlace: bytes[28] } };
        if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
            for (let i = 2; i + 9 < bytes.length;) {
                if (bytes[i] !== 0xff) { i++; continue; }
                const marker = bytes[i + 1], len = (bytes[i + 2] << 8) + bytes[i + 3];
                if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { w: (bytes[i + 7] << 8) + bytes[i + 8], h: (bytes[i + 5] << 8) + bytes[i + 6] };
                if (!len) break;
                i += 2 + len;
            }
        }
        return null;
    }

    async function decodeResizedBitmap(file, dimensions) {
        if (typeof createImageBitmap !== "function" || !dimensions) return null;
        const safe = safeWorkingSize(dimensions.w, dimensions.h);
        if (!safe.scaled) return null;
        showToast(`Preparing ${dimensions.w}×${dimensions.h} image at ${safe.w}×${safe.h}…`, "progress", 0);
        const bitmap = await createImageBitmap(file, { resizeWidth: safe.w, resizeHeight: safe.h, resizeQuality: "high" });
        const result = await decodedFrameToImage(bitmap, safe.w, safe.h);
        return { ...result, sourceW: dimensions.w, sourceH: dimensions.h, scaled: true };
    }

    function pngIdatTransform() {
        let phase = "signature", header = [], length = 0, type = "", remaining = 0, crc = 0;
        const readHeader = () => {
            length = ((header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3]) >>> 0;
            type = String.fromCharCode(header[4], header[5], header[6], header[7]);
            remaining = length;
            header = [];
            phase = "data";
        };
        return new TransformStream({
            transform(chunk, controller) {
                let at = 0;
                while (at < chunk.length) {
                    if (phase === "signature") {
                        const end = Math.min(chunk.length, at + 8 - header.length);
                        header.push(...chunk.subarray(at, end));
                        at = end;
                        if (header.length === 8) {
                            if (header.join(",") !== "137,80,78,71,13,10,26,10") throw new Error("The file is not a PNG.");
                            header = [];
                            phase = "header";
                        }
                        continue;
                    }
                    if (phase === "header") {
                        const end = Math.min(chunk.length, at + 8 - header.length);
                        header.push(...chunk.subarray(at, end));
                        at = end;
                        if (header.length === 8) readHeader();
                        continue;
                    }
                    if (phase === "data") {
                        const count = Math.min(remaining, chunk.length - at);
                        if (type === "IDAT" && count) controller.enqueue(chunk.slice(at, at + count));
                        at += count;
                        remaining -= count;
                        if (!remaining) { crc = 4; phase = "crc"; }
                        continue;
                    }
                    const count = Math.min(crc, chunk.length - at);
                    at += count;
                    crc -= count;
                    if (!crc) phase = "header";
                }
            }
        });
    }

    const pngPaeth = (a, b, c) => {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };

    async function decodePngStreamed(file, dimensions) {
        const info = dimensions?.png;
        if (!info || info.bitDepth !== 8 || info.interlace !== 0 || ![2, 6].includes(info.colorType)) throw new Error("This large PNG uses a format the streaming importer does not support.");
        if (typeof DecompressionStream !== "function" || !file.stream) throw new Error("This browser cannot stream-decode PNG files.");
        const safe = safeWorkingSize(dimensions.w, dimensions.h);
        const channels = info.colorType === 6 ? 4 : 3, rowBytes = dimensions.w * channels;
        const sourceX = new Int32Array(safe.w), sourceY = new Int32Array(safe.h);
        for (let x = 0; x < safe.w; x++) sourceX[x] = Math.min(dimensions.w - 1, Math.floor((x + .5) * dimensions.w / safe.w));
        for (let y = 0; y < safe.h; y++) sourceY[y] = Math.min(dimensions.h - 1, Math.floor((y + .5) * dimensions.h / safe.h));
        const canvas = document.createElement("canvas");
        canvas.width = safe.w; canvas.height = safe.h;
        const ctx = canvas.getContext("2d");
        const output = ctx.createImageData(safe.w, safe.h), data = output.data;
        const scanline = new Uint8Array(rowBytes + 1);
        let previous = new Uint8Array(rowBytes), current = new Uint8Array(rowBytes), filled = 0, sourceRow = 0, targetRow = 0;
        const useScanline = () => {
            const filter = scanline[0];
            if (filter > 4) throw new Error("The PNG uses an invalid scanline filter.");
            for (let i = 0; i < rowBytes; i++) {
                const value = scanline[i + 1], left = i >= channels ? current[i - channels] : 0, up = previous[i], upperLeft = i >= channels ? previous[i - channels] : 0;
                current[i] = (value + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? ((left + up) >> 1) : filter === 4 ? pngPaeth(left, up, upperLeft) : 0)) & 255;
            }
            if (targetRow < safe.h && sourceY[targetRow] === sourceRow) {
                const rowOffset = targetRow * safe.w * 4;
                for (let x = 0; x < safe.w; x++) {
                    const sourceOffset = sourceX[x] * channels, out = rowOffset + x * 4;
                    data[out] = current[sourceOffset];
                    data[out + 1] = current[sourceOffset + 1];
                    data[out + 2] = current[sourceOffset + 2];
                    data[out + 3] = channels === 4 ? current[sourceOffset + 3] : 255;
                }
                targetRow++;
            }
            [previous, current] = [current, previous];
            sourceRow++;
            if (!(sourceRow & 127)) showToast("Preparing " + dimensions.w + "×" + dimensions.h + " image: " + Math.min(99, Math.round(sourceRow / dimensions.h * 100)) + "%…", "progress", 0);
        };
        const reader = file.stream().pipeThrough(pngIdatTransform()).pipeThrough(new DecompressionStream("deflate")).getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                let at = 0;
                while (at < value.length) {
                    const count = Math.min(scanline.length - filled, value.length - at);
                    scanline.set(value.subarray(at, at + count), filled);
                    filled += count;
                    at += count;
                    if (filled === scanline.length) {
                        useScanline();
                        filled = 0;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
        if (filled || sourceRow !== dimensions.h || targetRow !== safe.h) throw new Error("The PNG data ended before the image was complete.");
        ctx.putImageData(output, 0, 0);
        const result = await canvasToPreparedImage(canvas);
        return { ...result, sourceW: dimensions.w, sourceH: dimensions.h, scaled: true };
    }

    async function prepareImageFile(file) {
        if (!isImageFile(file)) throw new Error("Please choose a supported image file.");
        showToast(`Reading ${file.name}…`, "progress", 0);
        const dimensions = await readImageDimensions(file);
        const large = !!dimensions && safeWorkingSize(dimensions.w, dimensions.h).scaled;

        try {
            const resized = await decodeResizedBitmap(file, dimensions);
            if (resized) return resized;
        } catch (e) {
            LOG("resized bitmap decode unavailable", e);
        }

        if (large && dimensions?.png) {
            try {
                showToast(`Preparing ${dimensions.w}×${dimensions.h} image without full-size decoding…`, "progress", 0);
                return await decodePngStreamed(file, dimensions);
            } catch (e) {
                LOG("streamed PNG decode unavailable", e);
                throw new Error(file.name + " could not be safely resized: " + (e?.message || "unknown PNG decoding error"));
            }
        }

        if (typeof ImageDecoder === "function" && file.type) {
            let decoder = null;
            try {
                decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
                await decoder.tracks.ready;
                const track = decoder.tracks.selectedTrack;
                const sourceW = track.codedWidth, sourceH = track.codedHeight;
                const safe = safeWorkingSize(sourceW, sourceH);
                showToast(safe.scaled ? `Preparing ${sourceW}×${sourceH} image at ${safe.w}×${safe.h}…` : `Decoding ${file.name}…`, "progress", 0);
                const { image } = await decoder.decode({ desiredWidth: safe.w, desiredHeight: safe.h });
                const result = await decodedFrameToImage(image, safe.w, safe.h);
                return { ...result, sourceW, sourceH, scaled: safe.scaled };
            } catch (e) {
                LOG("native image decode unavailable; using browser fallback", e);
            } finally {
                decoder?.close?.();
            }
        }

        if (large) throw new Error(file.name + " is too large for this browser to decode safely.");

        const url = await fileToDataUrl(file, (loaded, total) => total && showToast(`Reading ${file.name}: ${Math.round(loaded / total * 100)}%…`, "progress", 0));
        showToast(`Decoding ${file.name}…`, "progress", 0);
        const original = await loadImage(url, file.name);
        return { dataUrl: url, img: original, sourceW: original.naturalWidth, sourceH: original.naturalHeight, scaled: false };
    }

    async function createTemplateFromFile(file, lngLat) {
        try {
            const prepared = await prepareImageFile(file);
            const t = await addTemplateFromDataUrl(prepared.dataUrl, file.name.replace(/\.[^.]+$/, ""), lngLat, prepared.img);
            if (t) showToast(prepared.scaled ? `Added “${file.name}” at ${prepared.img.naturalWidth}×${prepared.img.naturalHeight}.` : `Added “${file.name}”.`, "success");
            return t;
        } catch (e) { LOG("image import failed", e); const m = importError(file, e); showToast(m, "error", 7000); return null; }
    }

    async function addTemplateFromDataUrl(dataUrl, name, lngLat, loadedImg = null, globalPosition = null) {
        if (!map) { setStatus("Map not ready yet — try again in a moment.", "error", 5000); return null; }
        const img = loadedImg || await loadImage(dataUrl, name || "image");
        const naturalW = img.naturalWidth, naturalH = img.naturalHeight;
        const safe = safeWorkingSize(naturalW, naturalH);

        let gx, gy;
        if (Array.isArray(globalPosition) && Number.isFinite(globalPosition[0]) && Number.isFinite(globalPosition[1])) {
            gx = Math.round(globalPosition[0]);
            gy = Math.round(globalPosition[1]);
        } else if (lngLat) {
            gx = Math.round(lngToGpx(lngLat[0]));
            gy = Math.round(latToGpy(lngLat[1]));
        } else {
            const c = map.getCenter();
            gx = Math.round(lngToGpx(c.lng)) - Math.round(safe.w / 2);
            gy = Math.round(latToGpy(c.lat)) - Math.round(safe.h / 2);
        }
        gx = wrapHorizontal(gx);
        gy = clamp(gy, 0, WORLD_PIXELS - safe.h);

        const t = {
            id: nextId++,
            name: name || `template ${nextId}`,
            dataUrl, naturalW, naturalH,
            gx, gy, w: safe.w, h: safe.h,
            opacity: 0.7, visible: true, locked: false,
            aspectLock: true, disabled: []
        };
        templates.unshift(t);
        selectedId = t.id;
        await updateTemplateTiles(t);
        queueColorUsage(t);
        storeSet();
        renderPanel();
        updateOverlay();
        LOG(`added "${t.name}" ${naturalW}x${naturalH} at tile ${Math.floor(gx / TILE_SIZE)},${Math.floor(gy / TILE_SIZE)}`);
        return t;
    }

    const fileToDataUrl = (file, onProgress) => new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result);
        r.onerror = () => rej(new Error(r.error?.message || "The browser could not read this file."));
        r.onabort = () => rej(new Error("Reading the file was cancelled."));
        r.onprogress = (e) => onProgress?.(e.loaded, e.total);
        try { r.readAsDataURL(file); } catch (e) { rej(e); }
    });

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const wrapHorizontal = (x) => ((x % WORLD_PIXELS) + WORLD_PIXELS) % WORLD_PIXELS;
    const unwrapHorizontalNear = (x, reference) => x + Math.round((reference - x) / WORLD_PIXELS) * WORLD_PIXELS;

    function resetTemplateCaches(t) {
        t._procCanvas = null; t._procSig = null;
        t._gridCanvas = null; t._gridSig = null;
        t._mapPreview = null; t._mapPreviewSig = null; t._mapPreviewPromise = null; t._mapPreviewPromiseSig = null;
        t._usage = null; t._usageFor = null;
        queueColorUsage(t);
        t._analysis = null;
        t._dotGrid = null; t._dotGridSig = null;
        if (map) { removeFilledTiles(t); removeDotLayer(t); }
    }

    async function deleteTemplate(id) {
        removeLayer(id);
        templates = templates.filter((t) => t.id !== id);
        if (selectedId === id) selectedId = templates.length ? templates[0].id : null;
        storeSet();
        renderPanel();
        updateOverlay();
    }

    function goToTemplate(t) {
        if (!map) return;
        selectedId = t.id;
        const left = gpxToLng(t.gx), right = gpxToLng(t.gx + t.w);
        const top = gpyToLat(t.gy), bottom = gpyToLat(t.gy + t.h);
        const sw = [Math.min(left, right), Math.min(top, bottom)];
        const ne = [Math.max(left, right), Math.max(top, bottom)];
        map.fitBounds([sw, ne], { padding: 80, maxZoom: 18, duration: 800 });
        renderPanel();
        updateOverlay();
    }

    const coordString = (tx, ty, px, py) => `tX: ${tx} tY: ${ty} X: ${px} Y: ${py}`;

    function parseCoords(str) {
        const m = String(str || "").match(/\d+/g);
        if (!m) return null;
        const n = m.map(Number);
        let tx, ty, px = 1, py = 1;
        if (n.length >= 4) [tx, ty, px, py] = n;
        else if (n.length === 2) [tx, ty] = n;
        else return null;
        tx = clamp(tx, 0, TILE_COUNT - 1); ty = clamp(ty, 0, TILE_COUNT - 1);
        px = clamp(px, 1, TILE_SIZE); py = clamp(py, 1, TILE_SIZE);
        return { gx: tx * TILE_SIZE + px - 1, gy: ty * TILE_SIZE + py - 1 };
    }

    const paintPanelOpen = () => !!document.querySelector(".palette-card");

    function selectPixelAfterMove(lng, lat) {
        let done = false;
        const fire = () => {
            if (done) return; done = true;
            map.off("moveend", fire);
            if (paintPanelOpen()) return;
            try { map.fire("click", { lngLat: { lng, lat }, point: map.project([lng, lat]), originalEvent: null }); } catch (e) {  }
        };
        map.once("moveend", fire);
        setTimeout(fire, 1100);
    }

    function teleportTo(str) {
        const c = parseCoords(str);
        if (!c) { setStatus("Couldn't read coordinates. Try: tX tY X Y (e.g. 415 811 50 434).", "error", 5000); return false; }
        if (!map) { setStatus("Map not ready yet — try again in a moment.", "error", 5000); return false; }
        const lng = gpxToLng(c.gx + 0.5), lat = gpyToLat(c.gy + 0.5);
        map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
        selectPixelAfterMove(lng, lat);
        setStatus("");
        return true;
    }

    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
        } catch (e) {  }
        try {
            const ta = document.createElement("textarea");
            ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.focus(); ta.select();
            const ok = document.execCommand("copy"); ta.remove();
            return ok;
        } catch (e) { return false; }
    }

    const SHARE_CODE_PREFIX = "OPTT1";
    const MAX_SHARE_CODE_CHARS = 50_000_000;
    const SHARE_SERVICE_ORIGIN = "https://snowy-base-78d1.olivierdb.workers.dev";
    const SHORT_SHARE_CODE = /^[A-Za-z0-9]{10}$/;
    let shareDialog = null;

    function bytesToShareText(bytes) {
        let text = "";
        for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
        return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function shareTextToBytes(text) {
        const base64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    async function transformShareBytes(bytes, Stream) {
        const stream = new Blob([bytes]).stream().pipeThrough(new Stream("gzip"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async function createShareCode(t) {
        const preview = await createSharePreview(t);
        const payload = { v: 3, n: t.name, d: t.dataUrl, r: preview, w: t.w, h: t.h, o: t.opacity, a: t.aspectLock, x: t.disabled || [], p: [t.gx, t.gy] };
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        if (typeof CompressionStream === "function") {
            const compressed = await transformShareBytes(bytes, CompressionStream);
            return SHARE_CODE_PREFIX + "G." + bytesToShareText(compressed);
        }
        return SHARE_CODE_PREFIX + "J." + bytesToShareText(bytes);
    }
    async function createShareIdentity(t) {
        const identity = { d: t.dataUrl, w: t.w, h: t.h, o: t.opacity, a: t.aspectLock, x: [...(t.disabled || [])].sort((a, b) => a - b), p: [t.gx, t.gy] };
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(identity)));
        return bytesToShareText(new Uint8Array(hash));
    }
    async function readShareCode(code) {
        const text = String(code || "").trim();
        if (text.length > MAX_SHARE_CODE_CHARS) throw new Error("This share code is too large.");
        const match = text.match(/^OPTT1([GJ])\.([A-Za-z0-9_-]+)$/);
        if (!match) throw new Error("This is not a valid openplace template share code.");
        let bytes = shareTextToBytes(match[2]);
        if (match[1] === "G") {
            if (typeof DecompressionStream !== "function") throw new Error("This browser cannot open compressed share codes.");
            bytes = await transformShareBytes(bytes, DecompressionStream);
        }
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        if (![1, 2, 3].includes(payload?.v) || typeof payload.d !== "string" || !/^data:image\//i.test(payload.d)) throw new Error("This share code does not contain a valid template image.");
        return payload;
    }

    async function shareServiceRequest(path, options = {}) {
        let response;
        try {
            response = await fetch(SHARE_SERVICE_ORIGIN + path, { credentials: "omit", cache: "no-store", ...options });
        } catch (_) {
            throw new Error("The sharing service could not be reached.");
        }
        const text = await response.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch (_) {  }
        if (!response.ok) throw new Error(body?.error || "The sharing service could not complete that request.");
        return body ?? text;
    }

    function requestShareProof() {
        return new Promise((resolve, reject) => {
            const root = document.createElement("div");
            const frame = document.createElement("iframe");
            const origin = new URL(SHARE_SERVICE_ORIGIN).origin;
            let settled = false;
            const finish = (error, proof) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                window.removeEventListener("message", receive);
                root.remove();
                error ? reject(error) : resolve(proof);
            };
            const receive = (event) => {
                if (event.origin !== origin || !event.data || typeof event.data !== "object") return;
                if (event.data.type === "openplace-template-share-proof" && typeof event.data.token === "string") finish(null, event.data.token);
                if (event.data.type === "openplace-template-share-error") finish(new Error(event.data.message || "Share verification failed."));
            };
            const timeout = setTimeout(() => finish(new Error("Share verification timed out.")), 120000);
            Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "2147483647", display: "grid", placeItems: "center", padding: "16px", background: "rgba(0,0,0,.62)" });
            Object.assign(frame.style, { width: "min(380px,100%)", height: "190px", border: "1px solid #344150", borderRadius: "10px", background: "#10161c", boxShadow: "0 18px 48px #0009" });
            root.addEventListener("click", (event) => { if (event.target === root) finish(new Error("Share verification cancelled.")); });
            window.addEventListener("message", receive);
            frame.src = SHARE_SERVICE_ORIGIN + "/v1/challenge";
            root.appendChild(frame);
            document.body.appendChild(root);
        });
    }

    async function storeShareCode(payload, proof, identity) {
        const result = await shareServiceRequest("/v1/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload, proof, identity }) });
        if (!SHORT_SHARE_CODE.test(result?.code || "")) throw new Error("The sharing service returned an invalid share code.");
        return result;
    }

    async function resolveShareCode(code) {
        const text = String(code || "").trim();
        if (text.startsWith(SHARE_CODE_PREFIX)) return text;
        if (!SHORT_SHARE_CODE.test(text)) throw new Error("Enter a valid 10-character share code.");
        const payload = await shareServiceRequest("/v1/share/" + text);
        if (typeof payload !== "string") throw new Error("The sharing service returned an invalid template.");
        return payload;
    }
    function getShareDialog() {
        if (shareDialog) return shareDialog;
        const root = document.createElement("div");
        const box = document.createElement("div");
        const icon = document.createElement("div");
        const marker = document.createElement("div");
        const title = document.createElement("div");
        const subtitle = document.createElement("div");
        const code = document.createElement("div");
        const preview = document.createElement("div");
        const previewImage = document.createElement("img");
        const previewText = document.createElement("div");
        const actions = document.createElement("div");
        const primary = document.createElement("button");
        const close = document.createElement("button");
        const inputs = Array.from({ length: 10 }, () => document.createElement("input"));
        const setCode = (value) => {
            const chars = String(value || "").replace(/[^A-Za-z0-9]/g, "").slice(0, inputs.length).split("");
            inputs.forEach((input, index) => { input.value = chars[index] || ""; });
        };
        const getCode = () => inputs.map((input) => input.value).join("");
        const setReadOnly = (readOnly) => inputs.forEach((input) => { input.readOnly = readOnly; input.tabIndex = readOnly ? -1 : 0; });
        Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "2147483647", display: "none", alignItems: "center", justifyContent: "center", padding: "16px", background: "rgba(0,0,0,.62)" });
        Object.assign(box.style, { width: "min(480px,100%)", boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "stretch", gap: "12px", padding: "20px", border: "1px solid #344150", borderRadius: "14px", background: "#10161c", color: "#eef3f8", font: "13px system-ui,sans-serif", boxShadow: "0 18px 48px #0009" });
        Object.assign(icon.style, { width: "42px", height: "42px", display: "grid", placeItems: "center", alignSelf: "center", border: "1px solid #2e3947", borderRadius: "50%", background: "#131b25" });
        Object.assign(marker.style, { width: "15px", height: "15px", border: "1px dashed #dce6f0", borderRadius: "3px" });
        Object.assign(title.style, { textAlign: "center", fontSize: "16px", fontWeight: "700", marginTop: "2px" });
        Object.assign(subtitle.style, { minHeight: "18px", textAlign: "center", color: "#9eabb9", fontSize: "12px" });
        Object.assign(code.style, { display: "grid", gridTemplateColumns: "repeat(10,minmax(0,1fr))", gap: "5px" });
        Object.assign(preview.style, { display: "none", gap: "14px", alignItems: "center", padding: "12px", border: "1px solid #2e3947", borderRadius: "9px", background: "#0c1116" });
        Object.assign(previewImage.style, { width: "112px", height: "112px", objectFit: "contain", borderRadius: "6px", background: "#161d26" });
        Object.assign(previewText.style, { minWidth: "0", color: "#cbd6e2", fontSize: "12px", lineHeight: "1.45", whiteSpace: "pre-line" });
        for (const [index, input] of inputs.entries()) {
            input.type = "text";
            input.maxLength = 1;
            input.autocomplete = index === 0 ? "one-time-code" : "off";
            input.inputMode = "text";
            input.spellcheck = false;
            Object.assign(input.style, { minWidth: "0", height: "42px", boxSizing: "border-box", border: "1px solid #344150", borderRadius: "7px", outline: "none", background: "#0c1116", color: "#eef3f8", textAlign: "center", font: "700 18px ui-monospace,monospace" });
            input.addEventListener("focus", () => { input.style.borderColor = "#4b82ed"; });
            input.addEventListener("blur", () => { input.style.borderColor = "#344150"; });
            input.addEventListener("input", () => {
                input.value = input.value.replace(/[^A-Za-z0-9]/g, "").slice(-1);
                if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
                shareDialog?.onCodeChange?.();
            });
            input.addEventListener("keydown", (event) => {
                if (event.key === "Backspace" && !input.value && index > 0) { inputs[index - 1].focus(); inputs[index - 1].select(); }
            });
            input.addEventListener("paste", (event) => {
                const pasted = event.clipboardData?.getData("text");
                if (!pasted) return;
                event.preventDefault();
                setCode(pasted);
                shareDialog?.onCodeChange?.();
                const next = Math.min(getCode().length, inputs.length - 1);
                inputs[next].focus();
            });
            code.appendChild(input);
        }
        Object.assign(actions.style, { display: "flex", flexDirection: "column", gap: "8px", marginTop: "2px" });
        Object.assign(primary.style, { width: "100%", minHeight: "40px", border: "1px solid #4a82ed", borderRadius: "7px", background: "#477df0", color: "#fff", fontWeight: "650", cursor: "pointer" });
        Object.assign(close.style, { alignSelf: "center", padding: "3px 8px", border: "none", background: "transparent", color: "#9eabb9", fontSize: "11px", cursor: "pointer" });
        icon.appendChild(marker);
        preview.append(previewImage, previewText);
        root.addEventListener("click", (event) => { if (event.target === root) root.style.display = "none"; });
        close.addEventListener("click", () => { root.style.display = "none"; });
        actions.append(primary, close);
        box.append(icon, title, subtitle, code, preview, actions);
        root.appendChild(box);
        document.body.appendChild(root);
        shareDialog = { root, box, title, subtitle, inputs, primary, close, preview, previewImage, previewText, setCode, getCode, setReadOnly, onCodeChange: null };
        return shareDialog;
    }

    function showShareCode(code) {
        const dialog = getShareDialog();
        dialog.title.textContent = "Share template";
        dialog.subtitle.textContent = "Send this 10-character code to another user.";
        dialog.preview.style.display = "none";
        dialog.onCodeChange = null;
        dialog.setCode(code);
        dialog.setReadOnly(true);
        dialog.primary.textContent = "Copy share code";
        dialog.close.textContent = "Close";
        dialog.primary.onclick = async () => showToast(await copyToClipboard(dialog.getCode()) ? "Share code copied." : "Copy failed. Select the code and copy it manually.", "info", 5000);
        dialog.root.style.display = "flex";
    }

    function showImportShareDialog() {
        const dialog = getShareDialog();
        let pendingShare = null;
        const resetPreview = () => {
            pendingShare = null;
            dialog.preview.style.display = "none";
            dialog.primary.textContent = "Preview template";
            dialog.subtitle.textContent = "Enter the 10-character code you received.";
        };
        dialog.title.textContent = "Import template";
        dialog.setCode("");
        dialog.setReadOnly(false);
        dialog.close.textContent = "Cancel";
        dialog.onCodeChange = resetPreview;
        resetPreview();
        dialog.primary.onclick = async () => {
            try {
                if (!pendingShare) {
                    pendingShare = await previewShareCode(dialog.getCode());
                    const size = `${Math.max(1, Math.round(Number(pendingShare.w) || 0))}×${Math.max(1, Math.round(Number(pendingShare.h) || 0))} px`;
                    const position = Array.isArray(pendingShare.p) && Number.isFinite(pendingShare.p[0]) && Number.isFinite(pendingShare.p[1]) ? gpToTilePixel(pendingShare.p[0], pendingShare.p[1]) : null;
                    showToast("Preparing template preview…", "progress", 0);
                    dialog.previewImage.src = await sharedPreviewData(pendingShare);
                    dialog.previewImage.alt = "Shared template preview";
                    dialog.previewText.textContent = `${String(pendingShare.n || "Shared template").slice(0, 120)}\n${size}${position ? `\nTile ${position.tx}, ${position.ty} · px ${position.px}, ${position.py}` : "\nNo saved location"}`;
                    dialog.preview.style.display = "flex";
                    dialog.subtitle.textContent = "Review the shared template before importing.";
                    dialog.primary.textContent = "Import template";
                    showToast("Preview ready.", "success", 2200);
                    return;
                }
                await importSharedTemplate(pendingShare);
                dialog.root.style.display = "none";
            } catch (e) {
                showToast(e?.message || "Could not import this share code.", "error", 7000);
            }
        };
        dialog.root.style.display = "flex";
        dialog.inputs[0].focus();
    }

    async function shareTemplate(t) {
        if (!t?.locked) {
            showToast("Lock this template before sharing it.", "info");
            return;
        }
        if (!confirm("Share codes let another person preview and import this locked template at the same map location. Anyone you give the code to can access that shared template. Continue?")) {
            showToast("Share code cancelled.", "info");
            return;
        }
        showToast("Preparing share preview…", "progress", 0);
        try {
            const payload = await createShareCode(t);
            const identity = await createShareIdentity(t);
            showToast("Complete verification to create a share code…", "progress", 0);
            const proof = await requestShareProof();
            showToast("Saving share code…", "progress", 0);
            const result = await storeShareCode(payload, proof, identity);
            showShareCode(result.code);
            const message = result.reused ? "Existing share code copied." : "Share code copied.";
            showToast(await copyToClipboard(result.code) ? message : "Share code is ready to copy.", "success", 5000);
        } catch (e) {
            showToast(e?.message || "Could not create a share code.", "error", 7000);
        }
    }

    async function previewShareCode(code) {
        showToast("Reading shared template…", "progress", 0);
        return readShareCode(await resolveShareCode(code));
    }

    async function importShareCode(code) {
        return importSharedTemplate(await previewShareCode(code));
    }

    async function importSharedTemplate(shared) {
        showToast("Importing shared template…", "progress", 0);
        const img = await loadImage(shared.d, "shared template");
        const placement = lastPixel ? [gpxToLng(lastPixel.gx), gpyToLat(lastPixel.gy)] : null;
        const sharedPosition = Array.isArray(shared.p) && Number.isFinite(shared.p[0]) && Number.isFinite(shared.p[1]) ? shared.p : null;
        const t = await addTemplateFromDataUrl(shared.d, String(shared.n || "Shared template").slice(0, 120), placement, img, sharedPosition);
        if (!t) throw new Error("The map is not ready yet.");
        const safe = safeWorkingSize(Number(shared.w) || img.naturalWidth, Number(shared.h) || img.naturalHeight);
        t.w = safe.w;
        t.h = safe.h;
        if (sharedPosition) {
            t.gx = wrapHorizontal(Math.round(sharedPosition[0]));
            t.gy = clamp(Math.round(sharedPosition[1]), 0, WORLD_PIXELS - safe.h);
        }
        t.opacity = clamp(Number(shared.o), 0, 1);
        if (!Number.isFinite(t.opacity)) t.opacity = .7;
        t.aspectLock = shared.a !== false;
        t.disabled = Array.isArray(shared.x) ? shared.x.filter((index) => PALETTE_BY_INDEX[index]) : [];
        t.locked = true;
        resetTemplateCaches(t);
        await updateTemplateTiles(t);
        renderPanel();
        updateOverlay();
        storeSet();
        goToTemplate(t);
        showToast(sharedPosition ? "Shared template added locked at its original location." : "Shared template added locked.", "success", 5000);
        return t;
    }

    async function copyTemplateCoords(t) {
        const { tx, ty, px, py } = gpToTilePixel(t.gx, t.gy);
        const s = coordString(tx, ty, px, py);
        const ok = await copyToClipboard(s);
        setStatus(ok ? `Copied: ${s}` : "Copy failed — your browser blocked clipboard access.");
        if (ok) setTimeout(() => { if (statusMsg.startsWith("Copied:")) setStatus(""); }, 2000);
    }

    const SVGNS = "http://www.w3.org/2000/svg";
    let overlayRoot = null, svg = null, fillPoly = null, outline = null;
    let handleEls = [];
    let labelEl = null;

    let dlPoly = null;
    let dlOutline = true;
    let dlC1 = null, dlC2 = null;

    const HANDLES = [
        { id: "tl", fx: "right", fy: "bottom", corner: true },
        { id: "tr", fx: "left", fy: "bottom", corner: true },
        { id: "br", fx: "left", fy: "top", corner: true },
        { id: "bl", fx: "right", fy: "top", corner: true },
        { id: "t", fy: "bottom" },
        { id: "b", fy: "top" },
        { id: "l", fx: "right" },
        { id: "r", fx: "left" }
    ];

    function buildOverlay() {
        const container = map.getContainer();
        overlayRoot = document.createElement("div");
        overlayRoot.className = "rtpl-overlay";
        Object.assign(overlayRoot.style, {
            position: "absolute", inset: "0", pointerEvents: "none", zIndex: 5
        });

        svg = document.createElementNS(SVGNS, "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.position = "absolute";
        svg.style.inset = "0";
        svg.style.overflow = "visible";

        fillPoly = document.createElementNS(SVGNS, "polygon");
        fillPoly.setAttribute("class", "rtpl-fill");

        fillPoly.setAttribute("fill", "rgba(0,0,0,0)");
        fillPoly.setAttribute("stroke", "none");
        fillPoly.style.cursor = "move";
        fillPoly.style.touchAction = "none";
        svg.appendChild(fillPoly);

        outline = document.createElementNS(SVGNS, "polygon");
        outline.setAttribute("fill", "none");
        outline.setAttribute("stroke", "#3a86ff");
        outline.setAttribute("stroke-width", "2");
        outline.style.pointerEvents = "none";
        svg.appendChild(outline);

        dlPoly = document.createElementNS(SVGNS, "polygon");
        dlPoly.setAttribute("fill", "none");
        dlPoly.setAttribute("stroke", "#ffb300");
        dlPoly.setAttribute("stroke-width", "2");
        dlPoly.setAttribute("stroke-dasharray", "8 6");
        dlPoly.style.pointerEvents = "none";
        dlPoly.style.display = "none";
        svg.appendChild(dlPoly);

        for (const def of HANDLES) {
            const r = document.createElementNS(SVGNS, "rect");
            r.setAttribute("width", "16");
            r.setAttribute("height", "16");
            r.setAttribute("rx", "3");
            r.setAttribute("fill", "#fff");
            r.setAttribute("stroke", "#3a86ff");
            r.setAttribute("stroke-width", "2");
            r.dataset.handle = def.id;
            r.style.cursor = handleCursor(def.id);
            r.style.touchAction = "none";
            svg.appendChild(r);
            handleEls.push({ def, el: r });
        }

        labelEl = document.createElement("div");
        labelEl.className = "rtpl-label";
        Object.assign(labelEl.style, {
            position: "absolute", padding: "2px 6px", borderRadius: "4px",
            background: "rgba(0,0,0,0.75)", color: "#fff", font: "11px ui-monospace,monospace",
            pointerEvents: "none", whiteSpace: "nowrap"
        });

        overlayRoot.appendChild(svg);
        overlayRoot.appendChild(labelEl);
        container.appendChild(overlayRoot);

        svg.addEventListener("wheel", (e) => {
            e.preventDefault();
            const canvas = map.getCanvas();
            canvas.dispatchEvent(new WheelEvent("wheel", {
                deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
                clientX: e.clientX, clientY: e.clientY,
                bubbles: true, cancelable: true,
                ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey
            }));
        }, { passive: false });

        attachPointerHandlers();
        map.on("render", updateOverlay);
    }

    const handleCursor = (id) => ({
        tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize",
        t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize"
    }[id] || "pointer");

    const dragHandleSize = () => matchMedia("(pointer: coarse)").matches ? 28 : 16;

    function projGp(gx, gy) {
        const lng = gpxToLng(gx);
        const center = map.getCenter().lng;
        const wrappedLng = lng + Math.round((center - lng) / 360) * 360;
        const p = map.project([wrappedLng, gpyToLat(gy)]);
        return [p.x, p.y];
    }

    function updateOverlay() {
        if (!overlayRoot) return;
        const t = selected();

        const farAway = !!map && map.getZoom() < MIN_TEMPLATE_ZOOM;
        const showBox = !!t && editMode && !farAway && !t.locked;
        const show = showBox;
        const showDl = !!(dlOutline && dlC1 && dlC2 && dlPoly);

        overlayRoot.style.display = (showBox || showDl) ? "block" : "none";

        if (dlPoly) {
            if (showDl) {
                const minX = Math.min(dlC1[0], dlC2[0]), minY = Math.min(dlC1[1], dlC2[1]);
                const maxX = Math.max(dlC1[0], dlC2[0]) + 1, maxY = Math.max(dlC1[1], dlC2[1]) + 1;
                const a = projGp(minX, minY), b = projGp(maxX, minY), c = projGp(maxX, maxY), e = projGp(minX, maxY);
                dlPoly.setAttribute("points", `${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]} ${e[0]},${e[1]}`);
                dlPoly.style.display = "block";
            } else {
                dlPoly.style.display = "none";
            }
        }

        if (!showBox) {

            outline.style.display = "none";
            fillPoly.style.pointerEvents = "none";
            fillPoly.setAttribute("points", "");
            labelEl.style.display = "none";
            for (const { el } of handleEls) { el.style.display = "none"; el.style.pointerEvents = "none"; }
            return;
        }
        outline.style.display = "block";

        const tl = projGp(t.gx, t.gy);
        const tr = projGp(t.gx + t.w, t.gy);
        const br = projGp(t.gx + t.w, t.gy + t.h);
        const bl = projGp(t.gx, t.gy + t.h);
        const pts = `${tl[0]},${tl[1]} ${tr[0]},${tr[1]} ${br[0]},${br[1]} ${bl[0]},${bl[1]}`;
        outline.setAttribute("points", pts);
        fillPoly.setAttribute("points", pts);

        fillPoly.style.pointerEvents = show ? "all" : "none";

        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const pos = {
            tl, tr, br, bl,
            t: mid(tl, tr), b: mid(bl, br), l: mid(tl, bl), r: mid(tr, br)
        };
        const handleSize = dragHandleSize();
        for (const { def, el } of handleEls) {
            const p = pos[def.id];
            el.setAttribute("width", handleSize);
            el.setAttribute("height", handleSize);
            el.setAttribute("x", p[0] - handleSize / 2);
            el.setAttribute("y", p[1] - handleSize / 2);
            el.style.display = show ? "block" : "none";
            el.style.pointerEvents = show ? "auto" : "none";
        }

        const { tx, ty, px, py } = gpToTilePixel(t.gx, t.gy);
        labelEl.style.display = show ? "block" : "none";
        labelEl.textContent = `${t.w}×${t.h}px  @ tile ${tx},${ty} px ${px},${py}`;
        labelEl.style.left = `${tl[0]}px`;
        labelEl.style.top = `${Math.min(tl[1], tr[1]) - 22}px`;
    }

    let drag = null;

    function clientToGp(clientX, clientY) {
        const rect = map.getContainer().getBoundingClientRect();
        const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
        return [lngToGpx(lngLat.lng), latToGpy(lngLat.lat)];
    }

    function attachPointerHandlers() {
        const onDown = (e) => {
            const t = selected();
            if (!t || !editMode || t.locked || !e.isPrimary) return;
            const handle = e.target?.dataset?.handle;
            const isFill = e.target === fillPoly;
            if (!handle && !isFill) return;
            e.preventDefault();
            e.stopPropagation();
            try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
            const [rawX, pgy] = clientToGp(e.clientX, e.clientY);
            const pgx = unwrapHorizontalNear(rawX, t.gx + t.w / 2);
            drag = {
                pointerId: e.pointerId,
                mode: handle ? "resize" : "move",
                handle,
                start: { gx: t.gx, gy: t.gy, w: t.w, h: t.h },
                pStart: { gx: pgx, gy: pgy }
            };
        };

        const onMove = (e) => {
            if (!drag || e.pointerId !== drag.pointerId) return;
            const t = selected();
            if (!t) return;
            e.preventDefault();
            e.stopPropagation();
            const [rawX, pgy] = clientToGp(e.clientX, e.clientY);
            const pgx = unwrapHorizontalNear(rawX, drag.pStart.gx);
            const dx = pgx - drag.pStart.gx;
            const dy = pgy - drag.pStart.gy;

            if (drag.mode === "move") {

                const nx = Math.round(drag.start.gx + dx);
                const ny = Math.round(drag.start.gy + dy);
                t.gx = wrapHorizontal(nx);
                t.gy = clamp(ny, 0, WORLD_PIXELS - t.h);
            } else {
                resizeFromHandle(t, drag, pgx, pgy, e.shiftKey);
            }
            t._analysis = null;
            if (drag.mode === "move") updateTemplateMoveCoordinates(t);
            queueTemplateRender(t);
            updateOverlay();
            renderPanelLight();
        };

        const onUp = (e) => {
            if (!drag || e.pointerId !== drag.pointerId) return;
            const wasMoving = !!selected();
            drag = null;
            storeSet();
            renderPanel();

            const t = selected();
            if (wasMoving && t && errorMode && t.visible) {
                const card = panelBody.querySelector(`[data-card="${t.id}"]`);
                if (card) refreshAnalysis(t, card);
                else { analyzeTemplate(t).then(() => updateTemplateTiles(t)).catch(() => {}); }
            }
        };

        svg.addEventListener("pointerdown", onDown);
        svg.addEventListener("pointermove", onMove, { passive: false });
        svg.addEventListener("pointerup", onUp);
        svg.addEventListener("pointercancel", onUp);
    }

    function resizeFromHandle(t, d, pgx, pgy, shiftKey) {
        const s = d.start;
        const def = HANDLES.find((h) => h.id === d.handle);
        let left = s.gx, top = s.gy, right = s.gx + s.w, bottom = s.gy + s.h;

        const movesX = def.fx ? "x" : null;
        const movesY = def.fy ? "y" : null;
        const edgeX = def.fx === "left" ? s.gx + s.w : s.gx;
        let pX = Math.round(unwrapHorizontalNear(pgx, edgeX)), pY = Math.round(pgy);

        if (movesX) {
            if (def.fx === "left") right = Math.max(left + 1, pX);
            else left = Math.min(right - 1, pX);
        }
        if (movesY) {
            if (def.fy === "top") bottom = Math.max(top + 1, pY);
            else top = Math.min(bottom - 1, pY);
        }

        let w = right - left, h = bottom - top;

        const ratio = s.w / s.h;
        if ((t.aspectLock || shiftKey) && def.corner) {
            if (w / h > ratio) w = Math.round(h * ratio);
            else h = Math.round(w / ratio);

            if (def.fx === "left") right = left + w; else left = right - w;
            if (def.fy === "top") bottom = top + h; else top = bottom - h;
        }

        t.gx = wrapHorizontal(Math.round(left));
        t.gy = clamp(Math.round(top), 0, WORLD_PIXELS - 1);
        t.w = Math.max(1, Math.round(right - left));
        t.h = Math.max(1, Math.round(bottom - top));
        const safe = safeWorkingSize(t.w, t.h);
        if (safe.scaled) { t.w = safe.w; t.h = safe.h; }
    }

    function attachDropHandlers() {
        const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
        const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
        let dropHint = null;
        let dragDepth = 0;
        const editorOpen = () => editor && !editor.classList.contains("rtpl-hidden");
        const showHint = () => {
            const text = editorOpen() ? "Drop image to load into the editor" : "Drop image to add as template";
            if (dropHint) { dropHint.textContent = text; return; }
            dropHint = document.createElement("div");
            dropHint.className = "rtpl-drophint";
            dropHint.textContent = text;
            document.body.appendChild(dropHint);
        };
        const hideHint = () => { dragDepth = 0; dropHint?.remove(); dropHint = null; };

        window.addEventListener("dragenter", (e) => {
            if (!hasFiles(e)) return;
            stop(e); dragDepth++; showHint();
        });
        window.addEventListener("dragover", (e) => {
            if (!hasFiles(e)) return;
            stop(e); e.dataTransfer.dropEffect = "copy";
        });
        window.addEventListener("dragleave", (e) => {
            if (!hasFiles(e)) return;
            dragDepth--;

            if (dragDepth <= 0 || e.relatedTarget === null) hideHint();
        });

        window.addEventListener("dragend", hideHint);
        window.addEventListener("blur", hideHint);
        document.addEventListener("mouseleave", () => { if (dropHint) hideHint(); });

        window.addEventListener("drop", async (e) => {
            const files = e.dataTransfer?.files;
            hideHint();
            if (!files || !files.length) return;
            stop(e);

            if (editorOpen()) {
                const img = [...files].find(isImageFile);
                try {
                    if (!img) throw new Error("Drop an image file to load it into the editor.");
                    const prepared = await prepareImageFile(img);
                    await editorSetSource(prepared.dataUrl, img.name.replace(/\.[^.]+$/, ""), null, prepared.img);
                    showToast(prepared.scaled ? `Loaded “${img.name}” at ${prepared.img.naturalWidth}×${prepared.img.naturalHeight}.` : `Loaded “${img.name}”.`, "success");
                } catch (err) { LOG("editor drop failed", err); showToast(importError(img, err), "error", 7000); }
                return;
            }
            if (!map) { setStatus("Map not ready yet — try again in a moment.", "error", 5000); return; }
            const rect = map.getContainer().getBoundingClientRect();
            let lngLat = null;
            if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
                lngLat = [ll.lng, ll.lat];
            }
            for (const f of files) await createTemplateFromFile(f, lngLat);
        });
    }

    let panel = null, panelBody = null, fab = null, statusMsg = "";
    let toastEl = null, toastTimer = null, toastId = 0, statusToastId = 0;

    function showToast(message, kind = "info", ms = 3500) {
        if (!toastEl) {
            toastEl = document.createElement("div");
            toastEl.className = "rtpl-toast";
            document.body.appendChild(toastEl);
        }
        const id = ++toastId;
        clearTimeout(toastTimer);
        toastEl.textContent = message;
        toastEl.className = "rtpl-toast rtpl-toast-" + kind + " rtpl-toast-on";
        if (ms > 0) toastTimer = setTimeout(() => { if (id === toastId) toastEl?.classList.remove("rtpl-toast-on"); }, ms);
        return id;
    }

    function hideToast(id) {
        if (id !== toastId) return;
        clearTimeout(toastTimer);
        toastEl?.classList.remove("rtpl-toast-on");
    }

    function setStatus(msg, kind = "info", ms = 3500) {
        statusMsg = msg || "";
        if (statusToastId) hideToast(statusToastId);
        statusToastId = statusMsg ? showToast(statusMsg, kind, ms) : 0;
    }

    function flashStatus(msg, ms = 2500, kind = "info") {
        statusMsg = msg || "";
        showToast(statusMsg, kind, ms);
    }

    function announceUpdate() {
        const previous = lastSeenVersion;
        lastSeenVersion = SCRIPT_VERSION;
        saveSettings();
        if (previous && previous !== SCRIPT_VERSION) showToast(`openplace Template Overlay updated to v${SCRIPT_VERSION}.`, "success", 5000);
    }

    function showWalkthrough(restart = false) {
        if (walkthroughSeen && !restart) return;
        document.querySelector(".rtpl-walk-root")?.remove();
        const steps = [
            { title: "Welcome to openplace Template Overlay", text: "This overlay keeps reference images on the map while you paint. It works independently from openplace, and its position, minimized state, and settings are remembered after a refresh." },
            { title: "Add an image", text: "Select Add image to open the editor. You can also drag and drop an image directly onto the map to start a template at that map location. If you have a pixel selected, importing through the editor uses that pixel as the image’s top-left corner." },
            { title: "Use the editor", text: "In the editor, import an image with the button, drag and drop an image onto the editor, or paste an image from your clipboard. Adjust its palette, resize it, rotate or flip it, then choose whether to add a new template or replace the source of the template you opened." },
            { title: "Move the interface", text: "Drag the overlay by its header to place it anywhere on screen. When it is minimized, hold Ctrl while dragging the small button on desktop; on touch devices, touch-drag it. Both positions are saved automatically." },
            { title: "Position and lock templates", text: "Templates are unlocked while you position them. Turn on Edit mode to drag them or use their handles to resize. Lock the template once it is aligned: locking prevents accidental edits and enables sharing, color counts, selected color mode, Error mode, and Easy Paint." },
            { title: "Share with a code", text: "Only locked templates can create a share code. Share the code with someone else; they choose Import code, enter it, review the larger preview, and import the same image at the same map location. Imported shared templates stay locked." },
            { title: "Settings and painting help", text: "Settings contains display options, map scaling, Performance mode, and backup export/import. Easy Paint only paints matching pixels, while Error mode shows progress. Refresh the page after painting before relying on Easy Paint or Error mode results." }
        ];
        let step = 0;
        const root = document.createElement("div");
        root.className = "rtpl-walk-root";
        Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "2147483647", display: "grid", placeItems: "center", padding: "16px", background: "rgba(0,0,0,.62)", color: "#eef3f8", font: "13px system-ui,sans-serif" });
        const box = document.createElement("div");
        Object.assign(box.style, { width: "min(440px,100%)", boxSizing: "border-box", padding: "22px", border: "1px solid #344150", borderRadius: "14px", background: "#10161c", boxShadow: "0 18px 48px #0009" });
        const finish = () => { walkthroughSeen = true; saveSettings(); root.remove(); };
        const render = () => {
            const current = steps[step];
            box.innerHTML = `<div style="color:#8fb8ff;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Step ${step + 1} of ${steps.length}</div><h2 style="margin:8px 0 10px;font-size:18px">${current.title}</h2><p style="margin:0;color:#c5cfda;line-height:1.55">${current.text}</p><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:22px"><button class="rtpl-walk-back" style="padding:7px 10px;border:1px solid #3a4757;border-radius:7px;background:transparent;color:#cbd6e2;cursor:pointer">${step ? "Back" : "Skip"}</button><button class="rtpl-walk-next" style="padding:7px 14px;border:1px solid #3a86ff;border-radius:7px;background:#3a86ff;color:#fff;cursor:pointer">${step === steps.length - 1 ? "Finish" : "Next"}</button></div>`;
            box.querySelector(".rtpl-walk-back").addEventListener("click", () => { if (!step) finish(); else { step--; render(); } });
            box.querySelector(".rtpl-walk-next").addEventListener("click", () => { if (step === steps.length - 1) finish(); else { step++; render(); } });
        };
        root.appendChild(box);
        document.body.appendChild(root);
        render();
    }

    function buildUI() {
        injectStyles();

        fab = document.createElement("button");
        fab.className = "rtpl-fab";
        fab.title = "Templates. Ctrl-drag to move; touch-drag on mobile.";
        fab.innerHTML = "🖼️";
        fab.addEventListener("click", () => {
            if (fab.dataset.dragged) { delete fab.dataset.dragged; return; }
            panelOpen = panel.classList.contains("rtpl-hidden");
            panel.classList.toggle("rtpl-hidden", !panelOpen);
            if (panelOpen) clampPanelIntoView();
            saveSettings();
        });
        document.body.appendChild(fab);
        if (fabPosition) { setFloatingPosition(fab, fabPosition); clampFabIntoView(); }
        makeFabDraggable();

        panel = document.createElement("div");
        panel.className = "rtpl-panel" + (panelOpen ? "" : " rtpl-hidden");
        panel.innerHTML = `
            <div class="rtpl-top">
                <div class="rtpl-head">
                    <span>Templates</span>
                    <div class="rtpl-head-actions"><button class="rtpl-help" title="Show walkthrough" aria-label="Show walkthrough">?</button><button class="rtpl-x" title="Close">✕</button></div>
                </div>
                <div class="rtpl-account" style="display:none"></div>
            </div>
            <div class="rtpl-actions rtpl-actions-row">
                <button class="rtpl-add rtpl-addimg">Add image</button>
                <button class="rtpl-add rtpl-openeditor">Image editor</button>
                <button class="rtpl-add rtpl-importcode">Import code</button>
                <input type="file" accept="image/*" multiple class="rtpl-file" hidden>
            </div>
            <div class="rtpl-actions rtpl-tp">
                <input type="text" class="rtpl-tp-input" placeholder="Jump to tX tY X Y">
                <div class="rtpl-tp-btns">
                    <button class="rtpl-toggle rtpl-tp-go" title="Go to coordinates">Go</button>
                    <button class="rtpl-toggle rtpl-tp-pick" title="Put the last selected map pixel coordinates in the jump field and copy them">Copy coordinates</button>
                </div>
            </div>
            <div class="rtpl-tpl">
                <div class="rtpl-tpl-head"><button class="rtpl-tpl-caret">▾</button> Templates</div>
                <div class="rtpl-tpl-body">
                    <div class="rtpl-hint">Drop an image anywhere to add it. Drag a template to move it, or use its handles to resize.</div>
                    <div class="rtpl-list"></div>
                </div>
            </div>
            <div class="rtpl-dl rtpl-dl-collapsed">
                <div class="rtpl-dl-head"><button class="rtpl-dl-caret">▸</button> Download map area</div>
                <div class="rtpl-dl-body">
                    <label class="rtpl-dlout"><input type="checkbox" class="rtpl-dl-outline" checked> Show selection outline</label>
                    <div class="rtpl-row3">
                        <button class="rtpl-toggle rtpl-pick1">Pick corner 1</button>
                        <button class="rtpl-toggle rtpl-pick2">Pick corner 2</button>
                    </div>
                    <div class="rtpl-row3">
                        <label class="rtpl-num">C1 tile X<input type="number" class="rtpl-c1tx"></label>
                        <label class="rtpl-num">C1 tile Y<input type="number" class="rtpl-c1ty"></label>
                        <label class="rtpl-num">C1 px X<input type="number" class="rtpl-c1px" min="1" max="1000"></label>
                        <label class="rtpl-num">C1 px Y<input type="number" class="rtpl-c1py" min="1" max="1000"></label>
                    </div>
                    <div class="rtpl-row3">
                        <label class="rtpl-num">C2 tile X<input type="number" class="rtpl-c2tx"></label>
                        <label class="rtpl-num">C2 tile Y<input type="number" class="rtpl-c2ty"></label>
                        <label class="rtpl-num">C2 px X<input type="number" class="rtpl-c2px" min="1" max="1000"></label>
                        <label class="rtpl-num">C2 px Y<input type="number" class="rtpl-c2py" min="1" max="1000"></label>
                    </div>
                    <button class="rtpl-add rtpl-dl-go">Download PNG</button>
                </div>
            </div>
            <div class="rtpl-settings rtpl-settings-collapsed">
                <div class="rtpl-settings-head"><button class="rtpl-settings-caret">▸</button> Settings</div>
                <div class="rtpl-globaltoggles">
                    <label title="Show the on-map box and drag handles used to move or resize templates."><input type="checkbox" class="rtpl-edit"> Edit mode</label>
                    <label title="At close map zoom levels, draw each locked template pixel as a small centered dot."><input type="checkbox" class="rtpl-g-shrink"> Small pixels</label>
                    <label title="Reduces automatic comparison work to help slower devices. Enabled by default on mobile."><input type="checkbox" class="rtpl-g-performance"> Performance mode</label>
                    <label title="Show only the most recently selected openplace palette color on locked templates."><input type="checkbox" class="rtpl-g-selectedcolor"> Selected color mode</label>
                    <label><input type="checkbox" class="rtpl-g-easy"> Easy paint <span class="rtpl-info" tabindex="0" title="Only paint pixels that match the template's colour here; everything else stays as-is. Already-correct pixels are skipped too. Refresh the page after painting to see the proper changes.">?</span></label>
                    <label title="For visible templates, show correct pixels in green, missing pixels in yellow, and wrong pixels in red."><input type="checkbox" class="rtpl-g-err"> Error mode</label>
                    <label><input type="checkbox" class="rtpl-g-hidedone"> Hide completed colors</label>
                    <div class="rtpl-g-cmrow">Outline:
                        <button class="rtpl-toggle rtpl-g-outline"></button>
                    </div>
                    <div class="rtpl-g-cmrow">Map resize sampling <select class="rtpl-g-scale"></select></div>
                    <div class="rtpl-g-cmrow">WASD pan step
                        <input type="number" class="rtpl-g-panstep" min="1" max="5000" step="10">
                        <span class="rtpl-muted">px / press</span>
                    </div>
                    <div class="rtpl-backup"><button class="rtpl-toggle rtpl-backup-export">Export backup</button><button class="rtpl-toggle rtpl-backup-import">Import backup</button><input type="file" accept="application/json,.json" class="rtpl-backup-file" hidden></div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        if (panelPosition) setFloatingPosition(panel, panelPosition);
        if (panelOpen) requestAnimationFrame(clampPanelIntoView);
        panelBody = panel.querySelector(".rtpl-list");
        accountBarEl = panel.querySelector(".rtpl-account");
        updateAccountBar();

        panel.querySelector(".rtpl-x").addEventListener("click", () => { panelOpen = false; panel.classList.add("rtpl-hidden"); saveSettings(); });
        panel.querySelector(".rtpl-help").addEventListener("click", () => showWalkthrough(true));

        const settings = panel.querySelector(".rtpl-settings");
        panel.querySelector(".rtpl-settings-head").addEventListener("click", () => {
            const collapsed = settings.classList.toggle("rtpl-settings-collapsed");
            panel.querySelector(".rtpl-settings-caret").textContent = collapsed ? "▸" : "▾";
        });

        const tplSec = panel.querySelector(".rtpl-tpl");
        panel.querySelector(".rtpl-tpl-head").addEventListener("click", () => {
            const collapsed = tplSec.classList.toggle("rtpl-tpl-collapsed");
            panel.querySelector(".rtpl-tpl-caret").textContent = collapsed ? "▸" : "▾";
        });
        const fileInput = panel.querySelector(".rtpl-file");
        panel.querySelector(".rtpl-addimg").addEventListener("click", () => fileInput.click());
        panel.querySelector(".rtpl-openeditor").addEventListener("click", () => openEditor());
        panel.querySelector(".rtpl-importcode").addEventListener("click", showImportShareDialog);
        const backupInput = panel.querySelector(".rtpl-backup-file");
        panel.querySelector(".rtpl-backup-export").addEventListener("click", downloadBackup);
        panel.querySelector(".rtpl-backup-import").addEventListener("click", () => backupInput.click());
        backupInput.addEventListener("change", async () => {
            const file = backupInput.files[0];
            if (file) {
                try { await importBackup(file); }
                catch (e) { showToast(e?.message || "Could not import that backup.", "error", 7000); }
            }
            backupInput.value = "";
        });

        const tpInput = panel.querySelector(".rtpl-tp-input");
        const doTeleport = () => { if (teleportTo(tpInput.value)) tpInput.blur(); };
        panel.querySelector(".rtpl-tp-go").addEventListener("click", doTeleport);
        tpInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doTeleport(); } });

        panel.querySelector(".rtpl-tp-pick").addEventListener("click", async () => {
            if (!lastPixel) { flashStatus("Click a pixel on the map first.", 3500, "error"); return; }
            const { tx, ty, px, py } = gpToTilePixel(lastPixel.gx, lastPixel.gy);
            const s = coordString(tx, ty, px, py);
            tpInput.value = s;
            const ok = await copyToClipboard(s);
            flashStatus(ok ? `Copied: ${s}` : s);
        });
        fileInput.addEventListener("change", async (e) => {
            const placement = lastPixel ? [gpxToLng(lastPixel.gx), gpyToLat(lastPixel.gy)] : null;
            for (const f of e.target.files) await createTemplateFromFile(f, placement);
            fileInput.value = "";
        });

        const editCb = panel.querySelector(".rtpl-edit");
        const shrinkCb = panel.querySelector(".rtpl-g-shrink");
        const performanceCb = panel.querySelector(".rtpl-g-performance");
        const selectedColorCb = panel.querySelector(".rtpl-g-selectedcolor");
        const easyCb = panel.querySelector(".rtpl-g-easy");
        const errCb = panel.querySelector(".rtpl-g-err");
        const hideDoneCb = panel.querySelector(".rtpl-g-hidedone");
        const outlineBtn = panel.querySelector(".rtpl-g-outline");
        editCb.checked = editMode;
        shrinkCb.checked = gShrink;
        performanceCb.checked = performanceMode;
        selectedColorCb.checked = gSelectedColorMode;
        easyCb.checked = gEasyPaint;
        errCb.checked = errorMode;
        hideDoneCb.checked = gHideCompleted;
        const setOutlineLabel = () => { outlineBtn.textContent = `${OUTLINE_LABELS[gOutlineMode]}`; };
        setOutlineLabel();

        editCb.addEventListener("change", (e) => {
            editMode = e.target.checked; updateOverlay(); saveSettings();
        });
        shrinkCb.addEventListener("change", async (e) => {
            gShrink = e.target.checked; saveSettings();
            await applyGlobalDisplayChange();
        });
        performanceCb.addEventListener("change", (e) => {
            performanceMode = e.target.checked;
            saveSettings();
            if (!performanceMode) autoAnalyzeTick();
            showToast(performanceMode ? "Performance mode enabled." : "Performance mode disabled.", "success");
        });
        selectedColorCb.addEventListener("change", async (e) => {
            if (e.target.checked && selectedPaintColor == null) {
                e.target.checked = false;
                showToast("Select a color in the openplace palette first.", "info");
                return;
            }
            gSelectedColorMode = e.target.checked;
            saveSettings();
            await applyGlobalDisplayChange();
        });
        easyCb.addEventListener("change", (e) => {
            gEasyPaint = e.target.checked; saveSettings();
            if (gEasyPaint) autoAnalyzeTick();
        });
        errCb.addEventListener("change", (e) => setErrorMode(e.target.checked));
        hideDoneCb.addEventListener("change", (e) => {
            gHideCompleted = e.target.checked; saveSettings();

            for (const t of templates) applyAnalysisToCard(t, cardOf(t));
        });
        outlineBtn.addEventListener("click", async () => {
            gOutlineMode = OUTLINE_MODES[(OUTLINE_MODES.indexOf(gOutlineMode) + 1) % OUTLINE_MODES.length];
            setOutlineLabel(); saveSettings();
            await applyGlobalDisplayChange();
        });
        const mapScale = panel.querySelector(".rtpl-g-scale");
        mapScale.innerHTML = SCALE_ALGORITHMS.map(([v, label]) => `<option value="${v}">${label}</option>`).join("");
        mapScale.value = gMapScaleAlgorithm;
        mapScale.addEventListener("change", async () => {
            gMapScaleAlgorithm = mapScale.value; saveSettings();
            for (const t of templates) resetTemplateCaches(t);
            showToast(`Map resize sampling: ${mapScale.selectedOptions[0].textContent}`, "success");
            await applyGlobalDisplayChange();
        });
        const panstepIn = panel.querySelector(".rtpl-g-panstep");
        panstepIn.value = gPanStep;
        panstepIn.addEventListener("change", (e) => {
            const v = parseInt(e.target.value);
            if (v > 0) { gPanStep = clamp(v, 1, 5000); panstepIn.value = gPanStep; saveSettings(); }
            else panstepIn.value = gPanStep;
        });

        wireDownloadTool();
        makeDraggable(panel, panel.querySelector(".rtpl-head"), () => { clampPanelIntoView(); panelPosition = floatingPosition(panel); saveSettings(); });
        let viewportClampQueued = false;
        window.addEventListener("resize", () => {
            if (viewportClampQueued) return;
            viewportClampQueued = true;
            requestAnimationFrame(() => {
                viewportClampQueued = false;
                clampFabIntoView();
                if (!panel.classList.contains("rtpl-hidden")) clampPanelIntoView();
            });
        });
    }

    async function applyGlobalDisplayChange() {
        for (const t of templates) await updateTemplateTiles(t);
    }

    async function setErrorMode(on) {
        errorMode = on; saveSettings();
        if (on) {
            const pending = templates.filter((t) => t.visible && !t._analysis);
            for (let index = 0; index < pending.length; index++) {
                setStatus(`Comparing template ${index + 1} of ${pending.length}…`, "progress", 0);
                try { await analyzeTemplate(pending[index]); } catch (e) { LOG("analysis failed", e); }
            }
            if (pending.length) setStatus(`Compared ${pending.length} template${pending.length === 1 ? "" : "s"}.`, "success", 2500);
        }
        for (const t of templates) await updateTemplateTiles(t);
        renderPanel();
    }

    let pickMode = 0;

    function dlSetCorner(n, gx, gy) {
        const { tx, ty, px, py } = gpToTilePixel(gx, gy);
        panel.querySelector(`.rtpl-c${n}tx`).value = tx;
        panel.querySelector(`.rtpl-c${n}ty`).value = ty;
        panel.querySelector(`.rtpl-c${n}px`).value = px;
        panel.querySelector(`.rtpl-c${n}py`).value = py;
        refreshDlOutline();
    }

    function dlReadCorner(n) {
        const v = (cls) => parseInt(panel.querySelector(`.rtpl-c${n}${cls}`).value);
        const tx = v("tx"), ty = v("ty"), px = v("px"), py = v("py");
        if ([tx, ty, px, py].some((x) => Number.isNaN(x))) return null;
        return [clamp(tx, 0, TILE_COUNT - 1) * TILE_SIZE + clamp(px, 1, TILE_SIZE) - 1, clamp(ty, 0, TILE_COUNT - 1) * TILE_SIZE + clamp(py, 1, TILE_SIZE) - 1];
    }

    function refreshDlOutline() {
        dlC1 = dlReadCorner(1);
        dlC2 = dlReadCorner(2);
        updateOverlay();
    }

    let downloadToastId = 0;
    const dlStatus = (m, kind = "info", ms = 3500) => {
        if (downloadToastId) hideToast(downloadToastId);
        downloadToastId = m ? showToast(m, kind, ms) : 0;
    };

    function wireDownloadTool() {
        const setPick = (n) => {
            pickMode = pickMode === n ? 0 : n;
            panel.querySelector(".rtpl-pick1").classList.toggle("rtpl-active", pickMode === 1);
            panel.querySelector(".rtpl-pick2").classList.toggle("rtpl-active", pickMode === 2);
            dlStatus(pickMode ? `Click a pixel on the map to set corner ${pickMode}.` : "");
        };
        panel.querySelector(".rtpl-pick1").addEventListener("click", () => setPick(1));
        panel.querySelector(".rtpl-pick2").addEventListener("click", () => setPick(2));
        panel.querySelector(".rtpl-dl-go").addEventListener("click", downloadArea);

        for (const cls of ["c1tx", "c1ty", "c1px", "c1py", "c2tx", "c2ty", "c2px", "c2py"]) {
            panel.querySelector(`.rtpl-${cls}`).addEventListener("input", refreshDlOutline);
        }
        const outlineCb = panel.querySelector(".rtpl-dl-outline");
        outlineCb.checked = dlOutline;
        outlineCb.addEventListener("change", (e) => { dlOutline = e.target.checked; saveSettings(); updateOverlay(); });

        const dl = panel.querySelector(".rtpl-dl");
        panel.querySelector(".rtpl-dl-head").addEventListener("click", () => {
            const collapsed = dl.classList.toggle("rtpl-dl-collapsed");
            panel.querySelector(".rtpl-dl-caret").textContent = collapsed ? "▸" : "▾";
        });
    }

    function attachPickHandler() {
        map.on("click", (e) => {
            const gx = Math.floor(lngToGpx(e.lngLat.lng));
            const gy = Math.floor(latToGpy(e.lngLat.lat));

            lastPixel = { gx, gy };
            if (!pickMode) return;
            dlSetCorner(pickMode, gx, gy);
            dlStatus(`Corner ${pickMode} set to tile ${Math.floor(gx / TILE_SIZE)},${Math.floor(gy / TILE_SIZE)}.`);
            pickMode = 0;
            panel.querySelector(".rtpl-pick1").classList.remove("rtpl-active");
            panel.querySelector(".rtpl-pick2").classList.remove("rtpl-active");
        });
    }

    const keyboardPanKeys = new Set();
    const keyboardPanCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
    let keyboardPanFrame = 0, keyboardPanAt = 0;

    function keyboardPanBlocked() {
        if (!map || (editor && !editor.classList.contains("rtpl-hidden"))) return true;
        const el = document.activeElement;
        return !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
    }

    function stopKeyboardPan() {
        keyboardPanKeys.clear();
        if (keyboardPanFrame) cancelAnimationFrame(keyboardPanFrame);
        keyboardPanFrame = 0;
        keyboardPanAt = 0;
    }

    function runKeyboardPan(now) {
        if (!keyboardPanKeys.size || keyboardPanBlocked()) { stopKeyboardPan(); return; }
        const elapsed = Math.min(50, now - keyboardPanAt || 16.67);
        keyboardPanAt = now;
        const dx = (keyboardPanKeys.has("KeyD") || keyboardPanKeys.has("ArrowRight") ? 1 : 0) - (keyboardPanKeys.has("KeyA") || keyboardPanKeys.has("ArrowLeft") ? 1 : 0);
        const dy = (keyboardPanKeys.has("KeyS") || keyboardPanKeys.has("ArrowDown") ? 1 : 0) - (keyboardPanKeys.has("KeyW") || keyboardPanKeys.has("ArrowUp") ? 1 : 0);
        const length = Math.hypot(dx, dy);
        if (length) {
            const distance = gPanStep * 30 * elapsed / 1000;
            map.panBy([dx / length * distance, dy / length * distance], { duration: 0 });
        }
        keyboardPanFrame = requestAnimationFrame(runKeyboardPan);
    }

    function attachKeyboardPan() {
        window.addEventListener("keydown", (e) => {
            if (!keyboardPanCodes.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || keyboardPanBlocked()) return;
            e.preventDefault();
            e.stopPropagation();
            keyboardPanKeys.add(e.code);
            if (!keyboardPanFrame) { keyboardPanAt = performance.now(); keyboardPanFrame = requestAnimationFrame(runKeyboardPan); }
        }, true);
        window.addEventListener("keyup", (e) => {
            if (!keyboardPanCodes.has(e.code)) return;
            keyboardPanKeys.delete(e.code);
            if (!keyboardPanKeys.size) stopKeyboardPan();
        }, true);
        window.addEventListener("blur", stopKeyboardPan);
    }
    async function downloadArea() {
        const c1 = dlReadCorner(1), c2 = dlReadCorner(2);
        if (!c1 || !c2) { dlStatus("Enter or pick both corners first.", "error", 5000); return; }
        const minX = Math.min(c1[0], c2[0]), minY = Math.min(c1[1], c2[1]);
        const maxX = Math.max(c1[0], c2[0]), maxY = Math.max(c1[1], c2[1]);
        const w = maxX - minX + 1, h = maxY - minY + 1;
        if (w <= 0 || h <= 0) { dlStatus("Invalid area.", "error", 5000); return; }
        if (w > MAX_DL_DIM || h > MAX_DL_DIM) { dlStatus(`Area too big — max ${MAX_DL_DIM}px per side (this is ${w}×${h}).`); return; }
        if (w * h > MAX_DL_PIXELS) { dlStatus(`Area too large — max ${Math.round(MAX_DL_PIXELS / 1e6)}M pixels.`); return; }

        dlStatus(`Downloading ${w}×${h}px…`);
        try {
            const { canvas } = await compositeRegion(minX, minY, w, h);
            const blobUrl = canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.href = blobUrl;
            const { tx: a1x, ty: a1y, px: p1x, py: p1y } = gpToTilePixel(minX, minY);
            a.download = `openplace_area_${a1x}-${a1y}-${p1x}-${p1y}_${w}x${h}.png`;
            a.click();
            dlStatus(`Saved ${w}×${h}px.`);
        } catch (e) {
            LOG("download failed", e);
            dlStatus("Download failed. Tiles may be cross-origin without CORS.", "error", 7000);
        }
    }

    async function compositeRegion(gx, gy, w, h) {
        const out = document.createElement("canvas");
        out.width = w; out.height = h;
        const octx = out.getContext("2d", { willReadFrequently: true });
        octx.imageSmoothingEnabled = false;

        const base = getBackendBase();

        const bust = Date.now();
        const tx0 = Math.floor(gx / TILE_SIZE), tx1 = Math.floor((gx + w - 1) / TILE_SIZE);
        const ty0 = Math.floor(gy / TILE_SIZE), ty1 = Math.floor((gy + h - 1) / TILE_SIZE);

        for (let ty = ty0; ty <= ty1; ty++) {
            for (let tx = tx0; tx <= tx1; tx++) {
                const wx = ((tx % TILE_COUNT) + TILE_COUNT) % TILE_COUNT;
                const wy = ((ty % TILE_COUNT) + TILE_COUNT) % TILE_COUNT;
                const url = `${base}/files/s0/tiles/${wx}/${wy}.png?_=${bust}`;
                let bmp = null;
                try {
                    const res = await fetch(url, { credentials: "include", cache: "no-store" });
                    if (res.ok) bmp = await createImageBitmap(await res.blob());
                } catch (e) {  }
                if (!bmp) continue;
                const tileLeft = tx * TILE_SIZE, tileTop = ty * TILE_SIZE;
                const ix0 = Math.max(gx, tileLeft), iy0 = Math.max(gy, tileTop);
                const ix1 = Math.min(gx + w, tileLeft + TILE_SIZE), iy1 = Math.min(gy + h, tileTop + TILE_SIZE);
                const sw = ix1 - ix0, sh = iy1 - iy0;
                if (sw <= 0 || sh <= 0) continue;
                octx.drawImage(bmp, ix0 - tileLeft, iy0 - tileTop, sw, sh, ix0 - gx, iy0 - gy, sw, sh);
            }
        }
        return { canvas: out, ctx: octx };
    }

    function renderPanelLight() {
        const t = selected();
        if (!t || !panelBody) return;
        const card = panelBody.querySelector(`[data-card="${t.id}"]`);
        if (!card) return;
        const dim = card.querySelector(".rtpl-dim");
        if (dim) {
            const { tx, ty, px, py } = gpToTilePixel(t.gx, t.gy);
            dim.textContent = `${t.w}×${t.h}px · tile ${tx},${ty} px ${px},${py}`;
        }
    }

    function attachReorder(card, handle) {
        if (!handle) return;
        handle.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            try { handle.setPointerCapture(e.pointerId); } catch (_) {}
            card.classList.add("rtpl-dragging");
            const onMove = (ev) => {
                const others = [...panelBody.querySelectorAll(".rtpl-card:not(.rtpl-dragging)")];
                let placed = false;
                for (const s of others) {
                    const r = s.getBoundingClientRect();
                    if (ev.clientY < r.top + r.height / 2) { panelBody.insertBefore(card, s); placed = true; break; }
                }
                if (!placed) panelBody.appendChild(card);
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                window.removeEventListener("pointercancel", onUp);
                card.classList.remove("rtpl-dragging");
                commitReorderFromDom();
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onUp);
        });
    }

    function commitReorderFromDom() {
        if (!panelBody) return;
        const order = [...panelBody.querySelectorAll(".rtpl-card")].map((c) => Number(c.dataset.card));
        templates.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        storeSet();
        renderPanel();
        restackTemplates();
        updateOverlay();
    }

    function renderPanel() {
        if (!panelBody) return;
        panelBody.innerHTML = "";
        if (!templates.length) {
            panelBody.innerHTML = `<div class="rtpl-empty">No templates yet.</div>`;
            return;
        }
        for (const t of templates) {
            const card = document.createElement("div");
            card.className = "rtpl-card" + (t.id === selectedId ? " rtpl-sel" : "") + (t.collapsed ? " rtpl-collapsed" : "");
            card.dataset.card = t.id;
            const { tx, ty, px, py } = gpToTilePixel(t.gx, t.gy);
            card.innerHTML = `
                <div class="rtpl-row1">
                    <span class="rtpl-drag" title="Drag to reorder — top of the list is painted on top of overlaps">⠿</span>
                    <button class="rtpl-caret" title="Minimize / expand">${t.collapsed ? "▸" : "▾"}</button>
                    <input type="checkbox" class="rtpl-vischk" ${t.visible ? "checked" : ""} title="Show / hide">
                    <img class="rtpl-thumb" alt="">
                    <div class="rtpl-meta">
                        <input class="rtpl-name" value="${escapeHtml(t.name)}">
                        <div class="rtpl-dim">${t.w}×${t.h}px · tile ${tx},${ty} px ${px},${py}</div>
                    </div>
                    ${t.locked ? "" : `<button class="rtpl-icon rtpl-edit-img" title="Edit / dither image">✏️</button>`}
                    <button class="rtpl-icon rtpl-go" title="Go to template">📍</button>
                    <button class="rtpl-icon rtpl-del" title="Delete">🗑️</button>
                </div>
                <div class="rtpl-row2">
                    <label class="rtpl-op">Opacity
                        <input type="range" class="rtpl-opacity" min="0" max="1" step="0.05" value="${t.opacity}">
                    </label>
                </div>
                <div class="rtpl-collapsible">
                    <div class="rtpl-row3">
                        <button class="rtpl-toggle rtpl-lock">${t.locked ? "Unlock" : "Lock"}</button>
                        ${t.locked ? `<button class="rtpl-toggle rtpl-share">Share code</button>` : `
                        <button class="rtpl-toggle rtpl-ar">${t.aspectLock ? "Ratio" : "Free resize"}</button>
                        <button class="rtpl-toggle rtpl-one">1:1 size</button>
                        `}
                    </div>${t.locked ? "" : `
                    <div class="rtpl-row3">
                        <label class="rtpl-num">X tile<input type="number" class="rtpl-tx" value="${tx}"></label>
                        <label class="rtpl-num">Y tile<input type="number" class="rtpl-ty" value="${ty}"></label>
                    </div>
                    <div class="rtpl-row3">
                        <label class="rtpl-num">X px<input type="number" class="rtpl-px" min="1" max="1000" value="${px}"></label>
                        <label class="rtpl-num">Y px<input type="number" class="rtpl-py" min="1" max="1000" value="${py}"></label>
                    </div>
                    <div class="rtpl-row3">
                        <button class="rtpl-toggle rtpl-usepixel" title="Place this template's top-left at the last pixel you clicked on the map">Use selected pixel</button>
                    </div>
                    `}
                    <div class="rtpl-colors"></div>
                </div>
            `;

            card.addEventListener("pointerdown", (e) => {
                if (e.target.closest("input,button,select,.rtpl-dim,.rtpl-drag")) return;
                selectedId = t.id; renderPanel(); updateOverlay();
            });

            attachReorder(card, card.querySelector(".rtpl-drag"));

            card.querySelector(".rtpl-caret").addEventListener("click", () => {
                t.collapsed = !t.collapsed;
                card.classList.toggle("rtpl-collapsed", t.collapsed);
                card.querySelector(".rtpl-caret").textContent = t.collapsed ? "▸" : "▾";
                storeSet();
                if (!t.collapsed && t.locked) refreshAnalysis(t, card);
            });
            card.querySelector(".rtpl-go").addEventListener("click", () => goToTemplate(t));
            card.querySelector(".rtpl-share")?.addEventListener("click", () => shareTemplate(t));

            for (const sel of [".rtpl-dim"]) {
                const el = card.querySelector(sel);
                if (!el) continue;
                el.title = "Click to copy coordinates";
                el.addEventListener("click", (e) => { e.stopPropagation(); copyTemplateCoords(t); });
            }
            card.querySelector(".rtpl-edit-img")?.addEventListener("click", () => {
                openEditor();
                editorSetSource(t.dataUrl, t.name, t.id);
            });
            card.querySelector(".rtpl-name").addEventListener("change", (e) => {
                t.name = e.target.value; storeSet();
            });
            card.querySelector(".rtpl-del").addEventListener("click", () => {
                if (confirm(`Delete template "${t.name}"? This cannot be undone.`)) deleteTemplate(t.id);
            });
            card.querySelector(".rtpl-opacity").addEventListener("input", (e) => {
                t.opacity = parseFloat(e.target.value);
                setTemplateOpacity(t);
                storeSet();
            });
            card.querySelector(".rtpl-vischk").addEventListener("change", (e) => {
                t.visible = e.target.checked;
                setTemplateOpacity(t);
                storeSet();
            });
            card.querySelector(".rtpl-lock").addEventListener("click", async () => {
                t.locked = !t.locked;
                await updateTemplateTiles(t);

                renderPanel(); updateOverlay(); storeSet();
                if (t.locked && !t.collapsed) {
                    const c = cardOf(t);
                    if (c) refreshAnalysis(t, c);
                }
            });

            card.querySelector(".rtpl-ar")?.addEventListener("click", (e) => {
                t.aspectLock = !t.aspectLock;
                e.target.textContent = t.aspectLock ? "Ratio" : "Free resize";
                storeSet();
            });
            card.querySelector(".rtpl-one")?.addEventListener("click", async () => {
                const safe = safeWorkingSize(t.naturalW, t.naturalH);
                t.w = safe.w; t.h = safe.h;
                if (safe.scaled) showToast(`1:1 is limited to ${safe.w}×${safe.h} for browser safety.`, "info");
                markGeometryChanged(t);
                await updateTemplateTiles(t); updateOverlay(); renderPanel(); storeSet();
            });

            if (!t.locked) {
                const applyPos = async () => {
                    const ntx = clamp(parseInt(card.querySelector(".rtpl-tx").value) || 0, 0, TILE_COUNT - 1);
                    const nty = clamp(parseInt(card.querySelector(".rtpl-ty").value) || 0, 0, TILE_COUNT - 1);
                    const npx = clamp(parseInt(card.querySelector(".rtpl-px").value) || 1, 1, TILE_SIZE);
                    const npy = clamp(parseInt(card.querySelector(".rtpl-py").value) || 1, 1, TILE_SIZE);
                    t.gx = wrapHorizontal(ntx * TILE_SIZE + npx - 1);
                    t.gy = clamp(nty * TILE_SIZE + npy - 1, 0, WORLD_PIXELS - t.h);
                    markGeometryChanged(t);
                    await updateTemplateTiles(t); updateOverlay(); storeSet();
                };
                for (const sel of [".rtpl-tx", ".rtpl-ty", ".rtpl-px", ".rtpl-py"]) {
                    card.querySelector(sel).addEventListener("change", applyPos);
                }
                card.querySelector(".rtpl-usepixel").addEventListener("click", async () => {
                    if (!lastPixel) { flashStatus("Click a pixel on the map first, then use this.", 3500, "error"); return; }
                    t.gx = wrapHorizontal(lastPixel.gx);
                    t.gy = clamp(lastPixel.gy, 0, WORLD_PIXELS - t.h);
                    markGeometryChanged(t);
                    await updateTemplateTiles(t); updateOverlay(); renderPanel(); storeSet();
                });
            }

            panelBody.appendChild(card);
            queueOverlayPreview(t, card.querySelector(".rtpl-thumb"));
            renderColorList(t, card);
        }
    }

    async function refreshAnalysis(t, card) {
        const box = card?.querySelector(".rtpl-colors");
        const totalsEl = box?.querySelector(".rtpl-totals");
        if (totalsEl) totalsEl.textContent = "Reading canvas…";
        try {
            await analyzeTemplate(t);
        } catch (e) {
            LOG("analysis failed", e);
            if (totalsEl) totalsEl.textContent = "Analysis failed (see console).";
            return;
        }
        await updateTemplateTiles(t);
        if (card) renderColorList(t, card);
    }

    function markGeometryChanged(t) {
        t._analysis = null;
        queueColorUsage(t);
        if (errorMode && t.visible && t.w * t.h <= AUTO_MAX_PIXELS) {
            analyzeTemplate(t)
                .then(() => { updateTemplateTiles(t); applyAnalysisToCard(t, cardOf(t)); })
                .catch(() => {});
        }
    }

    const AUTO_INTERVAL = 15_000;
    const AUTO_MAX_PIXELS = 6_000_000;
    let autoRunning = false;

    const cardOf = (t) => panelBody?.querySelector(`[data-card="${t.id}"]`) || null;
    function needsAnalysis(t) {
        if (t.w * t.h > AUTO_MAX_PIXELS) return false;
        if (performanceMode && !gEasyPaint && !errorMode) return false;
        if (errorMode && t.visible) return true;

        if (gEasyPaint && t.visible) return true;
        const panelOpen = panel && !panel.classList.contains("rtpl-hidden");
        return !!(panelOpen && t.locked && !t.collapsed);
    }

    async function autoAnalyzeTick() {
        if (autoRunning || !map || document.hidden) return;
        const actives = templates.filter(needsAnalysis);
        if (!actives.length) return;
        autoRunning = true;
        try {
            for (const t of actives) {
                try { await analyzeTemplate(t); } catch (e) { continue; }
                if (errorMode && t.visible) await updateTemplateTiles(t);
                applyAnalysisToCard(t, cardOf(t));
            }
        } finally {
            autoRunning = false;
        }
    }

    const totalsHtmlFor = (t) => {
        const tot = t._analysis?.totals;
        return tot
            ? `<span class="rtpl-tg">✅ ${tot.correct}</span><span class="rtpl-ty">🟨 ${tot.missing}</span><span class="rtpl-tr">🟥 ${tot.wrong}</span><span class="rtpl-tt">Σ ${tot.total}</span>`
            : `<span class="rtpl-muted">Comparing…</span>`;
    };

    function applyAnalysisToCard(t, card) {
        const box = card?.querySelector(".rtpl-colors");
        if (!box || box.style.display === "none") return;
        const a = t._analysis;
        const totalsEl = box.querySelector(".rtpl-totals");
        if (totalsEl) totalsEl.innerHTML = totalsHtmlFor(t);
        for (const row of box.querySelectorAll(".rtpl-cl-row")) {
            const idx = Number(row.dataset.ci);
            const total = Number(row.dataset.total);
            const pc = a ? a.perColor.get(idx) : null;
            const remaining = pc ? (pc.total - pc.correct) : total;
            const cc = row.querySelector(".rtpl-cc");
            if (cc) cc.innerHTML = `${remaining}<span class="rtpl-muted">/${total}</span>`;

            row.style.display = (gHideCompleted && pc && remaining === 0) ? "none" : "";
        }
    }

    function sortUsage(usage, a) {
        const arr = usage.slice();
        const remaining = (u) => { const pc = a?.perColor.get(u.index); return pc ? (pc.total - pc.correct) : u.count; };
        switch (gColorSort) {
            case "id": arr.sort((x, y) => x.index - y.index); break;
            case "name": arr.sort((x, y) => x.name.localeCompare(y.name)); break;
            case "countAsc": arr.sort((x, y) => x.count - y.count); break;
            case "missing": arr.sort((x, y) => remaining(y) - remaining(x) || y.count - x.count); break;
            case "missingAsc": arr.sort((x, y) => remaining(x) - remaining(y) || x.count - y.count); break;
            case "count": default: arr.sort((x, y) => y.count - x.count); break;
        }
        return arr;
    }

    async function renderColorList(t, card) {
        const box = card.querySelector(".rtpl-colors");
        if (!box) return;
        if (!t.locked) { box.innerHTML = ""; box.style.display = "none"; return; }
        box.style.display = "block";

        box.innerHTML = `
            <div class="rtpl-totals">${totalsHtmlFor(t)}</div>
            <div class="rtpl-cl-head">Colors — left to place / total (uncheck to hide)</div>
            <div class="rtpl-cl-sortrow">Sort:
                <select class="rtpl-cl-sort">
                    <option value="count">Total (high→low)</option>
                    <option value="countAsc">Total (low→high)</option>
                    <option value="missing">Left to place (high→low)</option>
                    <option value="missingAsc">Left to place (low→high)</option>
                    <option value="id">Color ID</option>
                    <option value="name">Name</option>
                </select>
            </div>
            <div class="rtpl-cl-actions">
                <button class="rtpl-cl-all">Enable all</button>
                <button class="rtpl-cl-none">Disable all</button>
            </div>
            <div class="rtpl-cl-list">Analyzing…</div>`;

        const a = t._analysis;
        const usage = sortUsage(await computeColorUsage(t), a);
        const disabled = new Set(t.disabled || []);
        const list = box.querySelector(".rtpl-cl-list");

        const sortSel = box.querySelector(".rtpl-cl-sort");
        sortSel.value = gColorSort;
        sortSel.addEventListener("change", (e) => {
            gColorSort = e.target.value; saveSettings();
            renderColorList(t, card);
        });

        if (!usage.length) { list.textContent = "No opaque pixels."; return; }
        list.innerHTML = "";
        for (const u of usage) {
            const row = document.createElement("label");
            row.className = "rtpl-cl-row";
            row.dataset.ci = u.index;
            row.dataset.total = u.count;
            const rgb = `rgb(${u.rgb[0]},${u.rgb[1]},${u.rgb[2]})`;
            const pc = a?.perColor.get(u.index);
            const remaining = pc ? (pc.total - pc.correct) : u.count;
            if (gHideCompleted && pc && remaining === 0) row.style.display = "none";
            row.innerHTML = `
                <input type="checkbox" ${disabled.has(u.index) ? "" : "checked"}>
                <span class="rtpl-sw" style="background:${rgb}"></span>
                <span class="rtpl-cn">#${u.index} ${escapeHtml(u.name)}</span>
                <span class="rtpl-cc">${remaining}<span class="rtpl-muted">/${u.count}</span></span>`;

            row.querySelector("input").addEventListener("change", async (e) => {
                t.disabled = t.disabled || [];
                if (e.target.checked) t.disabled = t.disabled.filter((x) => x !== u.index);
                else if (!t.disabled.includes(u.index)) t.disabled.push(u.index);
                t._analysis = null;
                await updateTemplateTiles(t);
                storeSet();
                applyAnalysisToCard(t, card);
                autoAnalyzeTick();
            });
            list.appendChild(row);
        }

        const setAll = async (disableAll) => {
            t.disabled = disableAll ? usage.map((u) => u.index) : [];

            for (const cb of list.querySelectorAll(".rtpl-cl-row input")) cb.checked = !disableAll;
            t._analysis = null;
            await updateTemplateTiles(t);
            storeSet();
            applyAnalysisToCard(t, card);
            autoAnalyzeTick();
        };
        box.querySelector(".rtpl-cl-all").addEventListener("click", () => setAll(false));
        box.querySelector(".rtpl-cl-none").addEventListener("click", () => setAll(true));

    }

    const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    function setFloatingPosition(el, position) {
        el.style.left = `${Math.round(position.left)}px`;
        el.style.top = `${Math.round(position.top)}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
    }

    function floatingPosition(el) {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top };
    }

    function clampFloatingElement(el) {
        const r = el.getBoundingClientRect();
        const left = Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth - r.width));
        const top = Math.min(Math.max(0, r.top), Math.max(0, window.innerHeight - r.height));
        setFloatingPosition(el, { left, top });
    }

    function makeDraggable(el, handle, onEnd = null) {
        let sx, sy, ox, oy, dragging = false;
        handle.style.cursor = "move";
        handle.style.touchAction = "none";
        handle.addEventListener("pointerdown", (e) => {
            if (e.target.closest("button")) return;
            dragging = true;
            const r = el.getBoundingClientRect();
            ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
            setFloatingPosition(el, { left: ox, top: oy });
            try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        });
        handle.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            e.preventDefault();
            setFloatingPosition(el, { left: ox + e.clientX - sx, top: oy + e.clientY - sy });
        });
        const end = () => {
            if (!dragging) return;
            dragging = false;
            onEnd?.();
        };
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
    }

    function makeFabDraggable() {
        let sx, sy, ox, oy, dragging = false, moved = false;
        fab.style.touchAction = "none";
        fab.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || (e.pointerType === "mouse" && !e.ctrlKey)) return;
            const r = fab.getBoundingClientRect();
            sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
            dragging = true; moved = false;
            setFloatingPosition(fab, { left: ox, top: oy });
            try { fab.setPointerCapture(e.pointerId); } catch (_) {}
        });
        fab.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
            if (!moved) return;
            e.preventDefault();
            setFloatingPosition(fab, { left: ox + dx, top: oy + dy });
        });
        const end = () => {
            if (!dragging) return;
            dragging = false;
            if (!moved) return;
            clampFloatingElement(fab);
            fabPosition = floatingPosition(fab);
            fab.dataset.dragged = "1";
            saveSettings();
        };
        fab.addEventListener("pointerup", end);
        fab.addEventListener("pointercancel", end);
    }

    function clampPanelIntoView() {
        if (panel) clampFloatingElement(panel);
    }

    function clampFabIntoView() {
        if (fab) clampFloatingElement(fab);
    }
    function injectStyles() {
        const css = `
        .rtpl-fab{position:fixed;left:12px;bottom:12px;z-index:9998;width:44px;height:44px;border-radius:50%;
            border:none;background:#3a86ff;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}
        .rtpl-fab:hover{background:#2f6fe0}
        .rtpl-panel{position:fixed;left:12px;bottom:64px;z-index:9999;width:300px;max-height:75vh;overflow:auto;
            background:#1b1f24;color:#e6e6e6;border:1px solid #333;border-radius:10px;
            font:13px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)}
        .rtpl-panel.rtpl-hidden{display:none}
        .rtpl-head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;
            background:#22272e;border-bottom:1px solid #333;font-weight:600;border-radius:10px 10px 0 0;position:sticky;top:0}
        .rtpl-head-actions{display:flex;align-items:center;gap:9px}.rtpl-help{width:19px;height:19px;padding:0;border:1px solid #526171;border-radius:50%;background:transparent;color:#cbd6e2;cursor:pointer;font-size:12px;line-height:17px}.rtpl-x{background:none;border:none;color:#aaa;cursor:pointer;font-size:14px}
        .rtpl-actions{padding:10px 12px 4px}
        .rtpl-add{width:100%;padding:8px;border:1px dashed #4a7bd6;background:#1f2630;color:#cfe0ff;border-radius:8px;cursor:pointer}
        .rtpl-add:hover{background:#243044}
        .rtpl-actions-row{display:flex;gap:8px}
        .rtpl-actions-row .rtpl-add{flex:1;width:auto;padding:8px 6px;white-space:nowrap}
        .rtpl-tp{display:flex;flex-direction:column;gap:8px}
        .rtpl-tp-input{width:100%;box-sizing:border-box;background:#161a1f;border:1px solid #2c333d;color:#fff;border-radius:8px;padding:7px 8px;font-size:12px}
        .rtpl-tp-input:focus{outline:none;border-color:#3a86ff}
        .rtpl-tp-btns{display:flex;gap:8px}
        .rtpl-tp-btns .rtpl-toggle{flex:1}
        .rtpl-account{display:flex;gap:12px;justify-content:space-around;padding:8px 12px;margin:0;background:#1a2028;border-bottom:1px solid #2c333d;font:12px ui-monospace,monospace;color:#dfe6ef}
        .rtpl-settings-head{display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;user-select:none;color:#cdd3dc;font-weight:600}
        .rtpl-settings-caret{background:none;border:none;color:#9aa3b0;cursor:pointer;font-size:13px;padding:0}
        .rtpl-settings-collapsed .rtpl-globaltoggles{display:none}
        .rtpl-globaltoggles{display:flex;flex-direction:column;gap:4px;padding:6px 12px;color:#bbb}
        .rtpl-globaltoggles label{display:flex;gap:6px;align-items:center;cursor:pointer}
        .rtpl-info{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1px solid #708096;border-radius:50%;color:#b8c3d1;font-size:10px;font-weight:700;line-height:1;cursor:help}
        .rtpl-info:hover,.rtpl-info:focus{color:#fff;border-color:#fff;outline:none}
        .rtpl-g-cmrow{display:flex;gap:8px;align-items:center}
        .rtpl-g-panstep{flex:0 0 auto;width:64px;background:#161a1f;border:1px solid #2c333d;color:#fff;border-radius:4px;padding:3px 5px}
        .rtpl-hint{padding:4px 12px 8px;color:#8a93a0;font-size:11px;line-height:1.4}

        .rtpl-list{padding:0 12px 12px;display:flex;flex-direction:column;gap:10px}
        .rtpl-empty{color:#888;padding:8px 0}
        .rtpl-card{border:1px solid #2c333d;border-radius:8px;padding:8px;background:#20262e}
        .rtpl-card.rtpl-sel{border-color:#3a86ff;box-shadow:0 0 0 1px #3a86ff inset}
        .rtpl-row1{display:flex;gap:6px;align-items:center}
        .rtpl-caret{background:none;border:none;color:#9aa3b0;cursor:pointer;font-size:13px;padding:0 2px;flex:0 0 auto}
        .rtpl-drag{flex:0 0 auto;color:#6b7280;font-size:14px;line-height:1;cursor:grab;padding:0 2px;touch-action:none;user-select:none}
        .rtpl-drag:active{cursor:grabbing;color:#cfe0ff}
        .rtpl-card.rtpl-dragging{opacity:.65;outline:1px dashed #3a86ff}
        .rtpl-vischk{flex:0 0 auto;cursor:pointer;width:16px;height:16px}
        .rtpl-thumb{width:40px;height:40px;object-fit:contain;background:#0d1014 repeating-conic-gradient(#2a2f36 0 25%,transparent 0 50%) 0 0/10px 10px;border-radius:4px;flex:0 0 auto;image-rendering:pixelated}
        .rtpl-meta{flex:1;min-width:0}
        .rtpl-name{width:100%;background:#161a1f;border:1px solid #2c333d;color:#fff;border-radius:4px;padding:3px 5px}
        .rtpl-dim{color:#8a93a0;font-size:11px;margin-top:3px;font-family:ui-monospace,monospace;cursor:pointer}
        .rtpl-dim:hover{color:#cfe0ff}
        .rtpl-icon{background:none;border:none;cursor:pointer;font-size:15px;flex:0 0 auto;padding:0 2px}
        .rtpl-collapsed .rtpl-dim{display:none}
        .rtpl-collapsed .rtpl-collapsible{display:none}
        .rtpl-row2{margin-top:8px}
        .rtpl-op{display:flex;align-items:center;gap:8px;color:#bbb;font-size:12px}
        .rtpl-op input{flex:1}
        .rtpl-row3{display:flex;gap:6px;margin-top:6px}
        .rtpl-toggle{flex:1;padding:5px 4px;border:1px solid #2c333d;background:#161a1f;color:#ccc;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap}
        .rtpl-toggle:hover{background:#222a33}
        .rtpl-toggle:disabled{opacity:.4;cursor:not-allowed}
        .rtpl-num{flex:1;display:flex;flex-direction:column;color:#8a93a0;font-size:10px;gap:2px}
        .rtpl-num input{background:#161a1f;border:1px solid #2c333d;color:#fff;border-radius:4px;padding:3px 4px;width:100%}
        .rtpl-drophint{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;
            background:rgba(58,134,255,.12);border:3px dashed #3a86ff;color:#fff;font:600 22px system-ui;pointer-events:none}
        .rtpl-toggle.rtpl-active{background:#3a86ff;color:#fff;border-color:#3a86ff}
        .rtpl-colors{display:none;margin-top:8px;border-top:1px solid #2c333d;padding-top:8px}
        .rtpl-cl-head{color:#8a93a0;font-size:11px;margin-bottom:6px}
        .rtpl-cl-sortrow{display:flex;gap:6px;align-items:center;margin-bottom:6px;color:#8a93a0;font-size:11px}
        .rtpl-cl-sort{flex:1;background:#161a1f;border:1px solid #2c333d;color:#fff;border-radius:6px;padding:3px 5px;font-size:11px}
        .rtpl-cl-actions{display:flex;gap:6px;margin-bottom:6px}
        .rtpl-cl-actions button{flex:1;padding:4px;border:1px solid #2c333d;background:#161a1f;color:#ccc;border-radius:6px;cursor:pointer;font-size:11px}
        .rtpl-cl-list{max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:2px}
        .rtpl-cl-row{display:flex;align-items:center;gap:6px;font-size:11px;color:#ddd;cursor:pointer;padding:1px 0}
        .rtpl-sw{width:14px;height:14px;border-radius:3px;border:1px solid #0006;flex:0 0 auto}
        .rtpl-cn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .rtpl-cc{color:#cdd3dc;font-family:ui-monospace,monospace;font-size:10px}
        .rtpl-muted{color:#8a93a0}
        .rtpl-totals{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;font-family:ui-monospace,monospace;margin:2px 0 8px}
        .rtpl-tg{color:#37d67a}.rtpl-ty{color:#ffce4a}.rtpl-tr{color:#ff6b6b}.rtpl-tt{color:#aab2bd}
        .rtpl-dl{margin:0 12px 12px;border-top:1px solid #333;padding-top:10px}
        .rtpl-dl-head{font-weight:600;margin-bottom:6px;cursor:pointer;user-select:none}
        .rtpl-dl-caret{background:none;border:none;color:#9aa3b0;cursor:pointer;font-size:13px;padding:0}
        .rtpl-dl-collapsed .rtpl-dl-body{display:none}
        .rtpl-dlout{display:flex;gap:6px;align-items:center;color:#bbb;font-size:12px;margin-bottom:6px;cursor:pointer}
        .rtpl-dl-go{margin-top:8px}
        .rtpl-backup{display:flex;gap:6px;margin-top:4px}
        .rtpl-backup .rtpl-toggle{min-height:34px}

        .rtpl-tpl{border-top:1px solid #333;padding-top:4px}
        .rtpl-tpl-head{display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;user-select:none;color:#cdd3dc;font-weight:600}
        .rtpl-tpl-caret{background:none;border:none;color:#9aa3b0;cursor:pointer;font-size:13px;padding:0}
        .rtpl-tpl-collapsed .rtpl-tpl-body{display:none}
        .rtpl-editor{position:fixed;inset:24px;z-index:10001;background:#14171c;border:1px solid #333;border-radius:12px;
            display:flex;flex-direction:column;color:#e6e6e6;font:13px system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6)}
        .rtpl-editor.rtpl-hidden{display:none}
        .rtpl-editor:fullscreen{inset:0;border-radius:0}
        .rtpl-ed-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #2c333d;background:#1b2026;border-radius:12px 12px 0 0}
        .rtpl-ed-title{font-weight:600}
        .rtpl-ed-headbtns{display:flex;gap:8px;align-items:center}
        .rtpl-ed-headbtns .rtpl-toggle{flex:0 0 auto}
        .rtpl-ed-zoomv{font:11px ui-monospace,monospace;color:#aab2bd;min-width:42px;text-align:center}
        .rtpl-ed-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:12px 16px;border-bottom:1px solid #2c333d}
        .rtpl-ed-ctl{display:flex;flex-direction:column;gap:4px;color:#aab2bd;font-size:11px}
        .rtpl-ed-ctl select,.rtpl-ed-ctl input{background:#161a1f;border:1px solid #2c333d;color:#fff;border-radius:6px;padding:4px 6px}
        .rtpl-ed-palbtn,.rtpl-ed-preset-save,.rtpl-ed-preset-del{align-self:flex-end;flex:0 0 auto}
        .rtpl-ed-preset-save,.rtpl-ed-preset-del{font-size:15px;padding:5px 11px;line-height:1.3}
        .rtpl-ed-palette{display:none;flex-direction:column;gap:8px;padding:10px 16px;border-bottom:1px solid #2c333d;background:#161a1f}
        .rtpl-ed-palette.rtpl-on{display:flex}
        .rtpl-ed-palhead{display:flex;gap:8px;align-items:center;color:#aab2bd;font-size:11px}
        .rtpl-ed-pal-search{flex:1;min-width:0;background:#0e1217;border:1px solid #2c333d;color:#fff;border-radius:6px;padding:4px 8px;font-size:11px}
        .rtpl-ed-palhead .rtpl-toggle{flex:0 0 auto;padding:3px 10px}
        .rtpl-ed-pal-count{flex:0 0 auto;color:#8a93a0;font-family:ui-monospace,monospace}
        .rtpl-ed-pal-grid{display:flex;flex-wrap:wrap;gap:5px;max-height:170px;overflow:auto}
        .rtpl-ed-palcell{display:flex;align-items:center;gap:6px;width:150px;font-size:11px;color:#8a93a0;cursor:pointer;background:#11161c;border:1px solid #2c333d;border-radius:6px;padding:4px 7px;text-align:left;opacity:.55;transition:opacity .08s,border-color .08s}
        .rtpl-ed-palcell:hover{border-color:#3a86ff}
        .rtpl-ed-palcell.rtpl-on{opacity:1;color:#e6e6e6;border-color:#3a7d4a;background:#16241a}
        .rtpl-ed-palcell .rtpl-sw{width:14px;height:14px;border-radius:3px;border:1px solid #0006;flex:0 0 auto}
        .rtpl-ed-palname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .rtpl-ed-palchk{flex:0 0 auto;color:#37d67a;font-weight:700;visibility:hidden}
        .rtpl-ed-palcell.rtpl-on .rtpl-ed-palchk{visibility:visible}
        .rtpl-ed-resize{display:flex;gap:6px;align-items:flex-end}
        .rtpl-ed-transform{display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap}
        .rtpl-ed-transform .rtpl-toggle{flex:0 0 auto;min-width:34px;font-size:16px}
        .rtpl-ed-resize .rtpl-ed-w,.rtpl-ed-resize .rtpl-ed-h{width:62px}
        .rtpl-ed-x{color:#8a93a0;padding-bottom:6px}
        .rtpl-ed-lockaspect{display:flex;gap:4px;align-items:center;color:#aab2bd;font-size:11px;padding-bottom:5px}
        .rtpl-ed-reset{align-self:flex-end;flex:0 0 auto}
        .rtpl-ed-view{align-self:flex-end;flex:0 0 auto}
        .rtpl-ed-apply{display:flex;gap:8px;margin-left:auto;align-items:flex-end}
        .rtpl-ed-apply .rtpl-add{width:auto;padding:8px 12px}
        .rtpl-ed-import{width:auto;padding:8px 12px}
        .rtpl-ed-stage{flex:1;display:flex;gap:12px;padding:12px 16px;overflow:auto;min-height:0;position:relative}
        .rtpl-ed-pane{flex:1;display:flex;flex-direction:column;min-width:0}        .rtpl-ed-label{position:absolute;top:8px;left:8px;z-index:3;margin:0;font-size:12px;background:rgba(0,0,0,.6);padding:2px 6px;border-radius:4px;color:#fff;pointer-events:none}
        .rtpl-ed-pane-after .rtpl-ed-label{left:auto;right:8px}
        .rtpl-ed-canwrap{flex:1;display:grid;place-items:center;background:#0d1014 repeating-conic-gradient(#1c2128 0 25%,transparent 0 50%) 0 0/16px 16px;border:1px solid #2c333d;border-radius:8px;overflow:auto;min-height:0;cursor:grab}
        .rtpl-ed-canwrap.rtpl-panning{cursor:grabbing}
        .rtpl-mode-slider .rtpl-ed-canwrap{cursor:default}
        .rtpl-ed-canwrap canvas{image-rendering:pixelated;display:block}
        .rtpl-ed-handle{display:none}
        .rtpl-ed-stage.rtpl-mode-slider{display:block}
        .rtpl-mode-slider .rtpl-ed-pane{position:absolute;inset:12px 16px}        .rtpl-mode-slider .rtpl-ed-pane-after{clip-path:inset(0 0 0 calc(var(--split) * 1%))}
        .rtpl-mode-slider .rtpl-ed-handle{display:flex;position:absolute;top:12px;bottom:12px;left:calc(16px + (100% - 32px) * var(--split) / 100);transform:translateX(-50%);width:2px;background:#fff;z-index:4;cursor:ew-resize;align-items:center;justify-content:center;touch-action:none}
        .rtpl-ed-knob{background:#fff;color:#000;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 1px 5px rgba(0,0,0,.6)}
        .rtpl-ed-pane-before,.rtpl-ed-pane-after{position:relative}
        .rtpl-ed-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 16px;color:#8a93a0;cursor:pointer}
        .rtpl-ed-empty:hover{color:#cfe0ff}        .rtpl-ed-loading{position:absolute;inset:0;z-index:10;display:none;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(13,16,20,.45);pointer-events:none}
        .rtpl-ed-loading.rtpl-on{display:flex}
        .rtpl-toast{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(420px,calc(100vw - 32px));padding:10px 13px;border:1px solid #3a86ff;border-radius:8px;background:#121820;color:#f4f7fb;font:13px system-ui,sans-serif;box-shadow:0 8px 28px #0008;opacity:0;transform:translateY(12px);pointer-events:none;transition:.18s}.rtpl-toast-on{opacity:1;transform:translateY(0)}.rtpl-toast-success{border-color:#4ecb71}.rtpl-toast-error{border-color:#ff5b5b;background:#32191b}.rtpl-toast-progress{border-color:#ffb300}
        .rtpl-ed-loading-msg{color:#ffd9a0;font:600 12px ui-monospace,monospace;letter-spacing:.5px}
        .rtpl-ed-loading-bar{position:relative;width:140px;height:4px;border-radius:3px;overflow:hidden;background:rgba(255,159,28,.2)}
        .rtpl-ed-loading-bar::before{content:"";position:absolute;top:0;left:0;height:100%;width:40%;background:#ff9f1c;border-radius:3px;will-change:transform;animation:rtpl-ind 1.1s linear infinite}
        @keyframes rtpl-ind{0%{transform:translateX(-110%)}100%{transform:translateX(360%)}}
        .rtpl-panel{width:344px;background:#10151b;border:1px solid #29333e;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.48);font-size:13px;padding-bottom:12px;box-sizing:border-box}
        .rtpl-top{position:sticky;top:0;z-index:3}.rtpl-head{padding:13px 14px;background:#151c24;border-bottom:1px solid #29333e;border-radius:14px 14px 0 0;font-size:14px;letter-spacing:.1px;position:static;z-index:auto}.rtpl-account{position:static;z-index:auto}
        .rtpl-panel .rtpl-actions{padding:10px 12px 0}
        .rtpl-panel .rtpl-actions-row{gap:8px}
        .rtpl-panel .rtpl-actions-row .rtpl-add{min-height:36px;border-style:solid;border-radius:8px;font-weight:600}
        .rtpl-panel .rtpl-actions-row .rtpl-add:first-child{background:#3a86ff;border-color:#3a86ff;color:#fff}
        .rtpl-panel .rtpl-actions-row .rtpl-add:first-child:hover{background:#2975ed}
        .rtpl-panel .rtpl-actions-row .rtpl-add:last-child{background:#18212b;border-color:#354352;color:#d7e0ea}
        .rtpl-panel .rtpl-tp{padding-bottom:10px}
        .rtpl-panel .rtpl-tp-input{background:#0c1116;border-color:#2d3946;border-radius:8px;padding:9px}
        .rtpl-panel .rtpl-tp-btns .rtpl-toggle{padding:7px 8px}
        .rtpl-panel .rtpl-tpl,.rtpl-panel .rtpl-dl,.rtpl-panel .rtpl-settings{margin:10px 12px 0;padding:0;border:1px solid #29333e;border-radius:10px;background:#141b22;overflow:hidden}
        .rtpl-panel .rtpl-tpl{border-top:1px solid #29333e}
        .rtpl-panel .rtpl-tpl-head,.rtpl-panel .rtpl-dl-head,.rtpl-panel .rtpl-settings-head{min-height:38px;box-sizing:border-box;margin:0;padding:10px 11px;color:#eef3f8;font-size:12px;font-weight:650}
        .rtpl-panel .rtpl-dl{border-top:1px solid #29333e}
        .rtpl-panel .rtpl-dl-body,.rtpl-panel .rtpl-globaltoggles{padding:4px 11px 11px}
        .rtpl-panel .rtpl-globaltoggles{gap:7px;color:#c4ced9}
        .rtpl-panel .rtpl-globaltoggles label{min-height:22px}
        .rtpl-panel .rtpl-hint{padding:0 11px 9px;color:#8f9dac;font-size:11px}
        .rtpl-panel .rtpl-list{padding:0 10px 10px;gap:7px}
        .rtpl-panel .rtpl-card{padding:8px;border-color:#2c3742;border-radius:8px;background:#10161c}
        .rtpl-panel .rtpl-card.rtpl-sel{border-color:#4c93ff;box-shadow:0 0 0 1px rgba(76,147,255,.3) inset}
        .rtpl-panel .rtpl-thumb{width:36px;height:36px}
        .rtpl-panel .rtpl-name{background:transparent;border-color:transparent;padding:2px 3px;font-weight:600}
        .rtpl-panel .rtpl-name:focus{border-color:#4c93ff;background:#0c1116}
        .rtpl-panel .rtpl-row2{margin-top:6px}
        .rtpl-panel .rtpl-op{font-size:11px;color:#94a2b2}
        .rtpl-panel .rtpl-toggle,.rtpl-panel .rtpl-cl-actions button{background:#18212a;border-color:#344150;color:#d9e3ed;border-radius:7px}
        .rtpl-panel .rtpl-toggle:hover,.rtpl-panel .rtpl-cl-actions button:hover{background:#222d38}
        .rtpl-panel .rtpl-num input,.rtpl-panel .rtpl-g-panstep,.rtpl-panel .rtpl-g-scale{background:#0c1116;border-color:#2d3946;border-radius:6px;color:#e7edf5}
        .rtpl-panel .rtpl-g-scale{min-width:0;flex:1;padding:4px 6px}

        .rtpl-panel .rtpl-info{border-color:#617388;color:#d1dbe6}
        @media (max-width:600px){
            .rtpl-fab{width:48px;height:48px;font-size:21px}
            .rtpl-panel{width:calc(100vw - 16px);max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:12px;overscroll-behavior:contain}
            .rtpl-panel .rtpl-tpl,.rtpl-panel .rtpl-dl,.rtpl-panel .rtpl-settings{margin-left:8px;margin-right:8px}
            .rtpl-panel .rtpl-actions{padding-left:10px;padding-right:10px}
            .rtpl-panel .rtpl-actions-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
            .rtpl-panel .rtpl-actions-row .rtpl-add{min-width:0;min-height:42px;padding:6px 4px;white-space:normal;font-size:11px;line-height:1.15}
            .rtpl-panel .rtpl-tp-btns{gap:6px}
            .rtpl-panel .rtpl-g-cmrow{flex-wrap:wrap}
            .rtpl-editor{inset:8px;max-height:calc(100dvh - 16px);border-radius:10px}
            .rtpl-ed-head{padding:10px;gap:8px;align-items:flex-start;flex-wrap:wrap;border-radius:10px 10px 0 0}
            .rtpl-ed-title{width:100%;min-width:0}
            .rtpl-ed-headbtns{width:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
            .rtpl-ed-headbtns .rtpl-toggle,.rtpl-ed-headbtns .rtpl-x{min-width:0;padding:6px 3px;font-size:11px}
            .rtpl-ed-zoomv{display:flex;align-items:center;justify-content:center;min-width:0;font-size:10px}
            .rtpl-ed-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:10px;align-items:stretch;overflow:auto}
            .rtpl-ed-controls > *{min-width:0}
            .rtpl-ed-ctl select,.rtpl-ed-ctl input{width:100%;box-sizing:border-box}
            .rtpl-ed-import,.rtpl-ed-palbtn,.rtpl-ed-view{width:100%;min-height:36px}
            .rtpl-ed-preset-save,.rtpl-ed-preset-del{align-self:stretch;padding:5px}
            .rtpl-ed-transform{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
            .rtpl-ed-transform .rtpl-toggle{min-width:0;white-space:normal;line-height:1.15;padding:6px 4px}
            .rtpl-ed-resize{grid-column:1/-1;flex-wrap:wrap;gap:6px}
            .rtpl-ed-resize .rtpl-ed-ctl{flex:1 1 calc(50% - 3px)}
            .rtpl-ed-resize .rtpl-ed-w,.rtpl-ed-resize .rtpl-ed-h{width:100%}
            .rtpl-ed-resize .rtpl-ed-x{display:none}
            .rtpl-ed-lockaspect{flex:1 1 auto;padding-bottom:0}
            .rtpl-ed-reset{flex:1 1 auto}
            .rtpl-ed-view{grid-column:1/-1}
            .rtpl-ed-apply{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-left:0}
            .rtpl-ed-apply .rtpl-add{width:100%;min-width:0;padding:7px 4px;white-space:normal;font-size:11px;line-height:1.15}
            .rtpl-ed-palette{padding:10px}
            .rtpl-ed-palhead{flex-wrap:wrap}
            .rtpl-ed-pal-search{order:1;flex-basis:100%}
            .rtpl-ed-pal-grid{max-height:140px}
            .rtpl-ed-palcell{width:calc(50% - 3px);min-width:0}
            .rtpl-ed-stage{gap:8px;padding:8px}
            .rtpl-ed-stage:not(.rtpl-mode-slider){flex-direction:column}
            .rtpl-mode-slider .rtpl-ed-pane{inset:8px}
            .rtpl-mode-slider .rtpl-ed-handle{top:8px;bottom:8px;left:calc(8px + (100% - 16px) * var(--split) / 100)}
            .rtpl-toast{right:8px;bottom:max(8px,env(safe-area-inset-bottom));max-width:calc(100vw - 16px)}
        }
        `;
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
    }

    const grayIdx = [1, 2, 3, 32, 4, 5];
    const EDITOR_PRESETS = {
        full: { label: "Full game palette", get: () => PALETTE },
        free: { label: "Free colors", get: () => PALETTE.filter((c) => c.index < PAID_PALETTE_INDEX) },
        mine: { label: "My (unlocked) colors", get: () => PALETTE.filter((c) => isColorUnlocked(c.index)) },
        gray: { label: "Grayscale", get: () => PALETTE.filter((c) => grayIdx.includes(c.index)) },
        bw: { label: "Black & white", get: () => PALETTE.filter((c) => c.index === 1 || c.index === 5) },
        rgb: { label: "RGB + black/white", get: () => PALETTE.filter((c) => [7, 13, 19, 1, 5].includes(c.index)) },
        cmyk: { label: "CMYK + black/white", get: () => PALETTE.filter((c) => [20, 27, 10, 1, 5].includes(c.index)) }
    };

    const DIFFUSION = {
        floyd: { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
        atkinson: { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
        jjn: { div: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
        stucki: { div: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
        burkes: { div: 32, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
        sierra: { div: 32, k: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 3], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
        sierraLite: { div: 4, k: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] }
    };
    const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    const BAYER8 = [
        [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
        [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
        [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
        [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]
    ];
    const ALGORITHMS = [
        ["none", "None (nearest)"], ["floyd", "Floyd–Steinberg"], ["atkinson", "Atkinson"],
        ["jjn", "Jarvis–Judice–Ninke"], ["stucki", "Stucki"], ["burkes", "Burkes"],
        ["sierra", "Sierra"], ["sierraLite", "Sierra Lite"], ["bayer4", "Ordered 4×4"], ["bayer8", "Ordered 8×8"]
    ];

    const nearest = (set, r, g, b) => {
        let best = set[0], bd = Infinity;
        for (const c of set) {
            const dr = r - c.rgb[0], dg = g - c.rgb[1], db = b - c.rgb[2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bd) { bd = d; best = c; }
        }
        return best;
    };

    function ditherTo(src, w, h, set, algo, strength, scaleAlgorithm) {
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        applyScaleAlgorithm(ctx, scaleAlgorithm);
        ctx.drawImage(src, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const s = strength;

        if (algo === "bayer4" || algo === "bayer8") {
            const m = algo === "bayer4" ? BAYER4 : BAYER8;
            const n = algo === "bayer4" ? 4 : 8;
            const denom = n * n;
            const amount = 64 * s;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    if (d[i + 3] <= 128) { d[i + 3] = 0; continue; }
                    const bias = (m[y % n][x % n] / denom - 0.5) * amount;
                    const c = nearest(set, d[i] + bias, d[i + 1] + bias, d[i + 2] + bias);
                    d[i] = c.rgb[0]; d[i + 1] = c.rgb[1]; d[i + 2] = c.rgb[2]; d[i + 3] = 255;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            return cv;
        }

        const kernel = DIFFUSION[algo];
        if (!kernel) {
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] <= 128) { d[i + 3] = 0; continue; }
                const c = nearest(set, d[i], d[i + 1], d[i + 2]);
                d[i] = c.rgb[0]; d[i + 1] = c.rgb[1]; d[i + 2] = c.rgb[2]; d[i + 3] = 255;
            }
            ctx.putImageData(imgData, 0, 0);
            return cv;
        }

        const rf = new Float32Array(w * h), gf = new Float32Array(w * h), bf = new Float32Array(w * h);
        for (let p = 0; p < w * h; p++) { rf[p] = d[p * 4]; gf[p] = d[p * 4 + 1]; bf[p] = d[p * 4 + 2]; }
        for (let y = 0; y < h; y++) {
            const ltr = (y % 2) === 0;
            for (let k = 0; k < w; k++) {
                const x = ltr ? k : (w - 1 - k);
                const p = y * w + x, i = p * 4;
                if (d[i + 3] <= 128) { d[i + 3] = 0; continue; }
                const c = nearest(set, rf[p], gf[p], bf[p]);
                const er = (rf[p] - c.rgb[0]) * s, eg = (gf[p] - c.rgb[1]) * s, eb = (bf[p] - c.rgb[2]) * s;
                d[i] = c.rgb[0]; d[i + 1] = c.rgb[1]; d[i + 2] = c.rgb[2]; d[i + 3] = 255;
                for (const [dx, dy, wt] of kernel.k) {
                    const sx = ltr ? dx : -dx;
                    const nx = x + sx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const np = ny * w + nx;
                    if (d[np * 4 + 3] <= 128) continue;
                    const f = wt / kernel.div;
                    rf[np] += er * f; gf[np] += eg * f; bf[np] += eb * f;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return cv;
    }

    let editor = null;
    let editorState = null;
    let editorRedrawTimer = null;
    let editorView = "side";
    let editorSplit = 50;

    const editorColorSet = new Set(PALETTE.map((c) => c.index));

    let userPresets = [];

    async function importEditorImage(file, pasted = false) {
        const name = (file?.name || "pasted image").replace(/\.[^.]+$/, "") || "image";
        try {
            const prepared = await prepareImageFile(file);
            await editorSetSource(prepared.dataUrl, name, null, prepared.img);
            const action = pasted ? "Pasted" : "Loaded";
            showToast(prepared.scaled ? `${action} “${name}” at ${prepared.img.naturalWidth}×${prepared.img.naturalHeight}.` : `${action} “${name}”.`, "success");
        } catch (err) {
            LOG(pasted ? "editor paste failed" : "editor import failed", err);
            showToast(importError(file, err), "error", 7000);
        }
    }

    function buildEditor() {
        editor = document.createElement("div");
        editor.className = "rtpl-editor rtpl-hidden";
        const algoOpts = ALGORITHMS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
        const scaleOpts = SCALE_ALGORITHMS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
        editor.innerHTML = `
            <div class="rtpl-ed-head">
                <span class="rtpl-ed-title">Image editor — dither to palette</span>
                <div class="rtpl-ed-headbtns">
                    <button class="rtpl-toggle rtpl-ed-zoomout" title="Zoom out">🔍−</button>
                    <span class="rtpl-ed-zoomv">100%</span>
                    <button class="rtpl-toggle rtpl-ed-zoomin" title="Zoom in">🔍+</button>
                    <button class="rtpl-toggle rtpl-ed-fit">Fit</button>
                    <button class="rtpl-toggle rtpl-ed-oneone">1:1</button>
                    <button class="rtpl-toggle rtpl-ed-full">⛶ Fullscreen</button>
                    <button class="rtpl-x rtpl-ed-close" title="Close">✕</button>
                </div>
            </div>
            <div class="rtpl-ed-controls">
                <button class="rtpl-add rtpl-ed-import">Import image…</button>
                <input type="file" accept="image/*" class="rtpl-ed-file" hidden>
                <div class="rtpl-ed-transform"><button class="rtpl-toggle rtpl-ed-rotate-l" title="Rotate left" aria-label="Rotate left">↶</button><button class="rtpl-toggle rtpl-ed-rotate-r" title="Rotate right" aria-label="Rotate right">↷</button><button class="rtpl-toggle rtpl-ed-flip-h" title="Flip horizontally" aria-label="Flip horizontally">⇄</button><button class="rtpl-toggle rtpl-ed-flip-v" title="Flip vertically" aria-label="Flip vertically">⇅</button></div>
                <label class="rtpl-ed-ctl">Preset
                    <select class="rtpl-ed-preset"></select>
                </label>
                <button class="rtpl-toggle rtpl-ed-preset-save" title="Save current colors as a new preset">💾</button>
                <button class="rtpl-toggle rtpl-ed-preset-del" title="Delete the selected saved preset" disabled>🗑️</button>
                <button class="rtpl-toggle rtpl-ed-palbtn" title="Pick exactly which colors the dither may use">Colors</button>
                <label class="rtpl-ed-ctl">Dither
                    <select class="rtpl-ed-algo">${algoOpts}</select>
                </label>
                <label class="rtpl-ed-ctl">Resize sampling
                    <select class="rtpl-ed-scale">${scaleOpts}</select>
                </label>
                <label class="rtpl-ed-ctl">Strength <span class="rtpl-ed-strv">100%</span>
                    <input type="range" class="rtpl-ed-str" min="0" max="100" value="100">
                </label>
                <div class="rtpl-ed-resize">
                    <label class="rtpl-ed-ctl">Width<input type="number" class="rtpl-ed-w" min="1" max="8192"></label>
                    <span class="rtpl-ed-x">×</span>
                    <label class="rtpl-ed-ctl">Height<input type="number" class="rtpl-ed-h" min="1" max="8192"></label>
                    <label class="rtpl-ed-lockaspect"><input type="checkbox" class="rtpl-ed-aspect" checked> Lock ratio</label>
                    <button class="rtpl-toggle rtpl-ed-reset">Reset</button>
                </div>
                <button class="rtpl-toggle rtpl-ed-view">⇆ Side by side</button>
                <div class="rtpl-ed-apply">
                    <button class="rtpl-add rtpl-ed-download">Download</button>
                    <button class="rtpl-add rtpl-ed-new">Add as new template</button>
                    <button class="rtpl-add rtpl-ed-replace" disabled>Replace source template</button>
                </div>
            </div>
            <div class="rtpl-ed-palette">
                <div class="rtpl-ed-palhead">
                    <input type="search" class="rtpl-ed-pal-search" placeholder="Search colors…">
                    <button class="rtpl-toggle rtpl-ed-pal-all">All</button>
                    <button class="rtpl-toggle rtpl-ed-pal-none">None</button>
                    <span class="rtpl-ed-pal-count"></span>
                </div>
                <div class="rtpl-ed-pal-grid"></div>
            </div>
            <div class="rtpl-ed-stage" style="--split:50">
                <div class="rtpl-ed-pane rtpl-ed-pane-before"><div class="rtpl-ed-label">Before</div><div class="rtpl-ed-canwrap"><canvas class="rtpl-ed-before"></canvas></div><div class="rtpl-ed-empty">Click here to import an image — or use Edit on a template.</div></div>
                <div class="rtpl-ed-pane rtpl-ed-pane-after"><div class="rtpl-ed-label">After (<span class="rtpl-ed-after-info">—</span>)</div><div class="rtpl-ed-canwrap"><canvas class="rtpl-ed-after"></canvas></div><div class="rtpl-ed-loading"><div class="rtpl-ed-loading-msg">Loading…</div><div class="rtpl-ed-loading-bar"></div></div></div>
                <div class="rtpl-ed-handle"><div class="rtpl-ed-knob">⇆</div></div>
            </div>
        `;
        document.body.appendChild(editor);

        editor.querySelector(".rtpl-ed-close").addEventListener("click", closeEditor);
        editor.querySelector(".rtpl-ed-full").addEventListener("click", () => {
            if (document.fullscreenElement) document.exitFullscreen?.();
            else editor.requestFullscreen?.();
        });
        const fileInput = editor.querySelector(".rtpl-ed-file");
        editor.querySelector(".rtpl-ed-import").addEventListener("click", () => fileInput.click());
        editor.querySelector(".rtpl-ed-rotate-l").addEventListener("click", () => editorTransform("rotate-left"));
        editor.querySelector(".rtpl-ed-rotate-r").addEventListener("click", () => editorTransform("rotate-right"));
        editor.querySelector(".rtpl-ed-flip-h").addEventListener("click", () => editorTransform("flip-horizontal"));
        editor.querySelector(".rtpl-ed-flip-v").addEventListener("click", () => editorTransform("flip-vertical"));

        editor.querySelector(".rtpl-ed-empty").addEventListener("click", () => { if (!editorState) fileInput.click(); });
        fileInput.addEventListener("change", async (e) => {
            const f = e.target.files[0];
            if (f) await importEditorImage(f);
            fileInput.value = "";
        });
        window.addEventListener("paste", (e) => {
            if (!editor || editor.classList.contains("rtpl-hidden")) return;
            const items = [...(e.clipboardData?.items || [])];
            const imageItem = items.find((item) => /^image\//.test(item.type));
            const file = imageItem?.getAsFile() || [...(e.clipboardData?.files || [])].find(isImageFile);
            if (!file) return;
            e.preventDefault();
            importEditorImage(file, true);
        });
        editor.querySelector(".rtpl-ed-preset").addEventListener("change", (e) => applyPresetValue(e.target.value));
        editor.querySelector(".rtpl-ed-preset-save").addEventListener("click", saveCurrentPreset);
        editor.querySelector(".rtpl-ed-preset-del").addEventListener("click", deleteCurrentPreset);
        editor.querySelector(".rtpl-ed-algo").addEventListener("change", scheduleEditorRedraw);
        const editorScale = editor.querySelector(".rtpl-ed-scale");
        editorScale.value = gEditorScaleAlgorithm;
        editorScale.addEventListener("change", () => {
            gEditorScaleAlgorithm = editorScale.value; saveSettings(); drawBefore(); scheduleEditorRedraw();
        });

        const palPanel = editor.querySelector(".rtpl-ed-palette");
        editor.querySelector(".rtpl-ed-palbtn").addEventListener("click", () => palPanel.classList.toggle("rtpl-on"));
        editor.querySelector(".rtpl-ed-pal-all").addEventListener("click", () => setEditorColors(PALETTE.map((c) => c.index)));
        editor.querySelector(".rtpl-ed-pal-none").addEventListener("click", () => setEditorColors([]));
        editor.querySelector(".rtpl-ed-pal-search").addEventListener("input", (e) => {
            const q = e.target.value.trim().toLowerCase();
            for (const cell of editor.querySelectorAll(".rtpl-ed-pal-grid .rtpl-ed-palcell")) {
                const hit = !q || cell.dataset.name.includes(q) || `#${cell.dataset.ci}`.includes(q);
                cell.style.display = hit ? "" : "none";
            }
        });
        populateEditorPalette();
        rebuildPresetSelect();
        updatePalCount();
        const str = editor.querySelector(".rtpl-ed-str");
        str.addEventListener("input", () => {
            editor.querySelector(".rtpl-ed-strv").textContent = `${str.value}%`;
            scheduleEditorRedraw();
        });
        editor.querySelector(".rtpl-ed-download").addEventListener("click", editorDownload);
        editor.querySelector(".rtpl-ed-new").addEventListener("click", () => editorApply(false));
        editor.querySelector(".rtpl-ed-replace").addEventListener("click", () => {
            if (confirm("Replace the source template with this edited image? This overwrites the original and can't be undone.")) editorApply(true);
        });

        editor.querySelector(".rtpl-ed-zoomin").addEventListener("click", () => zoomAtPoint(editorState && editorState.zoom * 1.25));
        editor.querySelector(".rtpl-ed-zoomout").addEventListener("click", () => zoomAtPoint(editorState && editorState.zoom / 1.25));
        editor.querySelector(".rtpl-ed-fit").addEventListener("click", fitEditor);
        editor.querySelector(".rtpl-ed-oneone").addEventListener("click", () => zoomAtPoint(1));
        const stage = editor.querySelector(".rtpl-ed-stage");
        stage.addEventListener("wheel", (e) => {
            if (!editorState) return;
            e.preventDefault();
            zoomAtPoint(editorState.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
        }, { passive: false });

        const wraps = [...editor.querySelectorAll(".rtpl-ed-canwrap")];
        let syncing = false;
        for (const w of wraps) {
            w.addEventListener("scroll", () => {
                if (syncing) return;
                syncing = true;
                for (const o of wraps) if (o !== w) { o.scrollTop = w.scrollTop; o.scrollLeft = w.scrollLeft; }
                syncing = false;
            });
            attachEditorPan(w);
        }

        const wIn = editor.querySelector(".rtpl-ed-w");
        const hIn = editor.querySelector(".rtpl-ed-h");
        const aspectCb = editor.querySelector(".rtpl-ed-aspect");
        const clampDim = (v) => Math.max(1, Math.min(MAX_WORK_DIM, Math.round(v || 1)));
        wIn.addEventListener("change", () => {
            if (!editorState) return;
            const w = clampDim(parseInt(wIn.value)), h = aspectCb.checked ? Math.round(w * editorState.natH / editorState.natW) : editorState.h;
            const safe = safeWorkingSize(w, h); editorState.w = safe.w; editorState.h = safe.h;
            if (safe.scaled) showToast(`Editor size limited to ${safe.w}×${safe.h} to protect browser memory.`, "info");
            syncResizeInputs(); drawBefore(); deferredRedraw();
        });
        hIn.addEventListener("change", () => {
            if (!editorState) return;
            const h = clampDim(parseInt(hIn.value)), w = aspectCb.checked ? Math.round(h * editorState.natW / editorState.natH) : editorState.w;
            const safe = safeWorkingSize(w, h); editorState.w = safe.w; editorState.h = safe.h;
            if (safe.scaled) showToast(`Editor size limited to ${safe.w}×${safe.h} to protect browser memory.`, "info");
            syncResizeInputs(); drawBefore(); deferredRedraw();
        });
        editor.querySelector(".rtpl-ed-reset").addEventListener("click", () => {
            if (!editorState) return;
            const safe = safeWorkingSize(editorState.natW, editorState.natH);
            editorState.w = safe.w; editorState.h = safe.h; syncResizeInputs(); drawBefore(); deferredRedraw();
        });

        editor.querySelector(".rtpl-ed-view").addEventListener("click", (e) => {
            editorView = editorView === "side" ? "slider" : "side";
            applyEditorView(e.target);
        });
        attachSliderDrag(editor.querySelector(".rtpl-ed-stage"), editor.querySelector(".rtpl-ed-handle"));
    }

    function syncResizeInputs() {
        if (!editor || !editorState) return;
        editor.querySelector(".rtpl-ed-w").value = editorState.w;
        editor.querySelector(".rtpl-ed-h").value = editorState.h;
    }

    function applyEditorView(btn) {
        const stage = editor.querySelector(".rtpl-ed-stage");
        const slider = editorView === "slider";
        stage.classList.toggle("rtpl-mode-slider", slider);
        const b = btn || editor.querySelector(".rtpl-ed-view");
        b.textContent = slider ? "▥ Slider" : "⇆ Side by side";
    }

    function attachEditorPan(wrap) {
        let panning = false, sx, sy, sl, st;
        wrap.addEventListener("pointerdown", (e) => {
            if (editorView !== "side" || e.button !== 0) return;
            panning = true;
            sx = e.clientX; sy = e.clientY; sl = wrap.scrollLeft; st = wrap.scrollTop;
            try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
            wrap.classList.add("rtpl-panning");
            e.preventDefault();
        });
        wrap.addEventListener("pointermove", (e) => {
            if (!panning) return;
            wrap.scrollLeft = sl - (e.clientX - sx);
            wrap.scrollTop = st - (e.clientY - sy);
        });
        const end = () => { panning = false; wrap.classList.remove("rtpl-panning"); };
        wrap.addEventListener("pointerup", end);
        wrap.addEventListener("pointercancel", end);
    }

    function attachSliderDrag(stage, handle) {
        const setFromClient = (clientX) => {
            const r = stage.getBoundingClientRect();
            editorSplit = clamp(((clientX - r.left) / r.width) * 100, 0, 100);
            stage.style.setProperty("--split", `${editorSplit}`);
        };
        let dragging = false;
        const down = (e) => { if (editorView !== "slider") return; dragging = true; handle.setPointerCapture?.(e.pointerId); setFromClient(e.clientX); e.preventDefault(); };
        const move = (e) => { if (dragging) setFromClient(e.clientX); };
        const up = () => { dragging = false; };
        handle.addEventListener("pointerdown", down);

        stage.addEventListener("pointerdown", (e) => { if (editorView === "slider" && e.target !== handle && !handle.contains(e.target)) { dragging = true; setFromClient(e.clientX); } });
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }

    async function editorTransform(type) {
        if (!editorState) return;
        const source = editorState.srcImg;
        const name = editorState.name;
        const templateId = editorState.templateId;
        const canvas = document.createElement("canvas");
        const turn = type === "rotate-left" || type === "rotate-right";
        canvas.width = turn ? source.naturalHeight : source.naturalWidth;
        canvas.height = turn ? source.naturalWidth : source.naturalHeight;
        showEditorLoading(true);
        showToast("Transforming image…", "progress", 0);
        try {
            const ctx = canvas.getContext("2d");
            if (type === "rotate-left") { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); }
            if (type === "rotate-right") { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
            if (type === "flip-horizontal") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
            if (type === "flip-vertical") { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
            ctx.drawImage(source, 0, 0);
            const dataUrl = canvas.toDataURL("image/png");
            const image = await loadImage(dataUrl, name || "image");
            await editorSetSource(dataUrl, name, templateId, image);
            showToast("Image transformed.", "success");
        } catch (e) {
            LOG("editor transform failed", e);
            showEditorLoading(false);
            showToast("Could not transform this image.", "error", 7000);
        }
    }

    function editorDownload() {
        if (!editorState) return;
        redrawEditor();
        if (!editorState.result) return;
        const a = document.createElement("a");
        a.href = editorState.result.toDataURL("image/png");
        a.download = `${editorState.name || "template"}_${editorState.w}x${editorState.h}.png`;
        a.click();
    }

    function openEditor() {
        if (!editor) buildEditor();
        editor.classList.remove("rtpl-hidden");

        fetchUserColors().then(() => { if (editorState) redrawEditor(); }).catch(() => {});
    }
    function closeEditor() {
        if (document.fullscreenElement) document.exitFullscreen?.();
        editor?.classList.add("rtpl-hidden");
    }

    async function editorSetSource(dataUrl, name, templateId, loadedImg = null) {
        if (!editor) buildEditor();
        showEditorLoading(true);
        const img = loadedImg || await loadImage(dataUrl, name || "image");
        const w = img.naturalWidth, h = img.naturalHeight, safe = safeWorkingSize(w, h);
        editorState = { srcImg: img, natW: w, natH: h, w: safe.w, h: safe.h, zoom: 1, name: name || "edited", templateId: templateId ?? null };
        if (safe.scaled) showToast(`Large source ${w}×${h}; editing at ${safe.w}×${safe.h}.`, "info", 5000);
        editor.querySelector(".rtpl-ed-empty").style.display = "none";
        editor.querySelector(".rtpl-ed-replace").disabled = (templateId == null);
        syncResizeInputs();
        applyEditorView();
        drawBefore();
        deferredRedraw();

        requestAnimationFrame(fitEditor);
    }

    function applyEditorZoom() {
        if (!editorState) return;
        editorState.zoom = clampZoom(editorState.zoom);
        const z = editorState.zoom;
        const w = Math.max(1, Math.round(editorState.w * z));
        const h = Math.max(1, Math.round(editorState.h * z));
        for (const sel of [".rtpl-ed-before", ".rtpl-ed-after"]) {
            const c = editor.querySelector(sel);
            c.style.width = `${w}px`; c.style.height = `${h}px`;
        }
        const zl = editor.querySelector(".rtpl-ed-zoomv");
        if (zl) zl.textContent = `${Math.round(z * 100)}%`;
    }

    const editorWrap = () => editor.querySelector(".rtpl-ed-pane-after .rtpl-ed-canwrap");

    function wrapAtPoint(clientX, clientY) {
        if (clientX != null) {
            for (const w of editor.querySelectorAll(".rtpl-ed-canwrap")) {
                const r = w.getBoundingClientRect();
                if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return w;
            }
        }
        return editorWrap();
    }

    function computeFitZoom() {
        if (!editorState) return null;
        const wrap = editorWrap();
        const aw = wrap ? wrap.clientWidth : 0, ah = wrap ? wrap.clientHeight : 0;
        if (aw < 4 || ah < 4) return null;
        return Math.min(aw / editorState.w, ah / editorState.h) * 0.98;
    }

    function clampZoom(z) {
        const fit = computeFitZoom();
        const min = fit != null ? fit : 0.05;
        return Math.max(min, Math.min(64, z));
    }

    function fitEditor() {
        if (!editorState) return;
        const fit = computeFitZoom();
        if (fit == null) { requestAnimationFrame(fitEditor); return; }
        editorState.zoom = fit;
        applyEditorZoom();
    }

    function zoomAtPoint(targetZoom, clientX, clientY) {
        if (!editorState || !targetZoom) return;
        const ref = wrapAtPoint(clientX, clientY);
        const z1 = clampZoom(targetZoom);
        if (!ref) { editorState.zoom = z1; applyEditorZoom(); return; }
        const rect = ref.getBoundingClientRect();
        const vw = ref.clientWidth, vh = ref.clientHeight;
        let cx = clientX != null ? clientX - rect.left : vw / 2;
        let cy = clientY != null ? clientY - rect.top : vh / 2;
        cx = clamp(cx, 0, vw); cy = clamp(cy, 0, vh);

        const z0 = editorState.zoom;
        const cw0 = editorState.w * z0, ch0 = editorState.h * z0;
        const offX0 = cw0 < vw ? (vw - cw0) / 2 : -ref.scrollLeft;
        const offY0 = ch0 < vh ? (vh - ch0) / 2 : -ref.scrollTop;
        const fracX = cw0 > 0 ? (cx - offX0) / cw0 : 0.5;
        const fracY = ch0 > 0 ? (cy - offY0) / ch0 : 0.5;

        editorState.zoom = z1;
        applyEditorZoom();

        const cw1 = editorState.w * z1, ch1 = editorState.h * z1;
        if (cw1 > vw) ref.scrollLeft = clamp(fracX * cw1 - cx, 0, cw1 - vw);
        if (ch1 > vh) ref.scrollTop = clamp(fracY * ch1 - cy, 0, ch1 - vh);
    }

    function drawBefore() {
        if (!editorState) return;
        const bc = editor.querySelector(".rtpl-ed-before");
        bc.width = editorState.w; bc.height = editorState.h;
        const ctx = bc.getContext("2d");
        applyScaleAlgorithm(ctx, gEditorScaleAlgorithm);
        ctx.clearRect(0, 0, bc.width, bc.height);
        ctx.drawImage(editorState.srcImg, 0, 0, editorState.w, editorState.h);
        applyEditorZoom();
    }

    function scheduleEditorRedraw() {
        clearTimeout(editorRedrawTimer);
        editorRedrawTimer = setTimeout(deferredRedraw, 120);
    }

    function showEditorLoading(on) {
        const el = editor && editor.querySelector(".rtpl-ed-loading");
        if (el) el.classList.toggle("rtpl-on", !!on);
    }

    function deferredRedraw() {
        if (!editorState) return;
        showEditorLoading(true);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            try { redrawEditor(); } finally { showEditorLoading(false); }
        }));
    }

    function populateEditorPalette() {
        const grid = editor.querySelector(".rtpl-ed-pal-grid");
        grid.innerHTML = "";
        for (const c of PALETTE) {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "rtpl-ed-palcell" + (editorColorSet.has(c.index) ? " rtpl-on" : "");
            cell.dataset.ci = c.index;
            cell.dataset.name = c.name.toLowerCase();
            const rgb = `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})`;
            cell.innerHTML = `<span class="rtpl-sw" style="background:${rgb}"></span>` +
                `<span class="rtpl-ed-palname">#${c.index} ${escapeHtml(c.name)}</span>` +
                `<span class="rtpl-ed-palchk">✓</span>`;
            cell.addEventListener("click", () => {
                if (editorColorSet.has(c.index)) editorColorSet.delete(c.index); else editorColorSet.add(c.index);
                cell.classList.toggle("rtpl-on", editorColorSet.has(c.index));
                updatePalCount(); updatePresetSelection(); deferredRedraw();
            });
            grid.appendChild(cell);
        }
    }
    function syncPaletteChecks() {
        if (!editor) return;
        for (const cell of editor.querySelectorAll(".rtpl-ed-pal-grid .rtpl-ed-palcell")) {
            cell.classList.toggle("rtpl-on", editorColorSet.has(Number(cell.dataset.ci)));
        }
    }
    function updatePalCount() {
        if (!editor) return;
        const btn = editor.querySelector(".rtpl-ed-palbtn");
        if (btn) btn.textContent = `Colors (${editorColorSet.size})`;
        const el = editor.querySelector(".rtpl-ed-pal-count");
        if (el) el.textContent = `${editorColorSet.size} / ${PALETTE.length} enabled`;
    }
    function setEditorColors(indices) {
        editorColorSet.clear();
        for (const i of indices) editorColorSet.add(i);
        syncPaletteChecks(); updatePalCount(); updatePresetSelection(); deferredRedraw();
    }

    const setKeyOf = (indices) => [...indices].map(Number).sort((a, b) => a - b).join(",");
    function presetOptionsHtml() {
        let h = Object.entries(EDITOR_PRESETS).map(([k, p]) => `<option value="b:${k}">${escapeHtml(p.label)}</option>`).join("");
        if (userPresets.length) {
            h += `<optgroup label="Saved">` +
                userPresets.map((p, i) => `<option value="u:${i}">★ ${escapeHtml(p.name)}</option>`).join("") +
                `</optgroup>`;
        }
        h += `<option value="custom">Custom…</option>`;
        return h;
    }
    function rebuildPresetSelect() {
        const sel = editor && editor.querySelector(".rtpl-ed-preset");
        if (!sel) return;
        sel.innerHTML = presetOptionsHtml();
        updatePresetSelection();
    }

    function matchPresetValue() {
        const cur = setKeyOf([...editorColorSet]);
        for (const [k, p] of Object.entries(EDITOR_PRESETS)) {
            if (setKeyOf(p.get().map((c) => c.index)) === cur) return `b:${k}`;
        }
        for (let i = 0; i < userPresets.length; i++) {
            if (setKeyOf(userPresets[i].colors) === cur) return `u:${i}`;
        }
        return "custom";
    }
    function updatePresetSelection() {
        const sel = editor && editor.querySelector(".rtpl-ed-preset");
        if (!sel) return;
        const v = matchPresetValue();
        sel.value = v;
        const delBtn = editor.querySelector(".rtpl-ed-preset-del");
        if (delBtn) delBtn.disabled = !v.startsWith("u:");
    }
    function applyPresetValue(v) {
        if (v === "custom") { updatePresetSelection(); return; }
        if (v.startsWith("b:")) { const p = EDITOR_PRESETS[v.slice(2)]; if (p) setEditorColors(p.get().map((c) => c.index)); }
        else if (v.startsWith("u:")) { const p = userPresets[Number(v.slice(2))]; if (p) setEditorColors(p.colors); }
    }
    function saveCurrentPreset() {
        const colors = [...editorColorSet];
        const key = setKeyOf(colors);
        const builtIn = Object.entries(EDITOR_PRESETS).find(([, p]) => setKeyOf(p.get().map((c) => c.index)) === key);
        if (builtIn) {
            showToast(`This is already the built-in “${builtIn[1].label}” preset.`, "info");
            return;
        }
        const duplicate = userPresets.find((p) => setKeyOf(p.colors) === key);
        if (duplicate) {
            showToast(`These colors are already saved as “${duplicate.name}”.`, "info");
            return;
        }
        const name = (prompt("Save these colors as a preset — name:") || "").trim();
        if (!name) return;
        const existing = userPresets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
        if (existing >= 0) {
            if (!confirm(`Replace “${userPresets[existing].name}” with these colors?`)) return;
            userPresets[existing] = { name, colors };
        } else userPresets.push({ name, colors });
        saveUserPresets();
        rebuildPresetSelect();
    }
    function deleteCurrentPreset() {
        const v = matchPresetValue();
        if (!v.startsWith("u:")) return;
        const i = Number(v.slice(2));
        if (!confirm(`Delete saved preset "${userPresets[i].name}"?`)) return;
        userPresets.splice(i, 1);
        saveUserPresets();
        rebuildPresetSelect();
    }

    function redrawEditor() {
        if (!editorState) return;
        const set = PALETTE.filter((c) => editorColorSet.has(c.index));
        const algo = editor.querySelector(".rtpl-ed-algo").value;
        const strength = Number(editor.querySelector(".rtpl-ed-str").value) / 100;
        if (!set.length) { editor.querySelector(".rtpl-ed-after-info").textContent = "no colors"; return; }
        const out = ditherTo(editorState.srcImg, editorState.w, editorState.h, set, algo, strength, gEditorScaleAlgorithm);
        editorState.result = out;
        const ac = editor.querySelector(".rtpl-ed-after");
        ac.width = editorState.w; ac.height = editorState.h;
        ac.getContext("2d").drawImage(out, 0, 0);
        editor.querySelector(".rtpl-ed-after-info").textContent = `${editorState.w}×${editorState.h}, ${set.length} colors`;
        applyEditorZoom();
    }

    async function editorApply(replace) {
        if (!editorState) return;
        redrawEditor();
        if (!editorState.result) return;
        const dataUrl = editorState.result.toDataURL("image/png");
        if (replace && editorState.templateId != null) {
            const t = getTpl(editorState.templateId);
            if (t) {
                const img = await loadImage(dataUrl);

                t.dataUrl = dataUrl;
                t.naturalW = img.naturalWidth; t.naturalH = img.naturalHeight;
                t.w = t.naturalW; t.h = t.naturalH;
                t.gx = wrapHorizontal(t.gx);
                t.gy = clamp(t.gy, 0, WORLD_PIXELS - t.h);
                resetTemplateCaches(t);
                t._imgEl = img; t._imgPromise = null;
                await updateTemplateTiles(t);
                renderPanel(); updateOverlay(); storeSet();
            }
        } else {
            await addTemplateFromDataUrl(dataUrl, `${editorState.name} (dithered)`, null);
        }
        closeEditor();
    }

    function waitForMap() {
        return new Promise((res) => {
            const check = () => {
                const m = pageWin.map || pageWin.globalThis?.map;
                if (m && typeof m.addSource === "function") { res(m); return true; }
                return false;
            };
            if (check()) return;
            const iv = setInterval(() => { if (check()) clearInterval(iv); }, 250);
        });
    }

    function whenStyleReady(m) {
        return new Promise((res) => {
            if (m.isStyleLoaded && m.isStyleLoaded()) return res();
            const done = () => { m.off("idle", done); m.off("load", done); res(); };
            m.on("load", done);
            m.on("idle", done);

            const iv = setInterval(() => {
                if (m.isStyleLoaded && m.isStyleLoaded()) { clearInterval(iv); done(); }
            }, 250);
        });
    }

    let deferredLayerRenderToken = 0;
    const deferLayerRender = (fn) => {
        if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 250 });
        else setTimeout(fn, 40);
    };

    async function reAddAllLayers() {
        if (!map) return;
        const token = ++deferredLayerRenderToken;
        const deferred = [];
        for (const t of templates) {
            t._tiles = new Map();
            t._dotTiles = new Map();
            if (largeDotTemplate(t)) deferred.push(t);
            else await updateTemplateTiles(t);
        }
        if (!deferred.length) return;
        let index = 0;
        const renderNext = async () => {
            if (!map || token !== deferredLayerRenderToken) return;
            const t = deferred[index++];
            showToast(`Loading large template ${index} of ${deferred.length}…`, "progress", 0);
            try { await updateTemplateTiles(t); } catch (e) { LOG("large template render failed", e); }
            if (index < deferred.length) deferLayerRender(renderNext);
            else showToast("Large templates loaded.", "success", 3000);
        };
        deferLayerRender(renderNext);
    }
    async function init() {

        await loadSettings();
        userPresets = await loadUserPresets();
        const saved = await storeGet([]);
        if (Array.isArray(saved) && saved.length) {
            templates = saved.map((savedTemplate) => {
                const template = {
                    disabled: [], aspectLock: true,
                    opacity: 0.7, visible: true, locked: false, collapsed: false,
                    ...savedTemplate,
                    disabled: Array.isArray(savedTemplate.disabled) ? savedTemplate.disabled : []
                };
                template.gx = wrapHorizontal(Math.round(Number(template.gx) || 0));
                if (Array.isArray(savedTemplate.colorUsage) && savedTemplate.colorUsageFor === colorUsageSignature(template)) {
                    template._usage = savedTemplate.colorUsage
                        .filter((u) => PALETTE_BY_INDEX[u?.index] && Number.isFinite(u.count) && u.count > 0)
                        .map((u) => ({ index: u.index, count: Math.floor(u.count), name: PALETTE_BY_INDEX[u.index].name, rgb: PALETTE_BY_INDEX[u.index].rgb }));
                    template._usageFor = savedTemplate.colorUsageFor;
                }
                return template;
            });
            nextId = Math.max(...templates.map((t) => t.id)) + 1;
            selectedId = templates[0].id;
        }

        buildUI();
        attachDropHandlers();
        attachPaletteSelectionTracking();
        renderPanel();
        templates.forEach(queueColorUsage);
        setStatus("Waiting for map…", "progress", 0);

        map = await waitForMap();
        LOG("map found, waiting for style…");
        await whenStyleReady(map);
        LOG("map ready");
        setStatus("");
        announceUpdate();
        showWalkthrough();

        buildOverlay();
        attachPickHandler();
        attachKeyboardPan();
        await reAddAllLayers();
        updateOverlay();

        fetchUserColors();
        setInterval(fetchUserColors, 60_000);
        setInterval(updateAccountBar, 1000);

        setInterval(autoAnalyzeTick, AUTO_INTERVAL);
        autoAnalyzeTick();

        let zoomDebounce = null, largeDotMoveDebounce = null;
        map.on("zoom", () => {
            clearTimeout(zoomDebounce);
            zoomDebounce = setTimeout(refreshTemplateModes, 120);
        });
        map.on("moveend", () => {
            clearTimeout(largeDotMoveDebounce);
            largeDotMoveDebounce = setTimeout(() => {
                for (const t of templates) if (t._mode === "dots" && largeDotTemplate(t)) queueTemplateRender(t);
            }, 100);
        });

        map.on("style.load", () => { reAddAllLayers().then(updateOverlay); });
    }

    setupPaintFilter();

    const startInit = () => init().catch((e) => LOG("init error", e));
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startInit);
    } else {
        startInit();
    }
})();
