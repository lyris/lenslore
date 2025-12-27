#!/usr/bin/env node
/**
 * Post-build helper to update Service Worker precache list with hashed assets.
 * Scans dist/assets and replaces the CORE_ASSETS array in sw.js (dist & public).
 */

import fs from 'fs';
import path from 'path';

const distAssetsDir = path.resolve('dist', 'assets');
const swTargets = [
  path.resolve('dist', 'sw.js'),
  path.resolve('public', 'sw.js')
];

// Build a unique cache name per build: package version + timestamp
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'));
const CACHE_NAME = `lenslore-${pkg.version}-${Date.now()}`;

const STATIC_ENTRIES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

function getAssetEntries() {
  if (!fs.existsSync(distAssetsDir)) {
    throw new Error(`dist/assets not found: ${distAssetsDir}. Did you run build?`);
  }
  const files = fs.readdirSync(distAssetsDir)
    .filter(name => !name.endsWith('.map')) // skip source maps
    .filter(name => /\.(js|css|wasm)$/i.test(name));

  return files.sort().map(name => `./assets/${name}`);
}

function updateSwFile(swPath, assets) {
  if (!fs.existsSync(swPath)) {
    console.warn(`[update-sw] skip: ${swPath} not found`);
    return;
  }

  const content = fs.readFileSync(swPath, 'utf-8');
  const coreAssetsBlock = `const CORE_ASSETS = [\n  ${assets.map(a => `'${a}'`).join(',\n  ')}\n];`;
  const regex = /const CORE_ASSETS = \[[\s\S]*?\];/;
  if (!regex.test(content)) {
    throw new Error(`[update-sw] CORE_ASSETS block not found in ${swPath}`);
  }

  const replaced = content.replace(regex, coreAssetsBlock);

  const cacheRegex = /const CACHE_NAME = ['"].+?['"];/;
  const withCache = cacheRegex.test(replaced)
    ? replaced.replace(cacheRegex, `const CACHE_NAME = '${CACHE_NAME}';`)
    : replaced;

  fs.writeFileSync(swPath, withCache, 'utf-8');
  console.log(`[update-sw] updated CORE_ASSETS and CACHE_NAME in ${swPath} -> ${CACHE_NAME}`);
}

function main() {
  const assets = [...STATIC_ENTRIES, ...getAssetEntries()];
  swTargets.forEach(sw => updateSwFile(sw, assets));
}

main();
