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

// ---------- capture / review flow ----------
function capturePhoto() {
  if (!rotCanvas.width) return;
  const shot = document.createElement('canvas');
  shot.width = rotCanvas.width;
  shot.height = rotCanvas.height;
  shot.getContext('2d').drawImage(rotCanvas, 0, 0);
  applyFilmLook(shot, currentFilter);

  resultCanvas.width = shot.width;
  resultCanvas.height = shot.height;
  resultCanvas.getContext('2d').drawImage(shot, 0, 0);

  liveView.classList.add('hidden');
  reviewView.classList.remove('hidden');
}

retakeBtn.addEventListener('click', () => {
  reviewView.classList.add('hidden');
  liveView.classList.remove('hidden');
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

// ---------- filter switching ----------
function switchFilter() {
  const idx = FILTER_NAMES.indexOf(currentFilter);
  currentFilter = FILTER_NAMES[(idx + 1) % FILTER_NAMES.length];
  filterLabel.textContent = currentFilter;
}
switchBtn.addEventListener('click', switchFilter);
shutterBtn.addEventListener('click', capturePhoto);

// ---------- R1 hardware controls ----------
// R1 creations expose the scroll wheel and side button as DOM events.
// Wired as best-effort extras; touch controls above remain the primary path.
window.addEventListener('scrollUp', switchFilter);
window.addEventListener('scrollDown', switchFilter);
window.addEventListener('sideClick', capturePhoto);

// keyboard fallback, useful when testing in a normal browser
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); capturePhoto(); }
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') switchFilter();
  else if (e.key === 'r') rotateBtn.click();
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
