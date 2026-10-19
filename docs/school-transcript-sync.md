# Automatic school-folder copies

In the prebuilt Mac app, use **Settings → Profiles → Course folder…**. The app
handles ten-second transcript copies itself while open, including a final copy
on normal quit. No Node installation, source checkout or extra service is needed.
The selected course folder is also where approved lecture notes are saved.

## Optional standalone follower

The following command is for existing advanced installations that already use a
separate follower. The packaged app preserves such an installed follower rather
than starting a second writer. It is not part of the ordinary Mac install path.

`scripts/sync-school-transcripts.mts` follows the app's existing saved-session
archives without interrupting capture or opening a microphone. It makes local
copies only; no AI calls, cleanup, audio replay, or network requests are made.
It works with the installed app and does not require an application restart.

Run with Node 26 or newer:

```sh
node scripts/sync-school-transcripts.mts --config /absolute/path/to/private-config.json
```

The private JSON config contains absolute `archiveDir`, `profileDir`,
`settingsFile`, and `stateFile` paths plus `courses`, a map of exact profile IDs
to existing course folders. Keep personal configuration outside the repository.
Use a single macOS LaunchAgent with `RunAtLoad` and `StartInterval: 10` to invoke
the command periodically. Launchd prevents overlapping invocations of that job.
Changing the active profile needs no service restart: each session follows its
originating profile ID, including answers that arrive after a profile switch.
New courses require an explicit mapping; no names, paths or enrollment are guessed.

Files are isolated in generated subfolders:

- `Documents/Transcripts/Classroom Copilot — Live Index.md`: generated links to
  readable session transcripts and the separate AI logs, newest dates first.
- `Documents/Transcripts/YYYY-MM-DD/Classroom Copilot/SESSION.speech.md`: readable
  finalized speech, timestamps, anonymous speaker IDs and user-assigned labels.
- The adjacent `.speech.jsonl` retains finalized ASR events and speaker labels;
  `.provenance.json` identifies the source and its checksum. These are uncorrected
  ASR copies, not cleaned or audio-verified transcripts.
- `Documents/Copilot Logs/YYYY-MM-DD/Classroom Copilot/SESSION.answers.md`: AI
  drafts and detected-question context, explicitly separate from speech.

Existing curated transcripts, indexes, and source archives are never changed.
Historical sessions are copied on first run; changed sessions refresh within the
polling interval while the user is logged in and the Mac is awake. Full output
paths and source signatures are checkpointed. Unchanged files are not rewritten;
missing generated files are recreated. Newline-incomplete tails are retried next
time, malformed complete events are reported, and mixed-course events are refused.
Test/demo/replay sessions and profiles with saving disabled are excluded. Global
autosave off pauses copying. Source deletions do not delete existing school copies.
Generated files are replaced on updates; edit separate curated notes instead.

To stop automatic copying, unload the configured LaunchAgent. This leaves source
archives and existing school copies intact. Logs report counts and errors, never
transcript content. Check launchd's exit status and an actual file update after
installation; a successful manual run alone does not prove background activation.

## Notes after Stop

The app's explicit Stop button offers **Create notes / Not now**. No model call
occurs before Create notes is chosen. Pause, profile switches, failed startup and
automatic listening expiry do not offer notes or generate them in the background.
The ten-second transcript follower remains local-only and never creates notes.

On approval, the main process reads every saved recording for the stopped
profile on its America/Toronto calendar date, including previous Start/Stop
fragments. It sends finalized speech only to `gpt-6.1-sol` with low reasoning,
through the existing Codex CLI sign-in. Model and tier settings are per request;
there is no fallback and global/application answer settings are unchanged.
Requests use the ordinary priority tier rather than the live-answer Fast tier.
The CLI turn is ephemeral and tools are disabled.

Sol receives all of the day's speech before deciding which topics belong
together. It is instructed to combine related explanations, keep unrelated
topics or sessions distinct, cite timestamps, preserve uncertainties and mark
recording gaps. It is never told to assume that missing speech occurred, that
speaker IDs are verified identities, or that model answers were spoken aloud.
Unreadable/mismatched sessions and oversized input fail visibly instead of
silently producing notes from an incomplete selection.

Notes save directly beside existing notes in the configured course folder as
`YYYY-MM-DD — COURSE Lecture Notes (auto).md`. The generated note records its
model, source checksum, speech count and links to the original transcript copies.
Another approved Stop updates this same automatic note using all recordings
available for that day. Files without the generator marker are preserved.
Personal edits belong in a separate note because the automatic file is replaced
after another approved generation. The app uses its own styled confirmation,
progress, saved and error cards. Open notes opens the saved file. Confirmation
tokens are bound to the requesting window, and closing the window declines an
unanswered confirmation.

This part requires the updated application payload. Installing on disk does not
reload a running lecture; the Stop prompt becomes available on the next launch.
