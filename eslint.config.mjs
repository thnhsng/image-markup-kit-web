import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'compat/', 'example/dist/', 'playwright-report/', 'test-results/', '.cache/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Public types must stay readable by TypeScript 4.9 consumers using `isolatedModules`.
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Use a string-literal union instead of an enum.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tools/**/*.mjs', '*.config.{js,mjs,ts,mts}', 'test/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
