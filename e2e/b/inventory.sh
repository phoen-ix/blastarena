#!/usr/bin/env bash
# Inventory for e2e part b (COVERAGE.b.md): one item per line, "<section> <item>".
#   bash e2e/b/inventory.sh | wc -l
set -euo pipefail
cd "$(dirname "$0")/../.."

# Admin tabs (each opened as admin; staff tabs also as moderator).
grep -oE "id: '[a-z]+'" frontend/src/ui/AdminUI.ts | sed -E "s/id: '([a-z]+)'/tab \1/"

# Every admin action: the REST calls and socket events the tabs make.
perl -0777 -ne 'while (/ApiClient\.(get|post|put|delete|download)\b[^(]*?\(\s*[`\x27]([^`\x27]*)[`\x27]/g) {
    my ($m, $p) = ($1, $2); $p =~ s/\$\{[^}]*\}/:x/g; $p =~ s/\?.*//; print "admin $m $p\n" }
  while (/emit\(\s*\x27((?:admin|sim):\w+)\x27/g) { print "admin socket $1\n" }' \
  frontend/src/ui/admin/*.ts | sort -u

# Level editor: tools and actions.
{
  grep -oE "tool: '[a-z_]+'|currentTool = '[a-z_]+'" frontend/src/scenes/LevelEditorScene.ts |
    sed -E "s/.*'([a-z_]+)'/editor tool \1/"
  grep -oE "t\('editor:(actions\.[a-zA-Z]+|modals\.(cancel|discard|saveAndExit))'\)" \
    frontend/src/scenes/LevelEditorScene.ts | sed -E "s/t\('editor:([a-zA-Z.]+)'\)/editor \1/"
} | sort -u

# Account flows: the auth and account routes (local co-op, buddy, privacy, match list are part a).
perl -0777 -ne "while (/router\.(get|post|put|delete)\(\s*'(\/(?:auth|user)\/[^']*)'/g) { print \"account \$1 \$2\n\" }" \
  backend/src/routes/auth.ts backend/src/routes/user.ts |
  grep -vE ' /user/(buddy-settings|privacy|matches)$' | sort -u

# Languages and themes.
grep -oE "supportedLngs: \[[^]]*\]" frontend/src/i18n/index.ts | grep -oE "'[a-z]+'" | tr -d "'" |
  sed 's/^/language /'
perl -0777 -ne 'print "$1\n" if /THEME_IDS = \[([^\]]*)\]/' shared/src/constants/themes.ts |
  grep -oE "'[a-z]+'" | tr -d "'" | sed 's/^/theme /'
