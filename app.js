// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  patients: [],
  currentPatient: null,
  mode: 'tymp',          // 'tymp' | 'arts-ipsi' | 'arts-contra'
  offset: 0,
  tympAnimFrame: null,
  tympDone: { right: false, left: false },
  reflexTraces: {},      // [ear][mode][freq][level] = Float32Array
  reflexResults: {},     // [ear][mode][freq][level] = { positive, amplitude }
  selectedCell: null,
  probeEar: 'right',     // which ear the probe is in for reflex view
  trialCount: 0,         // increments each click so repeated presentations vary
};

// ─── SEEDED RNG ───────────────────────────────────────────────────────────────
function seededRng(seed) {
  let s = (seed + 1) * 2654435761 >>> 0;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ─── TYMPANOGRAM COMPUTATION ──────────────────────────────────────────────────
function computeTympPoints(earData, noiseSeed) {
  const { tympType, peakAdmittance, TPP, gradient } = earData;
  const rng = seededRng(noiseSeed);
  const sigma = Math.max(gradient / 2.355, 10);
  const points = [];

  // Slow sinusoidal wander parameters for Type B
  const bWave1Amp   = rng() * 0.012;
  const bWave1Freq  = 0.004 + rng() * 0.003;
  const bWave1Phase = rng() * Math.PI * 2;
  const bWave2Amp   = rng() * 0.006;
  const bWave2Freq  = 0.009 + rng() * 0.005;
  const bWave2Phase = rng() * Math.PI * 2;

  let sampleIdx = 0;
  for (let p = -600; p <= 300; p += 4) {
    let y = 0;
    if (tympType === 'B') {
      const wander = bWave1Amp * Math.sin(bWave1Freq * sampleIdx + bWave1Phase)
                   + bWave2Amp * Math.sin(bWave2Freq * sampleIdx + bWave2Phase);
      y = earData.peakAdmittance + wander + (rng() - 0.5) * 0.003;
    } else {
      const g = Math.exp(-Math.pow(p - TPP, 2) / (2 * sigma * sigma));
      y = peakAdmittance * g;
      // Ad is just a tall single-peaked curve; no modification needed
      y += (rng() - 0.5) * 0.015; // subtle natural noise
    }
    points.push({ p, y: Math.max(0, y) });
    sampleIdx++;
  }
  return points;
}

// ─── REFLEX TRACE COMPUTATION ─────────────────────────────────────────────────
function computeReflexTrace(ear, mode, freq, level, patient, offset, trialSeed) {
  const earData = patient.ears[ear];
  const { tympType, TPP } = earData;
  const threshold = earData.reflexes[mode][freq];
  const reflexShape = earData.reflexShape || 'standard';

  // Interpretable only when offset is between 20 and 100 daPa from TPP
  const offsetDist = Math.abs(offset - TPP);
  const isNoisy = tympType === 'Ad' && (offsetDist < 20 || offsetDist > 100);
  const isAboveThreshold = threshold !== null && level >= threshold;

  const baseSeed = (ear === 'right' ? 0 : 1000) + (mode === 'ipsi' ? 0 : 500) + freq + level;
  // Both noisy and normal traces vary per trial using trialSeed
  const seed = isNoisy
    ? (baseSeed ^ (Date.now() & 0xffff))
    : (baseSeed ^ ((trialSeed || 0) & 0xff));
  const rng = seededRng(seed);

  const N = 150;
  const trace = new Float32Array(N);
  const preStim = Math.floor(N * 0.38);

  if (isNoisy) {
    // Atypical morphology: slow sinusoidal artifact oscillations.
    // Amplitude scales with frequency (2kHz >> 1kHz > 500Hz).
    const freqScale = freq === 2000 ? 1.0 : freq === 1000 ? 0.45 : 0.25;
    const baseAmp = 0.16 * freqScale;

    const f1 = 0.018 + rng() * 0.012;
    const f2 = 0.032 + rng() * 0.018;
    const ph1 = rng() * Math.PI * 2;
    const ph2 = rng() * Math.PI * 2;
    const a1 = (0.5 + rng() * 0.5) * baseAmp;
    const a2 = (0.3 + rng() * 0.4) * baseAmp;

    for (let i = 0; i < N; i++) {
      const sinusoidal = a1 * Math.sin(f1 * i + ph1) + a2 * Math.sin(f2 * i + ph2);
      trace[i] = sinusoidal + (rng() - 0.5) * 0.006;
    }
  } else {
    // Amplitude varies ±25% trial-to-trial; can dip below 0.02 near threshold
    const ampJitter = 0.75 + rng() * 0.5;
    const nominalAmp = Math.min(0.01 + (level - (threshold || 0)) * 0.009, 0.13);
    const amplitude = nominalAmp * ampJitter;

    const shapeJitter = (rng() - 0.5) * 0.06;

    // Slow baseline drift parameters (used by 'drifting', subtle in others)
    const driftAmp   = reflexShape === 'drifting' ? 0.012 + rng() * 0.010 : 0.0015;
    const driftFreq  = 0.008 + rng() * 0.006;   // cycles per sample
    const driftPhase = rng() * Math.PI * 2;

    // Shape onset begins slightly before the formal stimulus marker
    const earlyOnset = Math.round(N * 0.07);
    const shapeStart = preStim - earlyOnset;

    for (let i = 0; i < N; i++) {
      const baseline = driftAmp * Math.sin(driftFreq * i + driftPhase);
      let y = baseline + (rng() - 0.5) * 0.002;

      if (i >= shapeStart && isAboveThreshold) {
        const tPost = (i - shapeStart) / (N - shapeStart); // 0→1

        let shape = 0;
        if (reflexShape === 'symmetric') {
          // Smooth bell guaranteed to start at 0: sin²(π·t / 2h) over [0, 2h]
          const halfWidth = (freq === 500 ? 0.44 : freq === 1000 ? 0.34 : 0.25) + shapeJitter * 0.5;
          if (tPost < 2 * halfWidth) {
            shape = Math.pow(Math.sin(Math.PI * tPost / (2 * halfWidth)), 2);
          }

        } else if (reflexShape === 'drifting') {
          // Same smooth bell on a drifting baseline; 2 kHz adds a positive rebound tail
          const halfWidth = (freq === 500 ? 0.40 : freq === 1000 ? 0.30 : 0.22) + shapeJitter * 0.5;
          if (tPost < 2 * halfWidth) {
            shape = Math.pow(Math.sin(Math.PI * tPost / (2 * halfWidth)), 2);
          }
          if (freq === 2000 && tPost > halfWidth) {
            // positive rebound after the peak
            const rb = tPost - 2 * halfWidth;
            if (rb > 0) shape -= 0.30 * Math.exp(-rb * 8);
          }

        } else {
          // standard: quick sin onset, exponential recovery; faster at higher freq
          const peakFrac = freq === 500 ? 0.38 : freq === 1000 ? 0.28 : 0.20;
          const decayRate = freq === 500 ? 1.6 : freq === 1000 ? 2.4 : 3.4;
          const peak = peakFrac + shapeJitter;
          shape = tPost < peak
            ? Math.sin((tPost / peak) * Math.PI / 2)
            : Math.exp(-(tPost - peak) * decayRate);
        }
        y -= amplitude * shape;
      }
      trace[i] = y;
    }
  }
  return trace;
}

function precomputeReflexTraces(patient, offset) {
  const traces = {};
  const DB_LEVELS = [70, 75, 80, 85, 90, 95, 100, 105, 110];
  const FREQS = [500, 1000, 2000];
  const MODES = ['ipsi', 'contra'];
  const EARS = ['right', 'left'];

  EARS.forEach(ear => {
    traces[ear] = {};
    MODES.forEach(mode => {
      traces[ear][mode] = {};
      FREQS.forEach(freq => {
        traces[ear][mode][freq] = {};
        DB_LEVELS.forEach(level => {
          traces[ear][mode][freq][level] = computeReflexTrace(ear, mode, freq, level, patient, offset, 0);
        });
      });
    });
  });
  return traces;
}

// ─── CANVAS DRAWING ───────────────────────────────────────────────────────────
const PAD = { top: 22, right: 55, bottom: 32, left: 48 };
const X_MIN = -600, X_MAX = 300, Y_MAX = 3.5;

function tympXtoC(p, w) { return PAD.left + (p - X_MIN) / (X_MAX - X_MIN) * w; }
function tympYtoC(y, h) { return PAD.top + (1 - y / Y_MAX) * h; }

function drawTympCanvas(canvas, earData, ear, sweepX) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width, H = rect.height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  ctx.clearRect(0, 0, W, H);

  const isRight = ear === 'right';
  const bgColor   = isRight ? 'rgba(255,235,235,0.9)' : 'rgba(235,240,255,0.9)';
  const fillColor = isRight ? 'rgba(220,80,80,0.18)'  : 'rgba(60,100,220,0.15)';
  const lineColor = isRight ? '#cc3333' : '#3355cc';
  const ecvColor  = isRight ? '#aa2222' : '#2233aa';

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(PAD.left, PAD.top, plotW, plotH);

  // Grid
  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 0.5;
  [-600, -300, 0, 300].forEach(p => {
    const x = tympXtoC(p, plotW);
    ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke();
  });
  [0, 1, 2, 3].forEach(y => {
    const cy = tympYtoC(y, plotH);
    ctx.beginPath(); ctx.moveTo(PAD.left, cy); ctx.lineTo(PAD.left + plotW, cy); ctx.stroke();
  });

  // Axis labels
  ctx.fillStyle = '#555';
  ctx.font = `${11 / dpr + 11}px sans-serif`;
  ctx.textAlign = 'right';
  [0, 1, 2, 3].forEach(y => {
    ctx.fillText(y, PAD.left - 5, tympYtoC(y, plotH) + 4);
  });
  ctx.textAlign = 'center';
  [-600, -300, 0, 300].forEach(p => {
    ctx.fillText(p, tympXtoC(p, plotW), PAD.top + plotH + 16);
  });

  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#777';
  ctx.textAlign = 'left';
  ctx.fillText('mmho', 4, PAD.top);
  ctx.textAlign = 'right';
  ctx.fillText('daPa', PAD.left + plotW, PAD.top + plotH + 28);

  if (!earData || !earData._points) return;

  const pts = earData._points;
  const clampX = sweepX !== undefined ? sweepX : X_MAX;

  // Fill below curve
  ctx.beginPath();
  ctx.moveTo(tympXtoC(-600, plotW), tympYtoC(0, plotH));
  pts.forEach(({ p, y }) => {
    if (p <= clampX) ctx.lineTo(tympXtoC(p, plotW), tympYtoC(y, plotH));
  });
  ctx.lineTo(tympXtoC(Math.min(clampX, X_MAX), plotW), tympYtoC(0, plotH));
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Curve line
  ctx.beginPath();
  let first = true;
  pts.forEach(({ p, y }) => {
    if (p > clampX) return;
    const cx = tympXtoC(p, plotW), cy = tympYtoC(y, plotH);
    if (first) { ctx.moveTo(cx, cy); first = false; } else ctx.lineTo(cx, cy);
  });
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const { tympType, TPP, gradient, peakAdmittance, ECV } = earData;

  // Dashed peak box (once sweep passes peak)
  if (clampX >= TPP && tympType !== 'B') {
    const bxL = tympXtoC(TPP - gradient * 0.75, plotW);
    const bxR = tympXtoC(TPP + gradient * 0.75, plotW);
    const byT = tympYtoC(peakAdmittance * 0.55, plotH);
    const byB = tympYtoC(Math.min(peakAdmittance * 0.08, 0.15), plotH);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.strokeRect(bxL, byT, bxR - bxL, byB - byT);
    ctx.setLineDash([]);
  }

  // Vertical crosshair at TPP
  if (clampX >= TPP && tympType !== 'B') {
    ctx.beginPath();
    ctx.moveTo(tympXtoC(TPP, plotW), PAD.top);
    ctx.lineTo(tympXtoC(TPP, plotW), PAD.top + plotH);
    ctx.strokeStyle = isRight ? 'rgba(180,50,50,0.35)' : 'rgba(40,70,200,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ECV bar (right side, separate ml scale shown on far right)
  if (clampX >= 200) {
    const ecvBarX = PAD.left + plotW + 8;
    const ecvBarH = (ECV / 3) * plotH;
    const ecvBarY = PAD.top + plotH - ecvBarH;
    ctx.fillStyle = ecvColor;
    ctx.fillRect(ecvBarX, ecvBarY, 18, ecvBarH);

    // ml scale
    ctx.fillStyle = '#666';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ml', ecvBarX + 22, PAD.top + 8);
    [0, 1, 2, 3].forEach(y => {
      const cy = PAD.top + plotH - (y / 3) * plotH;
      ctx.fillText(y, ecvBarX + 22, cy + 3);
    });
  }
}

// ─── REFLEX CELL DRAWING ──────────────────────────────────────────────────────
function drawReflexCell(canvas, trace, isPositive) {
  if (!canvas || !trace) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 120 * dpr;
  canvas.height = 52 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = 120, H = 52;
  const N = trace.length;
  const preStim = Math.floor(N * 0.38);

  ctx.clearRect(0, 0, W, H);

  const midY = H / 2;
  const scale = H * 2.5; // scale mmho to pixels

  // Dashed baseline
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();
  ctx.setLineDash([]);

  // Continuous trace across full width
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * W;
    const y = midY - trace[i] * scale;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = isPositive ? '#1a3acc' : '#1a3acc';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Dotted overlay on pre-stimulus segment
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < preStim; i++) {
    const x = (i / (N - 1)) * W;
    const y = midY - trace[i] * scale;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── AMPLITUDE CALCULATION ────────────────────────────────────────────────────
function getTraceAmplitude(trace) {
  const preStim = Math.floor(trace.length * 0.38);
  let min = 0;
  for (let i = preStim; i < trace.length; i++) {
    if (trace[i] < min) min = trace[i];
  }
  return Math.abs(min);
}

// ─── DOM REFERENCES ───────────────────────────────────────────────────────────
const els = {
  patientSelect: document.getElementById('patient-select'),
  startBtn:      document.getElementById('start-btn'),
  modeBtns:      document.querySelectorAll('.mode-btn'),
  tympView:      document.getElementById('tymp-view'),
  reflexView:    document.getElementById('reflex-view'),
  reflexHeader:  document.getElementById('reflex-header'),
  offsetSection: document.getElementById('offset-section'),
  offsetSlider:  document.getElementById('offset-slider'),
  offsetDisplay: document.getElementById('offset-display'),
  reflexGrid:    document.getElementById('reflex-grid'),
  toast:         document.getElementById('toast'),
  probeWheel:    document.querySelector('.probe-wheel'),
  canvasR:       document.getElementById('tymp-canvas-right'),
  canvasL:       document.getElementById('tymp-canvas-left'),
  resultsR:      document.getElementById('results-right'),
  resultsL:      document.getElementById('results-left'),
  sessionDate:   document.getElementById('session-date'),
};

// ─── PATIENT LOADING ──────────────────────────────────────────────────────────
function loadPatients(patients) {
  state.patients = patients;
  els.patientSelect.innerHTML = '<option value="">— Select patient —</option>';
  patients.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    els.patientSelect.appendChild(opt);
  });
}

