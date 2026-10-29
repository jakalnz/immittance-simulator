// ─── PROBE FIT AND MEASUREMENT NOISE ──────────────────────────────────────────
// Each time the probe is (re)inserted a fit is drawn from the probe ear's
// settings: patient.ears[ear].probeFit = { prob: 0–100 (%), severity }.
// A problem fit is 'unstable' or 'poor' (equally likely); otherwise 'good'.
// The fit is never named to the student — they have to spot it from the
// baseline, traces and pressure indicator (a poor fit can show Leaking),
// and fix it by reseating the probe.
// (Behaviour modelled on the probe-fit exercise in Wilding's PTA_Sim.)

const PROBE_FIT_SEVERITIES = ['mild', 'moderate', 'severe'];
const DEFAULT_PROBE_FIT = { prob: 0, severity: 'moderate' };

// Typical noise size (mmho) for each severity; a poor fit is noisier still.
const SEVERITY_MMHO = { mild: 0.008, moderate: 0.023, severe: 0.05 };
const POOR_FIT_FACTOR = 1.8;

function probeFitSettings(earData) {
  const pf = earData?.probeFit || {};
  const prob = Math.max(0, Math.min(100, Math.round(Number(pf.prob) || 0)));
  const severity = PROBE_FIT_SEVERITIES.includes(pf.severity) ? pf.severity : DEFAULT_PROBE_FIT.severity;
  return { prob, severity };
}

function drawProbeFit(earData, random = Math.random) {
  const { prob, severity } = probeFitSettings(earData);
  const problem = prob > 0 && random() * 100 < prob;
  const fitState = problem ? (random() < 0.5 ? 'unstable' : 'poor') : 'good';
  const magnitude = fitState === 'good'
    ? 0.0015 * random()
    : SEVERITY_MMHO[severity] * (fitState === 'poor' ? POOR_FIT_FACTOR : 1) * (0.85 + 0.3 * random());
  return { state: fitState, severity, magnitude, seed: Math.floor(random() * 0xffffffff) >>> 0 };
}

// Deterministic 0..1 value for an integer lattice point.
function fitHash(seed, n, channel) {
  let h = (seed + Math.imul(n, 0x27d4eb2d) + Math.imul(channel, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smoothly interpolated noise in -1..1 at `rate` lattice points per second.
function smoothNoise(seed, seconds, rate, channel) {
  const x = seconds * rate;
  const n = Math.floor(x);
  const f = x - n;
  const s = f * f * (3 - 2 * f);
  const a = fitHash(seed, n, channel);
  const b = fitHash(seed, n + 1, channel);
  return 2 * (a + (b - a) * s) - 1;
}

// Change in admittance (mmho) caused by the fit at `seconds` after insertion.
// Every insertion starts with a brief settling wobble. A good fit then sits
// almost still; unstable/poor fits keep drifting and fluctuating, and also
// get occasional sharp movement artefacts (more often when poor).
function probeFitNoise(fit, seconds) {
  if (!fit) return 0;
  const t = Math.max(0, seconds);
  const settle = 0.012 * Math.exp(-t / 0.5) * Math.sin(2 * Math.PI * 1.6 * t);
  if (fit.state === 'good') {
    return settle + fit.magnitude * (0.7 * smoothNoise(fit.seed, t, 6, 1) + 0.3 * smoothNoise(fit.seed, t, 20, 2));
  }
  const slotLength = 1.3;
  const slot = Math.floor(t / slotLength);
  const phase = t / slotLength - slot;
  const artefactChance = fit.state === 'poor' ? 0.55 : 0.3;
  const artefact = fitHash(fit.seed, slot, 3) < artefactChance
    ? (2 * fitHash(fit.seed, slot, 4) - 1) * 1.6 * Math.pow(Math.sin(Math.PI * phase), 8)
    : 0;
  return settle + fit.magnitude * (
    0.6 * smoothNoise(fit.seed, t, 0.7, 5)   // slow drift
    + 0.6 * smoothNoise(fit.seed, t, 7, 6)   // wandering
    + 0.3 * smoothNoise(fit.seed, t, 21, 7)  // flutter
    + artefact);
}
