#!/bin/sh
set -e

WORKFLOW_DIR="/workflows"

if [ -z "$(ls -A $WORKFLOW_DIR/*.json 2>/dev/null)" ]; then
  echo "No workflow files found in $WORKFLOW_DIR, skipping import."
  exit 0
fi

echo "Importing workflows from $WORKFLOW_DIR..."
for file in "$WORKFLOW_DIR"/*.json; do
  echo "  -> $(basename "$file")"
  n8n import:workflow --input="$file"
done

echo "Activating all imported workflows..."
n8n update:workflow --all --active=true

echo "Workflow import complete."
