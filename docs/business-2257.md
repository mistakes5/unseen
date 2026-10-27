# Western Business 2257: solve first, prepare context before class

Required agent workflow for **Accounting and Business Analysis**, researched
27 October 2026. This guide is preparation logic and operating instructions;
it is not a case solution, a current assignment list, or an installed profile.

## What this course needs

Ivey's [official course page][courses] describes first-term financial accounting
and preparation of financial statements, followed by second-term business
analysis and a group new-venture feasibility study. Its [April 2026 interview
with 2257 instructor Martin Eidenberg][interview] distinguishes accounting
answers that can be wrong from forward-looking decisions where several choices
can be well defended. Prepare correct calculations **and** the reasoning that
makes a recommendation persuasive.

The [official FAQ][faq] describes contribution as both quality and quantity and
lists it as 10% of the grade. Verify the user's current section syllabus before
using any grade weights, deadlines, team sizes or assigned cases. A student's
useful contribution may be a calculation, explanation, objection, correction,
decision or relevant question; do not manufacture opportunities to interrupt.

The public course page's Download Outline link still points to 2022–23. A more
detailed [main-campus 2023–24 outline][outline] and a [Huron 2025–26 brief][huron]
were available at research time. These establish background, not a verified
2026–27 schedule. Huron explicitly defers to the syllabus in OWL. Distinguish
main campus, affiliated college, section, term and edition. The cases TerraCycle
and RollUP Solutions appear in the 2026 instructor interview as teaching
examples; that is **not** proof they are assigned to this user.

## 1. Establish the materials and complete scope

1. Confirm course/section/year and the session to prepare. Reuse answers already
   supplied. Do not infer enrollment from a calendar or create a personal profile
   before the unresolved setup choices in [classroom-setup.md](classroom-setup.md)
   have been answered.
2. Search the user's local course folder, downloads and existing knowledge/index
   manifests for the current syllabus, daily assignment schedule, complete
   casebook, supplementary readings, question sheets, exhibits, spreadsheets and
   instructor corrections. Inspect actual files; filenames alone are insufficient.
   Check whether exhibits are embedded, separate attachments or missing pages.
3. If anything is missing, say: “Please sign into Western Brightspace/OWL in
   Chrome and connect that browser so I can locate the 2257 materials, or download
   the casebook, daily assignment schedule, questions and all exhibits into your
   local course folder.” Let the user enter credentials. Use the connected browser
   only within the authorized course; do not request passwords, buy access, or
   assume the public website contains the whole casebook.
4. Read the authenticated current syllabus and assignment schedule. Establish the
   full assigned case/problem set and the specific next-session subset. Count
   each case once by case ID/title plus edition/revision, not merely its filename.
   Distinguish practice problems, assigned cases and optional enrichment.
5. Maintain a local `case-manifest.json` with course/section/year, source paths and
   hashes, schedule locator/date, case ID/title/revision, assigned date, every
   required question, exhibit availability, solution path, verification evidence,
   assumptions and status. Suggested states: `missing-source`, `ready-to-solve`,
   `solved-unchecked`, `verified`, `needs-correction`. These are agent records;
   the app does not enforce this manifest.

Solve **all assigned cases in the established scope**, not a few illustrative
ones. Keep working through the available set and checkpoint after each case.
Prioritize the next class without calling the remaining course complete. Report
assigned total, sources complete, solved, verified and blocked separately. Unknown
assignment coverage is unknown, not zero missing cases. If scope or exhibits are
unavailable, ask for the exact missing material and finish independent available
work. Do not invent a case, an exhibit, an instructor solution or a number.

## 2. Produce a complete, checked solution for every case

Read the complete narrative, all assignment questions and exhibits. Record the
decision-maker, decision date, objective, alternatives, constraints, time period,
currency/units and relevant case facts with page/exhibit/row locators. Preserve
the historical information set; later company outcomes are not facts the original
decision-maker knew. External information may supplement only when appropriate
and must be separately sourced and dated.

Keep three layers explicit: **source facts**, **calculated results**, and
**assumptions or judgments**. “Solved” requires answers to every assigned
question, workings, reconciliation and interpretation. A generic case summary,
an answer copied from a study site, or a model's unsupported confidence is not
completion. An externally supplied solution is comparison evidence to check,
not authority that overrides the actual case edition and exhibits.

### Financial accounting cases

- Identify the accounting treatment required by the case, applicable course
  conventions and period. Do not impose a modern rule or a different reporting
  framework on an older teaching case without explaining the difference.
- Prepare every requested entry, T-account/ledger, adjustment, trial balance and
  financial statement. Include opening balances, transaction dates, classifications,
  amounts and explanations; show how schedules feed the final statements.
