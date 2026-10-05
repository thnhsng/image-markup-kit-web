import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkupEditor } from '../../src';

describe('MarkupEditor', () => {
  it('renders in jsdom', () => {
    render(<MarkupEditor className="editor" />);
    expect(screen.getByTestId('markup.editor').className).toBe('editor');
  });
});
