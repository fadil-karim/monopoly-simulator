#!/bin/sh
# The container's modes. Every one reads and writes /data: the store of games, and the table and keys when saved.
#
#   dashboard              the page on port 8788, from which the simulator is run (the default)
#   play [options]         batch after batch, headless, from the table in /data or the default one, with the keys
#                          from the environment (simulator.env); SIGUSR2 finishes the game in play and holds
#   once [options]         one batch, then exit
#   probe | store | publish | republish | import-site
#                          the runner's --probe, --store, --publish, --republish or --import-site, then exit
#   models <provider>      the models a provider serves to your key
#   --anything ...         passed to the runner as it is: --games 3 --dry, --help
set -e
mode="${1:-dashboard}"
if [ $# -gt 0 ]; then shift; fi
case "$mode" in
  dashboard) exec node runner/dashboard.mjs --no-open "$@" ;;
  play) exec node runner/run.mjs --loop --hold "$@" ;;
  once) exec node runner/run.mjs "$@" ;;
  probe|store|publish|republish|import-site) exec node runner/run.mjs "--$mode" "$@" ;;
  models) exec node runner/run.mjs --list-models "$@" ;;
  *) exec node runner/run.mjs "$mode" "$@" ;;
esac
