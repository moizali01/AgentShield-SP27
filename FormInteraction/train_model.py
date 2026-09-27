#!/usr/bin/env python3
"""Fit the humanness detector on the original log corpus and save it to disk.

One model per form. The saved bundle carries the fitted pipeline, the feature
list, and the training medians used for imputation, so scoring new logs later
uses exactly the training-time statistics (no leakage from the test data).

Usage:
    python train_model.py                          # all forms, default paths
    python train_model.py --form simpleForm
    python train_model.py --exclude-agent comet_adaptive
    python train_model.py --human-baseline             # + Figure 2 dashed line
"""
import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import KFold, StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import formfeatures as ff

BASE = Path(__file__).resolve().parent


def build_pipe():
    return Pipeline([
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)),
    ])


def human_baseline(df, form, n_splits=5):
    """Out-of-fold difference score for the human sessions (the model's FP rate).

    Humans are a single group, so they cannot be held out the way an agent is in
    the leave-one-agent-out runs. Instead K-fold the human sessions: hold out a
    slice, keep every agent plus the remaining humans in train, and predict the
    held-out humans. Their mean P(non-human) is the human baseline plotted as the
    dashed line in Figure 2.

    Each fold refits from scratch and imputes with that fold's training medians,
    so no held-out session influences the model that scores it.

    Also reports every human session's own out-of-fold score, worst first, so the
    highest false positive is visible rather than hidden behind the mean.
    """
    sub = df[df["form"] == form].reset_index(drop=True)
    if sub.empty:
        return None

    feats = [f for f in ff.FEATURES if f in sub.columns]
    X = sub[feats].copy()
    y = sub["is_human"].map({True: 0, False: 1}).astype(int).values   # 1 = agent

    human_idx = np.where(sub["is_human"].values)[0]
    if len(human_idx) < 2:
        print(f"{form}: need at least 2 human sessions for the baseline, got {len(human_idx)}")
        return None

    k = max(2, min(n_splits, len(human_idx)))
    rows = []
    for _, test in KFold(n_splits=k, shuffle=True, random_state=0).split(human_idx):
        test_rows = human_idx[test]
        train = np.ones(len(sub), bool)
        train[test_rows] = False
        med = X[train].median(numeric_only=True)
        pipe = build_pipe()
        pipe.fit(X[train].fillna(med), y[train])
        p = pipe.predict_proba(X.iloc[test_rows].fillna(med))[:, 1]
        for r, score in zip(test_rows, p):
            rows.append({"sessionId": sub.iloc[r].get("sessionId", r), "score": score})

    scores = pd.DataFrame(rows).sort_values("score", ascending=False).reset_index(drop=True)
    worst = scores.iloc[0]

    print(f"\n{form} human baseline ({k}-fold over {len(human_idx)} human sessions): "
          f"{scores['score'].mean():.3f}  (std {scores['score'].std():.3f})")
    print(f"  highest-scoring human session: {worst['score']:.3f}  ({worst['sessionId']})")
    print("  all human sessions, most bot-like first:")
    for _, r in scores.iterrows():
        print(f"    {r['score']:.3f}  {r['sessionId']}")
    return float(scores["score"].mean())


def train_form(df, form, out_dir):
    sub = df[df["form"] == form].copy()
    if sub.empty:
        print(f"no sessions for {form}, skipping")
        return None

    feats = [f for f in ff.FEATURES if f in sub.columns]
    X = sub[feats].copy()
    medians = X.median(numeric_only=True)     # training medians, saved with the model
    X = X.fillna(medians)
    y = sub["is_human"].map({True: 0, False: 1}).astype(int)   # 1 = agent, 0 = human

    n_human, n_agent = int((y == 0).sum()), int((y == 1).sum())
    print(f"\n=== {form} ===  {len(sub)} sessions | agent(1): {n_agent}  human(0): {n_human}")
    print(f"agents: {', '.join(sorted(sub.loc[~sub['is_human'], 'agent'].unique()))}")

    pipe = build_pipe()
    n_splits = max(2, min(5, n_human, n_agent))
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=0)
    auc = cross_val_score(pipe, X, y, cv=cv, scoring="roc_auc")
    print(f"{n_splits}-fold ROC-AUC: {auc.mean():.3f} +/- {auc.std():.3f}")

    pipe.fit(X, y)
    print(f"in-sample AUC: {roc_auc_score(y, pipe.predict_proba(X)[:, 1]):.3f}")

    coefs = (pd.Series(pipe.named_steps["clf"].coef_[0], index=feats, name="coef (std)")
               .sort_values(key=np.abs, ascending=False))
    print("\nstandardised coefficients (+ -> agent-like, - -> human-like):")
    print(coefs.round(3).to_string())

    bundle = {
        "pipeline": pipe,
        "features": feats,
        "medians": medians,
        "form": form,
        "cv_auc": float(auc.mean()),
        "train_agents": sorted(sub.loc[~sub["is_human"], "agent"].unique().tolist()),
        "n_train": len(sub),
    }
    out = out_dir / f"{form}_model.joblib"
    joblib.dump(bundle, out)
    print(f"\nsaved -> {out}")
    return bundle


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--logs", default=BASE / "logs", type=Path,
                    help="root logs directory (default: ./logs)")
    ap.add_argument("--out", default=BASE / "model_output", type=Path,
                    help="where to write the .joblib bundles")
    ap.add_argument("--form", action="append",
                    help="form to train (repeatable; default: simpleForm and dynamicForm)")
    ap.add_argument("--exclude-agent", action="append", default=[],
                    help="agent folder to hold out of training (repeatable)")
    ap.add_argument("--human-baseline", action="store_true",
                    help="also report the out-of-fold human score (Figure 2 dashed line)")
    args = ap.parse_args()

    forms = tuple(args.form) if args.form else ("simpleForm", "dynamicForm")
    args.out.mkdir(parents=True, exist_ok=True)

    df = ff.load_corpus(args.logs, forms=forms, skip_agents=set(args.exclude_agent))
    df = ff.drop_stray(df)
    print(f"\nloaded {len(df)} sessions across {df['agent'].nunique()} agents")

    for form in forms:
        train_form(df, form, args.out)
        if args.human_baseline:
            human_baseline(df, form)


if __name__ == "__main__":
    main()
