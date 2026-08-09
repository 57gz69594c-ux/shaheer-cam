// ---------- elements ----------
const video = document.getElementById('cam');
const previewCanvas = document.getElementById('preview');
const previewCtx = previewCanvas.getContext('2d');
const resultCanvas = document.getElementById('result');
const liveView = document.getElementById('liveView');
const reviewView = document.getElementById('reviewView');
const filterLabel = document.getElementById('filterLabel');
const rotateBtn = document.getElementById('rotateBtn');
const filmWindow = document.getElementById('filmWindow');
const shutterBtn = document.getElementById('shutterBtn');
const retakeBtn = document.getElementById('retakeBtn');
const saveBtn = document.getElementById('saveBtn');
const errorBox = document.getElementById('errorBox');
const galleryBtn = document.getElementById('galleryBtn');
const galleryView = document.getElementById('galleryView');
const galleryCanvas = document.getElementById('galleryCanvas');
const galleryVideo = document.getElementById('galleryVideo');
const galleryGrid = document.getElementById('galleryGrid');
const galleryGridBtn = document.getElementById('galleryGridBtn');
const galleryEmpty = document.getElementById('galleryEmpty');
const galleryCounter = document.getElementById('galleryCounter');
const galleryBackBtn = document.getElementById('galleryBackBtn');
const galleryDeleteBtn = document.getElementById('galleryDeleteBtn');
const emailBtn = document.getElementById('emailBtn');
const galleryEmailBtn = document.getElementById('galleryEmailBtn');
const toast = document.getElementById('toast');
const resultVideo = document.getElementById('resultVideo');
const recIndicator = document.getElementById('recIndicator');
const borderBtn = document.getElementById('borderBtn');

let toastTimer = null;
function showToast(msg, ms) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), ms || 8000);
}

let appView = 'live'; // 'live' | 'review' | 'gallery'

// ---------- email (EmailJS — sends the photo as an attachment to your own inbox) ----------
const EMAILJS_SERVICE_ID = 'service_349fg0q';
const EMAILJS_TEMPLATE_ID = 'template_kaj2dyv';
const EMAILJS_PUBLIC_KEY = 'w4pGSLR6hhtjI2tx_';
const EMAIL_TO = 'shaheerkhanmysteryperformer@hotmail.com';

if (window.emailjs) emailjs.init(EMAILJS_PUBLIC_KEY);

// EmailJS's free tier caps the total request payload (roughly 50KB) — a
// full-res capture easily blows past that, and when a request is over the
// limit EmailJS can still report success while the oversized `photo` field
// gets dropped, which is exactly what an "empty email" looks like from here.
// Downscaling only the emailed copy (the saved/gallery copy stays full-res)
// keeps every send comfortably under that ceiling.
function scaledJpegDataUrl(sourceCanvas, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(sourceCanvas.width, sourceCanvas.height));
  if (scale >= 1) return sourceCanvas.toDataURL('image/jpeg', quality);
  const small = document.createElement('canvas');
  small.width = Math.round(sourceCanvas.width * scale);
  small.height = Math.round(sourceCanvas.height * scale);
  small.getContext('2d').drawImage(sourceCanvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', quality);
}

function scaledJpegFromDataUrl(dataUrl, maxDim, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(scaledJpegDataUrl(c, maxDim, quality));
    };
    img.src = dataUrl;
  });
}

const EMAIL_MAX_DIM = 640;
const EMAIL_QUALITY = 0.6;

function emailPhoto(dataUrl, btn) {
  if (!window.emailjs) {
    btn.textContent = 'Unavailable';
    setTimeout(() => { btn.textContent = 'Email'; }, 2000);
    return;
  }
  const original = btn.textContent;
  btn.textContent = 'Sending';
  btn.disabled = true;
  btn.classList.add('sending');
  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    photo: dataUrl,
    to_email: EMAIL_TO,
  }).then(() => {
    btn.textContent = 'Sent!';
  }).catch((err) => {
    btn.textContent = 'Failed';
    const detail = (err && (err.text || err.message)) || JSON.stringify(err);
    showToast(`Email error (${err && err.status ? err.status : '?'}): ${detail}`);
    console.error('EmailJS send failed:', err);
  }).finally(() => {
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
      btn.classList.remove('sending');
    }, 2000);
  });
}

// offscreen canvas holding the current rotated, un-graded camera frame
const rotCanvas = document.createElement('canvas');
const rotCtx = rotCanvas.getContext('2d');
// scratch canvas for the full rotated frame before it gets center-cropped
// down to the screen's own aspect ratio (see drawRotatedFrame)
const rotFullCanvas = document.createElement('canvas');
const rotFullCtx = rotFullCanvas.getContext('2d');
// R1 screen is 240x282 — every capture (live preview, photo, video) is
// center-cropped to this exact aspect ratio so it fills the screen edge to
// edge instead of showing the camera's native (mismatched) aspect ratio
// letterboxed/pillarboxed.
const SCREEN_ASPECT = 240 / 282;

// the live camera MediaStream, kept around so it can be torn down on facing switch
let cameraStream = null;
// separately-acquired mic MediaStream, kept around so recording can pull an audio track from it
let micStream = null;

