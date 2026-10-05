import React, { useState } from 'react';
import type { ModelInfo } from '../../../shared/types';

/** A real dropdown; custom text never filters or hides the model choices. */
export function ModelPicker({ value, models, onChange, onRefresh, allowCustom = true }: {
  value: string;
  models: ModelInfo[];
  onChange: (value: string) => void;
  onRefresh: () => void;
  allowCustom?: boolean;
}): React.JSX.Element {
  const [custom, setCustom] = useState(false);
  const isCustom = allowCustom && (custom || !models.some(model => model.id === value));
  const selection = models.some(model => model.id === value) && !isCustom ? value : '';
  return (
    <div className="field">
      <label htmlFor="answer-model">Model</label>
      <div className="row">
        <select
          id="answer-model"
          value={selection}
          onChange={event => {
            const id = event.target.value;
            setCustom(id === '');
            // Opening custom entry must not erase the saved model.
            if (id) onChange(id);
          }}
        >
          {models.map(model => (
            <option key={model.id} value={model.id}>{model.label ?? model.id}</option>
          ))}
          {allowCustom ? <option value="">Custom model…</option> : selection === '' && <option value="" disabled>Choose model…</option>}
        </select>
        <button className="btn secondary" aria-label="Refresh model list" onClick={onRefresh}>↻</button>
      </div>
      {isCustom && (
        <div className="custom-model">
          <label htmlFor="custom-answer-model">Custom model ID</label>
          <input
            id="custom-answer-model"
            value={value}
            placeholder="Enter the provider’s exact model ID"
            onChange={event => onChange(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}
