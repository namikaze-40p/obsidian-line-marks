import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
	globalIgnores(['node_modules', 'main.js']),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					// Files not covered by tsconfig.json (config files and build scripts).
					allowDefaultProject: ['*.mjs'],
				},
			},
		},
		rules: {
			// Key names are proper nouns and written in capitals.
			'obsidianmd/ui/sentence-case': ['warn', { brands: ['Ctrl', 'Cmd', 'Alt', 'Option', 'Shift', 'Win', 'Esc'] }],
		},
	},
	{
		// Tests and build scripts run on Node, not in Obsidian.
		files: ['test/**/*.ts', '*.mjs'],
		languageOptions: {
			globals: globals.node,
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	{
		// The recommended config does not lint manifest.json, so enable the rule that checks it
		// (the community directory checks the same requirements, e.g. for the description).
		// The rule reads manifest.json as a JavaScript expression, so parse it with the TypeScript parser.
		files: ['manifest.json'],
		plugins: { obsidianmd },
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { projectService: false },
		},
		rules: {
			'obsidianmd/validate-manifest': 'error',
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			// describe / test of node:test return a Promise, but they are normally not awaited.
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
]);
