// Krema Dessert Haus — homepage app
// Brand: navy ink + cream + warm yellow + sky blue (light + deep) accents.
// Mascot image is the REAL one (assets/krema-mascot.png). Photos are
// intentional placeholders — slots reserved for the real photoshoot.

const { useState, useEffect, useRef, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "sky",
  "scriptFont": "Bukhari Script",
  "vibe": "cheeky",
  "showOpenBadge": true,
  "featuredBingsu": "Mango Magic",
  "mascotWiggle": true
}/*EDITMODE-END*/;

// ── palettes ──────────────────────────────────────────────────────────────
const PALETTES = {
  sky:    { bg: '#c9e6f1', bgDeep: '#a8d4e5', accent: '#f1e056', accentDeep: '#e6cf30', skyDeep: '#7ec3de' },
  sunny:  { bg: '#fbeea0', bgDeep: '#f3df66', accent: '#c9e6f1', accentDeep: '#9dd4e8', skyDeep: '#7ec3de' },
  candy:  { bg: '#f3d2e1', bgDeep: '#ebb7cd', accent: '#f1e056', accentDeep: '#e6cf30', skyDeep: '#7ec3de' },
};

// ── copy variants (vibe tweak) ────────────────────────────────────────────
const COPY = {
  cheeky: {
    speech: "hi bestie!",
    heroSub: "Bingsu mountains, fruit tea storms, lil' treat moments for the soft girlies, the K-pop besties, & the Tuesday-night homies. Tara, treat yo' self.",
    eventsSub: "Birthday cups for your bias, listening parties, sip-and-sketch nights, and rescue-pup meet-and-greets. RSVP, it's free.",
    findSub: "Unit 112, Banig Bldg., A. Luz Drive, Parqal Mall, Parañaque — look for the blue door, the 'we're open!' sign, & probably us oversharing on the IG story.",
    footerMsg: "life's too short\nto skip dessert.",
  },
  soft: {
    speech: "hello :)",
    heroSub: "Snowy bingsu, real-fruit teas, and the kind of corner café where you can stay til closing. Pet-friendly, Wi-Fi-friendly, you-friendly.",
    eventsSub: "Quiet listening parties, sketch nights, and rescue-pup adoption afternoons. Free to attend, no reservation needed.",
    findSub: "Tucked into Unit 112, Banig Bldg., A. Luz Drive, Parqal Mall, Parañaque. Look for the soft blue door.",
    footerMsg: "life's too short\nto skip dessert.",
  },
  loud: {
    speech: "OMG YOU CAME!",
    heroSub: "BINGSU MOUNTAINS. FRUIT TEA STORMS. The most photogenic ₱220 you'll spend this week. Tag us, we'll repost.",
    eventsSub: "BIRTHDAY CUPS! LISTENING PARTIES! ADOPTION DRIVES! Pull up.",
    findSub: "Unit 112, Banig Bldg., A. Luz Drive, Parqal Mall, Parañaque. We have a blue door & we put a 'WE'RE OPEN' sign in the window like it's 2007.",
    footerMsg: "life's too short\nto skip dessert.",
  },
};

