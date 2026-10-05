# Profiles

## Three-hour listening safety limit

Every explicit Start creates a three-hour elapsed-time deadline for the classroom
overlay, for every class and transcription provider. Pausing, reconnecting, changing
transcription settings, hiding the overlay or sleeping the Mac does not renew it.
The main process owns the deadline and rechecks on wake and before new automatic
AI/transcription work. If the Mac sleeps past the deadline, it stops on wake.

At expiry the overlay releases its microphone and transcription connection, cancels
automatic detection and answer work, and displays “Stopped automatically after
3 hours.” Saved transcripts and completed answers are retained; the app stays open.
Press Start explicitly for another three hours. Stop or switching courses ends the
old timer. This does not shut down a separate Meetily recording, stop dictation,
or quit the computer. It works with transcript autosave off as well.

A profile defines how the copilot behaves — its prompt, when it speaks up, its
output style, and which of your documents it knows.

This classroom fork bundles only four course profiles: Canadian Politics (2530F),
Political Identities (3304F), Federalism (3348F), and Politics of AI (3390F).
Generic upstream presets are not bundled; custom profiles can still be created.

## Optional question drafts

Settings → Profiles → Edit → **Question drafts for this class** can opt a course
into explicit question invitations or invitations plus strong discussion openings.
The YAML field is `questionSuggestions: off | invitations | openings`; omission
means off. This is independent of normal answering and autosave, and requires Jev.
Two additional judgments in the existing detector batch assess the opening and an
unanswered useful angle. The lower probability must reach the initial 0.75 cutoff.
Luna then drafts one question plus a brief reason, with the prepared course context.
These are suggestions for human review, never automatically spoken or submitted.

Drafts run only with no answer work outstanding, at most once per minute. Recent
drafts are supplied to reduce repetition, and obsolete in-flight openings are
discarded. Ordinary questions retain their normal detector threshold. These initial
guards need representative classroom evaluation; they do not guarantee quality,
uniqueness, or a suitable moment to interrupt. Drafts are labeled separately in the
overlay and autosaved answer events (`responseKind: question-suggestion`).

## Detector service failures

Both Jev detector paths allow at most two retries for network failures or HTTP
408, 429, 500, 502, 503, 504 and 529. Backoff starts at 250 ms then 600 ms, with
up to 99 ms of jitter. Server retry headers can extend those delays; a retry is
not attempted when its delay would exceed the eight-second total request budget.
Authentication, invalid requests and malformed successful responses are not retried.
Stopping, pausing or changing courses cancels work. No provider fallback is added.

If the bounded check fails, a single detector warning replaces per-segment error
cards. The next successful check clears the warning; a count of unchecked segments
remains in detector details, and failure records are saved when autosave is on.
Unchecked speech is not treated as a negative classification. Transcription saving
is independent. Ask now bypasses detection for the latest speech, not the original
failed segment. A continuing outage may still cause missed automatic answers.

**The easy way: Settings → Profiles.** Click **Edit** on any profile to change
its system prompt, triggers, output style, and model override in a form, and
**Attach files…** to add knowledge documents (product docs, battlecards, prep
notes) via a file picker — they're copied into the app's knowledge folder and
injected into the prompt. Editing a built-in creates your own copy that
overrides it; deleting your copy restores the original. **⧉ Duplicate** clones
any profile as a starting point, **+ New profile** starts from a template.

**The power way: YAML files.** Under the hood every profile is one YAML file.
Built-ins ship with the app; yours live in the user profiles folder (Settings →
Profiles → "Open profiles folder"). Files hot-reload on save, so you can edit
them in any editor while the app runs. A user profile with the same `id` as a
built-in overrides it.

## Full schema

