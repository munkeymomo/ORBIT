# Releasing ORBIT

Downloads live on SourceForge ([orbit-productivity](https://sourceforge.net/projects/orbit-productivity/)), the source on GitHub, and both carry the same files. The GitHub build makes and
publishes the release; SourceForge copies it.

## Cut a release

1. Bump `version` in `package.json` (the app's About box, the file names and the workflow all read it) and run
   `npm install` so `package-lock.json` matches.
2. Write `RELEASE-NOTES-<version>.md`. It becomes the GitHub release text and the top of SourceForge's README; the
   release refuses to run without it.
3. Commit and push to `main`.
4. On GitHub: **Actions → Build → Run workflow**, tick **Publish a release**. (Pushing a `v<version>` tag does the
   same; push one tag at a time, because GitHub starts no workflows for a push of more than three tags.)

The workflow tests on Linux, then on Windows builds and checks everything with `npm run release` and
`npm run e2e:release`, smoke-runs the packaged exe, and publishes these files:

| File | What it is |
| --- | --- |
| `ORBIT-Setup-<v>.exe` | Windows installer (NSIS, per user) |
| `ORBIT-<v>-Portable.exe` | Windows portable exe |
| `ORBIT-<v>.html` | single-file browser edition |
| `ORBIT-<v>-src.zip` | the source at that commit (`git archive`), MIT |
| `README.md` | the release notes plus a table of the files; SourceForge shows it on the folder |
| `SHA256SUMS.txt` | one line per file above |

It creates the release as a draft with every file attached and only then publishes it, because SourceForge copies a
release when it is published and does not see files added later. It refuses if the release already exists (bump the
version) or the notes are missing.

`npm run release` on a Windows machine produces the same folder locally in `release/sourceforge/<version>/`.

## SourceForge

One-time: in the SourceForge project, **Admin → Tools**, the gear beside **Files → GitHub integration**, and connect
`munkeymomo/ORBIT`. It copies each newly published release into a folder of its own. A release published before the
integration was connected is brought over with the one-time import (**Admin → Import → GitHub downloads**).

After each release appears there, set the default downloads, because that is what the big green button offers: click
the **(i)** beside `ORBIT-Setup-<v>.exe` and tick **Windows**; click it beside `ORBIT-<v>.html` and tick Mac, Linux and
the rest. Delete the two "source code" archives GitHub adds to every release if they were copied;
`ORBIT-<v>-src.zip` is the same code.

## Signing

The Windows builds are unsigned, so SmartScreen warns the first time anyone runs them. A code-signing certificate is
the only real fix; the README and release notes tell people how to get past the warning.
