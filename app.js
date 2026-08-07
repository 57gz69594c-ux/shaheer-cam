// ---------- elements ----------
const video = document.getElementById('cam');
const previewCanvas = document.getElementById('preview');
const previewCtx = previewCanvas.getContext('2d');
const resultCanvas = document.getElementById('result');
const liveView = document.getElementById('liveView');
const reviewView = document.getElementById('reviewView');
const filterLabel = document.getElementById('filterLabel');
const rotateBtn = document.getElementById('rotateBtn');
const switchBtn = document.getElementById('switchBtn');
const shutterBtn = document.getElementById('shutterBtn');
const retakeBtn = document.getElementById('retakeBtn');
const saveBtn = document.getElementById('saveBtn');
const errorBox = document.getElementById('errorBox');
const galleryBtn = document.getElementById('galleryBtn');
const galleryView = document.getElementById('galleryView');
const galleryCanvas = document.getElementById('galleryCanvas');
const galleryEmpty = document.getElementById('galleryEmpty');
const galleryCounter = document.getElementById('galleryCounter');
const galleryBackBtn = document.getElementById('galleryBackBtn');
const galleryDeleteBtn = document.getElementById('galleryDeleteBtn');
const gallerySaveBtn = document.getElementById('gallerySaveBtn');
const emailBtn = document.getElementById('emailBtn');
const galleryEmailBtn = document.getElementById('galleryEmailBtn');
const toast = document.getElementById('toast');
const resultVideo = document.getElementById('resultVideo');
const recIndicator = document.getElementById('recIndicator');

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

// ---------- film looks ----------
// Each preset emulates a real film stock: a base color grade (css filter),
// a black-lift (film shadows are never pure black), a split-tone color cast,
// grain, a tinted vignette, and stock-specific extras (halation, light leak,
// dust/scratches).
const FILTERS = {
  'Polaroid': {
    css: 'contrast(0.9) saturate(1.05) brightness(1.12) sepia(0.18)',
    blackLift: 'rgba(46,38,26,0.26)',
    tint: [
      { color: 'rgba(255,214,150,0.18)', blend: 'soft-light' },
      { color: 'rgba(120,140,90,0.09)', blend: 'soft-light' },
    ],
    grain: 0.14,
    vignette: { strength: 0.42, color: '35,24,12' },
    lightLeak: true,
    scratches: false,
    halation: false,
    blur: 0.3,
  },
  'Kodachrome': {
    css: 'contrast(1.26) saturate(1.5) brightness(1.0)',
    blackLift: 'rgba(15,8,6,0.06)',
    tint: { color: 'rgba(255,90,40,0.10)', blend: 'soft-light' },
    grain: 0.07,
    vignette: { strength: 0.3, color: '20,6,2' },
    lightLeak: false,
    scratches: false,
    halation: false,
    blur: 0,
  },
  'Lomo': {
    css: 'contrast(1.32) saturate(1.55) brightness(1.05)',
    blackLift: 'rgba(20,10,25,0.10)',
    tint: [
      { color: 'rgba(160,255,80,0.10)', blend: 'soft-light' },
      { color: 'rgba(255,0,150,0.06)', blend: 'overlay' },
    ],
    grain: 0.19,
    vignette: { strength: 0.68, color: '5,0,10' },
    lightLeak: true,
    scratches: false,
    halation: false,
    blur: 0,
  },
  'Kodak Gold': {
    css: 'contrast(1.16) saturate(1.35) brightness(1.03)',
    blackLift: 'rgba(20,12,8,0.08)',
    tint: { color: 'rgba(255,170,70,0.14)', blend: 'soft-light' },
    grain: 0.08,
    vignette: { strength: 0.26, color: '25,14,4' },
    lightLeak: false,
    scratches: false,
    halation: false,
    blur: 0,
  },
  'Fuji Chrome': {
    css: 'contrast(1.12) saturate(1.0) brightness(1.0)',
    blackLift: 'rgba(8,18,20,0.10)',
    tint: { color: 'rgba(80,195,175,0.13)', blend: 'soft-light' },
    grain: 0.09,
    vignette: { strength: 0.28, color: '6,16,16' },
    lightLeak: false,
    scratches: false,
    halation: false,
    blur: 0,
  },
  'Disposable Flash': {
    css: 'contrast(1.3) saturate(0.65) brightness(1.14)',
    blackLift: 'rgba(30,30,30,0.10)',
    tint: { color: 'rgba(255,255,255,0.06)', blend: 'overlay' },
    grain: 0.26,
    vignette: { strength: 0.55, color: '0,0,0' },
    lightLeak: false,
    scratches: true,
    halation: false,
    blur: 0.4,
  },
  'Cinestill Night': {
    css: 'contrast(1.2) saturate(0.9) brightness(0.98)',
    blackLift: 'rgba(6,14,24,0.16)',
    tint: { color: 'rgba(255,130,70,0.12)', blend: 'soft-light' },
    grain: 0.13,
    vignette: { strength: 0.4, color: '4,8,18' },
    lightLeak: false,
    scratches: false,
    halation: true,
    blur: 0,
  },
  'B&W Film': {
    css: 'contrast(1.22) saturate(0) brightness(1.02)',
    blackLift: 'rgba(25,25,25,0.10)',
    tint: null,
    grain: 0.20,
    vignette: { strength: 0.42, color: '0,0,0' },
    lightLeak: false,
    scratches: false,
    halation: false,
    blur: 0,
  },
};
const FILTER_NAMES = Object.keys(FILTERS);
let currentFilter = 'Polaroid';
filterLabel.textContent = currentFilter;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ---------- orientation ----------
// R1 is held with the scroll wheel on top / camera at top-left, so the raw
// camera frame needs a quarter turn to come out upright. Defaults to 90 but
// is adjustable on-device (tap the rotate button) and persisted locally,
// since it can't be verified against real hardware from here.
function getRotation() {
  return parseInt(localStorage.getItem('r1-rotation') || '90', 10);
}
function setRotation(deg) {
  localStorage.setItem('r1-rotation', String(((deg % 360) + 360) % 360));
}
rotateBtn.addEventListener('click', () => setRotation(getRotation() + 90));