function selectPatient(id) {
  state.currentPatient = state.patients.find(p => p.id === id) || null;
  if (!state.currentPatient) return;

  // Pre-compute tympanogram points
  ['right', 'left'].forEach((ear, i) => {
    state.currentPatient.ears[ear]._points =
      computeTympPoints(state.currentPatient.ears[ear], i * 999);
  });

  // Pre-compute reflex traces with current offset
  state.reflexTraces = precomputeReflexTraces(state.currentPatient, state.offset);
  state.reflexResults = {};
  state.selectedCell = null;

  // Reset tympanogram canvases
  state.tympDone = { right: false, left: false };
  clearTympCanvases();
  clearResults();
  buildReflexGrid();
}

function clearTympCanvases() {
  [els.canvasR, els.canvasL].forEach((c, i) => {
    if (!c) return;
    const ear = i === 0 ? 'right' : 'left';
    const earData = state.currentPatient ? state.currentPatient.ears[ear] : null;
    drawTympCanvas(c, earData, ear, X_MIN - 1);
  });
}

function clearResults() {
  ['right', 'left'].forEach(ear => {
    const el = ear === 'right' ? els.resultsR : els.resultsL;
    if (!el) return;
    el.querySelectorAll('.result-value').forEach(v => {
      v.className = 'result-value pending';
      v.textContent = '—';
    });
  });
}