// ---------- film looks ----------
// Each preset emulates a real film stock: a base color grade (css filter),
// a black-lift (film shadows are never pure black), a split-tone color cast,
// grain, a tinted vignette, and stock-specific extras (halation, light leak,
// dust/scratches, highlight haze). Grades are pushed hard against each other
// on purpose — warm vs cool, punchy vs muted, color vs mono — so consecutive
// filters read as genuinely different stocks, not variations on one look.
// `haze` = a soft mist/glow bloomed out of the highlights (not every stock
// gets it — only the ones where that hazy, dreamy vintage glow is authentic).
const FILTERS = {
  // No film look at all — the raw camera capture, untouched. `raw: true`
  // short-circuits the photo grading pipeline (applyFilmLook) entirely.
  // Video never carries any baked-in grade regardless of filter (see
  // startRecording), so `raw` has no separate video-side effect to skip —
  // just the CSS color filter applied at playback, which is 'none' here.
  // First in the list — the default on open.
  'R1': {
    raw: true,
    css: 'none',
    blackLift: null,
    tint: null,
    grain: 0,
    vignette: { strength: 0, color: '0,0,0' },
    lightLeak: false,
    scratches: false,
    halation: false,
    haze: false,
    blur: 0,
  },
  'Cinestill Night': {
    css: 'contrast(1.3) saturate(0.9) brightness(0.92) hue-rotate(6deg)',
    blackLift: 'rgba(4,10,22,0.24)',
    tint: { color: 'rgba(255,110,50,0.18)', blend: 'soft-light' },
    grain: 0.15,
    vignette: { strength: 0.44, color: '2,6,20' },
    lightLeak: false,
    scratches: false,
    halation: true,
    haze: true,
    blur: 0,
  },
  'Polaroid': {
    css: 'contrast(0.9) saturate(1.5) brightness(1.15) sepia(0.12) hue-rotate(-4deg)',
    blackLift: 'rgba(52,42,26,0.28)',
    tint: [
      { color: 'rgba(255,200,120,0.16)', blend: 'soft-light' },
      { color: 'rgba(255,255,255,0.06)', blend: 'screen' },
    ],
    grain: 0.16,
    vignette: { strength: 0.4, color: '40,28,14' },
    lightLeak: false,
    scratches: false,
    halation: false,
    haze: true,
    blur: 0.4,
  },
  // Three more in the same "amazing color, hazy film glow" family as the
  // two favorites above — each pushed toward a distinct mood/palette rather
  // than being a minor variation on Cinestill Night or Polaroid.
  'Golden Hour': {
    css: 'contrast(1.08) saturate(1.35) brightness(1.1) hue-rotate(-4deg)',
    blackLift: 'rgba(40,24,8,0.14)',
    tint: [
      { color: 'rgba(255,176,64,0.22)', blend: 'soft-light' },
      { color: 'rgba(255,90,20,0.08)', blend: 'overlay' },
    ],
    grain: 0.1,
    vignette: { strength: 0.3, color: '40,20,4' },
    lightLeak: false,
    scratches: false,
    halation: true,
    haze: true,
    blur: 0.15,
  },
  'Neon Dusk': {
    css: 'contrast(1.28) saturate(1.5) brightness(0.96) hue-rotate(18deg)',
    blackLift: 'rgba(10,4,26,0.18)',
    tint: [
      { color: 'rgba(255,40,160,0.16)', blend: 'soft-light' },
      { color: 'rgba(40,200,255,0.14)', blend: 'screen' },
    ],
    grain: 0.12,
    vignette: { strength: 0.5, color: '8,2,20' },
    lightLeak: false,
    scratches: false,
    halation: true,
    haze: true,
    blur: 0,
  },
  'Dream Haze': {
    css: 'contrast(0.88) saturate(0.92) brightness(1.16) hue-rotate(-8deg)',
    blackLift: 'rgba(48,36,44,0.22)',
    tint: [
      { color: 'rgba(255,200,230,0.2)', blend: 'soft-light' },
      { color: 'rgba(190,190,255,0.12)', blend: 'screen' },
    ],
    grain: 0.08,
    vignette: { strength: 0.2, color: '40,30,44' },
    lightLeak: false,
    scratches: false,
    halation: false,
    haze: true,
    blur: 0.4,
  },
  'Kodachrome': {
    css: 'contrast(1.38) saturate(1.75) brightness(0.98) hue-rotate(3deg)',
    blackLift: 'rgba(12,6,4,0.04)',
    tint: { color: 'rgba(255,55,15,0.13)', blend: 'soft-light' },
    grain: 0.05,
    vignette: { strength: 0.32, color: '18,4,2' },
    lightLeak: false,
    scratches: false,
    halation: false,
    haze: false,
    blur: 0,
  },
  'Lomo': {
    css: 'contrast(1.45) saturate(1.9) brightness(1.08) hue-rotate(14deg)',
    blackLift: 'rgba(26,4,32,0.16)',
    tint: [
      { color: 'rgba(140,255,60,0.18)', blend: 'overlay' },
      { color: 'rgba(255,0,170,0.14)', blend: 'soft-light' },
    ],
    grain: 0.22,
    vignette: { strength: 0.78, color: '5,0,15' },
    lightLeak: true,
    scratches: false,
    halation: false,
    haze: false,
    blur: 0,
  },
  'Kodak Gold': {
    css: 'contrast(1.2) saturate(1.45) brightness(1.06) hue-rotate(-2deg)',
    blackLift: 'rgba(24,15,6,0.1)',
    tint: { color: 'rgba(255,178,60,0.2)', blend: 'soft-light' },
    grain: 0.09,
    vignette: { strength: 0.24, color: '28,16,4' },
    lightLeak: false,
    scratches: false,
    halation: false,
    haze: true,
    blur: 0,
  },
  'Fuji Chrome': {
    css: 'contrast(1.22) saturate(1.2) brightness(0.98) hue-rotate(-16deg)',
    blackLift: 'rgba(6,20,22,0.08)',
    tint: { color: 'rgba(55,210,190,0.18)', blend: 'soft-light' },
    grain: 0.06,
    vignette: { strength: 0.26, color: '4,18,18' },
    lightLeak: false,
    scratches: false,
    halation: false,
    haze: false,
    blur: 0,
  },
  'Infrared Dream': {
    css: 'contrast(1.25) saturate(1.6) brightness(1.05) hue-rotate(130deg)',
    blackLift: 'rgba(30,4,16,0.1)',
    tint: [
      { color: 'rgba(255,60,140,0.22)', blend: 'soft-light' },
      { color: 'rgba(255,255,255,0.08)', blend: 'screen' },
    ],
    grain: 0.14,
    vignette: { strength: 0.38, color: '40,4,20' },
    lightLeak: false,
    scratches: false,
    halation: true,
    haze: true,
    blur: 0.1,
  },
  'Velvia Punch': {
    css: 'contrast(1.35) saturate(1.85) brightness(1.02) hue-rotate(2deg)',
    blackLift: 'rgba(10,14,6,0.05)',
    tint: { color: 'rgba(20,200,120,0.1)', blend: 'soft-light' },
    grain: 0.05,
    vignette: { strength: 0.3, color: '6,14,6' },
    lightLeak: false,
    scratches: false,
    halation: false,
    haze: false,
    blur: 0,
  },
  'Noir': {
    css: 'contrast(1.5) saturate(0.08) brightness(0.96) hue-rotate(200deg)',
    blackLift: 'rgba(10,14,22,0.06)',
    tint: { color: 'rgba(40,60,90,0.1)', blend: 'soft-light' },
    grain: 0.22,
    vignette: { strength: 0.6, color: '0,4,10' },
    lightLeak: false,
    scratches: true,
    halation: false,
    haze: false,
    blur: 0,
  },
  // Named after and modeled on the real film gauges, not any particular
  // app's proprietary recipe: 8mm is the classic amateur home-movie
  // format — heaviest grain of any of these, warm degraded amateur-
  // Kodachrome color, heavy vignette from cheap lenses, soft optics,
  // light leaks and dust/scratches.
  '8mm': {
    css: 'contrast(1.1) saturate(0.7) brightness(1.08) sepia(0.35) hue-rotate(-6deg)',
    blackLift: 'rgba(45,30,12,0.26)',
    tint: [
      { color: 'rgba(255,190,90,0.2)', blend: 'soft-light' },
      { color: 'rgba(120,150,90,0.08)', blend: 'soft-light' },
    ],
    grain: 0.32,
    vignette: { strength: 0.62, color: '30,18,6' },
    lightLeak: true,
    scratches: true,
    halation: false,
    haze: true,
    blur: 0.55,
  },
  // 16mm is a step up in film gauge from 8mm — professional/documentary
  // territory (news, indie film), noticeably finer grain, truer color,
  // less vignette, sharper optics. Still filmic, but cleaner and more
  // "cinematic" than 8mm's degraded amateur warmth rather than a minor
  // variation on it.
  '16mm': {
    css: 'contrast(1.18) saturate(1.05) brightness(1.02) sepia(0.1) hue-rotate(-2deg)',
    blackLift: 'rgba(25,20,15,0.14)',
    tint: { color: 'rgba(255,210,170,0.1)', blend: 'soft-light' },
    grain: 0.17,
    vignette: { strength: 0.32, color: '15,12,8' },
    lightLeak: false,
    scratches: true,
    halation: false,
    haze: false,
    blur: 0.15,
  },
};
const FILTER_NAMES = Object.keys(FILTERS);
let currentFilter = 'R1';