// ── menu data ─────────────────────────────────────────────────────────────
const MENU_CATEGORIES = [
  {
    id: 'bingsu', name: 'Bingsu', tag: 'the signature', emoji: '🍧',
    badge: 'must-try',
    desc: "Snowy shaved milk, real fruit, mochi & the works. Solo or Family size — sharing encouraged but not required.",
    priceRange: '₱250 – 380',
    items: [
      { name: 'Halo Supreme',  variants: [{ label: 'Family', price: 380 }] },
      { name: 'Mango Magic',   variants: [{ label: 'Solo', price: 270 }, { label: 'Family', price: 370 }] },
      { name: 'Buko Pandan',   variants: [{ label: 'Solo', price: 250 }, { label: 'Family', price: 350 }] },
      { name: 'Choco Snow',    variants: [{ label: 'Solo', price: 250 }, { label: 'Family', price: 350 }] },
    ],
    addons: [
      { name: 'Sea Salt Cream', price: '+₱25' },
      { name: 'Ice Cream',      price: '+₱30' },
      { name: 'Leche Flan',     price: '+₱50' },
    ],
  },
  {
    id: 'coffee', name: 'Coffee', tag: 'the classics', emoji: '☕',
    badge: null,
    desc: "Espresso-based, hot or iced. The Krema Latte gets reordered way more than we expected.",
    priceRange: '₱150 – 220',
    items: [
      { name: 'Americano',             variants: [{ label: 'R', price: 150 }, { label: 'L', price: 160 }] },
      { name: 'Sweet Cream Americano', variants: [{ label: '', price: 180 }] },
      { name: 'Kastilatte',            variants: [{ label: 'R', price: 180 }, { label: 'L', price: 195 }] },
      { name: 'Latte',                 variants: [{ label: 'R', price: 180 }, { label: 'L', price: 190 }] },
      { name: 'Flavored Latte',        variants: [{ label: 'R', price: 195 }, { label: 'L', price: 210 }] },
      { name: 'Krema Latte',           variants: [{ label: 'R', price: 200 }, { label: 'L', price: 220 }] },
      { name: 'Salty Kreme Latte',     variants: [{ label: '', price: 210 }] },
    ],
  },
  {
    id: 'matcha', name: 'Matcha', tag: 'go green', emoji: '🍵',
    badge: null,
    desc: "Ceremonial-grade powder, real milk, frothed loud. Served cold.",
    priceRange: '₱200 – 240',
    items: [
      { name: 'Matcha Latte',           variants: [{ label: '', price: 200 }] },
      { name: 'Berry Matcha',           variants: [{ label: '', price: 220 }] },
      { name: 'Salty Kreme Matcha',     variants: [{ label: '', price: 220 }] },
      { name: 'White Chocolate Matcha', variants: [{ label: '', price: 240 }] },
    ],
  },
  {
    id: 'milktea', name: 'Milk Tea', tag: 'the classic sip', emoji: '🧋',
    badge: null,
    desc: "OG or loaded with extras — the Krema Milktea gets reordered way more than we expected.",
    priceRange: '₱140 – 180',
    items: [
      { name: 'OG Milktea',          variants: [{ label: '', price: 140 }] },
      { name: 'Krema Milktea',       variants: [{ label: '', price: 180 }] },
      { name: 'Salty Kreme Milktea', variants: [{ label: '', price: 170 }] },
      { name: 'Banana Milktea',      variants: [{ label: '', price: 170 }] },
    ],
  },
  {
    id: 'refreshers', name: 'Refreshers', tag: 'fruity & fizzy', emoji: '🍹',
    badge: null,
    desc: "Real fruit, really cold. Mango, lychee, peach, strawberry — the IG-friendly lineup.",
    priceRange: '₱150 – 165',
    items: [
      { name: 'Fresh Lemon',  variants: [{ label: '', price: 150 }] },
      { name: 'Lychee',       variants: [{ label: 'R', price: 150 }, { label: 'L', price: 160 }] },
      { name: 'Strawberry',   variants: [{ label: 'R', price: 150 }, { label: 'L', price: 160 }] },
      { name: 'Peach',        variants: [{ label: 'R', price: 150 }, { label: 'L', price: 160 }] },
      { name: 'Mango',        variants: [{ label: 'R', price: 150 }, { label: 'L', price: 160 }] },
      { name: 'Peach Mango',  variants: [{ label: '', price: 165 }] },
    ],
  },
  {
    id: 'snacks', name: 'Snacks', tag: 'lil bites', emoji: '🥐',
    badge: null,
    desc: "The kind of snack you didn't plan on ordering but absolutely will.",
    priceRange: '₱160 – 180',
    items: [
      { name: '3-Cheese Nachos',        variants: [{ label: '', price: 160 }] },
      { name: 'Sausage Cheese Puff',    variants: [{ label: '', price: 180 }] },
      { name: 'Ham & Cheese Croissant', variants: [{ label: '', price: 180 }] },
    ],
  },
];

const MONTHLY_SPECIALS = [
  { name: 'Atin Oreo Storm',     price: '₱200',        note: 'bingsu' },
  { name: 'Chocolate Campfire',  price: '₱200',        note: 'bingsu' },
  { name: 'Horchata',            price: '₱200',        note: 'drink' },
  { name: 'Mango Matcha',        price: '₱240',        note: 'drink' },
  { name: 'Mango Graham Bingsu', price: '₱280 · ₱380', note: 'solo · family' },
];

