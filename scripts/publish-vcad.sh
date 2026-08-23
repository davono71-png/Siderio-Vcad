#!/usr/bin/env bash
# Pubblica l'albero corrente su davono71-png/Siderio-Vcad (main)
# come UN commit, senza la storia Suite/Rilievi.
set -euo pipefail
DEST="${1:-}"
if [[ -z "$DEST" ]]; then
  if git remote get-url vcad >/dev/null 2>&1; then
    DEST=vcad
  else
    DEST=https://github.com/davono71-png/Siderio-Vcad.git
  fi
fi

TREE="$(git rev-parse 'HEAD^{tree}')"
SEED="$(git commit-tree "$TREE" -m "Siderio Vcad: viewer CAD PWA senza Suite")"
git push "$DEST" "$SEED:refs/heads/main"
echo "Pubblicato $SEED su $DEST (main), senza storia Rilievi."