// ─── TYMPANOGRAM ANIMATION ────────────────────────────────────────────────────
function startTympAnimation() {
  if (!state.currentPatient) return;
  if (state.tympAnimFrame) cancelAnimationFrame(state.tympAnimFrame);

  const ear = state.probeEar;
  const canvas = ear === 'right' ? els.canvasR : els.canvasL;
  const earData = state.currentPatient.ears[ear];

  // Reset only the selected ear's results
  state.tympDone[ear] = false;
  const resultsEl = ear === 'right' ? els.resultsR : els.resultsL;
  if (resultsEl) {
    resultsEl.querySelectorAll('.result-value').forEach(v => {
      v.className = 'result-value pending';
      v.textContent = '—';
    });
  }

  els.probeWheel.classList.add('active');
  els.startBtn.disabled = true;

  let sweepP = X_MIN;
  const DURATION = 2200; // ms
  const startTime = performance.now();

  function frame(now) {
    const t = Math.min((now - startTime) / DURATION, 1);
    sweepP = X_MIN + t * (X_MAX - X_MIN);
    drawTympCanvas(canvas, earData, ear, sweepP);

    if (t < 1) {
      state.tympAnimFrame = requestAnimationFrame(frame);
    } else {
      onTympComplete(ear);
    }
  }
  state.tympAnimFrame = requestAnimationFrame(frame);
}

