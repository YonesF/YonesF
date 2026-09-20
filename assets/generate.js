#!/usr/bin/env node
// Regenerates the animated SVGs referenced by README.md:
//   assets/globe.svg, assets/globe-dark.svg  - spinning wireframe globe (light / dark theme)
//   assets/header.svg                        - space banner
//
// Everything is animated with SMIL (<animate>/<animateTransform>), which keeps moving inside
// GitHub's <img> sandbox where CSS animations and JavaScript are stripped.
//
// Usage: node assets/generate.js [outDir]
//        PHASE=3 node assets/generate.js /tmp/out   -> renders every animation 3s in (for screenshots)

'use strict';
const fs = require('fs');
const path = require('path');

const DEG = Math.PI / 180;
const r1 = n => String(Math.round(n * 10) / 10 + 0); // "+ 0" turns -0 into 0
const r2 = n => String(Math.round(n * 100) / 100 + 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const PHASE = Number(process.env.PHASE || 0);

// Small seeded PRNG so the star fields are stable between runs.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const beginAttr = (begin = 0) => ` begin="${r2(begin - PHASE)}s"`;
const anim = (attr, values, dur, extra = '', begin = 0) =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}s" repeatCount="indefinite"${beginAttr(begin)}${extra}/>`;
const animT = (type, values, dur, extra = '', begin = 0) =>
  `<animateTransform attributeName="transform" type="${type}" values="${values}" dur="${dur}s" repeatCount="indefinite"${beginAttr(begin)}${extra}/>`;

