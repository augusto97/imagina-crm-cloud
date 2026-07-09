import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Config propio del fork (apps/web). Vive acá —y no en el root— porque el
// eslint.config.mjs raíz ignora `apps/web/**` a propósito (el fork del plugin
// mantiene su propio lint). ESLint 9 detiene la búsqueda de flat-config en el
// primer archivo hacia arriba desde el cwd, así que al correr `pnpm lint` desde
// apps/web se usa ESTE config y no el del root (que ignoraría todo).
export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', '.turbo/**', '**/*.d.ts'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['app/**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2022,
            },
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: {
            react,
            'react-hooks': reactHooks,
        },
        settings: {
            react: { version: 'detect' },
        },
        rules: {
            ...react.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            // El fork no usa el runtime clásico de React (JSX transform nuevo).
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
);
