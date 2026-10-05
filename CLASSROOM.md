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

For the captured installed app, use the [complete reproduction guide](docs/reproduce-installation.md).
It pins build tools, verifies the installed payload, restores private settings and
course assets, and identifies the exact patched OMP runtime. The default answer
provider is now OMP with Codex sign-in and streamed answer text; the legacy Codex
CLI provider remains available. `CLASSROOM_OMP_BIN` overrides the OMP executable.

```sh
npm ci
npm run typecheck
npm test
npm run dev
```

`npm run dist` builds distributable packages. macOS microphone permission is required for live listening.

Configure providers in Settings using your own credentials. The Codex provider requires an installed, logged-in CLI; `CLASSROOM_CODEX_BIN` can override its executable path. The optional local transcription provider expects a WhisperLiveKit installation with `.venv/bin/wlk` under `~/Developer/classroom-whisperlivekit`, or a directory specified by `CLASSROOM_WLK_DIR`. That environment and the model weights are not bundled here.

Choose a profile and press Start for microphone input. Stop releases the capture session. Switching profiles stops the current session and clears its in-memory transcript and answers.

## Multiple questions and professor priority

Listening and question detection continue while answers generate. The controller separates transcribed question boundaries into verbatim candidates and batches independent Jev judgments. Accepted questions get stable IDs, two concurrent answer slots, and a waiting queue. Answers are routed by ID even when they finish out of order; newest question cards appear at the top. Ask now adds an answer without discarding other work. Stop, pause, and course changes cancel active/queued work with an explicit status.

The detector treats requests to recall or summarize a reading as discussion invitations, even when that topic was just explained. It uses up to 7,000 characters of preceding discussion, separated from the new speech, to interpret fragments and short follow-ups. It judges whether a contribution is invited, not whether the answer is available in the readings. The expandable **Question detector** line shows the last 20 actual scores and cutoff decisions; passing this gate can still be followed by duplicate suppression or an answer-model skip. With autosave on, `question-check` events also record scores, cutoff, timing, and prompt version beside the existing transcript. These probabilities and cutoffs are operational judgments, not guarantees of accuracy.

Enable diarization in Settings for numbered speaker labels. Within-result speaker changes are preserved. Use **Professor voice** in the overlay to assign a heard speaker; matching questions move ahead of waiting student questions, without interrupting answers already running. This is a user-assigned label, not biometric voice identification. Assignment clears on a new stream/reconnect; reassign after hearing the professor again. Speaker attribution and question detection can be wrong, and missing ASR question boundaries can still combine questions.

Live detection allows speech to settle for 750 ms after the latest transcript update, capped at 2.2 seconds from the oldest pending candidate (excluding an already-running detector request). Finalized follow-on speech is supplied separately to Jev and included in Luna's discussion context. This can recover closely spaced fragments without requiring perfect sentence boundaries; it cannot guarantee that a later continuation arrives before the cap. Ask now bypasses the settling delay.

Already-detected participation opportunities use an answer-first directive instead of running a second strict completeness gate in the answer prompt. Basic answers lead with what was requested—an example, name, distinction, or explanation. Readings remain available but are optional support for ordinary reasoning and classroom examples; citations are used only when directly supported. Author-specific claims and exact quotations still require evidence. Clearly non-content chatter and genuinely unrecoverable topics may still be skipped.

Question detection also counts open participation invitations: requests to demonstrate understanding of a reading, volunteer an explanation, or add comments. During a reading discussion, “anyone else who did the reading before I explain it” is treated as a participation opportunity even without a specific factual question. This intentionally favors recall over precision; purely administrative checks can still be rejected.

The overlay separates capture controls from the course picker, keeps the listening indicator green while answers run, and uses a near-opaque background for readability. Live transcript and detector diagnostics can be collapsed to leave more answer space. Extra or fragmentary question cards remain visible; this layout does not tighten question detection. Skipped/cancelled entries are retained in expandable history. New questions stay newest-first, with an **↑ newest** shortcut when reading older answers. **Discussion context** reveals a short excerpt of the preceding transcript, not an additional model summary or source citation.

## Expand an answer

