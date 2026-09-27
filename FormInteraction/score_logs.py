#!/usr/bin/env python3
"""Score any log folder against a saved detector.

Loads a model trained by train_model.py and reports the difference score
(mean P(non-human)) for the sessions in a log folder it has never seen.

The folder needs a tracker log and an interaction log; either naming convention
works (tracker-log.jsonl / tracker-pledge-form.jsonl, etc.).

Usage:
    python score_logs.py logs/adaptive/simple/comet
    python score_logs.py logs/adaptive/simple/comet --label comet_adaptive
    python score_logs.py logs/adaptive/simple/comet --model model_output/simpleForm_model.joblib
    python score_logs.py logs/adaptive/simple/comet --csv out.csv
"""
import argparse
from pathlib import Path

import joblib
import pandas as pd

import formfeatures as ff

BASE = Path(__file__).resolve().parent


def score_folder(folder, bundle, label=None, keep_stray=False):
    """Extract features from `folder` and score them with a saved bundle."""
    rows = ff.load_folder(folder, form=bundle["form"], agent=label or Path(folder).name)
    df = ff.add_features(pd.DataFrame(rows))
    if df.empty:
        raise SystemExit(f"no sessions extracted from {folder} — check the log filenames")
    if not keep_stray:
        df = ff.drop_stray(df)
    if df.empty:
        raise SystemExit(f"all sessions in {folder} were strays with no form activity")

    feats = bundle["features"]
    missing = [f for f in feats if f not in df.columns]
    for f in missing:
        df[f] = float("nan")
    if missing:
        print(f"warn: features absent from these logs, imputed from training medians: {missing}")

    # Impute with TRAINING medians, not this folder's — keeps the test data honest.
    X = df[feats].fillna(bundle["medians"])
    df["bot_score"] = bundle["pipeline"].predict_proba(X)[:, 1]
    return df



def infer_form(folder, available):
    """Guess which form's model to use from the folder path.

    Looks for a form name in the path components, then falls back to keyword
    hints ('simple'/'dynamic'). Returns None when the path is ambiguous, so the
    caller can require an explicit --form rather than silently guessing wrong.
    """
    parts = [p.lower() for p in Path(folder).resolve().parts]
    for form in available:
        if form.lower() in parts:
            return form
    hints = {"simple": "simpleForm", "dynamic": "dynamicForm"}
    found = {form for key, form in hints.items()
             if any(key in p for p in parts) and form in available}
    if len(found) == 1:
        return found.pop()
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path, help="log folder to score")
    ap.add_argument("--model", type=Path, help="path to a .joblib bundle")
    ap.add_argument("--form", help="which form's model to use when --model is omitted "
                                   "(default: inferred from the folder path)")
    ap.add_argument("--label", help="name for this group in the output (default: folder name)")
    ap.add_argument("--csv", type=Path, help="write per-session scores here")
    ap.add_argument("--keep-stray", action="store_true",
                    help="keep sessions with no form activity (dropped by default)")
    args = ap.parse_args()

    model_dir = BASE / "model_output"
    if args.model:
        model_path, why = args.model, "--model"
    else:
        available = sorted(p.name[:-len("_model.joblib")]
                           for p in model_dir.glob("*_model.joblib"))
        if not available:
            raise SystemExit(f"no models in {model_dir}\nRun: python train_model.py")
        if args.form:
            form, why = args.form, "--form"
        else:
            form, why = infer_form(args.folder, available), "inferred from path"
            if form is None:
                raise SystemExit(
                    f"cannot tell which form '{args.folder}' belongs to.\n"
                    f"Pass --form explicitly. Available: {', '.join(available)}")
        if form not in available:
            raise SystemExit(f"no model for form '{form}'. Available: {', '.join(available)}")
        model_path = model_dir / f"{form}_model.joblib"
    if not model_path.exists():
        raise SystemExit(f"model not found: {model_path}\nRun: python train_model.py")
    bundle = joblib.load(model_path)

    label = args.label or args.folder.name
    print(f"model: {model_path.name}  [{why}]  (form={bundle['form']}, "
          f"trained on {bundle['n_train']} sessions, CV AUC {bundle['cv_auc']:.3f})")
    print(f"train agents: {', '.join(bundle['train_agents'])}")
    if label in bundle["train_agents"]:
        print(f"\n*** WARNING: '{label}' was in the training set — this score is in-sample. ***")
    print(f"\nscoring: {args.folder}\n")

    df = score_folder(args.folder, bundle, label, args.keep_stray)

    show = [c for c in ["sessionId", "reactionMean", "dwellTimeMean",
                        "keypresses", "mouseMoves", "mouseClicks", "durationMs",
                        "has_dwell", "bot_score"] if c in df.columns]
    print(df[show].to_string(index=False))

    mean, std = df["bot_score"].mean(), df["bot_score"].std()
    print(f"\n{'=' * 60}")
    print(f"{label}: difference score = {mean:.3f}"
          + (f" (std {std:.3f})" if len(df) > 1 else f" (n={len(df)})"))
    print(f"{'=' * 60}")
    print("1.0 = looks fully automated, 0.0 = looks human")

    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(args.csv, index=False)
        print(f"\nper-session scores -> {args.csv}")


if __name__ == "__main__":
    main()
