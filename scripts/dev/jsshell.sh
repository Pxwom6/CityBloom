#!/bin/sh
# Fetch SpiderMonkey's js shell (Firefox's engine) into .cache/jsshell for `npm run xbrowser` (M29).
# Playwright's Firefox doesn't launch on macOS 27; the shell checks the engine meanwhile.
set -e
VERSION=${1:-144.0}
case "$(uname -s)" in
  Darwin) PLATFORM=mac ;;
  Linux) PLATFORM=linux-x86_64 ;;
  *) echo "Unsupported platform" >&2; exit 1 ;;
esac
mkdir -p .cache/jsshell
curl -sSfL -o .cache/jsshell/js.zip "https://archive.mozilla.org/pub/firefox/releases/$VERSION/jsshell/jsshell-$PLATFORM.zip"
(cd .cache/jsshell && unzip -oq js.zip && rm js.zip)
.cache/jsshell/js --version
