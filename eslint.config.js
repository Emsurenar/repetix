import js from '@eslint/js';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/games/_legacy-*.js'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        Image: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        getComputedStyle: 'readonly',
        performance: 'readonly',
        crypto: 'readonly',
        structuredClone: 'readonly',
        HTMLElement: 'readonly',
        Node: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        DOMParser: 'readonly',
        indexedDB: 'readonly',
      },
    },
    rules: {
      // Arvet fran den gamla kodbasen: mycket ar fortfarande under omskrivning.
      // Dessa star som varningar tills respektive etapp gatt igenom filen.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Onodiga escapes inuti teckenklasser, t.ex. [\/\^\*]. Semantiskt
      // identiska med de oescapade tecknen, alltsa ofarliga. De sitter nastan
      // uteslutande i spellagenas textnormalisering och stads nar de byggs om.
      'no-useless-escape': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { console: 'readonly' },
    },
  },
];