function onTympComplete(ear) {
  state.tympDone[ear] = true;
  els.probeWheel.classList.remove('active');
  els.startBtn.disabled = false;

  const canvas = ear === 'right' ? els.canvasR : els.canvasL;
  const earData = state.currentPatient.ears[ear];
  drawTympCanvas(canvas, earData, ear, X_MAX);
  showTympResults(ear);
}

function showTympResults(ear) {
  const earData = state.currentPatient.ears[ear];
  const el = ear === 'right' ? els.resultsR : els.resultsL;
  if (!el) return;
  const cls = `result-value ${ear}`;

  el.querySelector('[data-field="volume"]').className   = cls;
  el.querySelector('[data-field="volume"]').textContent = earData.ECV.toFixed(2);

  el.querySelector('[data-field="pressure"]').className   = cls;
  el.querySelector('[data-field="pressure"]').textContent = earData.TPP;

  el.querySelector('[data-field="admittance"]').className   = cls;
  el.querySelector('[data-field="admittance"]').textContent = earData.peakAdmittance.toFixed(2);

  el.querySelector('[data-field="gradient"]').className   = cls;
  el.querySelector('[data-field="gradient"]').textContent =
    earData.tympType === 'B' ? '—' : earData.gradient;

  // Tympanogram type badge
  const typeBadge = el.querySelector('[data-field="type"]');
  if (typeBadge) {
    typeBadge.className = cls;
    typeBadge.textContent = `Type ${earData.tympType}`;
  }
}

