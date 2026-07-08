import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/.turbo/**',
            'apps/web/**', // el fork del plugin mantiene su propio eslint (se integra en F1)
            'reference/**',
            '**/*.d.ts',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
);
