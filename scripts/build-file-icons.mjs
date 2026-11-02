#!/usr/bin/env node
/**
 * Vyrobi ikony pro asociovane typy souboru (Pruzkumnik Windows).
 *
 *   node scripts/build-file-icons.mjs
 *
 * Zdrojem je tenhle skript: SVG kresby jsou nize. Vystup jde do
 * src-tauri/icons/filetypes/ a commituje se (build ho nespousti):
 *   <typ>.svg          - velka varianta pro nahled
 *   <typ>.ico          - 16, 20, 24, 32, 40, 48, 64, 256 px (PNG uvnitr ICO)
 *   preview.png        - prehled vsech velikosti na svetlem i tmavem pozadi
 *
 * Rasterizuje se pres Chromium z balicku `playwright`, ktery v projektu
 * zamerne neni jako zavislost: npm i --no-save playwright (nebo prostredi,
 * kde uz je, napr. cloud sessions). Text pripony pouziva font Inter.
 *
 * Jak se ikony dostanou do registru: src-tauri/windows/hooks.nsh.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src-tauri/icons/filetypes');
const require = createRequire(join(root, 'package.json'));

// Barva typu = roh listu, dlazdice a text pripony. Markdown ma barvu aplikace.
export const TYPES = {
  md: { label: 'MD', color: '#2563EB' },
  puml: { label: 'PUML', color: '#7C3AED' },
  yaml: { label: 'YAML', color: '#059669' },
  json: { label: 'JSON', color: '#DC2626' },
};

// Symboly typu, kreslene do boxu 120 x 100, bile.
function glyph(type, x, y, s) {
  const c = '#fff';
  const t = `transform="translate(${x} ${y}) scale(${s})"`;
  switch (type) {
    case 'md': // M + sipka dolu jako v ikone aplikace
      return `<g ${t} fill="none" stroke="${c}" stroke-width="15">
        <path d="M8 88 V14 L38 52 L68 14 V88"/>
        <path d="M98 12 V70"/>
        <path d="M78 58 L98 84 L118 58 Z" fill="${c}" stroke-width="4"/></g>`;
    case 'puml': // sekvencni diagram: dva ucastnici, zprava a odpoved
      return `<g ${t}>
        <rect x="0" y="0" width="44" height="24" rx="5" fill="${c}"/>
        <rect x="76" y="0" width="44" height="24" rx="5" fill="${c}"/>
        <path d="M22 24 V100 M98 24 V100" stroke="${c}" stroke-width="5" stroke-dasharray="9 6"/>
        <path d="M22 48 H86" stroke="${c}" stroke-width="7"/>
        <path d="M84 38 L100 48 L84 58 Z" fill="${c}"/>
        <path d="M98 78 H36" stroke="${c}" stroke-width="7"/>
        <path d="M38 68 L20 78 L38 88 Z" fill="${c}"/></g>`;
    case 'yaml': // seznam operaci jako ve Swagger UI (OpenAPI nahled)
      return `<g ${t} stroke-linecap="round">${[0, 38, 76]
        .map(
          (dy, i) => `<rect x="0" y="${dy}" width="40" height="24" rx="6" fill="${c}"/>
          <path d="M54 ${dy + 12} H${[118, 100, 110][i]}" stroke="${c}" stroke-width="9" opacity=".85"/>`,
        )
        .join('')}</g>`;
    case 'json': // slozene zavorky
      return `<g ${t} fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
        <path d="M42 4 C26 4 24 10 24 22 V38 C24 46 18 50 8 50 C18 50 24 54 24 62 V78 C24 90 26 96 42 96"/>
        <path d="M78 4 C94 4 96 10 96 22 V38 C96 46 102 50 112 50 C102 50 96 54 96 62 V78 C96 90 94 96 78 96"/>
        <circle cx="60" cy="50" r="6" fill="${c}" stroke="none"/></g>`;
  }
  throw new Error(type);
}

const PAGE =
  'M52 12 H164 L212 60 V232 a12 12 0 0 1 -12 12 H52 a12 12 0 0 1 -12 -12 V24 a12 12 0 0 1 12 -12 Z';
const FOLD = 'M164 12 V52 a8 8 0 0 0 8 8 H212 Z';

/**
 * Varianta C: bily list s prehnutym rohem v barve typu, uprostred dlazdice
 * aplikace (zaobleny ctverec s ramem) se symbolem typu, nahore pripona.
 *   l  - 48 px a vic: s textem pripony
 *   s  - 24-40 px: bez textu, vetsi dlazdice
 *   xs - 16-20 px: bez textu a bez ramu, silnejsi obrys listu
 */
