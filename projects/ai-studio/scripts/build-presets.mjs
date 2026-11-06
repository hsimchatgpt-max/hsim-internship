// Renders the illustrated presenter PNGs: node scripts/build-presets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PRESETS, KEY_COLOR } from '../server/avatar/presets.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = path.resolve(import.meta.dirname, '../server/assets/avatars');

const shade = (hex, k) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');

function svg({ skin, hair, hairStyle, outfit, color, accessory }, gender) {
  const f = gender === 'female';
  const skinD = shade(skin, 0.85);
  const hairBack = {
    long: `<path d="M300 430 C280 700 300 820 330 860 L694 860 C724 820 744 700 724 430 Z" fill="${hair}"/>`,
    wavy: `<path d="M290 420 C250 560 300 640 270 760 C300 800 340 780 350 700 L674 700 C690 780 730 800 760 760 C730 640 780 560 734 420 Z" fill="${hair}"/>`,
    bob: `<path d="M296 400 C270 560 290 640 320 660 L704 660 C736 640 756 560 728 400 Z" fill="${hair}"/>`,
    bun: `<circle cx="512" cy="176" r="62" fill="${hair}"/>`,
  }[hairStyle] || '';
  const hairFront = {
    short: `<path d="M318 390 C318 250 400 200 512 200 C624 200 706 250 706 390 C690 330 630 300 512 300 C394 300 334 330 318 390 Z" fill="${hair}"/>`,
    quiff: `<path d="M316 392 C300 250 400 170 540 190 C640 205 712 270 708 392 C690 320 640 290 560 285 C470 280 380 290 316 392 Z" fill="${hair}"/>`,
    long: `<path d="M312 420 C300 250 400 200 512 200 C624 200 724 250 712 420 C690 340 620 290 500 290 C400 292 340 340 312 420 Z" fill="${hair}"/>`,
    wavy: `<path d="M310 430 C290 250 400 195 512 195 C624 195 734 250 714 430 C690 340 640 270 480 290 C380 300 336 350 310 430 Z" fill="${hair}"/>`,
    bob: `<path d="M308 440 C290 250 400 195 512 195 C624 195 734 250 716 440 C700 350 630 285 500 292 C400 296 330 350 308 440 Z" fill="${hair}"/>`,
    bun: `<path d="M318 400 C318 250 400 205 512 205 C624 205 706 250 706 400 C690 330 630 300 512 300 C394 300 334 330 318 400 Z" fill="${hair}"/>`,
  }[hairStyle] || '';
  const body = {
    suit: `<path d="M150 1024 C160 800 300 740 512 740 C724 740 864 800 874 1024 Z" fill="${color}"/><path d="M512 760 L440 1024 L584 1024 Z" fill="#f4f4f4"/><path d="M512 760 L420 800 L450 1024 L440 1024 Z M512 760 L604 800 L574 1024 L584 1024 Z" fill="${shade(color, 0.8)}"/>`,
    blazer: `<path d="M150 1024 C160 800 300 740 512 740 C724 740 864 800 874 1024 Z" fill="${color}"/><path d="M512 760 L450 1024 L574 1024 Z" fill="${f ? '#f1e4da' : '#f4f4f4'}"/><path d="M512 760 L410 800 L460 1024 L450 1024 Z M512 760 L614 800 L564 1024 L574 1024 Z" fill="${shade(color, 0.78)}"/>`,
    cardigan: `<path d="M150 1024 C160 800 300 740 512 740 C724 740 864 800 874 1024 Z" fill="${color}"/><path d="M512 770 C470 800 450 900 460 1024 L564 1024 C574 900 554 800 512 770 Z" fill="#fbf3e9"/>`,
    shirt: `<path d="M150 1024 C160 800 300 740 512 740 C724 740 864 800 874 1024 Z" fill="${color}"/><path d="M440 750 L512 830 L584 750 L560 740 L512 790 L464 740 Z" fill="${shade(color, 1.2)}"/>`,
    jacket: `<path d="M150 1024 C160 800 300 740 512 740 C724 740 864 800 874 1024 Z" fill="${color}"/><path d="M512 760 L470 1024 L554 1024 Z" fill="#fafafa"/><rect x="505" y="800" width="14" height="224" fill="${shade(color, 0.7)}"/>`,
    hoodie: `<path d="M140 1024 C150 800 290 735 512 735 C734 735 874 800 884 1024 Z" fill="${color}"/><path d="M330 750 C400 830 624 830 694 750 C640 720 384 720 330 750 Z" fill="${shade(color, 0.8)}"/><path d="M480 800 L476 900 M544 800 L548 900" stroke="#fff" stroke-width="8" stroke-linecap="round"/>`,
  }[outfit];
  const tie = accessory === 'tie' ? `<path d="M500 770 L524 770 L534 830 L512 960 L490 830 Z" fill="#a52a2a"/>` : '';
  const beard = accessory === 'beard' ? `<path d="M336 520 C340 650 420 720 512 720 C604 720 684 650 688 520 C660 580 600 600 512 600 C424 600 364 580 336 520 Z" fill="${hair}"/>` : '';
  const glasses = accessory === 'glasses' ? `<g fill="none" stroke="#222" stroke-width="9"><rect x="372" y="440" width="104" height="80" rx="28"/><rect x="548" y="440" width="104" height="80" rx="28"/><path d="M476 478 H548"/></g>` : '';
  const hoops = accessory === 'hoops' ? `<g fill="none" stroke="#e6b800" stroke-width="8"><circle cx="318" cy="560" r="26"/><circle cx="706" cy="560" r="26"/></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${KEY_COLOR}"/>
  ${hairBack}
  ${body}${tie}
  <rect x="450" y="640" width="124" height="130" rx="30" fill="${skinD}"/>
  <ellipse cx="318" cy="500" rx="26" ry="44" fill="${skin}"/><ellipse cx="706" cy="500" rx="26" ry="44" fill="${skin}"/>
  <path d="M512 270 C640 270 712 360 708 500 C704 640 620 740 512 740 C404 740 320 640 316 500 C312 360 384 270 512 270 Z" fill="${skin}"/>
  ${beard}
  ${hairFront}
  <g fill="#fff"><ellipse cx="424" cy="486" rx="34" ry="22"/><ellipse cx="600" cy="486" rx="34" ry="22"/></g>
  <g fill="#2a1a12"><circle cx="424" cy="486" r="15"/><circle cx="600" cy="486" r="15"/></g>
  <g fill="#fff"><circle cx="430" cy="480" r="5"/><circle cx="606" cy="480" r="5"/></g>
  <g stroke="${hair}" stroke-width="${f ? 8 : 13}" stroke-linecap="round" fill="none"><path d="M382 440 Q424 418 466 436"/><path d="M558 436 Q600 418 642 440"/></g>
  <path d="M512 500 C500 548 496 574 506 584 C516 590 530 586 536 580" stroke="${skinD}" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M440 636 Q512 ${f ? 694 : 680} 584 636 Q512 658 440 636 Z" fill="${f ? '#b8404a' : '#9b4a3a'}" stroke="#7a2a2a" stroke-width="4" stroke-linejoin="round"/>
  ${f ? '<g fill="#ff9aa2" opacity=".25"><circle cx="390" cy="580" r="34"/><circle cx="634" cy="580" r="34"/></g>' : ''}
  ${glasses}${hoops}
</svg>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const p of PRESETS) {
  await page.setContent(`<body style="margin:0">${svg(p.spec, p.gender)}</body>`);
  await page.screenshot({ path: path.join(OUT, `${p.id}.png`), clip: { x: 0, y: 0, width: 1024, height: 1024 } });
}
await browser.close();
console.log('built', PRESETS.length, 'presets into', OUT);
