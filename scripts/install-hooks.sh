#!/usr/bin/env bash
# Installs repo git hooks. Run via: npm run hooks:install
# Writes an exec-wrapper (not a copy) so hook edits in scripts/ always apply.
set -e

ROOT=$(git rev-parse --show-toplevel)
HOOK="$ROOT/.git/hooks/commit-msg"

cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# Wires scripts/pre-commit-research-check.sh (staged src/poly|src/trading
# require a sprint research/plan note or an escape tag). Installed as
# commit-msg so "$1" is the real message file for escape-tag detection.
exec "$(git rev-parse --show-toplevel)/scripts/pre-commit-research-check.sh" "$1"
EOF

chmod +x "$HOOK"
echo "installed: .git/hooks/commit-msg -> scripts/pre-commit-research-check.sh"
