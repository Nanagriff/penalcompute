#!/bin/sh
# Print every reviewer report from the live feedback database, in the
# vectors case format (inputs, the reviewer's dates, what the engine said,
# the comment). Extra arguments go to to_vectors.py, e.g. --since 3.
#
#   ./deploy/reports.sh                      # all reports
#   ./deploy/reports.sh > vectors/reviewer.json
set -eu
HOST="${DEPLOY_HOST:-mauplus}"
exec ssh "$HOST" docker exec computation python to_vectors.py \
  --db /var/lib/computation/feedback.sqlite3 "$@"
