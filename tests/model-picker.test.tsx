import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ModelPicker } from '../src/renderer/settings/components/ModelPicker';

const models = [{ id: 'gpt-6-luna', label: 'GPT-6 Luna · low reasoning · Fast' }];
const render = (value: string, available = models) => renderToStaticMarkup(
  <ModelPicker value={value} models={available} onChange={vi.fn()} onRefresh={vi.fn()} />,
);

it('keeps every suggested model in a real dropdown when custom text has no match', () => {
  const html = render('glm');
  expect(html).toContain('<select');
  expect(html).toContain('<option value="gpt-6-luna">');
  expect(html).toContain('value="" selected="">Custom model');
  expect(html).toContain('value="glm"');
  expect(html).not.toContain('<datalist');
});

it('selects an exact known model without showing an extra text field', () => {
  const html = render('gpt-6-luna');
  expect(html).toContain('value="gpt-6-luna" selected=""');
  expect(html).not.toContain('Custom model ID');
});

it('preserves the saved model when the provider has no suggestions', () => {
  expect(render('existing-custom-model', [])).toContain('value="existing-custom-model"');
});

it('offers only the configured model for the default backends even with a stale value', () => {
  const html = renderToStaticMarkup(<ModelPicker value="glm" models={models} allowCustom={false} onChange={vi.fn()} onRefresh={vi.fn()} />);
  expect(html).toContain('<option value="gpt-6-luna">');
  expect(html).not.toContain('Custom model');
  expect(html).not.toContain('<input');
});
