import React, { useEffect, useState } from 'react';
import type { ModelInfo, ProviderInfo, VerifyResult } from '../../../shared/types';
import type { TabProps } from '../App';

function KeyField({
  providerId,
  hasKey,
  onSaved,
}: {
  providerId: string;
  hasKey: boolean;
  onSaved: (status: Record<string, boolean>) => void;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  return (
    <div className="field">
      <label>
        API key <span className={`badge ${hasKey ? 'set' : ''}`}>{hasKey ? 'set' : 'not set'}</span>
      </label>
      <div className="row">
        <input
          type="password"
          placeholder={hasKey ? '•••••••• (stored in keychain)' : 'paste API key'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn"
          disabled={!value}
          onClick={async () => {
            onSaved(await window.unseen.secretsSet(providerId, value));
            setValue('');
          }}
        >
          Save
        </button>
      </div>
      <div className="hint">Stored encrypted via your OS keychain, never in plaintext.</div>
    </div>
  );
}

export function ProvidersTab({ settings, update }: TabProps): React.JSX.Element {
  const [providers, setProviders] = useState<{ llm: ProviderInfo[]; stt: ProviderInfo[] }>({
    llm: [],
    stt: [],
  });
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [sttVerify, setSttVerify] = useState<VerifyResult | null>(null);

  const llmId = settings.llm.provider;
  const llmProvider = providers.llm.find((p) => p.id === llmId);

  useEffect(() => {
    void window.unseen.providersList().then(setProviders);
    void window.unseen.secretsStatus().then(setKeyStatus);
  }, []);

  useEffect(() => {
    setVerify(null);
    setModels([]);
    void window.unseen.modelsList(llmId).then(setModels);
  }, [llmId, keyStatus]);

  const set = update;

  return (
    <div>
      <h2>Providers</h2>

      <h3>Answers (LLM)</h3>
      <div className="field">
        <label>Provider</label>
        <select value={llmId} onChange={(e) => set({ llm: { provider: e.target.value } })}>
          {providers.llm.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>

      {llmProvider?.needsApiKey && (
        <KeyField providerId={llmId} hasKey={!!keyStatus[llmId]} onSaved={setKeyStatus} />
      )}
      {llmId === 'codex' && <div className="hint">Uses your existing Codex CLI login and account limits; no separate OpenAI API key. GPT-5.6 Luna uses low reasoning + Fast mode (increased credit usage). Answers appear when each CLI message completes. Test connection checks login, not remaining quota.</div>}

      {llmId === 'ollama' && (
        <div className="field">
          <label>Ollama endpoint</label>
          <input
            value={settings.llm.endpoints.ollama}
            onChange={(e) => set({ llm: { endpoints: { ollama: e.target.value } } })}
          />
          <div className="hint">No account or API key needed — fully local.</div>
        </div>
      )}
      {llmId === 'openai-compatible' && (
        <>
          <div className="field">
            <label>Base URL</label>
            <input
              placeholder="e.g. http://localhost:1234/v1 (LM Studio) or https://openrouter.ai/api/v1"
              value={settings.llm.endpoints.openaiCompatible.baseURL}
              onChange={(e) =>
                set({ llm: { endpoints: { openaiCompatible: { baseURL: e.target.value } } } })
              }
            />
          </div>
          <KeyField
            providerId="openai-compatible"
            hasKey={!!keyStatus['openai-compatible']}
            onSaved={setKeyStatus}
          />
        </>
      )}

      <div className="field">
        <label>Model</label>
        <div className="row">
          <input
            list="model-options"
            value={settings.llm.model}
            onChange={(e) => set({ llm: { model: e.target.value } })}
          />
          <button
            className="btn secondary"
            onClick={() => void window.unseen.modelsList(llmId).then(setModels)}
          >
            ↻
          </button>
        </div>
        <datalist id="model-options">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label ?? m.id}
            </option>
          ))}
        </datalist>
      </div>

      <div className="field">
        <button
          className="btn"
          onClick={async () => setVerify(await window.unseen.providerVerify('llm', llmId))}
        >
          Test connection
        </button>
        {verify && (
          <div className={`verify ${verify.ok ? 'ok' : 'bad'}`}>
            {verify.ok ? `✓ Connected${verify.message ? ` — ${verify.message}` : ''}` : `✗ ${verify.message}`}
          </div>
        )}
      </div>

      <h3>Question detection</h3>
      <div className="field">
        <label>Automatic detection</label>
        <select value={settings.questionDetection.provider} onChange={(e) => set({ questionDetection: { provider: e.target.value as 'rules' | 'jev' } })}>
          <option value="jev">Jev · TypeSafe API</option>
          <option value="rules">Basic local rules · no detection fee</option>
        </select>
        <div className="hint">Jev receives recent transcript text. Ask now bypasses detection. Basic rules can misidentify questions.</div>
      </div>
      {settings.questionDetection.provider === 'jev' && <KeyField providerId="typesafe" hasKey={!!keyStatus.typesafe} onSaved={setKeyStatus} />}
      <h3>Transcription (STT)</h3>
      <div className="field">
        <label>Provider</label>
        <select
          value={settings.stt.provider}
          onChange={(e) => set({ stt: { provider: e.target.value } })}
        >
          {providers.stt.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </div>
      {providers.stt.find((p) => p.id === settings.stt.provider)?.needsApiKey && <KeyField
        providerId={settings.stt.provider}
        hasKey={!!keyStatus[settings.stt.provider]}
        onSaved={setKeyStatus}
      />}
      <div className="hint">
        {settings.stt.provider === 'meetily'
          ? 'Reads only new transcript segments from Meetily. Start recording there first, then Start here. No second microphone, audio stream, or Whisper model. Pausing/stopping this overlay does not stop Meetily.'
          : settings.stt.provider === 'whisperlivekit'
          ? 'Your cached MLX Turbo model runs on this Mac. Test connection starts the local server. Speaker identification is unavailable in this configuration.'
          : 'Audio streams to Deepgram. Its trial credit is finite; usage fees apply after credit runs out.'}
      </div>
      <div className="field">
        <button
          className="btn"
          onClick={async () =>
            setSttVerify(await window.unseen.providerVerify('stt', settings.stt.provider))
          }
        >
          Test connection
        </button>
        {sttVerify && (
          <div className={`verify ${sttVerify.ok ? 'ok' : 'bad'}`}>
            {sttVerify.ok ? `✓ Connected${sttVerify.message ? ` — ${sttVerify.message}` : ''}` : `✗ ${sttVerify.message}`}
          </div>
        )}
      </div>
    </div>
  );
}