// A tiny gradient swatch under the filter name, built straight from that
// filter's own tint/vignette colors — a quick piece of "artwork" standing
// in for its actual palette, rather than a generic icon.
const filterSwatch = document.getElementById('filterSwatch');
function updateFilterUI() {
  filterLabel.textContent = currentFilter;
  const f = FILTERS[currentFilter];
  const tints = Array.isArray(f.tint) ? f.tint : (f.tint ? [f.tint] : []);
  const stops = [`rgba(${f.vignette.color},0.95)`, ...tints.map((t) => t.color), `rgba(${f.vignette.color},0.95)`];
  filterSwatch.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
}
updateFilterUI();

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Deliberately not FileReader.readAsDataURL — that's the one thing that
// stayed constant across three different storage strategies (IndexedDB, one
// big creationStorage value, chunked creationStorage values) that all still
// corrupted on readback. Photos never hit this path at all (they go through
// canvas.toDataURL instead) and have never failed, so FileReader on a large
// binary video Blob, on this specific webview, is the most likely remaining
// suspect. This uses Blob.arrayBuffer() + manual byte-to-base64 conversion
// instead, a completely different code path, chunked to avoid blowing the
// call stack on String.fromCharCode for a large byte array.
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ---------- orientation ----------
// R1 is held with the scroll wheel on top / camera at top-left, so the raw
// camera frame needs a quarter turn to come out upright. Defaults to 90 but
// is adjustable on-device (tap the rotate button) and persisted locally,
// since it can't be verified against real hardware from here.
// Cached in memory — read once at startup, not on every frame. getRotation
// is called from renderLoop (every one of 24-60 frames/sec); hitting
// localStorage that often for a value that only ever changes from a
// button tap is pure waste on hardware this constrained.
let cachedRotation = parseInt(localStorage.getItem('r1-rotation') || '90', 10);
function getRotation() {
  return cachedRotation;
}
function setRotation(deg) {
  cachedRotation = ((deg % 360) + 360) % 360;
  localStorage.setItem('r1-rotation', String(cachedRotation));
}
rotateBtn.addEventListener('click', () => setRotation(getRotation() + 90));

// ---------- front/selfie camera ----------
// R1's camera is a single physically-rotating module (spun to face you via
// the scroll wheel), not a pair of front/rear sensors, so a software camera
// switch may or may not do anything depending on how the OS exposes it.
// `facingMode: { ideal }` is used (not `exact`) so the request is a no-op
// rather than an error if only one camera is ever exposed. What always
// works, regardless of hardware, is mirroring the frame — the thing that
// actually makes a selfie look right once the lens is facing you.
// Same caching reasoning as cachedRotation above — isSelfieMode runs every
// frame too.
let cachedFacing = localStorage.getItem('r1-facing') || 'environment';
function getFacing() {
  return cachedFacing;
}
function setFacing(v) {
  cachedFacing = v;
  localStorage.setItem('r1-facing', v);
}
function isSelfieMode() {
  return cachedFacing === 'user';
}

// Cached crop geometry — only recomputed when the rotated frame's own
// dimensions change (facing/rotation-setting changes), not every call.
// Single call site (renderLoop), so one shared cache is safe.
let cropCacheRW = -1;
let cropCacheRH = -1;
let cropCacheW = 0;
let cropCacheH = 0;
let cropCacheX = 0;
let cropCacheY = 0;

function drawRotatedFrame(ctx, source, sw, sh, rotation, canvas, mirror) {
  const swapped = rotation === 90 || rotation === 270;
  const rw = swapped ? sh : sw;
  const rh = swapped ? sw : sh;

  // Setting canvas.width/height reallocates its backing buffer even when
  // assigned the same value it already holds — real cost on every one of
  // 24-60 frames/sec if done unconditionally, for dimensions that in
  // practice only change on a facing flip or rotation-setting change.
  if (rotFullCanvas.width !== rw || rotFullCanvas.height !== rh) {
    rotFullCanvas.width = rw;
    rotFullCanvas.height = rh;
  }
  rotFullCtx.save();
  rotFullCtx.translate(rw / 2, rh / 2);
  rotFullCtx.rotate((rotation * Math.PI) / 180);
  if (mirror) rotFullCtx.scale(-1, 1);
  rotFullCtx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
  rotFullCtx.restore();

  if (rw !== cropCacheRW || rh !== cropCacheRH) {
    cropCacheRW = rw;
    cropCacheRH = rh;
    cropCacheW = rw;
    cropCacheH = rh;
    if (rw / rh > SCREEN_ASPECT) {
      cropCacheW = Math.round(rh * SCREEN_ASPECT);
    } else {
      cropCacheH = Math.round(rw / SCREEN_ASPECT);
    }
    cropCacheX = Math.round((rw - cropCacheW) / 2);
    cropCacheY = Math.round((rh - cropCacheH) / 2);
  }

  if (canvas.width !== cropCacheW || canvas.height !== cropCacheH) {
    canvas.width = cropCacheW;
    canvas.height = cropCacheH;
  }
  ctx.drawImage(rotFullCanvas, cropCacheX, cropCacheY, cropCacheW, cropCacheH, 0, 0, cropCacheW, cropCacheH);
}

// ---------- live preview loop ----------
// Deliberately lightweight: just the base CSS color filter, not a full
// per-frame grading pipeline (grain/vignette/haze/halation) — that heavier
// version was tried directly in this loop and made the whole app sluggish,
// running constantly in the background even while just reviewing a photo,
// not bounded to anything. This same canvas is also what video recording
// captures directly (see startRecording) — full grading stays photo-only,
// a one-shot cost at capture time (applyFilmLook) where it doesn't matter.
function renderLoop() {
  if (video.readyState >= 2 && video.videoWidth) {
    drawRotatedFrame(rotCtx, video, video.videoWidth, video.videoHeight, getRotation(), rotCanvas, isSelfieMode());
    if (previewCanvas.width !== rotCanvas.width || previewCanvas.height !== rotCanvas.height) {
      previewCanvas.width = rotCanvas.width;
      previewCanvas.height = rotCanvas.height;
    }
    previewCtx.filter = FILTERS[currentFilter].css;
    previewCtx.drawImage(rotCanvas, 0, 0);
    previewCtx.filter = 'none';
  }
  requestAnimationFrame(renderLoop);
}

// ---------- film processing (applied at capture time, full quality) ----------
function generateNoiseCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cctx = c.getContext('2d');
  const imgData = cctx.createImageData(w, h);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    imgData.data[i] = v;
    imgData.data[i + 1] = v;
    imgData.data[i + 2] = v;
    imgData.data[i + 3] = 255;
  }
  cctx.putImageData(imgData, 0, 0);
  return c;
}

function drawGrain(ctx, w, h, intensity) {
  const noise = generateNoiseCanvas(w, h);
  ctx.save();
  ctx.globalAlpha = intensity;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(noise, 0, 0);
  ctx.restore();
}

function drawVignette(ctx, w, h, strength, rgb) {
  const grad = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.25,
    w / 2, h / 2, Math.max(w, h) * 0.75
  );
  grad.addColorStop(0, `rgba(${rgb},0)`);
  grad.addColorStop(1, `rgba(${rgb},${strength})`);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// Film shadows never crush to pure black — this lifts the floor slightly.
function drawBlackLift(ctx, w, h, rgba) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighten';
  ctx.fillStyle = rgba;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// Flat color wash blended in — the classic split-tone trick for a stock's color cast.