// Twinkling stars scattered over a w x h area, skipping spots where exclude(x, y) is true.
function starField(rand, count, w, h, { color, minOpacity = 0.15, maxOpacity = 1, exclude }) {
  let out = '', placed = 0, guard = 0;
  while (placed < count && guard++ < count * 50) {
    const x = 4 + rand() * (w - 8), y = 4 + rand() * (h - 8);
    if (exclude && exclude(x, y)) continue;
    const r = 0.6 + rand() * 1.1;
    const lo = (minOpacity + rand() * 0.3).toFixed(2);
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${color}" opacity="${lo}">` +
      anim('opacity', `${lo};${maxOpacity};${lo}`, (1.6 + rand() * 2.4).toFixed(2), '', -rand() * 4) + '</circle>';
    placed++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Globe: an orthographic projection of a lat/long grid seen from slightly above the equator.
// Parallels are static ellipses. Each meridian is a great circle whose projection is the unit
// circle pushed through skewY(theta) then scale(R*sin(lon), -R*cos(beta)); both parameters are
// keyframed per longitude so the wireframe really rotates instead of just sliding sideways.
// ---------------------------------------------------------------------------------------------
function globe({ dark }) {
  const S = 184, CX = 92, CY = 96, R = 56;
  const BETA = 22 * DEG, sb = Math.sin(BETA), cb = Math.cos(BETA); // camera elevation
  const TILT = 14;            // in-plane lean of the axis, degrees
  const T = 12, N = 72;       // rotation period (s) and keyframes per turn
  const T_MOON = 9;
  const ORX = 84, ORY = 24, OTILT = -18;
  const LINE = '#bae6fd';
  const bg = dark ? '#0d1117' : '#ffffff';

  const frames = fn => Array.from({ length: N + 1 }, (_, k) => fn(k / N)).join(';');

  // --- parallels -----------------------------------------------------------------------------
  let parallels = '';
  for (const phi of [-60, -30, 0, 30, 60]) {
    const p = phi * DEG, rx = R * Math.cos(p), ry = rx * sb, cy = -R * Math.sin(p) * cb;
    const cls = phi === 0 ? 'near eq' : 'near';
    const k = -Math.tan(p) * Math.tan(BETA); // cos(lon) where the parallel crosses the limb
    if (k <= -1) { parallels += `<ellipse cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" class="${cls}"/>`; continue; }
    if (k >= 1) { parallels += `<ellipse cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" class="far"/>`; continue; }
    const ls = Math.acos(k);
    const x = r1(rx * Math.sin(ls)), y = r1(cy + ry * Math.cos(ls));
    const near = `M${-x} ${y}A${r1(rx)} ${r1(ry)} 0 ${ls > Math.PI / 2 ? 1 : 0} 0 ${x} ${y}`;
    const far = `M${x} ${y}A${r1(rx)} ${r1(ry)} 0 ${ls < Math.PI / 2 ? 1 : 0} 0 ${-x} ${y}`;
    parallels += `<path d="${far}" class="far"/><path d="${near}" class="${cls}"/>`;
  }

  // --- meridians -----------------------------------------------------------------------------
  let meridians = '';
  for (let i = 0; i < 6; i++) {
    const lon = t => (i * 30 + 360 * t) * DEG;
    const scale = frames(t => `${r2(R * Math.sin(lon(t)))} ${r2(-R * cb)}`);
    const skew = frames(t => r1(Math.atan(-Math.tan(BETA) * Math.cos(lon(t))) / DEG));
    // rotate the "near" half-circle so it always covers the part of the great circle facing us
    const rot = frames(t => r1(-Math.atan2(cb * Math.cos(lon(t)), sb) / DEG));
    meridians += `<g>${animT('scale', scale, T)}<g>${animT('skewY', skew, T)}<g>${animT('rotate', rot, T)}` +
      `<path d="M-1 0A1 1 0 0 1 1 0" class="far" vector-effect="non-scaling-stroke"/>` +
      `<path d="M1 0A1 1 0 0 1 -1 0" class="near" vector-effect="non-scaling-stroke"/></g></g></g>`;
  }

  // --- glowing points riding on the surface --------------------------------------------------
  let dots = '';
  for (const [phi, lon0, color] of [[38, 20, '#fef08a'], [-14, 150, '#a5f3fc'], [56, 250, '#ffffff'], [10, 300, '#fef08a'], [-38, 80, '#a5f3fc']]) {
    const p = phi * DEG;
    const pos = t => {
      const l = (lon0 + 360 * t) * DEG;
      return {
        x: R * Math.cos(p) * Math.sin(l),
        y: -R * Math.sin(p) * cb + R * Math.cos(p) * Math.cos(l) * sb,
        z: Math.sin(p) * sb + Math.cos(p) * Math.cos(l) * cb,
      };
    };
    const tr = frames(t => { const q = pos(t); return `${r1(q.x)} ${r1(q.y)}`; });
    const op = frames(t => (0.12 + 0.88 * clamp((pos(t).z + 0.12) / 0.3, 0, 1)).toFixed(2));
    dots += `<g>${animT('translate', tr, T)}${anim('opacity', op, T)}<circle r="5" fill="${color}" opacity=".3"/><circle r="2" fill="${color}"/></g>`;
  }

  // --- moon: two copies, one drawn behind the globe and one in front, swapped at the limb ----
  const mtr = frames(t => { const a = -360 * t * DEG; return `${r1(ORX * Math.cos(a))} ${r1(ORY * Math.sin(a))}`; });
  const moon = `<g>${animT('translate', mtr, T_MOON)}<circle r="4.6" fill="url(#moon)" stroke="#94a3b8" stroke-width=".5"/>` +
    `<circle cx="-1.4" cy="-1.2" r="1.1" fill="#94a3b8" opacity=".55"/><circle cx="1.6" cy="1.4" r=".8" fill="#94a3b8" opacity=".5"/></g>`;
  const moonLayer = vis => `<g transform="rotate(${OTILT})"><g opacity="${vis[0]}">` +
    anim('opacity', vis.join(';'), T_MOON, ' keyTimes="0;0.5;1" calcMode="discrete"') + `${moon}</g></g>`;

  const stars = starField(rng(7), 24, S, S, {
    color: dark ? '#ffffff' : '#64748b',
    maxOpacity: dark ? 1 : 0.55,
    exclude: (x, y) => Math.hypot(x - CX, y - CY) < R + 10,
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="Spinning globe">
<defs>
<radialGradient id="ocean" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="#4f8ff7"/><stop offset=".45" stop-color="#2158d6"/><stop offset=".8" stop-color="#173a8a"/><stop offset="1" stop-color="#0d1f4f"/></radialGradient>
<radialGradient id="shade" cx="36%" cy="30%" r="78%"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
<radialGradient id="gloss" cx="30%" cy="24%" r="40%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="moon" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#f8fafc"/><stop offset="1" stop-color="#cbd5e1"/></radialGradient>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
<style>.near{fill:none;stroke:${LINE};stroke-width:1.1;stroke-opacity:.8}.far{fill:none;stroke:${LINE};stroke-width:.8;stroke-opacity:.22}.eq{stroke-width:1.4}</style>
</defs>
<rect width="${S}" height="${S}" fill="${bg}"/>
${stars}
<g transform="translate(${CX} ${CY})">
<g transform="rotate(${OTILT})"><ellipse rx="${ORX}" ry="${ORY}" fill="none" stroke="#94a3b8" stroke-opacity=".3" stroke-width=".8" stroke-dasharray="2 3"/></g>
${moonLayer([1, 0, 0])}
<circle r="${R + 1}" fill="none" stroke="#38bdf8" stroke-width="5" stroke-opacity=".45" filter="url(#glow)">${anim('stroke-opacity', '.35;.65;.35', 4)}</circle>
<circle r="${R}" fill="url(#ocean)"/>
<g transform="rotate(${TILT})">${parallels}${meridians}${dots}</g>
<circle r="${R}" fill="url(#shade)"/>
<circle r="${R}" fill="url(#gloss)"/>
<circle r="${R}" fill="none" stroke="#7dd3fc" stroke-opacity=".6" stroke-width=".8"/>
${moonLayer([0, 1, 1])}
</g>
</svg>
`;
}

// ---------------------------------------------------------------------------------------------
// Header banner: star field, nebulae, shooting stars, a ringed planet and a rocket fly-by.
// ---------------------------------------------------------------------------------------------
function header() {
  const W = 1200, H = 260, rand = rng(42);
  const stars = starField(rand, 120, W, H, { color: '#ffffff', exclude: (x, y) => Math.hypot(x - 1040, y - 135) < 125 });

  const shooting = [[140, 30, 0], [720, 18, -4.5], [430, 70, -8.2]].map(([x, y, begin]) =>
    `<g transform="translate(${x} ${y})"><g opacity="0">` +
    animT('translate', '0 0;260 120;260 120', 12, ' keyTimes="0;0.07;1"', begin) +
    anim('opacity', '0;1;0;0', 12, ' keyTimes="0;0.015;0.07;1"', begin) +
    `<line x1="-120" y1="-55" x2="0" y2="0" stroke="url(#streak)" stroke-width="2" stroke-linecap="round"/><circle r="1.8" fill="#fff"/></g></g>`).join('');

  const rings = `<ellipse rx="112" ry="29" fill="none" stroke="#fbbf24" stroke-opacity=".35" stroke-width="3"/>` +
    `<ellipse rx="95" ry="24" fill="none" stroke="#fde68a" stroke-opacity=".6" stroke-width="7"/>`;
  const planet = `<g transform="translate(1040 135)">${animT('translate', '1040 135;1040 128;1040 135', 7)}` +
    `<g transform="rotate(-18)">${rings}</g>` +
    `<circle r="52" fill="url(#planet)"/>` +
    `<g clip-path="url(#planetClip)"><ellipse cy="-14" rx="60" ry="5" fill="#92400e" opacity=".25"/><ellipse cy="6" rx="60" ry="8" fill="#78350f" opacity=".28"/><ellipse cy="28" rx="60" ry="4" fill="#92400e" opacity=".22"/></g>` +
    `<circle r="52" fill="url(#pshade)"/>` +
    `<g transform="rotate(-18)" clip-path="url(#ringFront)">${rings}</g></g>`;

  const rocket = `<g>` +
    `<animateMotion dur="16s" repeatCount="indefinite" rotate="auto" path="M-80 78 Q 600 14 1280 72" keyPoints="0;1;1" keyTimes="0;0.5;1" calcMode="linear"${beginAttr(-2)}/>` +
    `<g transform="translate(-14 0)">${animT('scale', '1 1;1.5 1.2;.9 .9;1.3 1.1;1 1', 0.35)}<path d="M0 -4L-14 0L0 4Z" fill="#fb923c"/><path d="M0 -2L-8 0L0 2Z" fill="#fef08a"/></g>` +
    `<path d="M-6 -5L-16 -13L-14 -4Z" fill="#ef4444"/><path d="M-6 5L-16 13L-14 4Z" fill="#ef4444"/>` +
    `<path d="M22 0C14 -7 -6 -7 -14 -5L-14 5C-6 7 14 7 22 0Z" fill="#e2e8f0"/>` +
    `<path d="M22 0C18 -4 14 -5.5 12 -6L12 6C14 5.5 18 4 22 0Z" fill="#ef4444"/>` +
    `<circle cx="4" r="3.2" fill="#7dd3fc" stroke="#1e3a8a" stroke-width="1"/></g>`;

  const font = 'Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Welcome to my orbit">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050816"/><stop offset=".55" stop-color="#0b1a3f"/><stop offset="1" stop-color="#1a0b3d"/></linearGradient>
<linearGradient id="streak" gradientUnits="userSpaceOnUse" x1="-120" y1="-55" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
<radialGradient id="planet" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#f59e0b"/><stop offset=".85" stop-color="#b45309"/><stop offset="1" stop-color="#78350f"/></radialGradient>
<radialGradient id="pshade" cx="35%" cy="30%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
<clipPath id="planetClip"><circle r="52"/></clipPath>
<clipPath id="ringFront"><rect x="-140" y="0" width="280" height="80"/></clipPath>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="34"/></filter>
</defs>
<rect width="${W}" height="${H}" rx="14" fill="url(#sky)"/>
<circle cx="300" cy="210" r="150" fill="#7c3aed" opacity=".2" filter="url(#soft)"/>
<circle cx="820" cy="30" r="150" fill="#2563eb" opacity=".18" filter="url(#soft)"/>
${stars}
${shooting}
${planet}
<text x="70" y="128" font-family="${font}" font-size="62" font-weight="700" fill="#f8fafc" letter-spacing="1">Welcome to my orbit</text>
<text x="72" y="172" font-family="${font}" font-size="20" font-weight="600" fill="#93c5fd" letter-spacing="3">YONESF  ·  DEVELOPER  ·  SPACE ENTHUSIAST</text>
${rocket}
</svg>
`;
}

const outDir = process.argv[2] || __dirname;
fs.mkdirSync(outDir, { recursive: true });
for (const [name, svg] of [['globe.svg', globe({ dark: false })], ['globe-dark.svg', globe({ dark: true })], ['header.svg', header()]]) {
  fs.writeFileSync(path.join(outDir, name), svg);
  console.log(`wrote ${path.join(outDir, name)} (${(svg.length / 1024).toFixed(1)} KB)`);
}
