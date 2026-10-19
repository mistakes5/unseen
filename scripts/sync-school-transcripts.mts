#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { syncSchoolTranscripts, type SchoolSyncConfig } from '../src/main/services/school-transcript-sync.mts';
export { syncSchoolTranscripts, type SchoolSyncConfig };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--config') throw new Error('Usage: node scripts/sync-school-transcripts.mts --config FILE');
  const config = JSON.parse(readFileSync(args[1], 'utf8')) as SchoolSyncConfig;
  const result = syncSchoolTranscripts(config);
  if (result.updated || result.errors.length) console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  if (result.errors.length) process.exitCode = 1;
}
