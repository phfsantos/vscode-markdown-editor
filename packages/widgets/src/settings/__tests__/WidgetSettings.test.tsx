import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataSourceEditor } from '../WidgetSettings';

describe('DataSourceEditor expression input', () => {
  it('keeps invalid intermediate JSON editable while showing validation feedback', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DataSourceEditor
        dataSource={{
          type: 'static',
          config: {
            data: {},
            transform: { kind: 'get', path: ['results'] },
          },
        }}
        onChange={onChange}
      />,
    );
    const expressionInput = container.querySelector(
      'textarea[placeholder=\'{"kind":"get","path":["results"]}\']',
    ) as HTMLTextAreaElement;

    fireEvent.change(expressionInput, { target: { value: '{' } });

    expect(expressionInput.value).toBe('{');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('valid JSON');
    expect(onChange).not.toHaveBeenCalled();
  });
});
