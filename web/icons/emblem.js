// Ghana Prisons Service crest, redrawn as an SVG app icon.
// Emblem local box: 340 wide x 505 tall, centre x = 170.
const BLACK = "#111111", WHITE = "#ffffff";
const RED = "#ce1126", GOLD = "#fcd116", GREEN = "#006b3f";
const SHIELD_GREEN = "#1f7a3e", SHIELD_BLUE = "#2b7fc2", LION = "#f2b52a";
const SAND = "#f3ece1";

function star(cx, cy, ro, ri) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${BLACK}"/>`;
}

function arc(cx, cy, r, a0, a1) {
  // angles in degrees, clockwise from 12 o'clock
  const p = (a) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`;
  };
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${p(a0)} A ${r} ${r} 0 ${large} ${sweep} ${p(a1)}`;
}

// A heraldic lion passant, simplified so it still reads as a lion at 48 px.
// Drawn in a 100 x 70 box, facing left like the crest's lion.
const LION_PATH =
  "M 8 22 C 4 26 4 34 10 36 L 18 36 L 20 40 C 22 44 22 48 24 50 L 26 68 L 34 68 L 34 52 L 40 52 L 42 68 L 50 68 L 48 50 " +
  "L 60 50 L 62 68 L 70 68 L 70 52 L 74 52 L 78 68 L 86 68 L 84 46 C 88 40 88 30 84 26 C 70 16 50 14 34 18 C 30 8 22 4 14 8 C 10 10 8 16 8 22 Z";
const LION_TAIL = "M 82 28 C 92 24 98 14 92 6";