- Reconcile debits and credits, the accounting equation, opening-to-closing account
  balances, net income to retained earnings (including dividends/other applicable
  changes), and cash movements where relevant. Explain discrepancies before
  calling the solution verified. Never use an unexplained balancing plug.
- Recompute from the source exhibits using deterministic calculations, a local
  script or a formula workbook. Verify units, signs, periods, rounding and the
  requested presentation. Preserve the workings so a student can explain them.

### Business analysis and managerial cases

The archived main-campus outline covers cost behaviour, marketing, cash management,
ratio analysis, projected statements, financing, pricing and differential cash-flow
decisions. Use only the tools relevant to the assigned case; this is not a command
to force every technique into every answer.

- Quantify alternatives on comparable periods/units. Identify relevant incremental
  revenues, costs and cash flows; distinguish sunk costs, avoidable costs, allocated
  overhead, opportunity costs, working capital, and cash timing when applicable.
- Prepare requested cost/volume analysis, budgets, projections, ratios and financing
  requirements from the exhibits. State formula conventions, denominators and
  assumptions; independently recompute totals and cross-statement links.
- Relate quantitative findings to customers, competition, capabilities, capacity,
  execution, financing and risk. For marketing, specify the customer/positioning
  and explain how the proposed actions and economics fit together.
- Test important assumptions and the conditions that would change the decision.
  Give a recommendation, supporting numbers, strongest objection, response,
  implementation steps and a practical contingency. Several defensible decisions
  do not make arithmetic errors acceptable.

### Feasibility study

Use the current project instructions and rubric. Preserve the team's actual idea,
roles and work. Research demand and competition, define the offer and operations,
and connect revenue/cost assumptions to evidence, capacity, startup funding,
working capital and cash needs. Evaluate downside scenarios and explain the
go/no-go decision. Keep sources and methods reproducible. Never invent interviews,
survey responses, quotes, primary research, team contributions or market evidence.
Write the report and presentation only within the user's requested scope.

### Verification and completion

Keep full solutions in the private course folder, using a stable case ID in every
filename and reference. Each solution needs: original-source locators; answers
mapped to each question; reproducible numerical workings; reconciliation/check
results; assumptions; a defended decision where requested; and concise possible
class contributions. Mark an unresolved numerical or material evidence gap
explicitly. Update the manifest only after checking the actual result.

“All cases solved” is allowed only when the assigned set is known, every assigned
question is answered, all exhibits are accounted for, and every case passes its
checks. Otherwise report the exact completed/remaining counts and blockers. Keep
full-course completion distinct from next-session readiness.

## 3. Prebatch the next session's verified context

Do the substantial reading, solving and arithmetic **before** the live answer
request. Prebatching means preparing a local evidence file, not invoking a
provider's paid Batch API, starting a scheduler, or repeatedly searching during
class. Reuse the [existing prepared-context path](../src/main/services/prepared-context.ts).

1. Freeze the session date in `America/Toronto`, exact profile ID and assigned
   case IDs/revisions. Reconcile the session subset against the verified manifest.
   Keep the full solved course archive locally, but attach only the relevant
   session to the live answer profile.
2. Write a compact derived session brief: case decision and timeline; question map;
   verified key results with units; formula/input/result trails; assumptions;
   alternatives and recommendation; objections/sensitivities; likely discussion
   questions and short defensible contributions; known missing information.
   Label it **agent-prepared, checked case analysis**, not an instructor answer key.
3. Select the minimum original evidence needed to substantiate those results:
   decisive narrative facts and exact exhibit rows/figures. Keep tables legible,
   including headers, dates, units, negatives, footnotes and totals. Inspect original
   pages when PDF extraction/OCR breaks a table. Label source evidence separately
   from derived calculations, proposed decisions and class corrections.
4. Put selected source passages and verified analysis sections in a local version-1
   course index (`chunks` with `source`, `locator`, `text`). For derived entries,
   identify the solution file, exact section and calculation evidence. An index
   entry is not proof that its calculations have been verified. The current
   `scripts/index-course.py` only scans its listed reading/summary directories;
   **it does not automatically index arbitrary Cases or Solutions folders**.
   Explicitly construct/check those entries rather than reporting phantom coverage.
5. Create a private spec with `profileId`, `sessionDate`, `topic`, `briefName`,
   `brief`, and `passages: [{source, locator}]`. The `brief` also needs provenance
   and must not silently contain unverified numbers. Each passage must identify
   exactly one existing source/locator pair in that index.
6. From the repository, run the existing builder with actual local paths:

   ```sh
   node scripts/prepare-course-context.mjs \
     "$case_index" "$session_spec" "$staged_context"
   ```

   Define those task variables first; `staged_context` must end in `.context.json`.
   This builder is offline and only copies the chosen brief/passages. It does not
   solve cases, verify formulas, infer the assigned set or create a profile.
