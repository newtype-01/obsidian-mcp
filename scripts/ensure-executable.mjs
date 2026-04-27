import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const buildEntry = path.resolve(__dirname, '..', 'build', 'index.js');

if (!fs.existsSync(buildEntry)) {
  console.warn(`Build output not found at ${buildEntry}; skipping executable bit update.`);
  process.exit(0);
}

if (process.platform === 'win32') {
  process.exit(0);
}

const currentMode = fs.statSync(buildEntry).mode;
fs.chmodSync(buildEntry, currentMode | 0o111);