All four course profiles use simple wording with substantive reasoning. Discussion answers normally use 60–110 words to explain a mechanism, distinction or relevant tension; definitions, polls and chart entries can be shorter. Basic answers can retrieve relevant earlier speech from the same course and lecture day. Captured question context is kept separately from the newer rolling transcript, so a queued answer retains the original referent. Readings support reasoning about the question rather than compulsory reading summaries. Refinements preserve the selected course's style. Question drafts retain their separate concise format.

Completed answers have an **Expand** button: a longer plain-English follow-up stays beneath the original short answer. It reuses that answer's original question, course evidence, and model/reasoning settings. The expanded answer develops the underlying mechanism, a useful course connection, a consequence or example, and a meaningful limit when the evidence supports them. At expansion time, it selects relevant earlier spoken transcript from before the original answer began. Prior AI question drafts are excluded. Expansion shares the two answer slots, queues behind waiting questions, and does not stop listening. Collapse/show reuses the completed text without another model call. Errors and cancellation preserve the original answer and allow retry.

Expand can also search older saved spoken sessions from the current course. A private `knowledge/expansion-sources.json` manifest names any reading indexes and other course profiles allowed as sources. Each selected passage identifies its course and source. Without that manifest, no cross-course material is loaded. Search runs locally before the answer request, and the selected excerpts are sent to the configured answer provider as part of that request. It does not search the public web.

For the Political Identities profile, expansion can include a clearly signposted devil's-advocate perspective when it adds substance, a fair explanation of the other side, and a simple limitation or reply. The prompt avoids forced disagreement, false balance, unsupported readings, and promises about participation marks. Other profiles retain the general expansion prompt.

Snapshots are memory-only and capped at the latest 100 completed answers; after restart or eviction, ask the question again. With autosave enabled, expanded responses are linked to their original question and session and included in Markdown exports.

## Saved class sessions

Enable **Settings → Sessions → Record sessions** to persist transcript finals, detected questions, linked answers, speaker assignments, and cancellation/error statuses. Every Start creates a distinct class/date session in the local `sessions/<profile-id>/` directory. Files are private-mode JSONL plus a metadata catalog; they are not encrypted transcripts, and audio recordings are not retained by this feature. Existing legacy session files remain readable.

The Sessions tab filters by class, searches that class's saved text on demand, and exports Markdown. The search is local text matching over class-scoped records, not an embedding index or an automatic addition to the answer context. Autosave does not feed the separate personal-memory log. Changing course never puts the previous class's archive into the live answer prompt.

## Course materials and privacy

The two politics profiles are configuration examples. Readings, recordings, prepared bundles, account settings, API keys, and private test reports are **not included**. Supply materials you are authorized to use, and obtain any required permission to record or send classroom discussion to cloud services.

`scripts/index-course.py` prepares a local index. `scripts/prepare-course-context.mjs INDEX SPEC OUTPUT.context.json` selects exact passages using a local specification. Bundles identify the profile and session date; stale or missing bundles produce an availability notice, not an automatic search. Refresh them before each session. The default bundle directory on macOS is `~/Library/Application Support/Classroom Copilot/knowledge`.

Local transcription does not make the entire pipeline local: Jev receives transcript text, and cloud-backed answers receive transcript/context evidence. Deepgram also receives audio when selected. Provider charges or account usage limits apply. Silent replay does not play through speakers, but cloud replay still sends data to the configured providers and requires the explicit cloud-replay opt-in.

The smoke and benchmark scripts are opt-in diagnostics and can consume provider quota. Unit tests run separately with `npm test`.

### Connection failures

Failed answer cards offer **Retry answer**. A retry keeps the original question,
speaker, session, and captured transcript, uses a fresh request ID, and waits for
an answer slot. Later speech does not replace its captured transcript. Retries
are manual; returning connectivity alone does not resubmit questions. They use
the current course/provider configuration and reload course evidence. Failed
requests remain retryable while their cards remain in this session, including
after stopping capture; starting a new session or changing courses clears them.
Retrying does not start microphone capture. Generic Codex failures retain their
login/model/connectivity/usage troubleshooting message rather than being
mislabelled as a confirmed connection failure.

Cloud transcription still reconnects after transient socket closures. It does
not retain an offline audio backlog, so speech missed during an outage cannot
be recovered by retrying an answer.
