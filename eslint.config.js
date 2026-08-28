import js from '@eslint/js';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/games/_legacy-*.js'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
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
        AbortSignal: 'readonly',
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
        IDBKeyRange: 'readonly',
        FormData: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
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
    // Serverfunktionerna kör i Node, inte i webblasaren. Egen sektion i stallet
    // for att sla ihop globalerna med klientens: da fangas ett `document` i
    // serverkoden som det fel det ar, i stallet for att ga igenom tyst.
    files: ['api/**/*.js', 'vite-plugin-api.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // console ar inte deklarerad som global har, sa varje anrop fangas redan
      // av no-undef. Regeln star kvar for att gora avsikten uttalad: en logg pa
      // servern ar det enklaste sattet att av misstag skriva ut en anvandares
      // API-nyckel. Fel kastas eller returneras i stallet.
      'no-console': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' },
    },
  },
];
