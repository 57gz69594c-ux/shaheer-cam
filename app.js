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

let appView = 'live'; // 'live' | 'review' | 'gallery'

// ---------- email (EmailJS — sends the photo as an attachment to your own inbox) ----------
const EMAILJS_SERVICE_ID = 'service_349fg0q';
const EMAILJS_TEMPLATE_ID = 'template_kaj2dyv';
const EMAILJS_PUBLIC_KEY = 'w4pGSLR6hhtjl2tx_';
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
const FILTERS = {
  '35mm': {
    css: 'contrast(1.08) saturate(0.82) sepia(0.18) brightness(1.04) hue-rotate(-6deg)',
    grain: 0.12,
    vignette: 0.35,
    lightLeak: true,
    scratches: false,
    blur: 0,
  },
  '8mm': {
    css: 'contrast(1.3) saturate(0.5) sepia(0.32) brightness(0.92) hue-rotate(8deg)',
    grain: 0.24,
    vignette: 0.55,
    lightLeak: false,
    scratches: true,
    blur: 0.5,
  },
};
const FILTER_NAMES = Object.keys(FILTERS);
let currentFilter = '35mm';

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
function drawGrain(ctx, w, h, intensity) {
  const noise = document.createElement('canvas');
  noise.width = w;
  noise.height = h;
  const nctx = noise.getContext('2d');
  const imgData = nctx.createImageData(w, h);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    imgData.data[i] = v;
    imgData.data[i + 1] = v;
    imgData.data[i + 2] = v;
    imgData.data[i + 3] = 255;
  }
  nctx.putImageData(imgData, 0, 0);
  ctx.save();
  ctx.globalAlpha = intensity;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(noise, 0, 0);
  ctx.restore();
}

function drawVignette(ctx, w, h, strength) {
  const grad = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.25,
    w / 2, h / 2, Math.max(w, h) * 0.75
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
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

  drawGrain(ctx, w, h, f.grain);
  drawVignette(ctx, w, h, f.vignette);
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

  liveView.classList.add('hidden');
  reviewView.classList.remove('hidden');
  appView = 'review';
}

retakeBtn.addEventListener('click', () => {
  reviewView.classList.add('hidden');
  liveView.classList.remove('hidden');
  appView = 'live';
});

emailBtn.addEventListener('click', () => {
  emailPhoto(resultCanvas.toDataURL('image/jpeg', 0.7), emailBtn);
});

saveBtn.addEventListener('click', () => {
  resultCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shaheer-cam-${currentFilter}-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/jpeg', 0.92);
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
  downloadDataUrl(photo.dataUrl, `shaheer-cam-${photo.filter}-${photo.id}.jpg`);
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
shutterBtn.addEventListener('click', capturePhoto);

// ---------- R1 hardware controls ----------
// R1 creations expose the scroll wheel and side button as DOM events.
// Wired as best-effort extras; touch controls above remain the primary path.
function onScroll(delta) {
  if (appView === 'gallery') galleryNav(delta);
  else if (appView === 'live') switchFilter();
}
window.addEventListener('scrollUp', () => onScroll(-1));
window.addEventListener('scrollDown', () => onScroll(1));
window.addEventListener('sideClick', () => {
  if (appView === 'live') capturePhoto();
});

// keyboard fallback, useful when testing in a normal browser
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); capturePhoto(); }
  else if (e.code === 'ArrowLeft') onScroll(-1);
  else if (e.code === 'ArrowRight') onScroll(1);
  else if (e.key === 'r') rotateBtn.click();
  else if (e.key === 'Escape') { if (appView === 'gallery') closeGallery(); }
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
