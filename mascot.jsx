// Krema mascot — uses the REAL brand mascot image, not a drawn SVG.
// All pose variants are CSS transforms / framing of the same source image so
// the character stays on-brand wherever it shows up.

const MASCOT_SRC = 'assets/krema-mascot.png';
const HEAD_SRC = 'assets/krema-brandmark.png';

function MascotImg({ size = 320, style, alt = 'Krema mascot' }) {
  return (
    <img
      src={MASCOT_SRC}
      alt={alt}
      width={size}
      style={{ display: 'block', width: size, height: 'auto', ...style }}
      draggable={false}
    />
  );
}

// ── Pose 1: Waving (the canonical pose — arm up). Used in hero. ──────────
function MascotWave({ size = 320, style }) {
  return <MascotImg size={size} style={style} />;
}

// ── Pose 2: Peek (only top portion visible, used at edges) ───────────────
function MascotPeek({ size = 200, flip = false, style }) {
  return (
    <div style={{ width: size, height: size * 0.62, overflow: 'hidden', ...style }}>
      <MascotImg
        size={size}
        style={{ transform: flip ? 'scaleX(-1)' : undefined }}
        alt="Krema mascot peeking"
      />
    </div>
  );
}

// ── Pose 3: Standing (the same image, slightly smaller) ─────────────────
function MascotStand({ size = 140, style }) {
  return <MascotImg size={size} style={style} />;
}

// ── Pose 4: Chill (rotated to lounge — same mascot, just relaxing) ──────
function MascotChill({ size = 220, style }) {
  return (
    <MascotImg
      size={size}
      style={{ transform: 'rotate(-12deg)', ...style }}
      alt="Krema mascot chilling"
    />
  );
}

// ── Tiny logo mark (head only — nav + small spots) ──────────────────────
function MascotMark({ size = 44, style }) {
  return (
    <img
      src={HEAD_SRC}
      alt="Krema"
      width={size}
      style={{ display: 'block', width: size, height: 'auto', ...style }}
      draggable={false}
    />
  );
}

Object.assign(window, { MascotWave, MascotPeek, MascotStand, MascotChill, MascotMark, MascotImg });
 });