7. Check the output with the actual loader for the exact profile and intended
   session date. The evidence budget is **26,000 characters including excerpt
   names**, with a **150,000-byte file limit**. Preserve decisive calculations and
   source rows; remove repetition before removing evidence. Split preparation
   across sessions when necessary. Do not bypass the loader or silently truncate
   an equation/table to squeeze in the entire year's casebook.
8. Back up the existing context file, then atomically replace the profile's
   referenced `.context.json` in local app knowledge storage. The profile's
   `knowledge.files` must reference that exact filename; relative references are
   resolved from the app's `knowledge` directory. Create/change the user profile
   only with the confirmed setup choices. No recording restart is needed merely
   to replace a referenced context file: it is read on answer preparation.
9. Read back the published file and loader result. Check profile, date, case IDs,
   evidence labels/locators, key numbers and character/byte counts. A future-dated
   bundle should be tested using its intended date; it is unavailable to today's
   live loader until that date. Never “refresh” a stale bundle by changing only
   its date. Refresh the assignments, evidence and verification first.

Preserve a provenance record binding source/exhibit hashes, solution version,
verification results, spec and bundle hash. Public Git commits may include the
workflow and synthetic fixtures; keep casebooks, paid readings, real solutions,
prepared bundles, recordings and personal paths outside the repository.

## 4. Recommend the live answer configuration

Tell the user explicitly: **“For this course's live answers, the best
configuration we recommend is GPT-6 Luna, low reasoning, Fast mode through the
OMP harness.”** This is Billy's chosen recommendation for short answers over
precomputed casework. It is not evidence that low reasoning can independently
solve and audit every accounting case, or a universal speed/quality ranking.

The existing implementation uses:

| Setting | Value |
| --- | --- |
| Classroom answer provider | `omp-codex` |
| Model | `gpt-6-luna` |
| Reasoning | `low` |
| OMP model argument | `--model openai-codex/gpt-6-luna` |
| OMP reasoning argument | `--thinking low` |
| OMP Fast argument | `--service-tier priority` |

See [the adapter](../src/main/services/llm/omp.ts),
[provider presets](../src/shared/answer-models.ts), and
[provider regression tests](../tests/omp-provider.test.ts).
The [official Luna model page][luna] lists low reasoning support; the
[official Fast documentation][fast] describes `priority` as an accepted Fast
tier value. Actual account access, installed OMP flags and delivered speed need
verification. The adapter requests Fast; it does not prove every request receives
that tier. Fast can use more account credit. Do not recommend a paid plan or upgrade.

Check the discovered OMP executable/version, its model catalog and existing Codex
sign-in without exposing credentials. OMP and the standalone Codex CLI have
separate login stores. The OMP route needs a usable OMP installation; the prebuilt
app's bundled standalone Codex CLI does not establish that OMP is present.
Use existing supported setup paths; do not silently install dependencies, switch
providers, enable fallback, run inference or alter global OMP/Codex preferences.
Obtain any unresolved provider/privacy/budget choices through the existing setup
gate. Keep transcription, saving and answer settings independent.

## 5. During and after class

Give the requested result or recommendation first, followed by the important
number and a brief reason. For a calculation, make inputs, formula, units and
interpretation clear. Offer the student's next useful contribution rather than
reciting the entire solved case. Expand can expose the fuller workings.

Keep the selected case and question fixed. Related restatements/alternatives should
be noted or incorporated into the same answer; a different case or independent
question needs a separate answer. Treat spoken changes to a case assumption as
conditional variations; they do not silently overwrite the checked base solution.
If essential evidence is missing, identify the exact exhibit/input and give only
the supported conditional result. Do not pretend to see the board or hear a
verified identity from a speaker number.

After class, preserve the original sources and checked base solution, save
instructor corrections with provenance, recompute affected results, and update
the manifest and future bundles. A lecturer's reported number, ASR fragment and
verified calculation remain distinct evidence types. Do not start background
preparation, monitoring, capture or external sharing without authorization.

[courses]: https://www.ivey.uwo.ca/pre-ivey-experiences/business-foundations-courses/courses/
[faq]: https://www.ivey.uwo.ca/pre-ivey-experiences/business-foundations-courses/faqs/
[interview]: https://www.ivey.uwo.ca/hba/blog/2026/04/decoding-1220-and-2257-with-the-ivey-lecturers-who-know-them-best/
[outline]: https://www.ivey.uwo.ca/media/szrjkqmm/main-campus-business-2257-course-outline-fw-2023-24.pdf
[huron]: https://huronu.ca/wp-content/uploads/Accounting-and-Business-Analysis-BUSINESS-2257-552-Sweeney.pdf
[luna]: https://developers.openai.com/api/docs/models/gpt-6-luna
[fast]: https://developers.openai.com/api/docs/guides/fast-mode