function drawTint(ctx, w, h, rgba, blend) {
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.fillStyle = rgba;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// Soft glow bloom around bright highlights (Cinestill-style halation).
function drawHalation(ctx, w, h) {
  const bright = document.createElement('canvas');
  bright.width = w;
  bright.height = h;
  const bctx = bright.getContext('2d');
  bctx.filter = 'brightness(1.8) contrast(3) blur(3px)';
  bctx.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.35;
  ctx.drawImage(bright, 0, 0);
  ctx.restore();
}

// Soft, wide mist/glow bloomed out of the highlights — a hazy vintage veil,
// distinct from halation's tighter point-light bloom. Only stocks flagged
// `haze` get it, so it stays a deliberate look rather than a blanket filter.
function drawHaze(ctx, w, h) {
  const bright = document.createElement('canvas');
  bright.width = w;
  bright.height = h;
  const bctx = bright.getContext('2d');
  bctx.filter = 'brightness(1.5) blur(7px)';
  bctx.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.22;
  ctx.drawImage(bright, 0, 0);
  ctx.restore();
}

function drawLightLeak(ctx, w, h) {
  const corners = [
    [0, 0, w * 0.7, h * 0.7],
    [w, 0, w * 0.3, h * 0.7],
    [0, h, w * 0.7, h * 0.3],
    [w, h, w * 0.3, h * 0.3],
  ];
  const [cx, cy, rx] = corners[Math.floor(Math.random() * corners.length)];
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, h * 0.6));
  grad.addColorStop(0, 'rgba(255,140,40,0.55)');
  grad.addColorStop(0.5, 'rgba(255,80,60,0.25)');
  grad.addColorStop(1, 'rgba(255,80,60,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawScratches(ctx, w, h) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const scratchCount = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < scratchCount; i++) {
    const x = Math.random() * w;
    ctx.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.15})`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 10, h);
    ctx.stroke();
  }
  const dustCount = 15 + Math.floor(Math.random() * 20);
  for (let i = 0; i < dustCount; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function applyFilmLook(canvas, filterName) {
  const f = FILTERS[filterName];
  if (f.raw) return; // canvas already holds the untouched capture
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');

  // base color grade + optional softness, redrawn through a CSS filter
  const graded = document.createElement('canvas');
  graded.width = w;
  graded.height = h;
  const gctx = graded.getContext('2d');
  gctx.filter = f.blur ? `${f.css} blur(${f.blur}px)` : f.css;
  gctx.drawImage(canvas, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(graded, 0, 0);

  if (f.blackLift) drawBlackLift(ctx, w, h, f.blackLift);
  if (f.tint) {
    (Array.isArray(f.tint) ? f.tint : [f.tint]).forEach((t) => drawTint(ctx, w, h, t.color, t.blend));
  }
  if (f.halation) drawHalation(ctx, w, h);
  if (f.haze) drawHaze(ctx, w, h);
  drawGrain(ctx, w, h, f.grain);
  drawVignette(ctx, w, h, f.vignette.strength, f.vignette.color);
  if (f.lightLeak) drawLightLeak(ctx, w, h);
  if (f.scratches) drawScratches(ctx, w, h);
}

// ---------- saved-photo gallery (persisted so photos survive app restarts) ----------
// window.creationStorage is the official R1 SDK bridge for durable storage;
// localStorage is the fallback when it's unavailable (e.g. testing in a desktop browser).
const MAX_GALLERY = 20;

async function loadGallery() {
  try {
    if (window.creationStorage && window.creationStorage.plain) {
      const raw = await window.creationStorage.plain.getItem('gallery');
      return raw ? JSON.parse(atob(raw)) : [];
    }
  } catch (e) { /* fall through to localStorage */ }
  try {
    return JSON.parse(localStorage.getItem('gallery') || '[]');
  } catch (e) {
    return [];
  }
}

async function saveGallery(list) {
  const json = JSON.stringify(list);
  try {
    if (window.creationStorage && window.creationStorage.plain) {
      await window.creationStorage.plain.setItem('gallery', btoa(json));
      return;
    }
  } catch (e) { /* fall through to localStorage */ }
  try {
    localStorage.setItem('gallery', json);
  } catch (e) { /* storage full or unavailable — photo just won't persist */ }
}

// Video blobs go in a chunked base64 store, not the small metadata list
// above — that list only carries a thumbnail (one graded frame, JPEG) per
// video plus an id used as the key prefix for the full video here.
//
// This went through two earlier designs that both failed on-device:
// IndexedDB (never came back on reopen — the R1 SDK only documents
// creationStorage as persistent, nothing about IndexedDB surviving in
// whatever sandbox the webview runs in), then a single creationStorage.plain
// value per video (~350-400KB as a btoa'd string even for a small ~0.2MB
// clip) — which still corrupted on readback ("atob: string is not correctly
// encoded"). A 0.2MB clip is nowhere near any storage quota, which points at
// the storage bridge itself having a much smaller per-value size limit than
// that — plausible for a channel meant for small preference strings. So the
// payload is now split into small chunks, each written and read back as its
// own creationStorage.plain key, keeping every individual call small
// regardless of total video size.
const VIDEO_CHUNK_SIZE = 8000; // conservative — comfortably under any likely per-value limit

function videoChunkKey(id, part) {
  return `video_${id}_${part}`;
}

async function storagePlainSet(key, value) {
  try {
    if (window.creationStorage && window.creationStorage.plain) {
      await window.creationStorage.plain.setItem(key, value);
      return true;
    }
  } catch (e) { /* fall through to localStorage */ }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}
async function storagePlainGet(key) {
  try {
    if (window.creationStorage && window.creationStorage.plain) {
      const v = await window.creationStorage.plain.getItem(key);
      if (v != null) return v;
    }
  } catch (e) { /* fall through to localStorage */ }
  return localStorage.getItem(key);
}
async function storagePlainRemove(key) {
  try {
    if (window.creationStorage && window.creationStorage.plain) {
      await window.creationStorage.plain.removeItem(key);
    }
  } catch (e) { /* ignore */ }
  localStorage.removeItem(key);
}

async function saveVideoBlob(id, blob, mime) {
  const base64 = await blobToBase64(blob);
  // Sanity-check the encode itself, entirely in memory, before any storage
  // call happens — this pins down whether a future failure is the encoding
  // step or the storage layer, instead of leaving both as suspects again.
  if (atob(base64).length !== blob.size) {
    throw new Error(`in-memory encode mismatch (encoded ${atob(base64).length}, expected ${blob.size})`);
  }
  const payload = btoa(JSON.stringify({ mime, base64 }));
  const chunkCount = Math.ceil(payload.length / VIDEO_CHUNK_SIZE);
  for (let i = 0; i < chunkCount; i++) {
    const chunk = payload.slice(i * VIDEO_CHUNK_SIZE, (i + 1) * VIDEO_CHUNK_SIZE);
    const ok = await storagePlainSet(videoChunkKey(id, i), chunk);
    // Read the chunk straight back too — catches corruption per-chunk,
    // right where it happens, instead of only discovering it later as one
    // big opaque atob failure on the reassembled payload.
    const verify = ok ? await storagePlainGet(videoChunkKey(id, i)) : null;
    if (!ok || verify !== chunk) {
      throw new Error(`chunk ${i + 1}/${chunkCount} failed to write correctly`);
    }
  }
  await storagePlainSet(videoChunkKey(id, 'count'), String(chunkCount));
}

async function loadVideoBlob(id) {
  const countRaw = await storagePlainGet(videoChunkKey(id, 'count'));
  if (!countRaw) return null;
  const chunkCount = parseInt(countRaw, 10);
  let payload = '';
  for (let i = 0; i < chunkCount; i++) {
    const chunk = await storagePlainGet(videoChunkKey(id, i));
    if (chunk == null) return null;
    payload += chunk;
  }
  const { mime, base64 } = JSON.parse(atob(payload));
  return { blob: base64ToBlob(base64, mime), mime };
}

async function deleteVideoBlob(id) {
  const countRaw = await storagePlainGet(videoChunkKey(id, 'count'));
  const chunkCount = countRaw ? parseInt(countRaw, 10) : 0;
  for (let i = 0; i < chunkCount; i++) await storagePlainRemove(videoChunkKey(id, i));
  await storagePlainRemove(videoChunkKey(id, 'count'));
}

async function trimGallery(list) {
  while (list.length > MAX_GALLERY) {
    const removed = list.shift();
    if (removed && removed.type === 'video') await deleteVideoBlob(removed.id);
  }
}

async function addPhotoToGallery(dataUrl, filterName) {
  const list = await loadGallery();
  list.push({ id: Date.now(), type: 'photo', filter: filterName, dataUrl });
  await trimGallery(list);
  await saveGallery(list);
}

// Byte-for-byte, not just size — a length match can still hide corruption
// (e.g. chunks reassembled out of order) that would only surface later as
// "saved fine, won't play." This is the only way to actually catch that
// before the gallery entry is created instead of after.
async function blobsMatch(a, b) {
  if (a.size !== b.size) return false;
  const [bufA, bufB] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const bytesA = new Uint8Array(bufA);
  const bytesB = new Uint8Array(bufB);
  for (let i = 0; i < bytesA.length; i++) {
    if (bytesA[i] !== bytesB[i]) return false;
  }
  return true;
}

async function addVideoToGallery(blob, mime, filterName, thumbDataUrl) {
  const id = Date.now();
  try {
    await saveVideoBlob(id, blob, mime);
    const verify = await loadVideoBlob(id);
    if (!verify || !verify.blob || !(await blobsMatch(blob, verify.blob))) {
      throw new Error('saved video failed round-trip verification');
    }
  } catch (e) {
    console.error('Video gallery save failed:', e);
    deleteVideoBlob(id).catch(() => {});
    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    showToast(`Couldn't save video to gallery (${sizeMb}MB): ${e && e.message ? e.message : 'unknown error'}`, 6000);
    return;
  }
  const list = await loadGallery();
  list.push({ id, type: 'video', filter: filterName, mime, thumbDataUrl });
  await trimGallery(list);
  await saveGallery(list);
  showToast('Saved to gallery', 1500);
}

