# Reproduce the October 5, 2026 installation

This snapshot reproduces the Apple Silicon macOS Classroom Copilot application
payload. It includes the installed Jev detector, OMP streaming answer provider,
retry/suggestion handling, course-context retrieval, session saving, UI and four
built-in profiles. `config/installed-payload.json` records SHA-256 hashes of all
18 compiled/profile files from the installed app. It is a dated reference: later
intentional application changes will require a new reference capture.

The public repository supplies code, locked dependencies, configuration tools and
the patched OMP source. Your exact selected profile, overrides, prepared course
materials, compatible-server URL and session history belong in a **private bundle**.
They are not Git files. API keys and OAuth credentials must be entered or signed
in again on a new machine; an encrypted Electron vault is tied to its OS keychain.

## Build the application

Use macOS arm64, Node **26.6.0** and npm **11.18.0** (the captured build tools).
Git and Xcode Command Line Tools are needed for source/dependency tooling.

```sh
git clone --branch classroom-copilot https://github.com/mistakes5/unseen.git classroom-unseen
cd classroom-unseen
npm ci
npm test
npm run typecheck
npm run build
npm run verify:installation
```

`npm ci` uses `package-lock.json`; do not replace it with an unlocked dependency
upgrade when reproducing this snapshot. No unit test starts microphone capture
or calls a paid model. A matching payload verifies the captured application code
and built-in profiles, not cloud availability or credentials.

Package without publishing or replacing the current app:

```sh
npx electron-builder --mac --arm64 --dir --publish never
```

The app is `release/mac-arm64/Classroom Copilot.app`. Validate it before copying
to `~/Applications` on the target machine:

```sh
npm run verify:installation -- --app 'release/mac-arm64/Classroom Copilot.app'
```

This also checks all **5,085 packaged runtime dependency files** against the
captured installation and verifies Electron **42.4.0**.

The app ID is `local.classroom.copilot`; its default data directory is
`~/Library/Application Support/Classroom Copilot`. The repository contains macOS
microphone/JIT entitlements. A new package may have an ad-hoc signature rather
than the original machine's development certificate, and macOS may ask for
microphone permission again. Bundle signatures and permission grants are not
covered by the payload hash comparison.

## Capture private installation state

Export to a new private directory **outside the repository**. Prefer a stopped
app when taking a final migration snapshot so saved sessions cannot change while
being copied. Export does not stop or modify the running app.

```sh
npm run config:export -- \
  --bundle "$HOME/Documents/Classroom-Copilot-private-backup" \
  --omp-bin "$HOME/.bun/bin/omp" \
  --include-history
```

The bundle contains sanitized `settings.json`, user `profiles/`, all `knowledge/`
indexes/prepared bundles/selections/source manifests, and the exact OMP executable
when `--omp-bin` is supplied. `--include-history` also captures `sessions/` and
`memory/` under the app data directory. Every included file has a SHA-256 entry.
The directory is private-mode; do not commit it or share its course/transcript
content. Browser caches, cookies, old app backups and `secrets.json` are excluded.
The current installation uses the default data directory. If you deliberately
move memory using `dataDir`, separately migrate that external directory; this
exporter does not chase arbitrary external paths or symlinks.

## Restore on the target machine

Transfer the private bundle using your own private storage. Quit Classroom
Copilot on the **target**, then restore before launching the new package:

```sh
npm run config:restore -- \
  --bundle "$HOME/Documents/Classroom-Copilot-private-backup" \
  --app-stopped
```

All checksums and paths are checked before app files are overwritten. Existing
overwritten files are backed up under `restore-backup-*` in the target app data
directory. A fresh target data directory gives the closest replica: restore
does not delete unrelated files already present there. Home-directory settings
paths are relocated; microphone selection is reset to the target's default
device. Paths embedded in profile/material content are preserved, so recreate
those source paths if you need to rebuild prepared bundles. Existing prepared
bundles retain their dates and must be refreshed for a new class date.

The captured OMP executable is restored as
`~/Library/Application Support/Classroom Copilot/runtime/omp`. On a fresh machine,
put a symlink at the default path the app discovers, without overwriting another
OMP installation:

```sh
mkdir -p "$HOME/.bun/bin"
ln -s "$HOME/Library/Application Support/Classroom Copilot/runtime/omp" "$HOME/.bun/bin/omp"
"$HOME/.bun/bin/omp" --version
```

If `~/.bun/bin/omp` already exists, `ln` will refuse to replace it. Instead launch
the packaged executable with an explicit override for this invocation:

```sh
CLASSROOM_OMP_BIN="$HOME/Library/Application Support/Classroom Copilot/runtime/omp" \
  "$HOME/Applications/Classroom Copilot.app/Contents/MacOS/Classroom Copilot"
```

The binary is platform-specific; the restore tool refuses a captured runtime
from another OS/architecture. [OMP source reproduction](../vendor/omp/README.md)
is available when the captured executable is unavailable.

## Reconnect providers and verify

1. Start the restored OMP interactively, use `/login`, and select OpenAI Codex.
   OMP's own private auth store is separate from the Codex CLI login. Do not copy
   tokens into this repository. Exit OMP after signing in.
2. Launch Classroom Copilot, open Settings → Providers, and enter your own
   **TypeSafe** and **Deepgram** keys. `.env.example` lists supported development
   environment variables with empty values; packaged-app setup uses Settings.
3. Inspect the restored selected profile and Jev cutoff before pressing Start.
   The shipped fresh-install cutoff is `.80`; the private bundle preserves your
   saved cutoff (including `.65`) rather than silently replacing it. Demo can
   disable session saving through its profile even if global autosave is on.
4. Run `npm run setup:doctor` for an offline dependency/configuration check.
   Then use the app's connection tests when ready; those may use the network.
   Start listening only when you intend to capture audio.

The captured answer route is `omp-codex`, `gpt-6-luna`, low reasoning and
per-invocation `priority` (Fast). The provider disables retries, model fallback,
tools, extensions, skills, rules, saved sessions and title generation for its
answer subprocesses. Its temporary configuration reproduces the behavior
without needing your global OMP settings. Deepgram supplies transcription;
TypeSafe Jev judges participation and code applies the saved cutoff. This
snapshot does not enable the experimental five-flag answer-format router.

Meetily and local speech-model downloads are not dependencies of this active
Deepgram/OMP/Jev route. Optional WhisperLiveKit, Meetily bridge, legacy Codex CLI
and compatible-server routes need their own installations/logins/endpoints if
you select them. A current compatible-server URL is preserved privately, not
published as a portable or reachable public service.

Reproducible local code/configuration does not freeze external provider models,
account quota, network connectivity or future API behavior. The offline checks
do not claim a new Jev quality evaluation or a live classroom recording test.
