"""Shared feature extraction for the form-interaction detector.

run the two Node extractors over a log folder, join tracker sessions 
to interaction sessions by start time, and emit the model's feature frame.
"""
import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent

# Folders that represent the HUMAN baseline (everything else is an agent).
# Only human_all counts, and only the copy inside the form being loaded.
HUMAN_DIRS = {"human_all"}

# Human folders that are NOT the baseline are dropped rather than treated as
# agents: dynamicForm/human overlaps its human_all (3 of its 6 sessions), so
# keeping it would put the same session in training under both labels.
IGNORE_DIRS = {"human"}

# (form, agent) pairs to drop entirely, e.g. agents with no usable interaction log.
EXCLUDE = {}

FEATURES = [
    "reactionMean", "reactionMin", "reactionMax", "reactionMedian",
    "dwellTimeMean", "dwellTimeStdev",
    "keypresses",
    "mouseMoves", "mouseClicks",
    "durationMs",
    "has_dwell", "has_keypress",
]

# Filenames are not consistent across collection runs; accept either convention.
TRACKER_NAMES = ["tracker-log.jsonl", "tracker-pledge-form.jsonl"]
INTERACTION_NAMES = ["interaction-log.jsonl", "pledge-form-interactions.jsonl"]


def _find(folder, names):
    """First existing file in `folder` matching one of `names`, else any glob hit."""
    for n in names:
        p = folder / n
        if p.exists():
            return p
    for pattern in ("*tracker*.jsonl",) if names is TRACKER_NAMES else ("*interaction*.jsonl",):
        hits = sorted(folder.glob(pattern))
        if hits:
            return hits[0]
    return None


def run_extractor(script, path):
    """Run a node extractor and parse its JSONL stdout into a list of dicts."""
    if path is None or not path.exists():
        return []
    out = subprocess.run(["node", str(BASE / script), str(path)],
                         capture_output=True, text=True)
    if out.returncode != 0 and out.stderr.strip():
        print(f"  warn {script} on {path}: {out.stderr.strip()[:200]}")
    return [json.loads(l) for l in out.stdout.splitlines() if l.strip()]


def nearest_join(tracker_rows, inter_rows, tol_ms=8000):
    """Greedy nearest-startTime match between tracker and interaction sessions."""
    inter = sorted([r for r in inter_rows if r.get("startTime")], key=lambda r: r["startTime"])
    used = set()
    for tr in sorted(tracker_rows, key=lambda r: r.get("startTime") or 0):
        ts = tr.get("startTime")
        best, best_d, best_i = None, None, None
        for i, ir in enumerate(inter):
            if i in used:
                continue
            d = abs(ir["startTime"] - (ts or 0))
            if best_d is None or d < best_d:
                best, best_d, best_i = ir, d, i
        if best is not None and ts is not None and best_d <= tol_ms:
            used.add(best_i)
            for k in ("reactionMin", "reactionMax", "reactionMean",
                      "reactionMedian", "reactionCount"):
                tr[k] = best.get(k)
            tr["matched_interaction"] = True
        else:
            tr["matched_interaction"] = False
    return tracker_rows


def load_folder(folder, form=None, agent=None, is_human=False):
    """Extract + join one agent folder into a list of session dicts."""
    folder = Path(folder)
    tracker = run_extractor("extract_tracker.js", _find(folder, TRACKER_NAMES))
    inter = run_extractor("extract_interaction.js", _find(folder, INTERACTION_NAMES))
    rows = nearest_join(tracker, inter)
    for r in rows:
        r["form"] = form if form is not None else folder.parent.name
        r["agent"] = agent if agent is not None else folder.name
        r["is_human"] = is_human
    return rows


def load_corpus(logs_dir, forms=("simpleForm", "dynamicForm"), skip_agents=()):
    """Walk logs/<form>/<agent>/ and build the full session frame."""
    logs_dir = Path(logs_dir)
    records = []
    for form_dir in sorted(logs_dir.iterdir()):
        if not form_dir.is_dir() or (forms and form_dir.name not in forms):
            continue
        for agent_dir in sorted(form_dir.iterdir()):
            if not agent_dir.is_dir():
                continue
            form, agent = form_dir.name, agent_dir.name
            if (form, agent) in EXCLUDE or agent in skip_agents or agent in IGNORE_DIRS:
                print(f"excluding {form}/{agent}")
                continue
            records += load_folder(agent_dir, form, agent, agent in HUMAN_DIRS)
    return add_features(pd.DataFrame(records))


def add_features(df):
    """Reaction-time fallback + missingness flags. Safe on an empty frame."""
    if df.empty:
        return df
    for col, alt in [("reactionMean", "trackerReactionMean"),
                     ("reactionMin", "trackerReactionMin"),
                     ("reactionMax", "trackerReactionMax"),
                     ("reactionMedian", "trackerReactionMedian")]:
        if col not in df:
            df[col] = np.nan
        if alt in df:
            df[col] = df[col].fillna(df[alt])
    df["has_dwell"] = df["dwellTimeMean"].notna().astype(int)
    df["has_keypress"] = df["keypressMean"].notna().astype(int)
    return df


def drop_stray(df, verbose=True):
    """Drop tracker sessions that never reached the form (no reveals, no join).

    These are browser-open/idle artifacts, not form-fill attempts.
    """
    if df.empty:
        return df
    stray = (df.get("fieldsRevealed", 0) == 0) & (~df.get("matched_interaction", False))
    if verbose and stray.any():
        print(f"dropping {int(stray.sum())} stray session(s) with no form activity: "
              f"{df.loc[stray, 'sessionId'].tolist()}")
    return df[~stray].reset_index(drop=True)
