# Class-specific setup: ask first, then configure

Agents must follow the [required question gate](../AGENTS.md). Existing course
profiles are starting examples, not universal settings or proof of enrollment.
The app does not enforce this agent conversation in its setup UI.

## Required questions

Ask only what is not already explicitly answered. Group related questions into
short exchanges, wait for the answers, then confirm the proposed configuration.
Do not apply an unresolved choice using a silent default.

1. **Course/session:** Which course is this, which upcoming session, and is it a
   lecture or tutorial? Is it enrolled or only an optional class? Confirm timezone
   and dates if scheduling matters; exclude explicitly unenrolled calendar events
   from enrolled-course budgets.
2. **Purpose:** Fast participation, detailed notes, or both? How complete must the
   notes be even when the user rarely speaks?
3. **Sensitivity:** Prefer catching extra possible questions, or fewer unwanted
   answers? Ask how costly a missed invitation is versus an unnecessary card.
4. **Activities:** Mostly definitions, key terms/chart entries, reading discussion,
   comparisons, debates, examples or polls? Can tasks change within a session?
5. **Answer style:** How short and simple should the basic answer be? Should it
   always include a brief explanation? Are counterarguments useful in Expand,
   rather than forced into every short answer?
6. **Grounding:** Which local materials and today's assignment should be used?
   When is general knowledge acceptable, and when is exact reading support needed?
   Ask for missing materials instead of fabricating assignment requirements.
7. **Transcription/privacy/budget:** Cloud or local? Which destinations are allowed
   to receive audio, transcript and course excerpts? What cost/credit limit applies?
   Standalone microphone/system input or an existing transcript feed? Are speaker
   labels wanted, and can the user identify the professor? Confirm permission to
   record and permitted classroom use; technical availability is not consent.
8. **Saving:** Save full transcripts, answers, summaries, or some combination?
   Where, for how long, and with what sync preference? Keep archival saving separate
   from the short rolling context retained for answering.
9. **Answer provider:** Which available provider/model, reasoning level and speed
   tier? Must Fast stay app-specific? Verify account/CLI support without exposing
   credentials. Don't silently substitute a model or change global preferences.
10. **Testing/deployment:** Which recordings may be used, and sent to which services?
    May tests spend credit? Is a restart safe now or should it wait until class ends?

For an established course, ask about changed needs instead of repeating onboarding.
For a new course, do not assume another course's participation or note requirements.

## Translate the answers into a profile

| Confirmed class need | Configuration approach |
| --- | --- |
| Fast discussion + substantial notes | Short spoken answers, recall-friendly detection, complete autosave; detailed summary is a separate task |
| Light participation + substantial notes | Reduce automatic answering only if requested; retain full transcript saving |
| Polls/tutorial exercises | One defensible choice, variable, hypothesis or example plus a reason; no invented vote or result |
| Terms or chart entries | Term first, then a brief explanation; combine with a contrast if requested; never invent unseen axes |
| Reading seminar | Prepare relevant local excerpts before class; distinguish author claims from the student's interpretation |
| Cost-sensitive/local-only | Evaluate the chosen local backend on the user's hardware and representative audio; confirm that STT locality does not make a cloud answer model local |

Use user profile overrides for personal setup; see [profiles.md](profiles.md).
Do not commit personal paths or evidence bundles. Validate profiles against
`src/shared/profile-schema.ts`. User profiles override bundled profiles by ID.

Not every setting is per-profile: inspect `src/shared/types.ts` and the settings
service before changing anything. STT provider, Jev threshold, autosave and reasoning
settings are app settings in this version. Do not claim changing the course dropdown
automatically changes them. Course interpretation/clarification eligibility is also
listed in `src/shared/course-participation.ts`; a new YAML profile alone does not add
it to that map. Any shared-code changes require tests and should not overfit one class.

## Grounding without a search on every question

Prepare a bounded course/session evidence bundle in local app storage before class.
Validate its profile, date and provenance. Keep source labels and locators accurate;
do not turn study notes or an old syllabus snapshot into verified source authority.

Preserve useful nearby speech. A short “Why?” can refer to the current example;
it does not automatically ask for a quotation from a reading. Use ordinary reasoning
where permitted, and avoid irrelevant citations or habitual missing-reading disclaimers.
If a specific author's claim or unseen detail is essential and unavailable, identify
that gap rather than invent support. Cached/reused context still needs freshness checks.

## Lessons from local experiments

These are engineering observations from small exploratory replays, not universal
accuracy claims. The raw recordings, transcripts, reading excerpts and case-level
outputs are private and are not included here.

- Course-aware Jev instructions and a focused recent-context field helped selected
  participation cases without a new serial model call. Keep broader context for
  references and short follow-ups; do not just feed isolated fragments.
- A five-flag response-needs experiment (18 answer cases, two repetitions per arm)
  did **not** establish a consistent win over Luna inferring the response form.
  Label-hidden same-assistant review: 4 hinted-arm wins, 5 losses, 27 ties. The
  hinted arm was slower in 20/36 matched pairs despite a slightly lower overall
  median. Some pairs had identical Luna prompts because no hint was selected.
- Missing-visual hints helped avoid an unsupported verdict in a repeated writing-
  sample example. Correct “terms” classification still sometimes produced the wrong
  topic. Narrow evidence-gap or antecedent tests are more promising than assuming
  extra classification automatically removes generation latency.
- Explicit selected-speech/continuation field references improved a comparison
  diagnostic on known cases. That post-hoc result needs fresh answer-level testing;
  it is not a deployed feature or a validated universal threshold.
- The installed answer-format inference stays with Luna. Jev handles participation
  and bounded clarification judgments. If experimenting with response needs, allow
  overlapping flags, include uncertainty/no-hint behavior, and never suppress a
  participation opportunity merely because its format is unclear.

## Speed and safety checklist

- Measure first, preserving the user's model, recall and note requirements.
- Keep complete-question settling distinct from waiting for a fragment's continuation.
  Current timings are code-level policies, not validated settings for every class.
- Smaller audio batches reduce client buffering but may change overhead; do not
  reduce endpointing blindly or claim better ASR accuracy from a latency test.
- Keep tools and global project instructions out of text-only Codex answer calls.
  The current provider scopes Fast to its invocation and uses ephemeral turns.
  Check installed CLI support before changing those flags.
- Do not wait for CLI shutdown to hold an already-completed answer slot; preserve
  cancellation and bounded subprocess cleanup. Don't call completed-message output
  native token streaming.
- Keep expansions longer only on request. Preserve originals, refinements and full
  transcript saving when testing queueing and late context.
- Test overlapping questions, fragments, late clarification, topic switches,
  missing visuals, cancellation, course changes, labels-off and autosave.
- Report stage timings, paired outcomes, errors and token usage. Keep privacy and
  costs visible. Stable prefixes do not guarantee cache hits; free-credit balances
  and price estimates must be verified instead of assumed.

Public interface references (verify live when changing integrations):
[TypeSafe typed judgments](https://docs.typesafe.ai/primitives),
[TypeSafe parallel independent questions](https://docs.typesafe.ai/patterns/fan-out),
[OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
