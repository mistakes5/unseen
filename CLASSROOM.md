# Classroom Copilot fork

Classroom-focused customization of [Unseen](https://github.com/repowise-dev/unseen), retaining its MIT license and upstream attribution. Work lives on the `classroom-copilot` branch.

## What this branch adds

- Standalone microphone transcription with Deepgram; Meetily is not required.
- Optional local MLX Whisper large-v3-turbo through a separately installed WhisperLiveKit server, plus an optional read-only Meetily transcript bridge.
- TypeSafe Jev question detection followed by short, course-grounded answers in the overlay.
- An isolated Codex CLI answer provider using the existing CLI login. Its low-reasoning and Fast settings apply to each app subprocess, without changing global Codex configuration. Model and feature availability depend on the installed CLI and account.
- Prepared, dated local course excerpts loaded into memory before questions arrive. No file search runs in the prepared-context answer path. This is application-side preloading, not a guarantee of server-side prompt-cache hits.
- Opt-in silent file replay and tests for the classroom pipeline, course isolation, and provider wiring.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run dev
```

`npm run dist` builds distributable packages. macOS microphone permission is required for live listening.

Configure providers in Settings using your own credentials. The Codex provider requires an installed, logged-in CLI; `CLASSROOM_CODEX_BIN` can override its executable path. The optional local transcription provider expects a WhisperLiveKit installation with `.venv/bin/wlk` under `~/Developer/classroom-whisperlivekit`, or a directory specified by `CLASSROOM_WLK_DIR`. That environment and the model weights are not bundled here.

Choose a profile and press Start for microphone input. Stop releases the capture session. Switching profiles stops the current session and clears its in-memory transcript and answers.

## Course materials and privacy

The two politics profiles are configuration examples. Readings, recordings, prepared bundles, account settings, API keys, and private test reports are **not included**. Supply materials you are authorized to use, and obtain any required permission to record or send classroom discussion to cloud services.

`scripts/index-course.py` prepares a local index. `scripts/prepare-course-context.mjs INDEX SPEC OUTPUT.context.json` selects exact passages using a local specification. Bundles identify the profile and session date; stale or missing bundles produce an availability notice, not an automatic search. Refresh them before each session. The default bundle directory on macOS is `~/Library/Application Support/Classroom Copilot/knowledge`.

Local transcription does not make the entire pipeline local: Jev receives transcript text, and cloud-backed answers receive transcript/context evidence. Deepgram also receives audio when selected. Provider charges or account usage limits apply. Silent replay does not play through speakers, but cloud replay still sends data to the configured providers and requires the explicit cloud-replay opt-in.

The smoke and benchmark scripts are opt-in diagnostics and can consume provider quota. Unit tests run separately with `npm test`.