// ─── REFLEX GRID ──────────────────────────────────────────────────────────────
const DB_LEVELS = [70, 75, 80, 85, 90, 95, 100, 105, 110];
const FREQS = [500, 1000, 2000];
const FREQ_LABELS = { 500: '500 Hz', 1000: '1 kHz', 2000: '2 kHz' };

function buildReflexGrid() {
  const grid = els.reflexGrid;
  if (!grid) return;
  const mode = state.mode === 'arts-ipsi' ? 'ipsi' : 'contra';

  // Determine probe ear: from sidebar or default
  const ear = state.probeEar;

  grid.innerHTML = '';

  // Header row
  const thead = grid.createTHead();
  const hr = thead.insertRow();
  const th0 = document.createElement('th');
  th0.className = 'freq-header';
  th0.textContent = 'Frequency';
  hr.appendChild(th0);
  DB_LEVELS.forEach(db => {
    const th = document.createElement('th');
    th.className = 'db-header';
    th.textContent = db + ' dB';
    hr.appendChild(th);
  });

  const tbody = grid.createTBody();
  FREQS.forEach(freq => {
    const tr = tbody.insertRow();
    const tdLabel = tr.insertCell();
    tdLabel.style.background = '#4a7f96';
    tdLabel.style.color = '#fff';
    tdLabel.style.padding = '4px 6px';
    tdLabel.style.fontSize = '11px';
    tdLabel.style.fontWeight = '600';
    tdLabel.style.whiteSpace = 'nowrap';
    tdLabel.textContent = `${FREQ_LABELS[freq]} ${mode === 'ipsi' ? 'Ipsi' : 'Contra'}`;

    DB_LEVELS.forEach(level => {
      const td = tr.insertCell();
      const key = `${ear}-${mode}-${freq}-${level}`;

      const cvs = document.createElement('canvas');
      cvs.style.width = '120px';
      cvs.style.height = '52px';
      cvs.width = 120;
      cvs.height = 52;
      td.appendChild(cvs);

      const ampDiv = document.createElement('div');
      ampDiv.className = 'cell-amp';
      ampDiv.textContent = '';
      td.appendChild(ampDiv);

      // Restore previously clicked cells
      if (state.reflexResults[key]) {
        const { trace, positive, amplitude } = state.reflexResults[key];
        drawReflexCell(cvs, trace, positive);
        ampDiv.textContent = amplitude.toFixed(2);
        if (positive) td.classList.add('positive');
      }

      td.addEventListener('click', () => onReflexCellClick(td, cvs, ampDiv, ear, mode, freq, level));
    });
  });
}

