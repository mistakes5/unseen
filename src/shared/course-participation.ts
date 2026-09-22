/** Course-specific interpretation, not a different sensitivity threshold. */
export const COURSE_PARTICIPATION_GUIDANCE: Readonly<Record<string, string>> = {
  'canadian-politics': 'Canadian Politics. Content polls asking which factor and why are invitations; questions being read as survey items or tutorial assessment criteria are not by themselves invitations. Preserve high recall for real discussion, including source-use examples.',
  federalism: 'Federalism. Incomplete comparisons (more like which system?), own-words definitions, and requests for thoughts about an institutional distinction are invitations. A lecturer listing constitutional properties is not itself a question.',
  'politics-of-ai': 'Politics of AI. Normative position questions, technology-use examples, and invitations to discuss personal experience are content opportunities even when there is no uniquely right answer. Administrative questions are not lesson content.',
  'political-identities': 'Political Identities. High-recall seminar participation: guesses, terms for a chart, short conceptual follow-ups and invitations to discuss readings count. A bare comprehension tag does not require an answer.',
};

export function isParticipationCourse(profileId: string): boolean {
  return Object.hasOwn(COURSE_PARTICIPATION_GUIDANCE, profileId);
}

export function courseParticipationGuidance(profileId?: string): string | undefined {
  return profileId && isParticipationCourse(profileId) ? COURSE_PARTICIPATION_GUIDANCE[profileId] : undefined;
}

export function courseDetectionSuffix(focusPath: string): string {
  return ` Use courseGuidance to interpret the activity; ${focusPath} contains this candidate's nearest speech. Do not let unrelated older questions transfer onto this candidate. Questions quoted as survey items or assessment criteria do not invite a response unless the current speaker asks listeners to answer or discuss them.`;
}
