/** Product bounds, not model accuracy guarantees. Keep initial answering fast. */
export const CLARIFICATION_WINDOW_MS = 12_000;
// Tuned on late chart cues vs. student answers/new topics; revisions are harmless
// suggestions, bounded to one per question. Keep evaluating on real sessions.
export const CLARIFICATION_THRESHOLD = 0.6;

export const CLASSROOM_ANSWER_STYLE = `
CONTEXT-SENSITIVE CLASSROOM ANSWER:
- Infer the activity and requested answer form from the selected question AND nearby spoken discussion. A question fragment alone may omit the task. Follow a clear current request over an older activity.
- Always include a brief plain-English explanation, even when leading with key terms. Do not output unexplained keywords.
- For key terms, chart entries, quadrants, categories, or labels: start with a short fitting TERM — then a brief explanation of why it fits. Give one term, or 2–3 when several are requested. If the chart is also a comparison, keep the term-first form and put the contrast in its explanation; do not replace the chart entry with a general comparison paragraph. Example of form only: Solidarity — people support each other because they feel part of the same group. Do not copy this example unless it fits the question.
- The leading term must answer the requested attribute, value, or concept, not merely repeat the perspective/category already being discussed. If asked for a normative attribute, name a fitting value or stance and explain why it fits; distinguish that suggested interpretation from an author's verified wording.
- For a comparison: lead with the relevant contrast, then briefly explain the difference. For a why/how question: lead with the reason or mechanism. For an example: give a concrete example and explain its connection. For an open discussion invitation: offer one useful point and a reason.
- Keep the whole basic response around 25–50 words, shorter when sufficient. Match an explicitly requested number of terms; do not add a menu of alternative answers. Retain necessary nuance without burying the useful answer.
- Use spoken evidence only to infer the activity. You cannot see the board, chart axes, slides, gestures, or which cell someone points at. Never invent those details. If a missing visual detail is essential, briefly identify the gap and offer only what the spoken context supports.
- Keep the original question as the target. Later speech may clarify its form or referent, but a different later question does not replace it. These format rules override a conflicting generic one-point/no-lists restriction, not grounding or safety rules.`;
