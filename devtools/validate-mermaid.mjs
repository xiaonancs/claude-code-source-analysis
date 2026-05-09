#!/usr/bin/env node
/**
 * Validates every ```mermaid block in Markdown under the given directories (default: ".").
 *
 * Run from the repository root:
 *   npm install
 *   npm run validate:mermaid
 *
 * Optional paths:
 *   npm run validate:mermaid -- docs Part\ I
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

let mermaid;

try {
  mermaid = (await import('mermaid')).default;
} catch {
  console.error(
    '[validate-mermaid] Cannot load "mermaid". Install dependencies from this repo root:\n  npm install',
  );
  process.exit(2);
}

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
});

/** Opening fence: ```mermaid (allows trailing spaces) */
const MERMAID_OPEN_RE = /^[ \t]*```[ \t]*mermaid[ \t]*$/i;

/** @returns {Generator<string>} absolute file paths ending in .md */
function* walkMd(dir) {
  const abs = path.resolve(dir);
  if (!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return;
  for (const name of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, name.name);
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === '.git') continue;
      yield* walkMd(p);
    } else if (name.isFile() && name.name.endsWith('.md')) yield p;
  }
}

/** @param {string} text */
function extractMermaidBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!MERMAID_OPEN_RE.test(lines[i])) {
      i++;
      continue;
    }
    const start = i + 1;
    let j = start;
    while (j < lines.length && !/^[ \t]*```[ \t]*$/.test(lines[j])) j++;
    const body = lines.slice(start, j).join('\n').trim();
    if (body) blocks.push(body);
    i = j + 1;
  }
  return blocks;
}

/** @param {string} rootDirAbs */
async function validateDir(rootDirAbs) {
  /** @type {{ file: string; index: number; message: string }[]} */
  const failures = [];
  let blocks = 0;
  let filesWithMermaid = 0;

  for (const fp of walkMd(rootDirAbs)) {
    let content;
    try {
      content = fs.readFileSync(fp, 'utf8');
    } catch {
      continue;
    }
    const parts = extractMermaidBlocks(content);
    if (!parts.length) continue;
    filesWithMermaid++;
    parts.forEach((block, idx) => {
      blocks++;
      try {
        mermaid.parse(block);
      } catch (e) {
        const msg = String(e?.message ?? e ?? 'parse failed');
        failures.push({ file: fp, index: idx, message: msg });
      }
    });
  }

  return { failures, blocks, filesWithMermaid, rootDirAbs };
}

const dirs = (
  process.argv.length > 2 ? process.argv.slice(2) : ['.']
).map((d) => path.resolve(process.cwd(), d));

let totalBlocks = 0;
/** @type {number} */
let exit = 0;
const summary = [];

for (const dir of dirs) {
  const r = await validateDir(dir);
  totalBlocks += r.blocks;
  const relRoot = path.relative(process.cwd(), r.rootDirAbs) || '.';
  if (r.failures.length) {
    exit = 1;
    console.error(`\n[FAIL] ${relRoot} — ${r.failures.length} block(s):`);
    for (const f of r.failures) {
      const rf = path.relative(process.cwd(), f.file) || f.file;
      console.error(`  • ${rf} #${f.index}\n    ${f.message.split('\n')[0]}`);
    }
    summary.push(`${relRoot}: FAIL (${r.failures.length}/${r.blocks} blocks)`);
  } else {
    summary.push(
      `${relRoot}: OK (${r.blocks} mermaid blocks in ${r.filesWithMermaid} files)`,
    );
  }
}

for (const line of summary) console.log(line);

if (!exit && totalBlocks === 0) {
  console.error('[warn] No mermaid blocks found in given paths.');
}

process.exit(exit);
