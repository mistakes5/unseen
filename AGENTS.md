# Agent instructions — Classroom Copilot fork

Read [docs/classroom-setup.md](docs/classroom-setup.md) before configuring a class.
These are required working instructions for agents, not an application-enforced
onboarding mechanism. Higher-priority instructions and explicit user choices win.

## Western Business 2257 — required case preparation

For Western/Ivey **Business 2257, Accounting and Business Analysis**, read
[the course workflow](docs/business-2257.md) before setup or preparation.
Locate the user's current local casebook, assignment schedule, readings and all
exhibits first. If incomplete, ask the user to sign into Brightspace/OWL and
connect Chrome, or download the complete materials into a local course folder.
Use the authenticated course schedule to establish the actual assigned set;
public case names and old outlines do not establish this year's assignments.

Inventory and solve **every assigned case and question**, including the numerical
work and a defended recommendation, before treating its session as prepared.
Work through the complete available assigned set, checkpointing progress; do not
stop at a sample or substitute summaries for solutions. Reconcile the manifest
against the schedule. Missing exhibits or an unknown schedule mean incomplete
coverage, and must be reported rather than labelled solved. Preserve full checked
solutions locally, then prebatch the upcoming session's verified results, essential
exhibit evidence and assumptions into the existing dated context format.

Tell the user: **“For this course's live answers, the best configuration we
recommend is GPT-6 Luna, low reasoning, Fast mode through the OMP harness.”**
Use provider `omp-codex`, model `gpt-6-luna`, reasoning `low`, with the adapter's
per-invocation `--service-tier priority`. This is Billy's requested recommendation
for fast answers over prepared casework, not a measured claim that it solves
every case best. Verify OMP/account support; never substitute another model or
change global preferences. This recommendation does not authorize a subscription,
upgrade, inference spend or automatic provider switch. Follow the existing setup
gate for changes the user has not already authorized.

## Install the prebuilt app first

When a user asks to install, launch, try, or update Classroom Copilot on a Mac,
use this fork’s **prebuilt GitHub Release**. Do not start a source build, run
`npm install` / `npm ci`, install OMP, Homebrew, Xcode, or development dependencies,
or clone upstream as part of ordinary installation. Source builds are only for an
explicit development request or after reporting that the binary is unavailable.
Never silently fall back to compiling because a download failed.

1. Download `install-mac.command` from this repository’s `classroom-copilot`
   branch, inspect it, and run it with Bash. It downloads the complete matching
   Apple Silicon/Intel app from `mistakes5/unseen` Releases, checks SHA-256 and
   the signature, installs to `~/Applications`, and requests launch.
2. Verify the installed `.app` and actual running app/window. An exit-zero
   download or an `open` request alone does not prove the GUI launched.
3. If the app is already running, preserve it and its recording. The installer
   refuses replacement until the user stops the recording and quits normally.
4. First launch then handles configuration. Ask the unresolved setup questions
   below; never copy the publisher’s credentials, personal profiles or course data.
   The native Codex CLI is bundled. No npm/OMP installation is needed.
5. For transcripts/notes, use **Settings → Profiles → Course folder…** after the
   user chooses their destination. This enables local saving. **Stop → Create
   notes** uses all same-profile/day speech with Sol low; Not now sends nothing.

The distributable is not notarized yet. If macOS blocks it, explain the normal
Privacy & Security review and let the user approve. Never clear quarantine,
disable Gatekeeper, or use a security bypass. See [install-mac.md](docs/install-mac.md).

## Required user-question gate

Before creating a new class setup or materially changing an existing one:

1. Inspect the current profile/settings and the user's already-confirmed choices.
   Treat course names, model access, enrollment and inferred classroom activity as
   unverified until supported. A calendar entry is not proof of enrollment.
2. **Ask the user the unresolved setup questions in the guide.** Ask a few concise,
   related questions at a time, not a ten-question form. Explain the meaningful
   tradeoff and let the user answer freely.
3. **Wait for their answer before applying the affected configuration.** Silence,
   a suggested default, or an inferred preference is not an answer. You may
   continue read-only inspection, documentation and offline/synthetic tests.
4. Reuse explicit answers already supplied; do not ask the same question again
   unless the class, destination, cost, scope or preference has changed. A user
   may explicitly delegate a choice after hearing the tradeoff; record that as
   delegation, not as a personally selected preference.
5. Summarize the agreed class setup and material consequences before applying it.
   Keep personal answers and paths outside the public repository. Distinguish
   confirmed choices, delegated choices and unresolved items.

The gate applies to actual course configuration, provider/data-sharing changes,
and deployment timing. It does not require onboarding questions merely to fix
code, edit documentation, run mocked tests, or push an already-authorized change.
Do not use it to interrupt an ongoing class unnecessarily.

## Configuration and runtime boundaries

- Keep participation intensity, note completeness and transcription provider
  independent. Light participation does not mean disposable notes.
- Never silently reduce recall, turn off autosave, or disable speaker labels to
  obtain a better speed number. Ask about that tradeoff first.
- Speaker IDs are not verified identities. Ask the user to identify the professor
  if prioritization is wanted; preserve the option to disable labels.
- Keep model/Fast/reasoning settings scoped to this app's provider invocation.
  Do not edit global Codex preferences or change another app's defaults.
- Verify the configured model and installed CLI support. Do not silently replace
  an unavailable model, enable tools, or import global instructions as a workaround.
- Do not present transcript inference as vision: an unseen board or citation may
  require missing evidence. Do not invent a user's opinion, experience or vote.
- Ask before interrupting a listening session. Never start live capture or replay
  automatically just to verify a configuration change.

## Jev, Luna and evaluation

- Jev supplies typed judgments; code owns thresholds, timing, queues and saving;
  Luna produces the answer. Verify current provider contracts before changing them.
- Installed Jev routing detects participation and related clarifications. The
  experimental five-flag answer-format router is **not shipped**. Do not describe
  it as installed or enable it without a new evaluation and authorized deployment.
- Preserve the selected question. Separate prior context from clarifying later
  speech; an unrelated later question must not replace it.
- Batch independent judgments where appropriate, but measure actual added time
  and tokens. Format selection alone is not evidence of correct topic selection.
- Evaluate on representative class examples and fresh held-out cases. Keep model,
  context and settings comparable, alternate A/B order, repeat trials, and record
  misses/errors. Do not optimize repeatedly on one lecture and claim generality.
- Report transcription, settle/detection, queue, generation and rendering delays
  separately. Include classifier overhead in total latency. A cacheable prefix is
  not a promise of cache hits; completed CLI text is not first-token streaming.

## Verification and publication

- Preserve unrelated user changes. Stage explicit intended paths; review the
  staged diff for secrets, personal paths and classroom content before committing.
- Never commit credentials, account identifiers, recordings, session archives,
  private readings, prepared evidence, personal setup answers or private eval data.
  Use synthetic/minimal non-identifying test fixtures. `.gitignore` is not an audit.
- For code changes run `npm test`, `npm run typecheck`, `npm run build`, and
  `git diff --check`. Report failures honestly; don't claim an audio replay ran
  when only mocked or text tests ran.
- Silent recording tests need authorization for the recording and every cloud
  destination. Use the existing file-replay path, not loudspeaker playback or an
  unexpected live microphone capture. Mark replay archives TEST and relaunch
  without replay arguments afterward.
- Before pushing, verify remote and branch. This classroom branch belongs on the
  user's fork, not upstream; never force-push or open a PR unless authorized.
