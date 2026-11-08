# Tablature

Write and edit guitar and bass tabs from the keyboard in [Obsidian](https://obsidian.md). A port of
[tablature.nvim](https://github.com/hc-nolan/tablature.nvim).

Your tabs stay plain text in fenced code blocks, so a note reads the same with or without the plugin. Requires Obsidian
1.15.0 or later, on desktop. Works with or without Vim mode.

## Getting started

1. Under **Settings → Hotkeys**, search for "Tablature" and assign keys to **Insert staff** and **Enter tab mode**. The
   plugin sets no hotkeys of its own.
2. Put the cursor on an existing staff and run **Enter tab mode**. Anywhere else, **Enter tab mode** inserts a blank
   staff first, as does **Insert staff**.
3. Type frets. Press `Esc` when you're done.

## Note format

Tablature works in code blocks marked `tab` and in code blocks with no language. Blocks in other languages are left
alone.

````
```tab
e|------------|------------|
B|--1--3------|------------|
G|------------|--12--------|
D|------------|------------|
A|------------|------------|
E|------------|------------|
```
````

- A staff is at least 2 consecutive lines. Each line has a label of 1 to 4 characters, then `|`, and ends with `|`.
- Each beat is 3 characters wide, so every measure's width must be a multiple of 3.
- The bars must line up on every row. If they don't, tab mode tells you what's wrong rather than editing the staff.
- Any other line, such as an annotation or a blank line, separates staves and is never changed.

## Keys

### Tab mode

| Key | Action |
|---|---|
| `h` or `←`, `l` or `→` | Previous or next beat |
| `H` or `{`, `L` or `}` | First beat of the previous or next measure |
| `j` or `↓`, `k` or `↑` | Next or previous string, continuing into the next or previous staff |
| `0`–`9` | Write a fret. Two digits in a row make a double-digit fret |
| `Space` | Clear the cell |
| `Backspace` | Clear the previous cell and move onto it |
| `T` | Change the staff's tuning |
| `B` | Set the number of beats in the current measure |
| `C` | Pick a chord shape and enter chord mode |
| `N` | Insert a staff below |
| `I` | Switch the staff between guitar and bass |
| `Esc` or `q` | Exit tab mode |
| `?` | Show all keys in the legend below the staff, or only the essentials |

Other keys type nothing, so stray typing can't break a staff. Combinations with `Ctrl` or `Cmd`, such as undo and save,
work as usual. Clicking a cell moves to it, and clicking outside a staff exits.

`I` keeps the low strings and adds or removes the high ones, using the first guitar or bass tuning. It won't remove a
string that has notes on it.

### Chord mode

A preview of the chord follows the cursor until you write it.

| Key | Action |
|---|---|
| `Tab`, `Shift+Tab` | Next or previous shape |
| `+` or `=`, `-` | Move the root fret up or down |
| `Enter` | Write the chord |
| `C` | Pick a different shape |
| Movement keys | As in tab mode |
| `Esc` or `q` | Return to tab mode |
| `?` | Show all keys or only the essentials |

## Settings

- **Default beats per measure** and **Default measures per staff** set the size of new staves.
- **New staves use** sets whether a staff inserted from scratch is for guitar or bass. Inserting next to an existing
  staff copies its tuning instead.
- **Guitar tunings** and **Bass tunings** have one tuning per line, low string to high. The first in each list is the
  default for new staves of that instrument. Built-in defaults are always included, so ones added by an update appear
  without changing your own entries:

  ```
  Drop D | D A D G B e
  ```

- **Chord shapes** has one shape per line, low string to high. Use `default` for any tuning, or a tuning's name to limit
  the shape to that tuning. `x` mutes a string:

  ```
  default | Power 5th (E root) | 0 2 2 x x x
  Standard | Major (E shape) | 0 2 2 1 0 0
  default | Bass octave (E root) | 0 x 2 x
  ```

## Install manually

From a [release](https://github.com/hc-nolan/tablature-obsidian/releases), download `main.js`, `manifest.json` and
`styles.css` into `<your vault>/.obsidian/plugins/tablature/`. Then reload Obsidian and enable **Tablature** under
**Settings → Community plugins**.

To build from source:

```
pnpm install
pnpm build
```

## Privacy

Tablature makes no network requests and collects no data. It only changes the note you're editing.

## How this was made

This plugin was written with [Claude Code](https://claude.com/claude-code), an AI coding agent. The author directed the
design and tested the plugin by hand, but hasn't reviewed the code line by line.

## License

[GPL-3.0-only](LICENSE)