// ---------- Polaroid-style white border (toggle) ----------
function getBorderEnabled() {
  return localStorage.getItem('r1-border') === '1';
}
function setBorderEnabled(v) {
  localStorage.setItem('r1-border', v ? '1' : '0');
  updateBorderBtn();
}
function updateBorderBtn() {
  const on = getBorderEnabled();
  borderBtn.classList.toggle('active', on);
  borderBtn.textContent = on ? '▨' : '▭';
}
borderBtn.addEventListener('click', () => setBorderEnabled(!getBorderEnabled()));
updateBorderBtn();

// Classic instant-film frame: even side/top margin, deeper bottom margin,
// warm off-white (real Polaroid stock is never pure white).
function addPolaroidBorder(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const side = Math.round(w * 0.06);
  const top = side;
  const bottom = Math.round(h * 0.18);
  const bordered = document.createElement('canvas');
  bordered.width = w + side * 2;
  bordered.height = h + top + bottom;
  const bctx = bordered.getContext('2d');
  bctx.fillStyle = '#f4f1e8';
  bctx.fillRect(0, 0, bordered.width, bordered.height);
  bctx.drawImage(canvas, side, top);
  return bordered;
}

// Native <video controls> was covering/blocking our own Back button in both
// the review and gallery screens (the browser's own control bar and our
// bottom button row occupy the same strip of screen). Removed `controls`
// from both video elements in favor of this: tap the video to toggle
// play/pause, leaving our custom button row as the only bottom UI.
function wireVideoTapToggle(videoEl) {
  // play() returns a promise that doesn't settle until playback actually
  // starts decoding — on slower hardware that can take a moment. Tapping
  // pause (or tapping play again) before it settles makes the browser
  // reject that promise with a benign AbortError ("interrupted by a call
  // to pause()"), which isn't a real failure. Tracking the in-flight
  // promise lets a pause wait for it to settle instead of racing it, and
  // AbortError is filtered out of the error toast either way.
  let pendingPlay = null;
  videoEl.addEventListener('click', () => {
    if (!videoEl.paused) {
      if (pendingPlay) pendingPlay.finally(() => videoEl.pause());
      else videoEl.pause();
      return;
    }
    pendingPlay = videoEl.play();
    pendingPlay.then(() => { pendingPlay = null; }).catch((err) => {
      pendingPlay = null;
      if (err && err.name === 'AbortError') return;
      console.error('video play() failed:', err);
      showToast(`Can't play video: ${err && err.message ? err.message : 'unknown error'}`, 3000);
    });
  });
  // A play() failure that isn't a permissions/gesture issue (NotAllowedError)
  // usually means the media itself won't decode — surface that too, since
  // "tap play, nothing happens" was otherwise silent either way.
  videoEl.addEventListener('error', () => {
    const err = videoEl.error;
    console.error('video element error:', err);
    showToast(`Video error: ${err ? err.message || `code ${err.code}` : 'unknown'}`, 3000);
  });
}
wireVideoTapToggle(resultVideo);
wireVideoTapToggle(galleryVideo);

// ---------- capture / review flow ----------
// Nothing is written to the gallery at capture time anymore — a shot only
// exists in-memory while you're reviewing it. It's only persisted (and only
// downloaded to the device) when you explicitly press Save; Back/Retake, or
// the back-gesture guard, just drop it.
let reviewMediaType = 'photo'; // 'photo' | 'video'
let currentVideoUrl = null;
let currentVideoBlob = null;
let currentVideoExt = 'webm';
let currentVideoThumb = '';
let currentItemSaved = false;

function enterReview(type) {
  reviewMediaType = type;
  currentItemSaved = false;
  resultCanvas.classList.toggle('hidden', type !== 'photo');
  resultVideo.classList.toggle('hidden', type !== 'video');
  emailBtn.classList.toggle('hidden', type !== 'photo'); // video files are too large for EmailJS
  liveView.classList.add('hidden');
  reviewView.classList.remove('hidden');
  appView = 'review';
}

function capturePhoto() {
  if (appView !== 'live' || !rotCanvas.width) return;
  const shot = document.createElement('canvas');
  shot.width = rotCanvas.width;
  shot.height = rotCanvas.height;
  shot.getContext('2d').drawImage(rotCanvas, 0, 0);
  applyFilmLook(shot, currentFilter);

  const finalShot = getBorderEnabled() ? addPolaroidBorder(shot) : shot;

  resultCanvas.width = finalShot.width;
  resultCanvas.height = finalShot.height;
  resultCanvas.getContext('2d').drawImage(finalShot, 0, 0);

  enterReview('photo');
}

// Shared by the Retake button, the on-screen review Back button, and the
// hardware/OS back-gesture guard below — all three just mean "go back to
// the live camera view" and, if Save was never pressed, discard the shot.
function exitReviewToLive() {
  if (currentVideoUrl) {
    URL.revokeObjectURL(currentVideoUrl);
    currentVideoUrl = null;
    resultVideo.pause();
    resultVideo.removeAttribute('src');
    resultVideo.load();
  }
  currentVideoBlob = null;
  currentVideoThumb = '';
  reviewView.classList.add('hidden');
  liveView.classList.remove('hidden');
  appView = 'live';
}

retakeBtn.addEventListener('click', exitReviewToLive);

