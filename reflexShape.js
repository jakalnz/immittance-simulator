// ─── REFLEX SHAPE AND GROWTH (shared by app.js and admin.js) ─────────────────
// Times are fractions of the trace window (0 = left edge, 1 = right edge).

// Criterion change in admittance for a present reflex (mmho).
const REFLEX_CRITERION = 0.02;

// The 'standard' reflex: a smooth sin² dip that starts after the stimulus
// onset and returns fully to baseline, with no early onset or rebound
// (after the shape used in Wilding's PTA_Sim immittance simulator).
const STANDARD_DIP_START = 0.2;
const STANDARD_DIP_END = 0.8;

// Reflex size (mmho) at a given stimulus level:
// - nothing more than 5 dB below threshold
// - a linear ramp up to the criterion over the 5 dB below threshold
// - exactly the criterion at threshold
// - above threshold, saturating growth (10 dB constant) towards a ceiling of
//   20% of the probe ear's peak admittance, so stiff ears give small reflexes
//   and floppy ears large ones. If that ceiling is below the criterion the
//   reflex can never reach it.
function reflexAmplitude(level, threshold, peakAdmittance) {
  if (threshold === null || threshold === undefined) return 0;
  const cap = 0.2 * Math.max(0, Number(peakAdmittance) || 0);
  const onset = Math.min(REFLEX_CRITERION, cap);
  const delta = level - threshold;
  if (delta <= -5) return 0;
  if (delta < 0) return onset * (delta + 5) / 5;
  return onset + (cap - onset) * (1 - Math.exp(-delta / 10));
}

// Normalised reflex deflection (0 = baseline, 1 = full dip) at window time t.
// jitter (about ±0.03) varies the bell width of the non-standard shapes.
function reflexShapeValue(shape, freq, t, jitter = 0) {
  if (shape === 'symmetric' || shape === 'drifting') {
    // Frequency-dependent bell starting a little earlier than 'standard';
    // 'drifting' adds a positive rebound at 2 kHz (its drifting baseline is
    // added by the caller).
    const start = 0.24;
    const halfWidth = (shape === 'symmetric'
      ? (freq === 500 ? 0.33 : freq === 1000 ? 0.26 : 0.19)
      : (freq === 500 ? 0.30 : freq === 1000 ? 0.23 : 0.17)) + jitter * 0.4;
    const u = t - start;
    if (u < 0) return 0;
    let v = u < 2 * halfWidth ? Math.pow(Math.sin(Math.PI * u / (2 * halfWidth)), 2) : 0;
    if (shape === 'drifting' && freq === 2000 && u > 2 * halfWidth) {
      v -= 0.30 * Math.exp(-(u - 2 * halfWidth) * 6);
    }
    return v;
  }
  if (shape === 'biphasic') {
    // A small overshoot-and-recover bump brackets the main dip at both onset
    // and offset.
    const start = 0.2;
    const mainHalfWidth = (freq === 500 ? 0.23 : freq === 1000 ? 0.18 : 0.13) + jitter * 0.4;
    const blipHalfWidth = mainHalfWidth * 0.25;
    const blipFrac = 0.20;
    const u = t - start;
    const blip1End = 2 * blipHalfWidth;
    const mainEnd = blip1End + 2 * mainHalfWidth;
    const blip2End = mainEnd + 2 * blipHalfWidth;
    if (u < 0) return 0;
    if (u < blip1End) return -blipFrac * Math.pow(Math.sin(Math.PI * u / blip1End), 2);
    if (u < mainEnd) return Math.pow(Math.sin(Math.PI * (u - blip1End) / (2 * mainHalfWidth)), 2);
    if (u < blip2End) return -blipFrac * Math.pow(Math.sin(Math.PI * (u - mainEnd) / (2 * blipHalfWidth)), 2);
    return 0;
  }
  // 'standard' (and 'other' / unknown)
  if (t < STANDARD_DIP_START || t > STANDARD_DIP_END) return 0;
  return Math.pow(Math.sin(Math.PI * (t - STANDARD_DIP_START) / (STANDARD_DIP_END - STANDARD_DIP_START)), 2);
}
