import { render, screen } from '@testing-library/react';
import App from './App';

test('imports and renders the editor in Jest 27 / jsdom 16', () => {
  render(<App />);
  expect(screen.getByText(/image-markup-kit/)).toBeInTheDocument();
  expect(screen.getByTestId('markup.editor')).toHaveClass('editor');
  expect(screen.getByTestId('markup.done')).toHaveTextContent('Save');
  expect(screen.getByTestId('markup.toolbar')).toBeInTheDocument();
});
