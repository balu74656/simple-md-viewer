#!/usr/bin/env node
/**
 * Nastavi verzi aplikace na vsech trech mistech najednou.
 *
 *   npm run set-version 0.2.1
 *
 * Verze zijou ve trech souborech a musi si odpovidat:
 *   package.json            - npm balicek
 *   src-tauri/tauri.conf.json - z teto hodnoty se generuje nazev instalatoru
 *   src-tauri/Cargo.toml    - Rust crate
 *
 * Odkaz "version": "../package.json" v tauri.conf.json nefunguje spolehlive
 * (cesta se vyhodnocuje jinak, nez by clovek cekal), proto tenhle skript.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Použití: npm run set-version <semver>   např. npm run set-version 0.2.1');
  process.exit(1);
}

function patch(relPath, transform) {
  const full = join(root, relPath);
  const before = readFileSync(full, 'utf8');
  const after = transform(before);
  if (before === after) {
    console.error(`  ! ${relPath} — verze nenalezena, soubor beze změny`);
    return false;
  }
  writeFileSync(full, after);
  console.log(`  ✓ ${relPath}`);
  return true;
}

console.log(`Nastavuji verzi ${version}:`);

let ok = true;

// package.json — prvni "version" na urovni korene
ok = patch('package.json', (s) =>
  s.replace(/(^\s*"version"\s*:\s*")[^"]+(")/m, `$1${version}$2`),
) && ok;

// tauri.conf.json — z teto hodnoty se generuje nazev instalatoru
ok = patch('src-tauri/tauri.conf.json', (s) =>
  s.replace(/(^\s*"version"\s*:\s*")[^"]+(")/m, `$1${version}$2`),
) && ok;

// Cargo.toml — prvni version v sekci [package]
ok = patch('src-tauri/Cargo.toml', (s) =>
  s.replace(/(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`),
) && ok;

if (!ok) process.exit(1);

console.log(`\nHotovo. Instalátor se bude jmenovat "MD Viewer_${version}_x64-setup.exe".`);
