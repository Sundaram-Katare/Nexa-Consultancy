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
for file in "$WORKFLOW_DIR"/*.json; do
  WF_ID=$(grep -o '"id": "[^"]*' "$file" | head -n 1 | cut -d'"' -f4)
  if [ -n "$WF_ID" ]; then
    echo "  Activating workflow ID: $WF_ID"
    n8n publish:workflow --id="$WF_ID" 2>/dev/null || n8n update:workflow --id="$WF_ID" --active=true 2>/dev/null || true
  fi
done

echo "Workflow import complete."
