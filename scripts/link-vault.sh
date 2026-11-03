#!/usr/bin/env bash
# Symlink the built plugin into a TEST vault. Do not point this at a real vault.
set -euo pipefail

vault="${1:-}"
if [[ -z "$vault" || ! -d "$vault/.obsidian" ]]; then
	echo "usage: $0 <vault-path>  (the vault must already contain .obsidian)" >&2
	exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$vault/.obsidian/plugins/tablature"
mkdir -p "$target"
for f in main.js manifest.json styles.css; do
	ln -sf "$root/$f" "$target/$f"
done
echo "Linked into $target. Reminder: this must be a test vault, not your real one."