emailBtn.addEventListener('click', () => {
  emailPhoto(scaledJpegDataUrl(resultCanvas, EMAIL_MAX_DIM, EMAIL_QUALITY), emailBtn);
});

saveBtn.addEventListener('click', async () => {
  if (currentItemSaved) {
    showToast('Already saved', 1200);
    return;
  }
  currentItemSaved = true;
  if (reviewMediaType === 'video') {
    if (!currentVideoBlob) return;
    // Deliberately NOT triggering a file download here (no downloadDataUrl
    // call). An <a download> click for a video blob was, on this device,
    // apparently not being honored as a download at all — instead it looks
    // to have been handed to the native Android video player, which takes
    // the whole screen over outside our page (explains the snap back to
    // portrait, the gray native play button, and why only the hardware back
    // button — which exits the app — got out of it). It also fired before
    // the gallery save below ever got a chance to run, which is very
    // possibly why videos never made it into the gallery either. Only the
    // in-app gallery save happens now; it reports its own success/failure.
    await addVideoToGallery(currentVideoBlob, currentVideoBlob.type || 'video/webm', currentFilter, currentVideoThumb);
    return;
  }
  // Same fix as the video branch above, same reasoning: an <a download>
  // click was very likely not being honored as a download on this device
  // for photos either, handing off to a native viewer that takes the whole
  // screen over outside our page instead — which matches "no back button"
  // being reported here for photos too, not just video. Gallery save only.
  // Quality raised 0.7->0.85, kept deliberately short of "highest possible"
  // — the whole photo gallery list is stored as one combined value, not
  // chunked the way video is (see saveVideoBlob), so pushing this too far
  // risks the exact same single-oversized-value corruption that was fixed
  // for video. Restoring the 720p floor above already does more for
  // visible quality than JPEG quality alone would.
  addPhotoToGallery(resultCanvas.toDataURL('image/jpeg', 0.85), currentFilter);
  showToast('Saved to gallery', 1500);
});

// ---------- video recording ----------
// Recorded via MediaRecorder on a canvas stream that's graded frame-by-frame
// in real time, at the camera's own native frame rate and a high bitrate —
// no downscaling, no duration cap. Only written into the gallery (see
// addVideoToGallery above) once Save is pressed in review, same as photos;
// not emailable either way — EmailJS has no room for video-sized
// attachments. Uncapped duration means long clips can get large; that's
// fine for Save (a real file download), but addVideoToGallery already
// handles the in-app-gallery storage failing gracefully if a clip is too
// big for on-device storage.
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordStartTime = 0;
let recordTimerInterval = null;