export function icon(type, variant = 'l') {
  const T = TYPES[type];
  const sw = { l: 5, s: 9, xs: 14 }[variant];
  const page = `<path d="${PAGE}" fill="#fff" stroke="#94A3B8" stroke-width="${sw}" stroke-linejoin="round"/>
    <path d="${FOLD}" fill="${T.color}" stroke="${T.color}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  let body;
  if (variant === 'l') {
    body = `<rect x="62" y="84" width="128" height="128" rx="26" fill="${T.color}"/>
      <rect x="76" y="98" width="100" height="100" rx="9" fill="none" stroke="#fff" stroke-width="7"/>
      ${glyph(type, 90, 120, 0.6)}
      <text x="58" y="62" font-family="Inter" font-weight="800" font-size="26" fill="${T.color}" letter-spacing="1">${T.label}</text>`;
  } else if (variant === 's') {
    body = `<rect x="52" y="76" width="148" height="148" rx="30" fill="${T.color}"/>
      <rect x="68" y="92" width="116" height="116" rx="10" fill="none" stroke="#fff" stroke-width="10"/>
      ${glyph(type, 84, 118, 0.7)}`;
  } else {
    body = `<rect x="44" y="64" width="164" height="168" rx="28" fill="${T.color}"/>
      ${glyph(type, 62, 98, 1.07)}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${page}${body}</svg>`;
}

const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const variantFor = (px) => (px >= 48 ? 'l' : px >= 24 ? 's' : 'xs');

// ICO s PNG obrazky (Windows Vista+).
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ px, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(px >= 256 ? 0 : px, e);
    head.writeUInt8(px >= 256 ? 0 : px, e + 1);
    head.writeUInt8(0, e + 2);
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

async function main() {
  const { chromium } = require('playwright');
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  const render = async (svg, px) => {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}</style>` +
        svg.replace('<svg ', `<svg width="${px}" height="${px}" `),
    );
    await page.evaluate(() => document.fonts.ready);
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
  };

  for (const type of Object.keys(TYPES)) {
    writeFileSync(join(OUT, `${type}.svg`), icon(type) + '\n');
    const pngs = [];
    for (const px of SIZES) pngs.push({ px, data: await render(icon(type, variantFor(px)), px) });
    writeFileSync(join(OUT, `${type}.ico`), ico(pngs));
    console.log(`${type}.ico`, SIZES.join(', '));
  }

  // Nahled: kazda velikost v realnych pixelech, svetle a tmave pozadi
  const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const shown = [256, 64, 48, 32, 24, 20, 16];
  const strip = (bg, fg) =>
    `<div style="background:${bg};color:${fg};padding:16px 20px">` +
    Object.keys(TYPES)
      .map(
        (t) =>
          `<div style="display:flex;align-items:flex-end;gap:16px;margin:8px 0">
          ${shown.map((px) => `<img width="${px}" height="${px}" src="${uri(icon(t, variantFor(px)))}">`).join('')}
          <span style="font:600 14px Inter;margin-left:8px">soubor.${t}</span></div>`,
      )
      .join('') +
    '</div>';
  await page.setViewportSize({ width: 900, height: 400 });
  await page.setContent(`<body style="margin:0">${strip('#fff', '#111')}${strip('#1f1f1f', '#eee')}</body>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, 'preview.png'), fullPage: true });

  await browser.close();
}

await main();
