// ─── ADMIN STATE ──────────────────────────────────────────────────────────────
let patients = [];
let editingId = null;
const PIN = '1234'; // supervisor PIN — change as needed
const currentShape = { right: 'standard', left: 'standard' };

// ─── PIN GATE ─────────────────────────────────────────────────────────────────
(function checkPin() {
  if (sessionStorage.getItem('admin-auth') === 'ok') return showAdmin();
  const entered = prompt('Enter supervisor PIN:');
  if (entered === PIN) {
    sessionStorage.setItem('admin-auth', 'ok');
    showAdmin();
  } else {
    document.getElementById('pin-denied').style.display = 'block';
  }
})();

function showAdmin() {
  document.getElementById('admin-app').style.display = 'flex';
  loadFromStorage();
  ['right', 'left'].forEach(ear =>
    ['standard', 'symmetric', 'drifting'].forEach(shape =>
      drawShapePreview(document.getElementById(`shape-preview-${ear}-${shape}`), shape)
    )
  );
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
function loadFromStorage() {
  const saved = localStorage.getItem('imm-patients');
  if (saved) {
    try { patients = JSON.parse(saved); } catch (_) { patients = [...DEFAULT_PATIENTS]; }
  } else {
    patients = JSON.parse(JSON.stringify(DEFAULT_PATIENTS)); // deep copy
  }
  renderPatientList();
}

function saveToStorage() {
  localStorage.setItem('imm-patients', JSON.stringify(patients));
}

// ─── RENDER PATIENT LIST ──────────────────────────────────────────────────────
function renderPatientList() {
  const list = document.getElementById('patient-list');
  list.innerHTML = '';
  patients.forEach(p => {
    const li = document.createElement('li');
    li.className = 'patient-list-item';
    if (editingId === p.id) li.classList.add('selected');
    li.innerHTML = `
      <span class="patient-list-name">${p.name}</span>
      <div class="patient-list-actions">
        <button onclick="editPatient('${p.id}')">Edit</button>
        <button onclick="deletePatient('${p.id}')" class="danger">Delete</button>
      </div>`;
    list.appendChild(li);
  });
}

// ─── REFLEX SHAPE PICKER ──────────────────────────────────────────────────────
function selectShape(ear, shape) {
  currentShape[ear] = shape;
  document.querySelectorAll(`#shape-picker-${ear} .shape-card`).forEach(card => {
    card.classList.toggle('selected', card.dataset.shape === shape);
  });
}

function drawShapePreview(canvas, shape) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const N = 150;
  const preStim = Math.floor(N * 0.38);
  const amplitude = 0.09;
  const traces = [
    { freq: 500,  color: '#cc6633' },
    { freq: 1000, color: '#2255aa' },
    { freq: 2000, color: '#228833' },
  ];

  // Faint dashed baseline
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);

  traces.forEach(({ freq, color }) => {
    const pts = [];
    // Deterministic pseudo-random for preview
    let s = freq * 31 + shape.charCodeAt(0) * 7;
    const rng = () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };

    const driftAmp  = shape === 'drifting' ? 0.015 : 0.001;
    const driftFreq = 0.010, driftPhase = rng() * Math.PI * 2;

    for (let i = 0; i < N; i++) {
      const baseline = driftAmp * Math.sin(driftFreq * i + driftPhase);
      let y = baseline;

      if (i >= preStim) {
        const tPost = (i - preStim) / (N - preStim);
        let shape_val = 0;

        if (shape === 'symmetric') {
          const halfWidth = freq === 500 ? 0.44 : freq === 1000 ? 0.34 : 0.25;
          if (tPost < 2 * halfWidth)
            shape_val = Math.pow(Math.sin(Math.PI * tPost / (2 * halfWidth)), 2);
        } else if (shape === 'drifting') {
          const halfWidth = freq === 500 ? 0.40 : freq === 1000 ? 0.30 : 0.22;
          if (tPost < 2 * halfWidth)
            shape_val = Math.pow(Math.sin(Math.PI * tPost / (2 * halfWidth)), 2);
          if (freq === 2000 && tPost > halfWidth) {
            const rb = tPost - 2 * halfWidth;
            if (rb > 0) shape_val -= 0.30 * Math.exp(-rb * 8);
          }
        } else {
          const peakFrac  = freq === 500 ? 0.38 : freq === 1000 ? 0.28 : 0.20;
          const decayRate = freq === 500 ? 1.6  : freq === 1000 ? 2.4  : 3.4;
          shape_val = tPost < peakFrac
            ? Math.sin((tPost / peakFrac) * Math.PI / 2)
            : Math.exp(-(tPost - peakFrac) * decayRate);
        }
        y -= amplitude * shape_val;
      }
      pts.push(y);
    }

    // Scale to canvas
    const yScale = (H * 0.38) / 0.12;
    const yMid   = H / 2;
    ctx.beginPath();
    pts.forEach((y, i) => {
      const cx = (i / (N - 1)) * W;
      const cy = yMid + y * yScale;
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Freq legend
  ctx.font = '8px sans-serif';
  [{ color: '#cc6633', label: '500' }, { color: '#2255aa', label: '1k' }, { color: '#228833', label: '2k' }]
    .forEach(({ color, label }, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(4 + i * 30, H - 10, 8, 3);
      ctx.fillStyle = '#555';
      ctx.fillText(label, 14 + i * 30, H - 7);
    });
}

// ─── EDIT / CREATE ────────────────────────────────────────────────────────────
function newPatient() {
  const p = {
    id: 'p' + Date.now(),
    name: 'New Patient',
    ears: {
      right: defaultEar(),
      left:  defaultEar()
    }
  };
  patients.push(p);
  saveToStorage();
  editPatient(p.id);
  renderPatientList();
}

function defaultEar() {
  return {
    tympType: 'A',
    reflexShape: 'standard',
    peakAdmittance: 0.80,
    TPP: 0,
    ECV: 1.20,
    gradient: 75,
    reflexes: {
      ipsi:  { 500: 85, 1000: 85, 2000: 90 },
      contra: { 500: 80, 1000: 80, 2000: 85 }
    }
  };
}

function editPatient(id) {
  editingId = id;
  renderPatientList();
  const p = patients.find(x => x.id === id);
  if (!p) return;

  document.getElementById('edit-panel').style.display = 'block';
  document.getElementById('edit-name').value = p.name;
  ['right', 'left'].forEach(ear => selectShape(ear, p.ears[ear].reflexShape || 'standard'));

  ['right', 'left'].forEach(ear => {
    const d = p.ears[ear];
    setField(ear, 'tympType', d.tympType);
    setField(ear, 'peakAdmittance', d.peakAdmittance);
    setField(ear, 'TPP', d.TPP);
    setField(ear, 'ECV', d.ECV);
    setField(ear, 'gradient', d.gradient);

    ['ipsi', 'contra'].forEach(mode => {
      [500, 1000, 2000].forEach(freq => {
        const val = d.reflexes[mode][freq];
        setField(ear, `reflex-${mode}-${freq}`, val === null ? '' : val);
      });
    });
  });
}

function setField(ear, field, value) {
  const el = document.getElementById(`${ear}-${field}`);
  if (el) el.value = value === null ? '' : value;
}

function getField(ear, field) {
  const el = document.getElementById(`${ear}-${field}`);
  return el ? el.value : '';
}

function saveEdit() {
  const p = patients.find(x => x.id === editingId);
  if (!p) return;

  p.name = document.getElementById('edit-name').value.trim() || 'Unnamed Patient';

  ['right', 'left'].forEach(ear => {
    const d = p.ears[ear];
    d.reflexShape   = currentShape[ear];
    d.tympType      = getField(ear, 'tympType');
    d.peakAdmittance = parseFloat(getField(ear, 'peakAdmittance')) || 0.8;
    d.TPP           = parseInt(getField(ear, 'TPP')) || 0;
    d.ECV           = parseFloat(getField(ear, 'ECV')) || 1.2;
    d.gradient      = parseInt(getField(ear, 'gradient')) || 75;

    ['ipsi', 'contra'].forEach(mode => {
      [500, 1000, 2000].forEach(freq => {
        const raw = getField(ear, `reflex-${mode}-${freq}`).trim();
        d.reflexes[mode][freq] = raw === '' ? null : parseInt(raw);
      });
    });
  });

  saveToStorage();
  renderPatientList();
  showStatus('Saved.');
}

function deletePatient(id) {
  if (!confirm('Delete this patient?')) return;
  patients = patients.filter(p => p.id !== id);
  if (editingId === id) {
    editingId = null;
    document.getElementById('edit-panel').style.display = 'none';
  }
  saveToStorage();
  renderPatientList();
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
function exportJSON() {
  const json = JSON.stringify(patients, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'patients.json';
  a.click();
  URL.revokeObjectURL(url);
  showStatus('Downloaded patients.json — commit it to your GitHub repo to share with students.');
}

// ─── IMPORT ───────────────────────────────────────────────────────────────────
document.getElementById('import-admin').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!Array.isArray(data)) throw new Error('Expected array');
      patients = data;
      saveToStorage();
      renderPatientList();
      showStatus(`Imported ${data.length} patients.`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// ─── RESET TO DEFAULTS ────────────────────────────────────────────────────────
function resetDefaults() {
  if (!confirm('Replace all patients with the built-in defaults?')) return;
  patients = JSON.parse(JSON.stringify(DEFAULT_PATIENTS));
  saveToStorage();
  editingId = null;
  document.getElementById('edit-panel').style.display = 'none';
  renderPatientList();
  showStatus('Reset to defaults.');
}

// ─── STATUS ───────────────────────────────────────────────────────────────────
let statusTimer;
function showStatus(msg) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.textContent = '', 4000);
}
