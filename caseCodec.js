// ─── COMPACT SHARE-LINK CODEC ──────────────────────────────────────────────
// Packs a single patient case into a small binary blob (instead of raw JSON)
// so share links stay short enough to survive a 255-char hard limit (e.g.
// pasting into an MS Word hyperlink field). Structured ear data is bit-packed;
// the free-text name is appended as UTF-8 bytes. The whole thing is
// base64url-encoded (no padding) so it's URL-hash safe.

const CASE_CODEC_VERSION = 1;

const TYMP_TYPES = ['A', 'As', 'Ad', 'Ar', 'B', 'C', 'other'];
// Append new shapes at the end so indices in existing links keep their meaning
// (3 bits = up to 8 values); 'other' stays at index 3 for the same reason.
const REFLEX_SHAPES = ['symmetric', 'standard', 'drifting', 'other', 'biphasic'];
const REFLEX_FREQS = [500, 1000, 2000];

class BitWriter {
  constructor() { this.bits = []; }
  write(value, numBits) {
    for (let i = numBits - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }
  toBytes() {
    const byteLen = Math.ceil(this.bits.length / 8);
    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) bytes[i >> 3] |= (1 << (7 - (i & 7)));
    }
    return bytes;
  }
}

class BitReader {
  constructor(bytes) { this.bytes = bytes; this.pos = 0; }
  read(numBits) {
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      const byte = this.bytes[this.pos >> 3] || 0;
      const bit = (byte >> (7 - (this.pos & 7))) & 1;
      value = (value << 1) | bit;
      this.pos++;
    }
    return value >>> 0;
  }
}

function enumIndex(list, value, fallback) {
  const idx = list.indexOf(value);
  return idx === -1 ? fallback : idx;
}

// TPP: signed daPa, stored offset in 10 bits (-512..511)
function encodeTPP(v) { return Math.max(0, Math.min(1023, Math.round(v) + 512)); }
function decodeTPP(v) { return v - 512; }

// peakAdmittance / ECV: 0.00-5.11 mL, scaled x100, 9 bits (0-511)
function encodeScaled100(v) { return Math.max(0, Math.min(511, Math.round(v * 100))); }
function decodeScaled100(v) { return v / 100; }

// gradient: 0-511 daPa, 9 bits
function encodeGradient(v) { return Math.max(0, Math.min(511, Math.round(v))); }

// reflex dB values: 0-254 real, 255 = null/absent, 8 bits
function encodeReflex(v) {
  if (v === null || v === undefined) return 255;
  return Math.max(0, Math.min(254, Math.round(v)));
}
function decodeReflex(v) { return v === 255 ? null : v; }

function packEar(w, ear) {
  w.write(enumIndex(TYMP_TYPES, ear.tympType, TYMP_TYPES.length - 1), 3);
  w.write(encodeScaled100(ear.peakAdmittance), 9);
  w.write(encodeTPP(ear.TPP), 10);
  w.write(encodeScaled100(ear.ECV), 9);
  w.write(encodeGradient(ear.gradient), 9);
  w.write(enumIndex(REFLEX_SHAPES, ear.reflexShape, REFLEX_SHAPES.indexOf('other')), 3);
  for (const side of ['ipsi', 'contra']) {
    for (const f of REFLEX_FREQS) {
      w.write(encodeReflex(ear.reflexes?.[side]?.[f]), 8);
    }
  }
}

function unpackEar(r) {
  const tympType = TYMP_TYPES[r.read(3)];
  const peakAdmittance = decodeScaled100(r.read(9));
  const TPP = decodeTPP(r.read(10));
  const ECV = decodeScaled100(r.read(9));
  const gradient = r.read(9);
  const reflexShape = REFLEX_SHAPES[r.read(3)];
  const reflexes = { ipsi: {}, contra: {} };
  for (const side of ['ipsi', 'contra']) {
    for (const f of REFLEX_FREQS) {
      reflexes[side][f] = decodeReflex(r.read(8));
    }
  }
  return { tympType, peakAdmittance, TPP, ECV, gradient, reflexShape, reflexes };
}

function base64urlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodePatientCompact(p) {
  const w = new BitWriter();
  w.write(CASE_CODEC_VERSION, 4);
  packEar(w, p.ears.right);
  packEar(w, p.ears.left);
  const structuredBytes = w.toBytes();

  const nameBytes = new TextEncoder().encode(p.name || '');
  const out = new Uint8Array(structuredBytes.length + nameBytes.length);
  out.set(structuredBytes, 0);
  out.set(nameBytes, structuredBytes.length);

  return base64urlEncode(out);
}

// Structured portion is fixed-length: 4 (version) + 2 * (3+9+10+9+9+3+48) bits
const STRUCTURED_BITS = 4 + 2 * (3 + 9 + 10 + 9 + 9 + 3 + 48);
const STRUCTURED_BYTES = Math.ceil(STRUCTURED_BITS / 8);

function decodePatientCompact(encoded) {
  const bytes = base64urlDecode(encoded);
  const r = new BitReader(bytes);
  const version = r.read(4);
  if (version !== CASE_CODEC_VERSION) throw new Error('Unsupported share link version');
  const right = unpackEar(r);
  const left = unpackEar(r);

  const nameBytes = bytes.slice(STRUCTURED_BYTES);
  const name = new TextDecoder().decode(nameBytes) || 'Shared Case';

  return {
    id: 'shared-' + Date.now(),
    name,
    ears: { right, left }
  };
}
