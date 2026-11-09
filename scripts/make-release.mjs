// Gathers a finished release into release/sourceforge/<version>/, ready to upload as one folder:
// the Windows installer, the portable exe, the single-file browser edition, a README and checksums.
// Run through `npm run release`, which builds everything first.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { version: v } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const out = path.join('release', 'sourceforge', v);
const parts = [
  [path.join('release', `ORBIT-Setup-${v}.exe`), `ORBIT-Setup-${v}.exe`, 'Windows installer (per user, no admin rights needed)'],
  [path.join('release', `ORBIT-${v}-Portable.exe`), `ORBIT-${v}-Portable.exe`, 'Windows portable app: one file, nothing to install'],
  [path.join('dist-single', 'index.html'), `ORBIT-${v}.html`, 'Single-file edition for any modern browser (Chrome or Edge recommended)'],
];

const missing = parts.filter(([from]) => !fs.existsSync(from)).map(([from]) => from);
if (missing.length) {
  console.error(`Missing build output: ${missing.join(', ')}\nRun \`npm run release\` (or dist:win and build:single) first.`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// The source, exactly as committed (not the working tree), when this is a git checkout.
let hasSource = false;
try {
  execFileSync('git', ['archive', '--format=zip', `--prefix=orbit-${v}/`, '-o', path.join(out, `ORBIT-${v}-src.zip`), 'HEAD'], { stdio: 'pipe' });
  parts.push([path.join(out, `ORBIT-${v}-src.zip`), `ORBIT-${v}-src.zip`, 'Source code, MIT licensed']);
  hasSource = true;
} catch {
  console.warn('Not a git checkout: no source zip in this release.');
}

const sums = [];
for (const [from, name] of parts) {
  const target = path.join(out, name);
  if (path.resolve(from) !== path.resolve(target)) fs.copyFileSync(from, target);
  sums.push(`${createHash('sha256').update(fs.readFileSync(target)).digest('hex')}  ${name}`);
}
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');

const mb = (f) => `${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(1)} MB`;
// SourceForge shows README.md under the file list: the release notes, then the files and how to choose.
const notesFile = `RELEASE-NOTES-${v}.md`;
const intro = fs.existsSync(notesFile)
  ? fs.readFileSync(notesFile, 'utf8').trim()
  : `# ORBIT ${v}\n\nA visual, local-first productivity workspace. Created by Dr Mark Isaacs. Free and MIT licensed.`;
const readme = `${intro}

## Files in this folder

| File | What it is | Size |
| --- | --- | --- |
${parts.map(([, name, what]) => `| ${name} | ${what} | ${mb(name)} |`).join('\n')}

Downloads: https://sourceforge.net/projects/orbit-productivity/ · Source: https://github.com/munkeymomo/ORBIT · Support: https://ko-fi.com/markisaacschem
`;
fs.writeFileSync(path.join(out, 'README.md'), readme);

console.log(`Release ${v} ready in ${out}${hasSource ? '' : ' (no source zip)'}:`);
for (const f of fs.readdirSync(out)) console.log(`  ${f.padEnd(28)} ${mb(f)}`);