```yaml
id: my-profile            # kebab-case, unique
name: My Profile
description: One line shown in pickers.
icon: 🎙️

llm:                      # optional — overrides Settings → Providers for this profile
  model: claude-haiku-4-5
  maxTokens: 1200
  temperature: 0.7

prompt:
  system: |               # the heart of the profile. Template features:
    You assist {{user_speaker}}.        # {{user_speaker}} → e.g. "[S0]"
    {{#knowledge}}Ground answers in the docs below.{{/knowledge}}
                          # {{#knowledge}}...{{/knowledge}} included only when
                          # knowledge files are attached
  response_style: spoken  # spoken | notes | code-first (appends a shared style suffix)
  language: auto          # or a language name → "Always answer in X."

knowledge:
  prompt_label: PRODUCT DOCS    # heading used when injecting files
  files:                        # absolute paths, or relative to <userData>/knowledge/
    - battlecards.md

triggers:
  auto: true                    # evaluate detectors on new speech at all?
  detectors: [question, request, code-request, keyword]
  keywords: ["pricing"]         # used by the keyword detector
  debounce_ms: 1500             # min gap between auto-answers
  min_chars: 8                  # ignore tiny fragments

transcript:                     # optional overrides of global settings
  window_chars: 4000            # how much transcript the LLM sees
  retention_min: 3              # rolling window kept in memory
```

## Detectors

| Name | Fires when |
|---|---|
| `question` | a question is asked ("?", interrogative phrasing) |
| `request` | an imperative request ("walk me through…", "explain…") |
| `code-request` | code is asked for — also switches the answer to code mode |
| `keyword` | any of `triggers.keywords` appears |

"Ask now" (button or hotkey) bypasses all triggers and always answers the latest
thing said.

## The SKIP convention

Profiles instruct the model to reply exactly `SKIP` when there's nothing useful
to say; the UI silently discards those answers. Keep that rule in custom
prompts or the panel gets chatty.

## Tips

- Start by duplicating the built-in closest to your use case.
- Keep system prompts speakable if `response_style: spoken` — the user reads
  your output aloud.
- Knowledge files are injected as cacheable blocks: with Anthropic, repeated
  calls pay ~0.1× for them after the first.

## Lecture-aware question drafts

Opt-in question suggestions now use earlier same-course, same-day lecture speech
and previous drafts, including saved segments from before an app restart. TEST
sessions, other courses/dates and unspoken AI answers are excluded. This is a
course/day boundary, not an inferred lecture identity: two meetings of the same
course on one day share this history. With autosave off, new speech is kept in
memory only and is lost on exit; missing/unrecorded audio cannot be checked.

Generation uses a small local lexical shortlist of earlier passages. Before a
draft is displayed, Jev checks the **actual draft against every history chunk**
for an already-given answer, a semantically repeated question, or an unacknowledged
premise conflicting with the lecture. Same-topic follow-ups and explicit
challenges remain allowed. Generated drafts are not treated as words spoken aloud.
The guard uses three independent Nouls per chunk, at most two concurrent requests,
an eight-second check deadline and a conservative initial collision cutoff of
0.35. This is a product policy, not a calibrated guarantee of semantic accuracy.

Drafts are buffered until checked; failed, uncertain or unavailable checks withhold
the draft and archive a skip reason. History is refreshed after generation, with
one additional check for speech arriving during verification; continuing changes
withhold the stale draft. A 240,000-character history ceiling fails closed instead
of silently dropping old explanations. No automatic regeneration loop is used.
Ordinary answers retain their streaming, recall thresholds, model and Fast settings.
The extra Jev calls apply only to opt-in question drafts and consume provider usage.
# General conversation and unsaved sessions

`questionDetection.mode: general` lets Jev detect everyday and logistical questions
and indirect requests. Ordinary statements, small talk and unclear unfinished
requests remain excluded. The default is `classroom`; provider and cutoff remain
app settings.

`sessions.autoSave: false` prohibits archival for this profile, including late
answers after switching profiles. Omit it to follow global autosave. It cannot
override global autosave being off. Live context and cards remain in memory;
this does not change the configured cloud services or their data handling.

General profiles can use empty `knowledge.files` and `memory.namespaces`.
General-mode expansions do not import shared cross-course reading indexes.
The profile editor exposes both detection scope and session saving.
