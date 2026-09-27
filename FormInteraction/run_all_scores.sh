#!/bin/bash
# Run the LOAO and adaptive evaluations and collect the scores into one CSV.
# Usage: ./run_all_scores.sh [output.csv]
set -e
cd "$(dirname "$0")"

# Use the project venv if it exists, so the run does not depend on whatever
# `python` happens to be on PATH. Create it with:
#   python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
PY=.venv/bin/python
[ -x "$PY" ] || PY=python

CSV="${1:-model_output/all_scores.csv}"
LOG=model_output/run_all_scores.log

mkdir -p model_output
echo "condition,agent,form,score" > "$CSV"
: > "$LOG"

# Run score_logs.py, pull the difference score off its summary line, add a CSV row.
# The line looks like:  comet: difference score = 0.885 (std 0.332)
score() {
  local condition=$1 agent=$2 form=$3 folder=$4 label=$5

  echo "[$condition] $agent / $form"
  if [ ! -d "$folder" ]; then
    echo "  no logs at $folder, skipping"
    return
  fi

  local out
  out=$($PY score_logs.py "$folder" --form "$form" --label "$label")
  echo "$out" >> "$LOG"

  if echo "$out" | grep -q "was in the training set"; then
    echo "  WARNING: $label was in the training set, score is in-sample"
  fi

  local score
  score=$(echo "$out" | grep "difference score" | tail -1 | sed 's/.*= \([0-9.]*\).*/\1/')
  echo "  score = $score"
  echo "$condition,$agent,$form,$score" >> "$CSV"
}

# ---------------------------------------------------------------------------
# Part 1: leave-one-agent-out. Retrain with the agent held out, then score it.
# Each retrain overwrites the model files, so the pairs have to stay in order.
# ---------------------------------------------------------------------------
echo "=== LOAO ==="

loao() {
  local agent=$1 folder=$2   # folder name in logs/, may differ from the figure label
  echo "retraining without $folder"
  $PY train_model.py --exclude-agent "$folder" >> "$LOG" 2>&1

  score loao "$agent" simpleForm  "logs/simpleForm/$folder"  "$folder"
  score loao "$agent" dynamicForm "logs/dynamicForm/$folder" "$folder"
}

loao Comet  comet
loao Nova   nova
loao Manus  manus                # dynamicForm/manus has no interaction log
loao Claude claude
loao MCP    chrome-devtools-mcp

# ---------------------------------------------------------------------------
# Part 2: adaptive. These logs were never in training, so score them against
# the full model. Labels get an _adaptive suffix so they do not look in-sample.
# ---------------------------------------------------------------------------
echo "=== adaptive ==="
echo "retraining on the full corpus"
$PY train_model.py >> "$LOG" 2>&1

adaptive() {
  local agent=$1 folder=$2      # folder name under logs/adaptive/
  score adaptive "$agent" simpleForm  "logs/adaptive/simple/$folder"  "${folder}_adaptive"
  score adaptive "$agent" dynamicForm "logs/adaptive/dynamic/$folder" "${folder}_adaptive"
}

adaptive Comet  comet
adaptive Nova   nova             # simple only
adaptive Manus  manus            # simple only
adaptive Claude claude
adaptive MCP    devtools

echo
echo "wrote $CSV"
echo "full output in $LOG"
column -s, -t < "$CSV"
