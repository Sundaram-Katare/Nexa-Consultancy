#!/bin/sh
set -e

echo "========================================================"
echo "🚀 Auto-Importing n8n Workflows into Container..."
echo "========================================================"

# Wait for n8n service database/API to become available
echo "Waiting for n8n initialization..."
sleep 5

WORKFLOW_DIR="/workflows"
if [ -d "$WORKFLOW_DIR" ]; then
  for wf in "$WORKFLOW_DIR"/*.json; do
    if [ -f "$wf" ]; then
      echo "Importing workflow: $(basename "$wf")"
      n8n import:workflow --input="$wf" || echo "Workflow $(basename "$wf") already exists or imported."
    fi
  done
  echo "✅ All workflows successfully processed!"
else
  echo "⚠️ Workflow directory $WORKFLOW_DIR not found, skipping."
fi
