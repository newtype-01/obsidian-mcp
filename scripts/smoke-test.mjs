import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const buildEntry = path.join(repoRoot, 'build', 'index.js');

if (!fs.existsSync(buildEntry)) {
  console.log('Build output not found; running build before smoke test.');
  const buildResult = spawnSync(process.execPath, [
    path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  ], {
    cwd: repoRoot,
    encoding: 'utf-8'
  });

  if (buildResult.status !== 0) {
    process.stdout.write(buildResult.stdout || '');
    process.stderr.write(buildResult.stderr || '');
    process.exit(buildResult.status ?? 1);
  }
}

const helpResult = spawnSync(process.execPath, [buildEntry, '--help'], {
  cwd: repoRoot,
  encoding: 'utf-8'
});

if (helpResult.status !== 0) {
  process.stdout.write(helpResult.stdout || '');
  process.stderr.write(helpResult.stderr || '');
  throw new Error(`Expected --help to exit cleanly, got ${helpResult.status}`);
}

if (!helpResult.stdout.includes('Obsidian MCP Server')) {
  throw new Error('Smoke test failed: help output did not include the server banner.');
}

if (!helpResult.stdout.includes('--vault-path')) {
  throw new Error('Smoke test failed: help output did not include expected CLI options.');
}

console.log('Smoke test passed.');
