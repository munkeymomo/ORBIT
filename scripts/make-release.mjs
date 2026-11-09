// Gathers a finished release into release/sourceforge/<version>/, ready to upload as one folder:
// the Windows installer, the portable exe, the single-file browser edition, a README and checksums.
// Run through `npm run release`, which builds everything first.
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

const sums = [];
for (const [from, name] of parts) {
  const target = path.join(out, name);
  fs.copyFileSync(from, target);
  sums.push(`${createHash('sha256').update(fs.readFileSync(target)).digest('hex')}  ${name}`);
}
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');

const mb = (f) => `${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(1)} MB`;
const readme = `# ORBIT ${v}

A visual, local-first productivity workspace: your projects as a universe of galaxies and star systems,
context parking so you never lose your place, a focus timer that never forces you to stop, and a day board.
No account, no tracking, no AI service. Your data stays on your computer.

Created by Dr Mark Isaacs. Free and MIT licensed.

## Downloads

| File | What it is | Size |
| --- | --- | --- |
${parts.map(([, name, what]) => `| ${name} | ${what} | ${mb(name)} |`).join('\n')}

**Which one?** The installer adds ORBIT to the Start menu and desktop. The portable exe runs from anywhere
(it unpacks itself each time, so it starts a few seconds slower). Both keep your data in
\`%APPDATA%\\ORBIT\`, so you can switch between them. The HTML file opens in your browser and keeps its data
in that browser.

**Windows SmartScreen:** these builds are not code-signed yet, so Windows may say it "protected your PC".
Choose **More info → Run anyway**. Checksums are in SHA256SUMS.txt.

**Moving your data:** Settings → Back up downloads everything as one JSON file; Restore loads it anywhere,
including between the desktop app and the browser editions.

## Support

If ORBIT helps you start your day, you can buy me a coffee: https://ko-fi.com/markisaacschem
`;
fs.writeFileSync(path.join(out, 'README.md'), readme);

console.log(`Release ${v} ready in ${out}:`);
for (const f of fs.readdirSync(out)) console.log(`  ${f.padEnd(28)} ${mb(f)}`);