// ── PhotoSlot — intentional placeholder for the real photoshoot ──────────
// Looks reserved-for-photo, not "asset missing". Subtle diagonal hatch,
// monospace label, brand-style frame brackets.
function PhotoSlot({ label, kind = 'food', aspect = '1 / 1', radius = 18, tint = '#fff7e0', style }) {
  // SVG hatch + center text. Brackets at corners convey "this frame is reserved".
  const ink = '#2b3a66';
  const hatchId = useMemo(() => 'hatch-' + Math.random().toString(36).slice(2, 8), []);
  const kindLabel = ({ food: 'FOOD', drink: 'DRINK', lifestyle: 'LIFESTYLE', interior: 'INTERIOR' })[kind] || 'PHOTO';
  return (
    <div
      className="kh-photo-slot"
      style={{
        position: 'relative',
        aspectRatio: aspect,
        background: tint,
        border: `2.5px solid ${ink}`,
        borderRadius: radius,
        overflow: 'hidden',
        ...style,
      }}
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"
           style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="14" stroke={ink} strokeWidth="0.9" opacity="0.32" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${hatchId})`} />
      </svg>
      {/* corner brackets */}
      <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />
      {/* center label */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, padding: 16, textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 10, letterSpacing: '0.18em', color: ink, opacity: 0.55,
        }}>
          {kindLabel} · RESERVED
        </div>
        <div style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: ink,
        }}>
          {label}
        </div>
        <div style={{
          fontFamily: "'Caveat Brush', cursive", fontSize: 20, color: ink, opacity: 0.55, marginTop: 2,
        }}>
          shot dropping soon
        </div>
      </div>
    </div>
  );
}
function Bracket({ pos }) {
  const ink = '#2b3a66';
  const s = 18, t = 2.5;
  const styles = {
    tl: { top: 10, left: 10, borderTop: `${t}px solid ${ink}`, borderLeft: `${t}px solid ${ink}` },
    tr: { top: 10, right: 10, borderTop: `${t}px solid ${ink}`, borderRight: `${t}px solid ${ink}` },
    bl: { bottom: 10, left: 10, borderBottom: `${t}px solid ${ink}`, borderLeft: `${t}px solid ${ink}` },
    br: { bottom: 10, right: 10, borderBottom: `${t}px solid ${ink}`, borderRight: `${t}px solid ${ink}` },
  };
  return <span style={{ position: 'absolute', width: s, height: s, ...styles[pos] }} />;
}

// ── decorative doodles ────────────────────────────────────────────────────
function Sparkle({ size = 28, color = '#f1e056', ink = '#2b3a66', style }) {
  return (
    <svg viewBox="0 0 32 32" width={size} style={style} xmlns="http://www.w3.org/2000/svg">
      <path d="M 16 2 Q 18 13 28 16 Q 18 19 16 30 Q 14 19 4 16 Q 14 13 16 2 Z"
            fill={color} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function Heart({ size = 28, color = '#7ec3de', ink = '#2b3a66', style }) {
  return (
    <svg viewBox="0 0 32 32" width={size} style={style} xmlns="http://www.w3.org/2000/svg">
      <path d="M 16 28 Q 4 18 6 10 Q 8 4 14 6 Q 16 8 16 11 Q 16 8 18 6 Q 24 4 26 10 Q 28 18 16 28 Z"
            fill={color} stroke={ink} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function Swirl({ size = 60, color = '#2b3a66', style }) {
  return (
    <svg viewBox="0 0 60 60" width={size} style={style} xmlns="http://www.w3.org/2000/svg" fill="none">
      <path d="M 8 30 Q 8 12 30 12 Q 50 12 50 32 Q 50 48 34 48 Q 22 48 22 36 Q 22 28 32 28 Q 38 28 38 34"
            stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function Cloud({ size = 80, color = '#fff', ink = '#2b3a66', style }) {
  return (
    <svg viewBox="0 0 100 60" width={size} style={style} xmlns="http://www.w3.org/2000/svg">
      <path d="M 12 44 Q 4 44 6 34 Q 8 26 18 28 Q 18 16 32 16 Q 44 16 46 26 Q 56 22 64 28 Q 76 24 84 34 Q 96 34 94 46 Q 88 52 80 50 L 22 50 Q 14 52 12 44 Z"
            fill={color} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

// ── header / nav ──────────────────────────────────────────────────────────
function Header({ palette, showOpenBadge }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  // close on any nav link tap
  const closeMenu = () => setMenuOpen(false);
  return (
    <header className="kh-header">
      <div className="kh-header-inner">
        <a className="kh-logo" href="#top" style={{ display:'flex', alignItems:'center', textDecoration:'none' }}>
          <img src="assets/krema-logo-full.png" alt="Krema Dessert Haus" draggable={false}
               style={{ height:64, width:'auto', display:'block' }} />
        </a>
        <nav className={menuOpen ? 'kh-nav kh-nav-open' : 'kh-nav'}>
          {menuOpen && (
            <button className="kh-nav-close" onClick={closeMenu} aria-label="Close menu">✕</button>
          )}
          <a href="#menu"   onClick={closeMenu}>Menu</a>
          <a href="#gram"   onClick={closeMenu}>The Gram</a>
          <a href="#events" onClick={closeMenu}>Follow us</a>
          <a href="#find"   onClick={closeMenu}>Find us</a>
        </nav>
        <div className="kh-header-right">
          <button className="kh-hamburger" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <span /><span /><span />
          </button>
          {showOpenBadge && (
            <span className="kh-open-pill">
              <span className="kh-dot" />
              Open · til 11pm
            </span>
          )}
          <a className="kh-btn kh-btn-dark kh-btn-sm" href="#find">
            Find us <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </header>
  );
}

// ── hero ──────────────────────────────────────────────────────────────────
function Hero({ palette, scriptFont, vibe, mascotWiggle }) {
  const copy = COPY[vibe] || COPY.cheeky;
  return (
    <section id="top" className="kh-hero">
      <Cloud size={120} style={{ position: 'absolute', top: 60,  left: '8%', opacity: 0.85 }} />
      <Cloud size={90}  style={{ position: 'absolute', top: 110, right: '14%', opacity: 0.75 }} />
      <Sparkle size={36} color={palette.accent} style={{ position: 'absolute', top: 180, left: '46%' }} />
      <Sparkle size={22} color={palette.skyDeep} style={{ position: 'absolute', top: 80, left: '40%' }} />
      <Heart size={26} style={{ position: 'absolute', top: 240, right: '8%' }} />
      <Swirl size={70} style={{ position: 'absolute', bottom: 60, left: '5%', opacity: 0.5 }} />
      <img src="assets/sticker-croissant.png" alt="" draggable={false}
           style={{ position: 'absolute', bottom: 40, right: '4%', width: 100, height: 'auto', opacity: 0.88,
                    transform: 'rotate(12deg)', filter: 'drop-shadow(1px 2px 6px rgba(43,58,102,0.15))', pointerEvents: 'none' }} />

      <div className="kh-hero-inner">
        <div className="kh-hero-mascot">
          <div className="kh-hero-mascot-bubble">
            <img
              src="assets/krema-brandmark.png"
              alt="Krema mascot"
              draggable={false}
              style={{ width: '55%', height: 'auto', display: 'block', animation: mascotWiggle ? 'kh-wiggle 4.5s ease-in-out infinite' : 'none' }}
            />
            <div className="kh-speech">{copy.speech}</div>
            {/* a tiny "follow ig" tag pinned to the bubble */}
            <a href="https://instagram.com/kremadesserthaus" target="_blank" rel="noreferrer" className="kh-bubble-ig">
              <span>@kremadesserthaus</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
        <div className="kh-hero-text">
          <div className="kh-eyebrow">
            <span className="kh-eyebrow-pill">G/F Parqal Mall · Paranaque</span>
            <span className="kh-eyebrow-dot">·</span>
            <span>Mon–Thu 10am–10pm · Fri–Sun til 11</span>
          </div>
          <h1 className="kh-hero-title">
            Life's too short
            <br/>
            to skip dessert.
          </h1>
          <p className="kh-hero-sub">{copy.heroSub}</p>
          <div className="kh-hero-ctas">
            <a className="kh-btn kh-btn-primary" href="#menu">
              Peek the menu <span aria-hidden="true">→</span>
            </a>
            <a className="kh-btn kh-btn-ghost" href="#find">Find the haus</a>
          </div>
          <div className="kh-hero-meta">
            <span className="kh-meta-pill">★ 4.7 · 26 Google reviews</span>
            <span className="kh-meta-pill">🐾 Pet-friendly · Wi-Fi inside</span>
          </div>
        </div>
      </div>

      <div className="kh-ribbon">
        <div className="kh-ribbon-track">
          {Array(3).fill(0).flatMap((_, k) => [
            <span key={`a${k}`}>BINGSU SZN</span>,
            <Heart key={`h${k}`} size={20} color={palette.accent} />,
            <span key={`b${k}`}>NEW · MANGO GRAHAM BINGSU</span>,
            <Sparkle key={`s${k}`} size={20} color="#fff" />,
            <span key={`c${k}`}>YES, IT'S PET-FRIENDLY</span>,
            <Heart key={`h2${k}`} size={20} color={palette.skyDeep} />,
            <span key={`d${k}`}>COFFEE · MATCHA · MILKTEA · REFRESHERS</span>,
            <Sparkle key={`s2${k}`} size={20} color="#fff" />,
            <span key={`e${k}`}>G/F PARQAL MALL · PARANAQUE</span>,
            <Heart key={`h3${k}`} size={20} color={palette.accent} />,
          ])}
        </div>
      </div>
    </section>
  );
}

// ── menu ──────────────────────────────────────────────────────────────────
function MenuCategoryCard({ cat, idx }) {
  const ink = '#2b3a66';
  return (
    <div className="kh-card" style={{ '--rot': `${(idx % 2 ? 1.2 : -1.2)}deg` }}>
      {cat.badge && (
        <div className={`kh-card-badge ${cat.badge === 'new' ? 'is-new' : ''}`}>
          {cat.badge === 'new' ? 'NEW' : 'must-try'}
        </div>
      )}
      <div className="kh-card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 30, lineHeight: 1 }}>{cat.emoji}</span>
          <div>
            <div className="kh-card-tag" style={{ marginBottom: 0 }}>{cat.tag}</div>
            <h3 className="kh-card-title" style={{ margin: 0 }}>{cat.name}</h3>
          </div>
        </div>
        <p className="kh-card-desc" style={{ marginBottom: 10 }}>{cat.desc}</p>

        {/* items list */}
        <div style={{ borderTop: `1.5px solid rgba(43,58,102,0.16)`, paddingTop: 8, flex: 1 }}>
          {cat.items.map((item, j) => (
            <div key={j} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '3.5px 0',
              borderBottom: j < cat.items.length - 1 ? `1px solid rgba(43,58,102,0.07)` : 'none',
            }}>
              <span style={{ fontSize: 12.5, fontFamily: 'var(--font-body)', fontWeight: 600, color: ink, flex: 1, lineHeight: 1.3 }}>
                {item.name}
              </span>
              <span style={{ fontSize: 11.5, color: ink, opacity: 0.68, whiteSpace: 'nowrap', marginLeft: 6, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.02em' }}>
                {item.variants.length === 1 && item.variants[0].label === ''
                  ? `₱${item.variants[0].price}`
                  : item.variants.map(v => v.label ? `${v.label} ₱${v.price}` : `₱${v.price}`).join(' / ')
                }
              </span>
            </div>
          ))}
        </div>

        {/* add-ons */}
        {cat.addons && (
          <div style={{
            marginTop: 8, padding: '7px 10px',
            background: 'rgba(43,58,102,0.05)',
            borderRadius: 8,
            border: '1px dashed rgba(43,58,102,0.18)',
          }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', color: ink, opacity: 0.45, marginBottom: 3, fontFamily: 'ui-monospace, monospace', textTransform: 'uppercase' }}>
              Add-ons
            </div>
            {cat.addons.map((a, k) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: ink, opacity: 0.72 }}>
                <span>{a.name}</span>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{a.price}</span>
              </div>
            ))}
          </div>
        )}

        {/* footer */}
        <div className="kh-card-foot" style={{ marginTop: 10 }}>
          <span className="kh-card-price">{cat.priceRange}</span>
        </div>
      </div>
    </div>
  );
}

function MonthlySpecials({ palette }) {
  return (
    <div className="kh-monthly-specials">
      <div style={{ textAlign: 'center', marginBottom: 28, position: 'relative', zIndex: 1 }}>
        <div className="kh-section-eyebrow" style={{ justifyContent: 'center' }}>
          <Sparkle size={18} color={palette.accent} />
          <span style={{ color: palette.accent }}>this month only</span>
          <Sparkle size={18} color={palette.accent} />
        </div>
        <h3 style={{
          fontFamily: 'var(--font-script)', fontWeight: 400,
          fontSize: 'clamp(34px, 5vw, 50px)',
          color: '#fff',
          textShadow: '2px 3px 0 rgba(0,0,0,0.28)',
          margin: '4px 0 6px', letterSpacing: '0.01em',
        }}>Barista's Blackboard</h3>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: '0.14em', fontFamily: 'ui-monospace, monospace', textTransform: 'uppercase' }}>
          Monthly Specials · While Supplies Last
        </p>
      </div>
      <div className="kh-specials-list">
        {MONTHLY_SPECIALS.map((s, i) => (
          <div key={i} className="kh-special-row">
            <span className="kh-special-name">{s.name}</span>
            <span className="kh-special-dots" aria-hidden="true" />
            <span className="kh-special-price">{s.price}</span>
            {s.note && <span className="kh-special-note">{s.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Menu({ palette, featuredBingsu, scriptFont }) {
  const bingsuPrices = { 'Mango Magic': '₱270 – 370', 'Buko Pandan': '₱250 – 350', 'Choco Snow': '₱250 – 350', 'Halo Supreme': '₱380' };
  const bingsuDescs = {
    'Mango Magic':   "Milky shaved snow piled with real mango, condensed milk swirl, and mochi. The one everyone orders twice.",
    'Buko Pandan':   "Shaved snow meets coconut jelly, pandan syrup, and buko strips. Tropical, creamy, completely addictive.",
    'Choco Snow':    "Chocolate shaved milk, fudge drizzle, mochi, and more chocolate. For when you mean it.",
    'Halo Supreme':  "All the classics at once — ube, gulaman, beans, leche flan, ube ice cream. Family size only, because it should be.",
  };
  return (
    <section id="menu" className="kh-menu">
      <div className="kh-section-head" style={{ position: 'relative' }}>
        <img src="assets/sticker-coffee.png" alt="" draggable={false}
             style={{ position: 'absolute', top: -20, right: -10, width: 90, height: 'auto', opacity: 0.9,
                      transform: 'rotate(10deg)', filter: 'drop-shadow(1px 2px 6px rgba(43,58,102,0.12))', pointerEvents: 'none' }} />
        <div className="kh-section-eyebrow">
          <Sparkle size={18} color={palette.accent} />
          <span>What we're scooping</span>
          <Sparkle size={18} color={palette.skyDeep} />
        </div>
        <h2 className="kh-section-title">The menu, ate.</h2>
        <p className="kh-section-sub">
          Six categories, real prices, zero pretension. Add leche flan on your bingsu. You know you want to.
        </p>
      </div>

      <div className="kh-menu-grid">
        {MENU_CATEGORIES.map((cat, i) => <MenuCategoryCard key={cat.id} cat={cat} idx={i} />)}
      </div>

      {/* monthly specials — chalkboard */}
      <MonthlySpecials palette={palette} />

      {/* feature strip */}
      <div className="kh-feature">
        <div className="kh-feature-art">
          <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 360, aspectRatio: '1/1', borderRadius: 26, overflow: 'hidden', border: '3px solid #2b3a66', boxShadow: '7px 9px 0 #2b3a66, 16px 24px 28px rgba(43,58,102,0.18)' }}>
            <PhotoSlot label="BINGSU · OVERHEAD SHOT" kind="food" aspect="1/1" radius={22} tint="#fff7e0" />
          </div>
          <img src="assets/sticker-blob-walk.png" alt="" draggable={false}
               style={{ position: 'absolute', bottom: -20, right: -20, zIndex: 2, width: 160, height: 'auto',
                        filter: 'drop-shadow(2px 4px 10px rgba(43,58,102,0.18))',
                        transform: 'rotate(-6deg)' }} />
        </div>
        <div className="kh-feature-body">
          <div className="kh-feature-eyebrow">
            today's bingsu pick
          </div>
          <h3 className="kh-feature-title">{featuredBingsu}</h3>
          <p className="kh-feature-desc">
            {bingsuDescs[featuredBingsu] || "Milky shaved snow, real toppings, and a mountain of flavour. Solo if you're reasonable, Family if you're honest. Add leche flan for ₱50."}
          </p>
          <div className="kh-feature-row">
            <span className="kh-feature-price">{bingsuPrices[featuredBingsu] || '₱250 – 380'}</span>
            <a className="kh-btn kh-btn-primary" href="#menu">Full menu ↑</a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── social hub (replaces events while no events are scheduled) ────────────
const SOCIALS = [
  { name: 'Instagram', handle: '@kremadesserthaus', url: 'https://instagram.com/kremadesserthaus',
    tag: 'photos · reels · stories', tint: '#7ec3de',
    desc: "Our most active corner — bingsu drops, daily stories, and the occasional overshare." },
  { name: 'Facebook', handle: 'Krema Dessert Haus', url: 'https://www.facebook.com/p/Krema-Dessert-Haus-61578931360576/',
    tag: 'updates · promos', tint: '#f1e056',
    desc: "Hours updates, promos, and the occasional announcement. Give us a like na!" },
  { name: 'TikTok', handle: '@krema.ph', url: 'https://www.tiktok.com/@krema.ph',
    tag: 'videos · vibes', tint: '#9dd4e8',
    desc: "Bingsu pours, soft drinks fizzing, chaotic staff moments. Follow before we go viral." },
];

function Events({ palette, vibe }) {
  return (
    <section id="events" className="kh-events">
      <div className="kh-events-head">
        <div className="kh-section-eyebrow">
          <Heart size={18} color={palette.skyDeep} />
          <span>Find us online</span>
          <Heart size={18} color={palette.accent} />
        </div>
        <h2 className="kh-section-title">Hang with us, bestie.</h2>
        <p className="kh-section-sub">
          No events on the calendar yet — but follow us so you're first to know when K-pop nights,
          adoption drives, and sip-and-sketch sessions drop. They're coming, promise.
        </p>
      </div>

      <div className="kh-events-grid">
        {SOCIALS.map((s, i) => {
          const rots = [-2, 1.5, -1];
          const gradients = {
            Instagram: 'linear-gradient(145deg, #93ccdf 0%, #6cb6d4 70%, #4ea1c2 100%)',
            Facebook:  'linear-gradient(145deg, #f7ee80 0%, #f1e056 70%, #e6cc30 100%)',
            TikTok:    'linear-gradient(145deg, #bce6f5 0%, #9dd4e8 70%, #7ec3de 100%)',
          };
          // Platform logos as SVGs — semi-transparent watermark in top-right
          const logoSvg = {
            Instagram: (
              <svg width="110" height="110" viewBox="0 0 24 24" fill="none"
                   stroke="rgba(43,58,102,0.13)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="6"/>
                <circle cx="12" cy="12" r="5"/>
                <circle cx="17.5" cy="6.5" r="1.5" fill="rgba(43,58,102,0.13)" stroke="none"/>
              </svg>
            ),
            Facebook: (
              <svg width="110" height="110" viewBox="0 0 24 24" fill="rgba(43,58,102,0.13)">
                <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
              </svg>
            ),
            TikTok: (
              <svg width="110" height="110" viewBox="0 0 24 24" fill="rgba(43,58,102,0.13)">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.79a8.18 8.18 0 0 0 4.78 1.52V6.86a4.85 4.85 0 0 1-1.01-.17z"/>
              </svg>
            ),
          };
          // Small icon for the tag row
          const smallIcon = {
            Instagram: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                   stroke="#2b3a66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="6"/>
                <circle cx="12" cy="12" r="4.5"/>
                <circle cx="17.5" cy="6.5" r="1.2" fill="#2b3a66" stroke="none"/>
              </svg>
            ),
            Facebook: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#2b3a66">
                <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
              </svg>
            ),
            TikTok: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#2b3a66">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.79a8.18 8.18 0 0 0 4.78 1.52V6.86a4.85 4.85 0 0 1-1.01-.17z"/>
              </svg>
            ),
          };
          return (
            <a key={i} href={s.url} target="_blank" rel="noreferrer"
               className="kh-event-card"
               style={{
                 '--tint': s.tint,
                 '--rot': `${rots[i]}deg`,
                 textDecoration: 'none',
                 color: 'inherit',
                 background: gradients[s.name] || s.tint,
                 overflow: 'hidden',
                 position: 'relative',
               }}>
              {/* platform logo watermark */}
              <div style={{ position: 'absolute', top: -14, right: -14, pointerEvents: 'none', userSelect: 'none' }}>
                {logoSvg[s.name]}
              </div>
              <div className="kh-event-tape" />
              <div className="kh-event-body" style={{ paddingTop: 24, position: 'relative', zIndex: 1 }}>
                {/* small icon + tag row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  {smallIcon[s.name]}
                  <span className="kh-event-tag" style={{ margin: 0 }}>{s.tag}</span>
                </div>
                <h3 className="kh-event-title" style={{ fontSize: 28 }}>{s.name}</h3>
                <p style={{ fontSize: 14, margin: '8px 0 18px', opacity: 0.82, lineHeight: 1.48 }}>{s.desc}</p>
                <div className="kh-event-foot">
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{s.handle}</span>
                  <span className="kh-btn kh-btn-dark kh-btn-sm">Follow <span aria-hidden="true">↗</span></span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

// ── the gram — instagram strip ───────────────────────────────────────────
function Gram({ palette, scriptFont }) {
  // intentional photo slots laid out like an IG grid, with captions hinting
  // at what should go in each tile when real photos arrive.
  const tiles = [
    { src: 'assets/photo_gram1.jpg', caption: 'serving looks & drinks' },
    { src: 'assets/photo_gram2.jpg', caption: 'staff who make it happen' },
    { src: 'assets/photo_gram3.jpg', caption: 'cheers, bestie ✨' },
    { src: 'assets/photo_gram4.jpg', caption: 'the vibe check passed' },
    { src: 'assets/photo_gram5.jpg', caption: 'main character energy' },
    { src: 'assets/photo_gram6.jpg', caption: 'the haus, up close' },
  ];
  return (
    <section id="gram" className="kh-gram">
      <div className="kh-gram-head" style={{ position: 'relative' }}>
        <img src="assets/sticker-boba.png" alt="" draggable={false}
             style={{ position: 'absolute', top: -10, left: -20, width: 95, height: 'auto', opacity: 0.88,
                      transform: 'rotate(-12deg)', filter: 'drop-shadow(1px 2px 6px rgba(43,58,102,0.12))', pointerEvents: 'none' }} />
        <img src="assets/sticker-blob-chill.png" alt="" draggable={false}
             style={{ position: 'absolute', top: 20, right: -10, width: 85, height: 'auto', opacity: 0.85,
                      transform: 'rotate(8deg)', filter: 'drop-shadow(1px 2px 6px rgba(43,58,102,0.12))', pointerEvents: 'none' }} />
        <div className="kh-section-eyebrow">
          <Sparkle size={18} color={palette.accent} />
          <span>as seen on @kremadesserthaus</span>
          <Sparkle size={18} color={palette.skyDeep} />
        </div>
        <h2 className="kh-section-title">Your moots<br/>are already here.</h2>
        <p className="kh-section-sub">
          Tag <strong>@kremadesserthaus</strong> and we'll reshare. Probably with a heart emoji
          and a comment that's way too long.
        </p>
      </div>
      <div className="kh-gram-grid">
        {tiles.map((t, i) => (
          <div key={i} className="kh-gram-tile" style={{ '--rot': `${((i * 7) % 5 - 2) * 0.8}deg` }}>
            <div style={{ aspectRatio: '1/1', borderRadius: 14, overflow: 'hidden', border: '2.5px solid #2b3a66' }}>
              <img src={t.src} alt={t.caption} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <div className="kh-gram-cap" >
              {t.caption}
            </div>
          </div>
        ))}
      </div>
      <div className="kh-gram-foot">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
          <a className="kh-btn kh-btn-ig" href="https://instagram.com/kremadesserthaus" target="_blank" rel="noreferrer">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="6"/>
              <circle cx="12" cy="12" r="4.5"/>
              <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none"/>
            </svg>
            Instagram <span aria-hidden="true">↗</span>
          </a>
          <a className="kh-btn kh-btn-fb" href="https://www.facebook.com/p/Krema-Dessert-Haus-61578931360576/" target="_blank" rel="noreferrer">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
            </svg>
            Facebook <span aria-hidden="true">↗</span>
          </a>
          <a className="kh-btn kh-btn-tt" href="https://www.tiktok.com/@krema.ph" target="_blank" rel="noreferrer">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.79a8.18 8.18 0 0 0 4.78 1.52V6.86a4.85 4.85 0 0 1-1.01-.17z"/>
            </svg>
            TikTok <span aria-hidden="true">↗</span>
          </a>
        </div>
        <span className="kh-gram-note">320 followers and growing · tag us @kremadesserthaus</span>
      </div>
    </section>
  );
}

// ── find us ───────────────────────────────────────────────────────────────
function FindUs({ palette, scriptFont, vibe }) {
  const copy = COPY[vibe] || COPY.cheeky;
  return (
    <section id="find" className="kh-find">
      <div className="kh-find-inner">
        <div className="kh-find-stack">
          <div style={{ aspectRatio: '1.2/1', borderRadius: 26, overflow: 'hidden', border: '2.5px solid #2b3a66' }}>
            <img src="assets/photo_storefront.jpg" alt="Krema Dessert Haus storefront" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          {/* google maps embed */}
          <div className="kh-find-map" style={{ height: 220, padding: 0, overflow: 'hidden' }}>
            <iframe
              title="Krema Dessert Haus on Google Maps"
              src="https://maps.google.com/maps?q=14.5265193,120.9874293&output=embed&z=18"
              style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
              loading="lazy"
              allowFullScreen
            />
          </div>
        </div>
        <div className="kh-find-body">
          <div className="kh-section-eyebrow">
            <Sparkle size={16} color={palette.accent} />
            <span>Come thru</span>
          </div>
          <h2 className="kh-section-title">Find the haus.</h2>
          <p className="kh-section-sub">{copy.findSub}</p>
          <ul className="kh-find-list">
            <li><strong>Address</strong><span>Unit 112, Banig Bldg., A. Luz Drive, Parqal Mall, Parañaque</span></li>
            <li><strong>Hours</strong><span>Mon–Thu · 10am – 10pm<br/>Fri–Sun · 10am – 11pm</span></li>
            <li><strong>Vibe</strong><span>Pet-friendly · Wi-Fi · Free board games · Great for groups</span></li>
            <li><strong>Slide in</strong><span>IG: @kremadesserthaus · FB: Krema Dessert Haus · TikTok: @krema.ph</span></li>
          </ul>
          <div className="kh-find-ctas">
            <a className="kh-btn kh-btn-primary" href="https://maps.google.com/?q=Krema+Dessert+Haus,+Parqal+Mall,+Aseana+Ave,+Paranaque+City,+Philippines" target="_blank" rel="noreferrer">Get directions ↗</a>
            <a className="kh-btn kh-btn-ghost" href="https://instagram.com/kremadesserthaus" target="_blank" rel="noreferrer">Message us on IG</a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── footer ────────────────────────────────────────────────────────────────
function Footer({ palette, scriptFont, vibe }) {
  const copy = COPY[vibe] || COPY.cheeky;
  return (
    <footer className="kh-footer">
      <div className="kh-footer-top">
        <MascotChill size={160} />
        <div className="kh-footer-message" >
          {copy.footerMsg.split('\n').map((line, i) => (
            <span key={i}>{line}<br/></span>
          ))}
          <Heart size={32} color={palette.skyDeep} style={{ verticalAlign: 'middle' }} />
        </div>
      </div>
      <div className="kh-footer-mid">
        <div className="kh-footer-mark">
          <span className="kh-footer-k">K</span>
          <span className="kh-footer-rest">REMA</span>
        </div>
      </div>
      <div className="kh-footer-bot">
        <div className="kh-footer-col">
          <h4>The haus</h4>
          <a href="#menu">Menu</a>
          <a href="#events">Follow us</a>
          <a href="#gram">The gram</a>
        </div>
        <div className="kh-footer-col">
          <h4>Visit</h4>
          <a href="#find">Find us</a>
          <a href="#">Hours</a>
          <a href="#">Reserve</a>
        </div>
        <div className="kh-footer-col">
          <h4>Say hi</h4>
          <a href="https://instagram.com/kremadesserthaus" target="_blank" rel="noreferrer">Instagram ↗</a>
          <a href="https://www.facebook.com/p/Krema-Dessert-Haus-61578931360576/" target="_blank" rel="noreferrer">Facebook ↗</a>
          <a href="https://www.tiktok.com/@krema.ph" target="_blank" rel="noreferrer">TikTok ↗</a>
        </div>
        <div className="kh-footer-col kh-footer-col-wide">
          <h4>K-list</h4>
          <p>The bingsu drop, K-pop nights, happy-hour reminders. No spam, pinky promise.</p>
          <form className="kh-newsletter" onSubmit={(e) => e.preventDefault()}>
            <input type="email" placeholder="you@krema.life" />
            <button type="submit">Subscribe</button>
          </form>
        </div>
      </div>
      <div className="kh-footer-base">
        <span>© 2026 Krema Dessert Haus · Made with ube in Parañaque</span>
        <span>privacy · terms · accessibility</span>
      </div>
    </footer>
  );
}

// ── app ───────────────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const palette = PALETTES[t.palette] || PALETTES.sky;

  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--bg', palette.bg);
    r.setProperty('--bg-deep', palette.bgDeep);
    r.setProperty('--accent', palette.accent);
    r.setProperty('--accent-deep', palette.accentDeep);
    r.setProperty('--sky-deep', palette.skyDeep);
  }, [palette]);

  return (
    <div className="kh-root">
      <Header palette={palette} showOpenBadge={t.showOpenBadge} />
      <Hero palette={palette} scriptFont={t.scriptFont} vibe={t.vibe} mascotWiggle={t.mascotWiggle} />
      <Menu palette={palette} featuredBingsu={t.featuredBingsu} scriptFont={t.scriptFont} />
      <Events palette={palette} vibe={t.vibe} />
      <Gram palette={palette} scriptFont={t.scriptFont} />
      <FindUs palette={palette} scriptFont={t.scriptFont} vibe={t.vibe} />
      <Footer palette={palette} scriptFont={t.scriptFont} vibe={t.vibe} />

      <TweaksPanel>
        <TweakSection label="Palette" />
        <TweakRadio label="Theme" value={t.palette}
                    options={['sky', 'sunny', 'candy']}
                    onChange={(v) => setTweak('palette', v)} />

        <TweakSection label="Voice" />
        <TweakRadio label="Copy vibe" value={t.vibe}
                    options={['cheeky', 'soft', 'loud']}
                    onChange={(v) => setTweak('vibe', v)} />
        <TweakSelect label="Script font" value={t.scriptFont}
                     options={['Bukhari Script', 'Caveat Brush', 'Pacifico', 'Sacramento', 'Shadows Into Light']}
                     onChange={(v) => setTweak('scriptFont', v)} />

        <TweakSection label="Mascot" />
        <TweakToggle label="Idle wiggle" value={t.mascotWiggle}
                     onChange={(v) => setTweak('mascotWiggle', v)} />

        <TweakSection label="Content" />
        <TweakToggle label='"We are open" pill' value={t.showOpenBadge}
                     onChange={(v) => setTweak('showOpenBadge', v)} />
        <TweakSelect label="Featured bingsu" value={t.featuredBingsu}
                     options={['Mango Magic', 'Buko Pandan', 'Choco Snow', 'Halo Supreme']}
                     onChange={(v) => setTweak('featuredBingsu', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
