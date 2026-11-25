#!/bin/bash
# On Deck: build, pack and upload a beta build to Even Hub, then invite you as a tester.
# Run AFTER signing in once with:  npx evenhub login
# Usage:  bash store/upload-beta.sh you@example.com   (your Even Realities account email)
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="${1:?Pass your Even Realities account email}"
VERSION=$(node -p "require('./app.json').version")

npx evenhub self-check || { echo "Not signed in. Run: npx evenhub login"; exit 1; }
npm run build
npx evenhub pack app.json dist -o on-deck.ehpk --sdk-ver 0.0.16 -c
if npx evenhub ls com.davisvann.ondeck >/dev/null 2>&1; then
  npx evenhub upload on-deck.ehpk -m "$(cat store/release-notes.txt)"
else
  npx evenhub create on-deck.ehpk --name "On Deck" --tagline "Your decisions, one card at a time" \
    --description-file store/description.txt --icon store/icon-24.png
fi
npx evenhub testers add "$EMAIL" || true
npx evenhub promote "$VERSION" --to beta
npx evenhub ls com.davisvann.ondeck
echo
echo "Done. Accept the tester invite email, then in the Even Realities app: Me > Beta tester > Install."