// h264/mp4 first — generally hardware-decoded/encoded on more devices than
// vp8/vp9, which are often software-only. Confirmed against a sibling R1
// creation (r1-video-creation) built for this same hardware, which found
// this ordering meaningfully more reliable in real-time use.
function pickVideoMimeType() {
  if (!window.MediaRecorder) return '';
  const candidates = [
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

// Record at whatever frame rate the camera itself reports, rather than a
// fixed guess, so playback is as smooth as the sensor actually supports.
function getCameraFrameRate() {
  const track = cameraStream && cameraStream.getVideoTracks()[0];
  const settings = track && track.getSettings ? track.getSettings() : null;
  return (settings && settings.frameRate) ? Math.round(settings.frameRate) : 24;
}

function updateRecTimer() {
  const secs = Math.floor((Date.now() - recordStartTime) / 1000);
  const mins = Math.floor(secs / 60);
  recIndicator.textContent = `● REC ${mins}:${String(secs % 60).padStart(2, '0')}`;
}

function startRecording() {
  if (appView !== 'live' || isRecording || !rotCanvas.width) return;
  if (!window.MediaRecorder) {
    showToast('Video recording is not supported on this device');
    return;
  }
  const mimeType = pickVideoMimeType();
  const fps = getCameraFrameRate();
  // Captures previewCanvas directly — the same canvas already being
  // redrawn every frame for the live view regardless of recording state
  // (see renderLoop). Recording used to run a second, separate per-frame
  // pipeline (a dedicated recordCanvas re-doing the rotate/crop/grade work
  // from scratch) purely for capture, which is exactly the kind of
  // duplicated real-time work that was making recording lag independently
  // of resolution/bitrate. Reusing the preview canvas means recording adds
  // zero marginal per-frame JS/canvas cost — MediaRecorder just reads
  // frames from work that was already happening. The tradeoff: no
  // grain/vignette/halation/haze on video (those stay photo-only, where a
  // one-shot cost doesn't matter) — only the base color CSS filter, which
  // previewCanvas already carries.
  const stream = previewCanvas.captureStream(fps);
  const audioTrack = micStream && micStream.getAudioTracks()[0];
  if (audioTrack) {
    stream.addTrack(audioTrack);
  } else {
    showToast('Recording without sound — mic unavailable', 2000);
  }
  recordedChunks = [];
  try {
    mediaRecorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      // Raised again — 3Mbps was still visibly pixelated. The bigger fix
      // this round is the resolution floor above (both photos and video
      // were affected, which pointed at resolution, not just bitrate),
      // but pushing bitrate up further too, still comfortably under the
      // 8Mbps that caused actual lag, since recording costs nothing extra
      // per frame now regardless of bitrate.
      videoBitsPerSecond: 5000000,
      audioBitsPerSecond: 96000,
    });
  } catch (e) {
    showToast('Could not start recording: ' + e.message);
    return;
  }
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = onRecordingStopped;
  mediaRecorder.start();
  isRecording = true;
  recordStartTime = Date.now();
  recIndicator.classList.remove('hidden');
  shutterBtn.classList.add('recording');
  shutterBtn.setAttribute('aria-label', 'stop recording');
  updateRecTimer();
  recordTimerInterval = setInterval(updateRecTimer, 500);
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearInterval(recordTimerInterval);
  recIndicator.classList.add('hidden');
  shutterBtn.classList.remove('recording');
  shutterBtn.setAttribute('aria-label', 'start recording');
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function onRecordingStopped() {
  if (!recordedChunks.length) return;
  const mime = mediaRecorder.mimeType || 'video/webm';
  currentVideoExt = mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
  currentVideoBlob = new Blob(recordedChunks, { type: mime });
  currentVideoUrl = URL.createObjectURL(currentVideoBlob);
  // previewCanvas still holds the last frame — cheap, on-brand thumbnail,
  // held in memory until Save actually writes it (and the video) to the
  // gallery. Also used as the video's poster so it shows that frame instead
  // of the browser's generic gray/play-button placeholder before playback
  // starts.
  currentVideoThumb = previewCanvas.width ? previewCanvas.toDataURL('image/jpeg', 0.6) : '';
  resultVideo.poster = currentVideoThumb;
  resultVideo.src = currentVideoUrl;
  // Video itself carries no baked-in grade (see startRecording) — the CSS
  // filter is applied at playback instead, GPU-composited and effectively
  // free, so the filter still visibly differs on video without costing
  // anything during capture.
  resultVideo.style.filter = FILTERS[currentFilter].css;
  // Not autoplaying: on some embedded WebViews, autoplaying a non-native
  // (controls-less) <video> can trigger a native fullscreen takeover that
  // sits outside the page entirely, which is indistinguishable from "no way
  // back" since none of our own UI is reachable underneath it. Tap-to-play
  // (wired below via wireVideoTapToggle) avoids ever calling play()
  // automatically.
  enterReview('video');
}

// On-screen button = video (tap to start, tap again to stop).
// Physical side button = photo. Two separate controls, so there's no
// tap-vs-hold guessing.
function toggleRecording() {
  if (appView !== 'live') return;
  if (isRecording) stopRecording(); else startRecording();
}
shutterBtn.addEventListener('click', toggleRecording);

// ---------- gallery view ----------
// Two sub-modes sharing one bottom button row: 'single' swipes through items
// one at a time (photo or playable video); 'grid' shows thumbnails and lets
// you tap to multi-select for a quick bulk delete.
let galleryPhotos = [];
let galleryIndex = 0;
let galleryMode = 'single'; // 'single' | 'grid'
let selectedIds = new Set();
let galleryVideoObjUrl = null;

function currentGalleryItem() {
  return galleryPhotos[galleryIndex] || null;
}

function releaseGalleryVideo() {
  if (galleryVideoObjUrl) {
    URL.revokeObjectURL(galleryVideoObjUrl);
    galleryVideoObjUrl = null;
  }
  galleryVideo.pause();
  galleryVideo.removeAttribute('src');
}

function renderGalleryPhoto() {
  releaseGalleryVideo();
  if (!galleryPhotos.length) {
    galleryCanvas.classList.add('hidden');
    galleryVideo.classList.add('hidden');
    galleryEmpty.classList.remove('hidden');
    galleryCounter.textContent = '';
    galleryEmailBtn.classList.remove('hidden');
    return;
  }
  galleryEmpty.classList.add('hidden');
  const item = currentGalleryItem();
  galleryCounter.textContent = `${galleryIndex + 1} / ${galleryPhotos.length}`;
  galleryEmailBtn.classList.toggle('hidden', item.type === 'video'); // video too large for EmailJS

  if (item.type === 'video') {
    galleryCanvas.classList.add('hidden');
    galleryVideo.classList.remove('hidden');
    // Without a poster, a paused <video> with no controls just shows the
    // browser's generic gray/play-button placeholder until you tap it — the
    // thumbnail saved at record time is exactly the "first frame preview"
    // that placeholder should be showing instead.
    galleryVideo.poster = item.thumbDataUrl || '';
    // Same as the review screen: the filter is applied at playback (free,
    // GPU-composited), using whichever filter was active when this clip
    // was recorded — stored per-item, same as it already is for photos.
    galleryVideo.style.filter = (FILTERS[item.filter] || FILTERS.R1).css;
    loadVideoBlob(item.id).then((rec) => {
      if (!rec || currentGalleryItem() !== item) return;
      galleryVideoObjUrl = URL.createObjectURL(rec.blob);
      galleryVideo.src = galleryVideoObjUrl; // not autoplaying — see note in onRecordingStopped
    }).catch((err) => {
      if (currentGalleryItem() === item) showToast('Could not load this video', 2000);
      console.error('loadVideoBlob failed:', err);
    });
  } else {
    galleryVideo.classList.add('hidden');
    galleryCanvas.classList.remove('hidden');
    const img = new Image();
    img.onload = () => {
      galleryCanvas.width = img.width;
      galleryCanvas.height = img.height;
      galleryCanvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = item.dataUrl;
  }
}

function renderGalleryGrid() {
  galleryGrid.innerHTML = '';
  if (!galleryPhotos.length) {
    galleryEmpty.classList.remove('hidden');
    galleryCounter.textContent = '';
    return;
  }
  galleryEmpty.classList.add('hidden');
  galleryCounter.textContent = selectedIds.size ? `${selectedIds.size} selected` : `${galleryPhotos.length} items`;
  galleryPhotos.forEach((item) => {
    const thumb = document.createElement('div');
    thumb.className = 'gridThumb' + (item.type === 'video' ? ' video' : '') + (selectedIds.has(item.id) ? ' selected' : '');
    thumb.style.backgroundImage = `url(${item.type === 'video' ? item.thumbDataUrl : item.dataUrl})`;
    thumb.addEventListener('click', () => {
      if (selectedIds.has(item.id)) selectedIds.delete(item.id); else selectedIds.add(item.id);
      renderGalleryGrid();
      updateDeleteBtnState();
    });
    galleryGrid.appendChild(thumb);
  });
}

function updateDeleteBtnState() {
  if (galleryMode !== 'grid') {
    galleryDeleteBtn.textContent = 'Delete';
    galleryDeleteBtn.classList.remove('disabled');
    return;
  }
  galleryDeleteBtn.textContent = selectedIds.size ? `Delete (${selectedIds.size})` : 'Delete';
  galleryDeleteBtn.classList.toggle('disabled', !selectedIds.size);
}

function renderGalleryView() {
  if (galleryMode === 'grid') {
    galleryCanvas.classList.add('hidden');
    galleryVideo.classList.add('hidden');
    releaseGalleryVideo();
    galleryGrid.classList.remove('hidden');
    galleryEmailBtn.classList.add('hidden');
    renderGalleryGrid();
  } else {
    galleryGrid.classList.add('hidden');
    renderGalleryPhoto();
  }
  updateDeleteBtnState();
}

async function openGallery() {
  const stored = await loadGallery();
  galleryPhotos = stored.slice().reverse(); // newest first
  galleryIndex = 0;
  galleryMode = 'single';
  selectedIds.clear();
  galleryGridBtn.classList.remove('active');
  liveView.classList.add('hidden');
  reviewView.classList.add('hidden');
  galleryView.classList.remove('hidden');
  appView = 'gallery';
  renderGalleryView();
}

function closeGallery() {
  releaseGalleryVideo();
  galleryView.classList.add('hidden');
  liveView.classList.remove('hidden');
  appView = 'live';
}

function toggleGalleryGrid() {
  galleryMode = galleryMode === 'grid' ? 'single' : 'grid';
  galleryGridBtn.classList.toggle('active', galleryMode === 'grid');
  if (galleryMode === 'single' && galleryIndex >= galleryPhotos.length) galleryIndex = Math.max(0, galleryPhotos.length - 1);
  renderGalleryView();
}

function galleryNav(delta) {
  if (galleryMode === 'grid') {
    galleryGrid.scrollTop += delta * 90;
    return;
  }
  if (!galleryPhotos.length) return;
  galleryIndex = (galleryIndex + delta + galleryPhotos.length) % galleryPhotos.length;
  renderGalleryPhoto();
}

async function deleteCurrentPhoto() {
  if (!galleryPhotos.length) return;
  const item = currentGalleryItem();
  if (item.type === 'video') await deleteVideoBlob(item.id);
  const stored = (await loadGallery()).filter((p) => p.id !== item.id);
  await saveGallery(stored);
  galleryPhotos = stored.slice().reverse();
  if (galleryIndex >= galleryPhotos.length) galleryIndex = Math.max(0, galleryPhotos.length - 1);
  renderGalleryPhoto();
}

async function deleteSelectedPhotos() {
  if (!selectedIds.size) return;
  const stored = await loadGallery();
  const toDelete = stored.filter((p) => selectedIds.has(p.id));
  for (const p of toDelete) if (p.type === 'video') await deleteVideoBlob(p.id);
  const remaining = stored.filter((p) => !selectedIds.has(p.id));
  await saveGallery(remaining);
  galleryPhotos = remaining.slice().reverse();
  selectedIds.clear();
  renderGalleryGrid();
  updateDeleteBtnState();
}

galleryBtn.addEventListener('click', openGallery);
galleryBackBtn.addEventListener('click', closeGallery);
galleryGridBtn.addEventListener('click', toggleGalleryGrid);
galleryDeleteBtn.addEventListener('click', () => {
  if (galleryMode === 'grid') deleteSelectedPhotos(); else deleteCurrentPhoto();
});
galleryEmailBtn.addEventListener('click', async () => {
  const item = currentGalleryItem();
  if (!item || item.type === 'video') return;
  const small = await scaledJpegFromDataUrl(item.dataUrl, EMAIL_MAX_DIM, EMAIL_QUALITY);
  emailPhoto(small, galleryEmailBtn);
});

// ---------- filter switching ----------
function switchFilter() {
  if (appView !== 'live') return;
  const idx = FILTER_NAMES.indexOf(currentFilter);
  currentFilter = FILTER_NAMES[(idx + 1) % FILTER_NAMES.length];
  updateFilterUI();
}
filmWindow.addEventListener('click', switchFilter);

// ---------- R1 hardware controls ----------
// Confirmed on-device: requesting the opposite facingMode via getUserMedia
// actually drives the R1's motorized camera to physically rotate and face
// the user, it's not just a software mirror. In the live view the scroll
// wheel now drives that directly — up faces the camera at you (selfie),
// down faces it back out — instead of a screen button. In the gallery it
// still browses photos, since the camera isn't on screen there anyway.
// Filters are switched only via the on-screen switch button, never the
// wheel. The physical side button is the photo shutter — a separate
// control from the on-screen video toggle, so photo and video never fight
// over the same button.
// Cooldown after a flip: the earlier "wheel wasn't actually touched when
// facing reset mid-recording" finding (see the reverted isRecording guard
// above) only ruled out a finger on the wheel — it didn't rule out the
// motor itself. The camera flip physically spins a motor, and that motor
// settling into position a couple seconds later is very likely generating
// a phantom wheel-encoder tick that this code was dutifully treating as a
// real scrollDown and flipping right back. Blocking re-flips for a short
// window after a real one absorbs that phantom tick without needing to
// tell it apart from a genuine one at the event level.
let lastFlipAt = 0;
const FLIP_COOLDOWN_MS = 2000;

function flipToFacing(target) {
  if (getFacing() === target) return;
  const now = Date.now();
  if (now - lastFlipAt < FLIP_COOLDOWN_MS) return;
  lastFlipAt = now;
  setFacing(target);
  showToast(target === 'user' ? 'Selfie mode' : 'Back camera', 1500);
  initCamera();
}

function onScroll(delta) {
  if (appView === 'gallery') { galleryNav(delta); return; }
  // Deliberately NOT guarded against isRecording — confirmed the wheel
  // wasn't actually being touched when facing reset mid-recording, so
  // disabling it here wasn't the fix and just removed a control that's
  // wanted during recording too (front/back/front again, same as live view).
  if (appView === 'live') flipToFacing(delta < 0 ? 'user' : 'environment');
}
window.addEventListener('scrollUp', () => onScroll(-1));
window.addEventListener('scrollDown', () => onScroll(1));
window.addEventListener('sideClick', () => {
  if (appView === 'live') capturePhoto();
});

// ---------- back-gesture guard ----------
// The R1's back gesture navigates browser history; with no history entry to
// consume, it closes the whole creation instead of just backing out of the
// screen you're on. We keep one permanent extra history entry so back
// always has something to pop first: from review/gallery that pop is caught
// here and turned into "go to the live camera view" (then the guard entry
// is put right back, so the stack never grows and the next back press
// behaves the same way). From the live view there's nothing left to
// intercept, so back falls through to actually exiting, as expected.
history.pushState({ guard: true }, '');
window.addEventListener('popstate', () => {
  if (appView === 'review') {
    exitReviewToLive();
    history.pushState({ guard: true }, '');
  } else if (appView === 'gallery') {
    closeGallery();
    history.pushState({ guard: true }, '');
  }
});

// keyboard fallback, useful when testing in a normal browser
// (space = video toggle, mirroring the on-screen button; 'p' = photo, mirroring the side button)
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { if (!e.repeat) { e.preventDefault(); toggleRecording(); } }
  else if (e.key === 'p') capturePhoto();
  else if (e.code === 'ArrowLeft') { if (appView === 'gallery') galleryNav(-1); else switchFilter(); }
  else if (e.code === 'ArrowRight') { if (appView === 'gallery') galleryNav(1); else switchFilter(); }
  else if (e.key === 'r') rotateBtn.click();
  else if (e.key === 'Escape') { if (appView === 'gallery') closeGallery(); }
});

