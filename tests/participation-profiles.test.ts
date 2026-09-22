import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { ProfileSchema } from '../src/shared/profile-schema';
import { buildAnswerRequest } from '../src/main/services/prompt-builder';
import { DEFAULT_SETTINGS } from '../src/shared/constants';

describe('fast participation profiles', () => {
  it.each(['canadian-politics', 'political-identities'])('%s keeps grounding with one short contribution', id => {
    const profile = ProfileSchema.parse(load(readFileSync(`profiles/${id}.yaml`, 'utf8')));
    expect(profile.prompt.system).toContain('25–40 words');
    expect(profile.prompt.system).toContain('ONE useful participation point');
    expect(profile.prompt.system).not.toContain('40–90');
    expect(profile.prompt.system).toContain('never repeat the long filename');
    expect(profile.knowledge.files).toHaveLength(1);
    expect(profile.knowledge.files[0]).toMatch(/\.context\.json$/);
    const request = buildAnswerRequest({ profile, knowledge: [{ name: 'Original reading | file page 2', text: 'Untrusted evidence.' }], settings: DEFAULT_SETTINGS, fullTranscript: 'Classroom discussion', newSegment: 'How does this work?', userSpeaker: 0, forced: false, codeMode: false });
    expect(request.system[0].text).toContain('25–40 words');
    expect(request.messages[0].content).toContain('Untrusted evidence.');
    expect(request.system[0].text).not.toContain('Untrusted evidence.');
  });
});
