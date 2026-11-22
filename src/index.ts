// Host-agnostic entry point: the tab core and the CodeMirror extensions, with no Obsidian imports.
// The plugin itself (`src/main.ts`, `src/pickers.ts`, `src/settings.ts`) is deliberately left out,
// so a host other than Obsidian can import everything below.

export * from './core/blocks';
export * from './core/chords';
export * from './core/config';
export * from './core/staff';
export * from './editor/actions';
export * from './editor/decorations';
export * from './editor/keys';
export * from './editor/mode';