function emblem() {
  const cx = 170;
  const ringCy = 335, ringR = 170, ringInner = 120;
  const textR = 145;
  const parts = [];

  // star
  parts.push(star(cx, 60, 60, 24));

  // tricolour band, a curved ribbon just above the ring
  const bandR = ringR + 14;
  const bandY = ringCy;
  const segs = [
    [-33, -11, RED], [-11, 11, GOLD], [11, 33, GREEN],
  ];
  parts.push(`<path d="${arc(cx, bandY, bandR, -36, 36)}" fill="none" stroke="${BLACK}" stroke-width="34" stroke-linecap="butt"/>`);
  for (const [a0, a1, col] of segs) {
    parts.push(`<path d="${arc(cx, bandY, bandR, a0, a1)}" fill="none" stroke="${col}" stroke-width="26"/>`);
  }
  // the band in the crest is cut into small blocks: black ticks between the blocks
  for (const a of [-33, -22, -11, 0, 11, 22, 33]) {
    parts.push(`<path d="${arc(cx, bandY, bandR, a - 0.9, a + 0.9)}" fill="none" stroke="${BLACK}" stroke-width="26"/>`);
  }

  // ring
  parts.push(`<circle cx="${cx}" cy="${ringCy}" r="${ringR}" fill="${BLACK}"/>`);
  parts.push(`<circle cx="${cx}" cy="${ringCy}" r="${ringInner}" fill="${WHITE}"/>`);

  // ring text
  const font = `font-family="'DejaVu Sans','Liberation Sans','Helvetica Neue',Arial,sans-serif" font-weight="700" fill="${WHITE}"`;
  parts.push(`<defs>
    <path id="top" d="${arc(cx, ringCy, textR, -90, 90)}"/>
    <path id="bot" d="${arc(cx, ringCy, textR, 250, 110)}"/>
  </defs>`);
  parts.push(`<text ${font} font-size="42" letter-spacing="7"><textPath href="#top" startOffset="50%" text-anchor="middle">GHANA</textPath></text>`);
  parts.push(`<text ${font} font-size="42" letter-spacing="6" dominant-baseline="hanging"><textPath href="#bot" startOffset="50%" text-anchor="middle">PRISONS</textPath></text>`);

  // shield: a heater shape, 116 wide, 140 tall, centred a little above the disc centre
  const sx = cx, sy = ringCy - 20;
  const w = 104, h = 124;
  const L = sx - w / 2, R = sx + w / 2, T = sy - h / 2, B = sy + h / 2;
  const shield = `M ${L} ${T} L ${R} ${T} L ${R} ${T + h * 0.5} C ${R} ${T + h * 0.85} ${sx + w * 0.2} ${B - 8} ${sx} ${B} C ${sx - w * 0.2} ${B - 8} ${L} ${T + h * 0.85} ${L} ${T + h * 0.5} Z`;
  parts.push(`<defs><clipPath id="shield"><path d="${shield}"/></clipPath></defs>`);
  parts.push(`<path d="${shield}" fill="${SHIELD_BLUE}"/>`);
  parts.push(`<g clip-path="url(#shield)">`);
  // green cross
  parts.push(`<rect x="${sx - 12}" y="${T}" width="24" height="${h}" fill="${SHIELD_GREEN}"/>`);
  parts.push(`<rect x="${L}" y="${sy - 12}" width="${w}" height="24" fill="${SHIELD_GREEN}"/>`);
  // top-left quarter: a sword / staff
  parts.push(`<g transform="translate(${L + 8} ${T + 8})"><path d="M 6 40 L 34 4" stroke="${GOLD}" stroke-width="7" stroke-linecap="round"/><path d="M 24 6 L 38 20" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/><path d="M 3 45 L 10 38" stroke="${GOLD}" stroke-width="9" stroke-linecap="round"/></g>`);
  // top-right quarter: a small castle
  parts.push(`<g transform="translate(${sx + 16} ${T + 10})" fill="${WHITE}"><rect x="4" y="16" width="34" height="26"/><rect x="4" y="8" width="7" height="10"/><rect x="17" y="8" width="7" height="10"/><rect x="31" y="8" width="7" height="10"/><rect x="17" y="30" width="8" height="12" fill="${SHIELD_BLUE}"/></g>`);
  // bottom-left quarter: a tree
  parts.push(`<g transform="translate(${L + 8} ${sy + 16})"><rect x="20" y="24" width="7" height="22" fill="${GOLD}"/><circle cx="23.5" cy="20" r="16" fill="${SHIELD_GREEN}"/><circle cx="23.5" cy="20" r="16" fill="none" stroke="${WHITE}" stroke-width="2"/></g>`);
  // bottom-right quarter: a mine head-frame (gold and minerals)
  parts.push(`<g transform="translate(${sx + 14} ${sy + 14})"><path d="M 8 44 L 20 8 L 32 44 Z" fill="none" stroke="${GOLD}" stroke-width="5" stroke-linejoin="round"/><rect x="2" y="42" width="36" height="5" fill="${GOLD}"/><circle cx="20" cy="6" r="5" fill="${WHITE}"/></g>`);
  parts.push(`</g>`);
  parts.push(`<path d="${shield}" fill="none" stroke="${SHIELD_GREEN}" stroke-width="5"/>`);
  // the lion at the centre of the cross
  parts.push(`<g transform="translate(${sx - 31} ${sy - 22}) scale(0.62)"><path d="${LION_TAIL}" fill="none" stroke="${LION}" stroke-width="7" stroke-linecap="round"/><path d="${LION_TAIL}" fill="none" stroke="${BLACK}" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/><path d="${LION_PATH}" fill="${LION}" stroke="${BLACK}" stroke-width="2" stroke-linejoin="round"/><polygon points="14,8 20,2 22,10" fill="${LION}" stroke="${BLACK}" stroke-width="1.5"/><circle cx="13" cy="19" r="2" fill="${BLACK}"/></g>`);

  // motto ribbon under the shield
  const ry = B + 6;
  parts.push(`<path d="M ${sx - 100} ${ry - 4} Q ${sx} ${ry + 24} ${sx + 100} ${ry - 4} L ${sx + 93} ${ry + 20} Q ${sx} ${ry + 46} ${sx - 93} ${ry + 20} Z" fill="${GOLD}" stroke="${BLACK}" stroke-width="2.5" stroke-linejoin="round"/>`);
  parts.push(`<defs><path id="motto" d="M ${sx - 97} ${ry + 10} Q ${sx} ${ry + 36} ${sx + 97} ${ry + 10}"/></defs>`);
  parts.push(`<text font-family="'DejaVu Sans','Liberation Sans',Arial,sans-serif" font-weight="700" font-size="9" fill="${BLACK}" letter-spacing="0"><textPath href="#motto" startOffset="50%" text-anchor="middle">VIGILANCE · FORTITUDE · HUMANITY</textPath></text>`);

  return parts.join("\n");
}

/** scale: fraction of the 512 canvas height the emblem should fill. */
function svg({ size = 512, scale = 0.92, background = SAND, rounded = 0 } = {}) {
  const W = 340, H = 505;
  const k = (size * scale) / H;
  const tx = (size - W * k) / 2, ty = (size - H * k) / 2;
  const bg = rounded
    ? `<rect width="${size}" height="${size}" rx="${rounded}" fill="${background}"/>`
    : `<rect width="${size}" height="${size}" fill="${background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<title>Ghana Prisons Service</title>
${bg}
<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})">
${emblem()}
</g>
</svg>
`;
}
module.exports = { svg };
