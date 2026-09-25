/**
 * Copies locale JSON files from shared and backend source directories
 * into backend/locales/ for loading via i18next-fs-backend at runtime.
 *
 * Run: node backend/scripts/copy-locales.cjs (npm runs it before dev and build)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.resolve(__dirname, '../locales');

const SOURCES = [
  path.join(ROOT, 'shared/src/i18n/locales'),
  path.join(ROOT, 'backend/src/i18n/locales'),
];

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else if (entry.name.endsWith('.json')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Clean and rebuild
fs.rmSync(OUTPUT, { recursive: true, force: true });
fs.mkdirSync(OUTPUT, { recursive: true });

for (const src of SOURCES) {
  copyDir(src, OUTPUT);
}

const count = fs.readdirSync(OUTPUT, { recursive: true }).filter(f => f.endsWith('.json')).length;
console.log(`Copied ${count} locale file(s) to backend/locales/`);
