"""Compute Cohen's Kappa between two raters' verdict labels.

Reads three verdict CSVs (each with columns:
Sheet, Agent, Run, Moiz, Nafis), reports kappa per dataset
and pooled across all three. Only rows where BOTH raters gave a real verdict
count; blanks and "-" (not-applicable / not-run) are excluded.

Run:  python cohens_kappa.py
"""

import pandas as pd
from sklearn.metrics import cohen_kappa_score, confusion_matrix

CSVS = {
    "Repetition":           "verdicts_repetition.csv",
    "Content Modification": "verdicts_content_modification.csv",
    "OCR":                  "verdicts_ocr.csv",
}

NON_LABELS = {"", "-"}  # values that are NOT real verdicts


def load(path, dataset):
    df = pd.read_csv(path, keep_default_na=False)  # treat blanks as ""
    df["Dataset"] = dataset
    return df


def score(df, name):
    both = df[(~df["Moiz"].isin(NON_LABELS)) &
              (~df["Nafis"].isin(NON_LABELS))]
    r1, r2 = both["Moiz"], both["Nafis"]
    kappa = cohen_kappa_score(r1, r2)
    agreement = (r1 == r2).mean()
    print(f"\n=== {name} ===")
    print(f"Total rows:            {len(df)}")
    print(f"Rows labeled by both:  {len(both)}")
    print(f"Raw percent agreement: {agreement:.4f}")
    print(f"Cohen's Kappa:         {kappa:.4f}")
    return both


# per-dataset
all_both = []
for name, path in CSVS.items():
    df = load(path, name)
    all_both.append(score(df, name))

# pooled across all three
pooled = pd.concat(all_both, ignore_index=True)
r1, r2 = pooled["Moiz"], pooled["Nafis"]
kappa = cohen_kappa_score(r1, r2)
agreement = (r1 == r2).mean()

print("\n=== POOLED (all datasets) ===")
print(f"Rows labeled by both:  {len(pooled)}")
print(f"Raw percent agreement: {agreement:.4f}")
print(f"Cohen's Kappa:         {kappa:.4f}")

labels = sorted(set(r1) | set(r2))
print("\nConfusion matrix (rows = Moiz, cols = Nafis):")
print("labels:", labels)
print(pd.DataFrame(confusion_matrix(r1, r2, labels=labels),
                   index=labels, columns=labels))