function onReflexCellClick(td, cvs, ampDiv, ear, mode, freq, level) {
  if (!state.currentPatient) { showToast('Please select a patient first.'); return; }
  if (level > 110) return;

  // Deselect previous
  document.querySelectorAll('#reflex-grid td.selected')
    .forEach(el => el.classList.remove('selected'));
  td.classList.add('selected');
  state.selectedCell = { ear, mode, freq, level };

  // Every click gets a fresh trace for repeatability assessment
  state.trialCount++;
  const earData = state.currentPatient.ears[ear];
  const offsetDist = Math.abs(state.offset - earData.TPP);
  const isNoisy = earData.tympType === 'Ad' && (offsetDist < 20 || offsetDist > 100);

  const trace = computeReflexTrace(ear, mode, freq, level, state.currentPatient, state.offset, state.trialCount);
  const amplitude = getTraceAmplitude(trace);
  const threshold = earData.reflexes[mode][freq];
  const positive = !isNoisy && threshold !== null && level >= threshold && amplitude >= 0.02;
  const result = { trace, positive, amplitude };
  state.reflexResults[`${ear}-${mode}-${freq}-${level}`] = result;

  drawReflexCell(cvs, result.trace, result.positive);
  ampDiv.textContent = result.amplitude.toFixed(2);
  td.classList.toggle('positive', result.positive);
}

// ─── MODE SWITCHING ───────────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  els.modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const isTymp = mode === 'tymp';
  els.tympView.classList.toggle('active', isTymp);
  els.reflexView.classList.toggle('active', !isTymp);
  els.offsetSection.classList.toggle('hidden', isTymp);

  if (!isTymp) {
    updateReflexHeader();
    buildReflexGrid();
  }
}

function updateReflexHeader() {
  const modeLabel = state.mode === 'arts-ipsi' ? 'Ipsi' : 'Contra';
  const earIcon = state.probeEar === 'right' ? '🔴' : '🔵';
  els.reflexHeader.textContent = `${earIcon}  Reflex  F:226 Hz  P:${state.offset} daPa  —  ${modeLabel}`;
  els.reflexHeader.className = state.probeEar === 'right' ? 'right' : '';
}

// ─── OFFSET CONTROL ───────────────────────────────────────────────────────────
function applyOffset(val) {
  state.offset = val;
  els.offsetDisplay.textContent = `P = ${val > 0 ? '+' : ''}${val} daPa`;
  updateReflexHeader();
}