// ---------- camera init ----------
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

// Video and mic are requested as two separate getUserMedia calls, not one
// combined constraint object. A combined { video, audio: true } request was
// silently falling back to video-only whenever the mic side of that single
// negotiation failed for any reason, producing recordings with no sound and
// no indication why. Splitting them means a mic failure can't take the
// camera down with it (or vice versa), and it's the same track either way
// once startRecording() reads micStream.getAudioTracks()[0].
// facingMode is `ideal`, not `exact`, so on hardware with only one camera
// this is simply ignored rather than throwing OverconstrainedError.
// frameRate/resolution target 720p/24-30fps, but as `ideal` only, not a
// hard min/max floor — a stricter version of this (pinned min AND max)
// forces exact-match negotiation, which a sibling R1 creation
// (r1-video-creation, built for this same hardware) found can itself
// strain the camera/encoder. `ideal` lets getUserMedia settle for the
// closest mode the hardware actually supports smoothly, and this whole
// object is still dropped entirely in the second fallback attempt below,
// so a camera that can't do it at all still gets used rather than failing
// outright.
function buildCameraAttempts() {
  const facing = getFacing();
  const fr = { ideal: 24, max: 30 };
  // `min`, not just `ideal` — both photos and video were coming out
  // pixelated, and photos never touch bitrate/encoding at all (a direct
  // canvas capture of the camera frame), so the shared cause has to be
  // upstream of both: the camera settling for a resolution well under
  // 720p once the request dropped to `ideal`-only. `min` without a
  // matching `max` sets a floor without forcing an exact-match ceiling,
  // avoiding the unstable-negotiation risk `min`+`max` pinning had before
  // while still refusing to silently accept something much smaller.
  const res = { width: { ideal: 1280, min: 1280 }, height: { ideal: 720, min: 720 } };
  return [
    { video: { facingMode: { ideal: facing }, frameRate: fr, ...res } },
    { video: { frameRate: fr, ...res } },
    { video: { facingMode: { ideal: facing } } },
    { video: true },
  ];
}

let renderLoopStarted = false;

async function initCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  let lastErr = null;
  for (const constraints of buildCameraAttempts()) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraStream = stream;
      video.srcObject = stream;
      await video.play();
      errorBox.classList.add('hidden');
      // Diagnostic: what the camera actually negotiated, not what we asked
      // for. If frame rate still looks low with the raw/no-effects R1
      // filter (which does almost no per-frame work at all), the ceiling
      // is very likely here — the camera itself isn't delivering more
      // frames per second, not anything our own drawing code is doing.
      const vt = stream.getVideoTracks()[0];
      const vs = vt && vt.getSettings ? vt.getSettings() : null;
      if (vs) {
        showToast(`Camera: ${vs.width || '?'}x${vs.height || '?'} @ ${vs.frameRate ? Math.round(vs.frameRate) : '?'}fps`, 3000);
      }
      if (!renderLoopStarted) {
        renderLoopStarted = true;
        requestAnimationFrame(renderLoop);
      }
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  showError('Camera access failed: ' + (lastErr ? lastErr.message : 'unknown error'));
}

async function initMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    micStream = null;
    console.warn('Microphone unavailable, videos will record without sound:', err);
  }
}

initCamera();
initMic();
