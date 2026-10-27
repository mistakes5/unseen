# Providers

## LLM (answers)

| Provider | Key | Notes |
|---|---|---|
| **Anthropic** (default) | `ANTHROPIC_API_KEY` / Settings | Prompt caching: the profile prompt + knowledge files are marked ephemeral-cacheable, so repeated calls cost ~0.1× input for that prefix. Default model `claude-sonnet-4-6`; `claude-haiku-4-5` for low latency. |
| **OpenAI** | `OPENAI_API_KEY` / Settings | Live model list from `/models` plus curated fallbacks. |
| **Google Gemini** | `GEMINI_API_KEY` / Settings | `gemini-2.5-flash` (fast) or `-pro`. Live model list. |
| **Ollama** | none | Fully local/offline. Endpoint configurable (default `http://localhost:11434`); model dropdown lists what you've pulled. |
| **OpenAI-compatible** | optional | Anything speaking the OpenAI chat API: LM Studio (`http://localhost:1234/v1`), Groq, OpenRouter, vLLM, llama.cpp server. Set base URL in Settings. |

### Fallback chain

`llm.fallbacks` in settings.json (e.g. `["ollama"]`) is tried in order when the
primary provider fails **before** producing any output. Mid-stream failures are
surfaced as errors instead of silently restarting the answer.

### Cost display

The footer shows tokens and an estimated cost from a static price table
(`src/main/services/llm/prices.ts`). Unknown models show tokens only — PRs
updating prices are welcome.

## Switching the answer provider while recording

You can switch between OpenAI-compatible and OpenAI via OMP in Settings →
Providers during a recording. Change only the answer provider/model: changing
the course resets its session, and changing STT settings can reconnect audio.

An answer already in progress finishes with the provider/settings captured when
it started. A queued or new answer uses the selected provider when it starts.
Expand and automatic revisions retain the original question/evidence while using
the current model and reasoning settings. Selecting OMP applies the Luna/low
preset; the adapter requests Fast per call. OMP must be installed, signed in and
have the requested model available. Provider availability and quota are separate
from the continuity of recording.

Regression tests cover the recording/session remaining active, queued work,
in-flight endpoint completion, and expansion/refinement switches in both
directions. These are mocked provider tests, not proof of a live service handoff
or uninterrupted audio measured against an independent recording.

## STT (transcription)

| Provider | Key | Notes |
|---|---|---|
| **Deepgram** nova-3 | `DEEPGRAM_API_KEY` / Settings | Streaming, interim results, speaker diarization, configurable language (`multi` for multilingual). |

Planned: local whisper.cpp (no-cloud mode), AssemblyAI, OpenAI Realtime.

## Where keys live

Keys are encrypted with your OS keychain via Electron `safeStorage` and never
cross into the renderer process (the only exception: the short-lived websocket
token that opens the STT audio stream). `.env` works as a dev fallback;
keychain-stored keys take precedence.