// ─── PRINT SUMMARY ────────────────────────────────────────────────────────────
function printSummary() {
  if (!state.currentPatient) { showToast('Select a patient first.'); return; }

  const p = state.currentPatient;
  const now = new Date().toLocaleString();

  const tympRow = (ear) => {
    const d = p.ears[ear];
    if (!state.tympDone[ear]) return '<tr><td colspan="5" style="color:#aaa">Not yet tested</td></tr>';
    return `<tr>
      <td>${ear.charAt(0).toUpperCase() + ear.slice(1)}</td>
      <td>Type ${d.tympType}</td>
      <td>${d.peakAdmittance.toFixed(2)}</td>
      <td>${d.TPP}</td>
      <td>${d.ECV.toFixed(2)}</td>
      <td>${d.tympType === 'B' ? '—' : d.gradient}</td>
    </tr>`;
  };

  const reflexCell = (ear, mode, freq) => {
    const threshold = p.ears[ear].reflexes[mode][freq];
    return threshold === null ? 'Absent' : `${threshold} dB HL`;
  };

  const summaryHTML = `
    <h1>Immittance Test Summary</h1>
    <p class="print-meta">Patient: <strong>${p.name}</strong> &nbsp;|&nbsp; Date: ${now}</p>

    <h2>Tympanometry (226 Hz)</h2>
    <table class="print-table">
      <thead><tr><th>Ear</th><th>Type</th><th>Admittance (mmho)</th><th>Peak Pressure (daPa)</th><th>ECV (ml)</th><th>Gradient (daPa)</th></tr></thead>
      <tbody>${tympRow('right')}${tympRow('left')}</tbody>
    </table>

    <h2>Acoustic Reflex Thresholds</h2>
    <table class="print-table">
      <thead>
        <tr>
          <th>Probe Ear</th><th>Mode</th>
          <th>500 Hz</th><th>1000 Hz</th><th>2000 Hz</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Right</td><td>Ipsilateral</td><td>${reflexCell('right','ipsi',500)}</td><td>${reflexCell('right','ipsi',1000)}</td><td>${reflexCell('right','ipsi',2000)}</td></tr>
        <tr><td>Right</td><td>Contralateral</td><td>${reflexCell('right','contra',500)}</td><td>${reflexCell('right','contra',1000)}</td><td>${reflexCell('right','contra',2000)}</td></tr>
        <tr><td>Left</td><td>Ipsilateral</td><td>${reflexCell('left','ipsi',500)}</td><td>${reflexCell('left','ipsi',1000)}</td><td>${reflexCell('left','ipsi',2000)}</td></tr>
        <tr><td>Left</td><td>Contralateral</td><td>${reflexCell('left','contra',500)}</td><td>${reflexCell('left','contra',1000)}</td><td>${reflexCell('left','contra',2000)}</td></tr>
      </tbody>
    </table>
    <p class="print-meta" style="margin-top:16px;font-style:italic">
      Note: Reflex thresholds shown are the preset values for this patient.
      Offset used during testing: ${state.offset} daPa.
    </p>
  `;

  document.getElementById('print-summary').innerHTML = summaryHTML;
  window.print();
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 2500) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), duration);
}

// ─── JSON IMPORT ──────────────────────────────────────────────────────────────
document.getElementById('import-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!Array.isArray(data)) throw new Error('Expected an array of patients');
      loadPatients(data);
      showToast(`Loaded ${data.length} patients from file.`);
    } catch (err) {
      showToast('Invalid JSON file: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// ─── PROBE EAR TOGGLE ─────────────────────────────────────────────────────────
document.querySelectorAll('input[name="probe-ear"]').forEach(radio => {
  radio.addEventListener('change', e => {
    if (!e.target.checked) return;
    state.probeEar = e.target.value;
    if (state.mode !== 'tymp') {
      state.reflexResults = {};
      updateReflexHeader();
      buildReflexGrid();
    }
  });
});

// ─── EVENTS ───────────────────────────────────────────────────────────────────
els.patientSelect.addEventListener('change', e => selectPatient(e.target.value));
els.startBtn.addEventListener('click', () => {
  if (state.mode === 'tymp') startTympAnimation();
});
els.modeBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
els.offsetSlider.addEventListener('input', e => applyOffset(parseInt(e.target.value)));
document.getElementById('print-btn').addEventListener('click', printSummary);

// Canvas resize observer
const resizeObs = new ResizeObserver(() => {
  if (state.mode === 'tymp' && state.currentPatient) {
    ['right', 'left'].forEach((ear, i) => {
      const canvas = i === 0 ? els.canvasR : els.canvasL;
      const earData = state.currentPatient.ears[ear];
      const sweepX = state.tympDone[ear] ? X_MAX : X_MIN - 1;
      drawTympCanvas(canvas, earData, ear, sweepX);
    });
  }
});
if (els.canvasR) resizeObs.observe(els.canvasR);
if (els.canvasL) resizeObs.observe(els.canvasL);

// ─── INIT ─────────────────────────────────────────────────────────────────────
(async function init() {
  // Date display
  if (els.sessionDate) {
    els.sessionDate.textContent = new Date().toLocaleString([], {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  }

  // Try to load patients.json from the server
  let patients = null;
  try {
    const res = await fetch('./patients.json');
    if (res.ok) patients = await res.json();
  } catch (_) { /* use defaults */ }

  loadPatients(patients || DEFAULT_PATIENTS);
  setMode('tymp');
  applyOffset(0);
})();
