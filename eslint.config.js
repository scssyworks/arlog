import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import regexp from 'eslint-plugin-regexp';
import redos from 'eslint-plugin-redos';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [tseslint.configs.recommended],
  },
  {
    // Library code must run in browsers and Node; scripts/tests/config are Node-side.
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Static ReDoS analysis of every regex literal and RegExp() call in the repo.
    // Every finding is a hard error so CI fails on it.
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: { regexp, redos },
    rules: {
      // Exact analysis (recheck): exponential and polynomial blow-up.
      'redos/no-vulnerable': 'error',
      // Structural patterns that cause super-linear backtracking.
      'regexp/no-super-linear-backtracking': 'error',
      'regexp/no-super-linear-move': 'error',
      'regexp/no-misleading-capturing-group': 'error',
      'regexp/optimal-quantifier-concatenation': 'error',
      'regexp/no-dupe-disjunctions': 'error',
      'regexp/no-empty-alternative': 'error',
      'regexp/no-useless-quantifier': 'error',
      'regexp/no-trivially-nested-quantifier': 'error',
      'regexp/no-useless-lazy': 'error',
      'regexp/no-empty-group': 'error',
      'regexp/no-useless-assertions': 'error',
      'regexp/strict': 'error',
      // Only regex literals are statically analyzable; forbid runtime-built ones.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='RegExp'], CallExpression[callee.name='RegExp']",
          message: 'Use a regex literal so ReDoS lint rules can analyze it.',
        },
      ],
    },
  },
);
