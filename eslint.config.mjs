import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'.remember',
		'.claude',
		'.superpowers',
		'esbuild.config.mjs',
		'eslint.config.mjs',
		'vitest.config.ts',
		'main.js',
		'package.json',
		'tsconfig.json',
		'versions.json',
		'scripts',
		'test-vault',
		'docs',
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: { allowDefaultProject: ['manifest.json'] },
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
);
