import { render, screen } from '@testing-library/react';
import App from './App';

test('imports and renders the library in Jest 27 / jsdom', () => {
  render(<App />);
  expect(screen.getByText(/image-markup-kit/)).toBeInTheDocument();
  expect(screen.getByTestId('markup.editor')).toHaveClass('editor');
});