function drawRotatedFrame(ctx, source, sw, sh, rotation, canvas) {
  const swapped = rotation === 90 || rotation === 270;
  canvas.width = swapped ? sh : sw;
  canvas.height = swapped ? sw : sh;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

// ---------- live preview loop ----------
function renderLoop() {
  if (video.readyState >= 2 && video.videoWidth) {
    drawRotatedFrame(rotCtx, video, video.videoWidth, video.videoHeight, getRotation(), rotCanvas);
    previewCanvas.width = rotCanvas.width;
    previewCanvas.height = rotCanvas.height;
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
  drawGrain(ctx, w, h, f.grain);
  drawVignette(ctx, w, h, f.vignette.strength, f.vignette.color);
  if (f.lightLeak) drawLightLeak(ctx, w, h);
  if (f.scratches) drawScratches(ctx, w, h);
}

// ---------- lightweight per-frame grading for video (cached grain tiles —
// generating fresh per-pixel noise every frame is too slow on R1 hardware) ----------
let grainTiles = [];
let grainTileKey = '';
function ensureGrainTiles(w, h) {
  const key = `${w}x${h}`;
  if (grainTileKey === key && grainTiles.length) return;
  grainTileKey = key;
  grainTiles = [generateNoiseCanvas(w, h), generateNoiseCanvas(w, h), generateNoiseCanvas(w, h)];
}

function drawFrameGraded(ctx, srcCanvas, w, h, filterName) {
  const f = FILTERS[filterName];
  ctx.filter = f.blur ? `${f.css} blur(${f.blur}px)` : f.css;
  ctx.drawImage(srcCanvas, 0, 0);
  ctx.filter = 'none';
  if (f.blackLift) drawBlackLift(ctx, w, h, f.blackLift);
  if (f.tint) {
    (Array.isArray(f.tint) ? f.tint : [f.tint]).forEach((t) => drawTint(ctx, w, h, t.color, t.blend));
  }
  ensureGrainTiles(w, h);
  const tile = grainTiles[Math.floor(Math.random() * grainTiles.length)];
  ctx.save();
  ctx.globalAlpha = f.grain;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(tile, 0, 0);
  ctx.restore();
  drawVignette(ctx, w, h, f.vignette.strength, f.vignette.color);
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

async function addToGallery(dataUrl, filterName) {
  const list = await loadGallery();
  list.push({ id: Date.now(), filter: filterName, dataUrl });
  while (list.length > MAX_GALLERY) list.shift();
  await saveGallery(list);
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- capture / review flow ----------
let reviewMediaType = 'photo'; // 'photo' | 'video'
let currentVideoUrl = null;
let currentVideoBlob = null;
let currentVideoExt = 'webm';

function enterReview(type) {
  reviewMediaType = type;
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

  resultCanvas.width = shot.width;
  resultCanvas.height = shot.height;
  resultCanvas.getContext('2d').drawImage(shot, 0, 0);

  addToGallery(resultCanvas.toDataURL('image/jpeg', 0.7), currentFilter);
  enterReview('photo');
}

retakeBtn.addEventListener('click', () => {
  if (currentVideoUrl) {
    URL.revokeObjectURL(currentVideoUrl);
    currentVideoUrl = null;
    resultVideo.pause();
    resultVideo.removeAttribute('src');
    resultVideo.load();
  }
  reviewView.classList.add('hidden');
  liveView.classList.remove('hidden');
  appView = 'live';
});

emailBtn.addEventListener('click', () => {
  emailPhoto(resultCanvas.toDataURL('image/jpeg', 0.7), emailBtn);
});

saveBtn.addEventListener('click', () => {
  if (reviewMediaType === 'video') {
    if (!currentVideoBlob) return;
    downloadDataUrl(URL.createObjectURL(currentVideoBlob), `film-camera-${slugify(currentFilter)}-${Date.now()}.${currentVideoExt}`);
    return;
  }
  resultCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `film-camera-${slugify(currentFilter)}-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/jpeg', 0.92);
});

// ---------- video recording ----------
// Recorded via MediaRecorder on a canvas stream that's graded frame-by-frame
// in real time. Capped at 10s and not added to the photo gallery — the
// gallery stores everything as base64 in on-device storage, and even a short
// clip would be far too large for that (and for emailing).
const MAX_RECORD_MS = 10000;
const recordCanvas = document.createElement('canvas');
const recordCtx = recordCanvas.getContext('2d');
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordRAF = null;
let recordStartTime = 0;
let recordTimerInterval = null;
let recordAutoStopTimer = null;

function pickVideoMimeType() {
  if (!window.MediaRecorder) return '';
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function recordFrameLoop() {
  if (!isRecording) return;
  if (rotCanvas.width) {
    recordCanvas.width = rotCanvas.width;
    recordCanvas.height = rotCanvas.height;
    drawFrameGraded(recordCtx, rotCanvas, recordCanvas.width, recordCanvas.height, currentFilter);
  }
  recordRAF = requestAnimationFrame(recordFrameLoop);
}

function updateRecTimer() {
  const secs = Math.floor((Date.now() - recordStartTime) / 1000);
  recIndicator.textContent = `● REC 0:${String(secs).padStart(2, '0')}`;
}

function startRecording() {
  if (appView !== 'live' || isRecording || !rotCanvas.width) return;
  if (!window.MediaRecorder) {
    showToast('Video recording is not supported on this device');
    return;
  }
  const mimeType = pickVideoMimeType();
  recordCanvas.width = rotCanvas.width;
  recordCanvas.height = rotCanvas.height;
  const stream = recordCanvas.captureStream(24);
  recordedChunks = [];
  try {
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
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
  updateRecTimer();
  recordTimerInterval = setInterval(updateRecTimer, 500);
  recordRAF = requestAnimationFrame(recordFrameLoop);
  recordAutoStopTimer = setTimeout(stopRecording, MAX_RECORD_MS);
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearTimeout(recordAutoStopTimer);
  clearInterval(recordTimerInterval);
  cancelAnimationFrame(recordRAF);
  recIndicator.classList.add('hidden');
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function onRecordingStopped() {
  if (!recordedChunks.length) return;
  const mime = mediaRecorder.mimeType || 'video/webm';
  currentVideoExt = mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
  currentVideoBlob = new Blob(recordedChunks, { type: mime });
  currentVideoUrl = URL.createObjectURL(currentVideoBlob);
  resultVideo.src = currentVideoUrl;
  enterReview('video');
}

// tap shutter = photo, hold shutter = record video
let shutterHoldTimer = null;
let shutterHoldFired = false;
const SHUTTER_HOLD_MS = 450;

function handleShutterDown() {
  if (appView !== 'live') return;
  shutterHoldFired = false;
  shutterHoldTimer = setTimeout(() => {
    shutterHoldFired = true;
    startRecording();
  }, SHUTTER_HOLD_MS);
}
function handleShutterUp() {
  clearTimeout(shutterHoldTimer);
  if (shutterHoldFired) {
    stopRecording();
  } else if (appView === 'live') {
    capturePhoto();
  }
}
shutterBtn.addEventListener('pointerdown', handleShutterDown);
shutterBtn.addEventListener('pointerup', handleShutterUp);
shutterBtn.addEventListener('pointerleave', () => clearTimeout(shutterHoldTimer));
shutterBtn.addEventListener('pointercancel', () => {
  clearTimeout(shutterHoldTimer);
  if (shutterHoldFired) stopRecording();
});

// ---------- gallery view ----------
let galleryPhotos = [];
let galleryIndex = 0;

function renderGalleryPhoto() {
  if (!galleryPhotos.length) {
    galleryCanvas.classList.add('hidden');
    galleryEmpty.classList.remove('hidden');
    galleryCounter.textContent = '';
    return;
  }
  galleryCanvas.classList.remove('hidden');
  galleryEmpty.classList.add('hidden');
  const photo = galleryPhotos[galleryIndex];
  const img = new Image();
  img.onload = () => {
    galleryCanvas.width = img.width;
    galleryCanvas.height = img.height;
    galleryCanvas.getContext('2d').drawImage(img, 0, 0);
  };
  img.src = photo.dataUrl;
  galleryCounter.textContent = `${galleryIndex + 1} / ${galleryPhotos.length}`;
}

async function openGallery() {
  const stored = await loadGallery();
  galleryPhotos = stored.slice().reverse(); // newest first
  galleryIndex = 0;
  liveView.classList.add('hidden');
  reviewView.classList.add('hidden');
  galleryView.classList.remove('hidden');
  appView = 'gallery';
  renderGalleryPhoto();
}

function closeGallery() {
  galleryView.classList.add('hidden');
  liveView.classList.remove('hidden');
  appView = 'live';
}

function galleryNav(delta) {
  if (!galleryPhotos.length) return;
  galleryIndex = (galleryIndex + delta + galleryPhotos.length) % galleryPhotos.length;
  renderGalleryPhoto();
}

async function deleteCurrentPhoto() {
  if (!galleryPhotos.length) return;
  const id = galleryPhotos[galleryIndex].id;
  const stored = (await loadGallery()).filter((p) => p.id !== id);
  await saveGallery(stored);
  galleryPhotos = stored.slice().reverse();
  if (galleryIndex >= galleryPhotos.length) galleryIndex = Math.max(0, galleryPhotos.length - 1);
  renderGalleryPhoto();
}

galleryBtn.addEventListener('click', openGallery);
galleryBackBtn.addEventListener('click', closeGallery);
galleryDeleteBtn.addEventListener('click', deleteCurrentPhoto);
gallerySaveBtn.addEventListener('click', () => {
  if (!galleryPhotos.length) return;
  const photo = galleryPhotos[galleryIndex];
  downloadDataUrl(photo.dataUrl, `film-camera-${slugify(photo.filter)}-${photo.id}.jpg`);
});
galleryEmailBtn.addEventListener('click', () => {
  if (!galleryPhotos.length) return;
  emailPhoto(galleryPhotos[galleryIndex].dataUrl, galleryEmailBtn);
});

// ---------- filter switching ----------
function switchFilter() {
  if (appView !== 'live') return;
  const idx = FILTER_NAMES.indexOf(currentFilter);
  currentFilter = FILTER_NAMES[(idx + 1) % FILTER_NAMES.length];
  filterLabel.textContent = currentFilter;
}
switchBtn.addEventListener('click', switchFilter);

// ---------- R1 hardware controls ----------
// The scroll wheel is the R1's own physical control for spinning the
// rotating camera to face you — left free here (in the live view) so it
// isn't fought over. It's still used to browse the gallery, where the
// camera isn't in view anyway. Filters are switched only via the on-screen
// switch button, never the wheel. The physical side button mirrors the
// on-screen shutter: a quick press is a photo, a long press records video —
// the R1 already tells these apart via separate sideClick/longPress events.
function onScroll(delta) {
  if (appView === 'gallery') galleryNav(delta);
}
window.addEventListener('scrollUp', () => onScroll(-1));
window.addEventListener('scrollDown', () => onScroll(1));
window.addEventListener('sideClick', () => {
  if (appView === 'live' && !isRecording) capturePhoto();
});
window.addEventListener('longPressStart', () => {
  if (appView === 'live' && !isRecording) startRecording();
});
window.addEventListener('longPressEnd', () => {
  if (isRecording) stopRecording();
});

// keyboard fallback, useful when testing in a normal browser
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { if (!e.repeat) { e.preventDefault(); handleShutterDown(); } }
  else if (e.code === 'ArrowLeft') { if (appView === 'gallery') galleryNav(-1); else switchFilter(); }
  else if (e.code === 'ArrowRight') { if (appView === 'gallery') galleryNav(1); else switchFilter(); }
  else if (e.key === 'r') rotateBtn.click();
  else if (e.key === 'Escape') { if (appView === 'gallery') closeGallery(); }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { e.preventDefault(); handleShutterUp(); }
});

// ---------- camera init ----------
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    requestAnimationFrame(renderLoop);
  } catch (err) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      await video.play();
      requestAnimationFrame(renderLoop);
    } catch (err2) {
      showError('Camera access failed: ' + err2.message);
    }
  }
}

initCamera();
