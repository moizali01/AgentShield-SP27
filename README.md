# AgentShield — Artifacts

Code, test sites, prompts, logs, and results for the paper *AgentShield: Fortifying Web
Applications Against AI Agents and Agentic Browsers*.

Each experiment has its own folder containing the code/assets used to run it and an
Excel sheet with the detailed per-run outputs of every tool. The master log combining
all experiments is in `data/AgentShield_Experiment_Log_Final.xlsx`.

## Repository Layout

| Folder | Paper section | Contents |
|---|---|---|
| `ExistingDefenses/` | §3.1, §4.1 | Results for network, environment-validation, and identity defenses |
| `TestSite/` | §3.2 | Express server hosting the dynamic/simple forms, telemetry tracker, and CAPTCHA pages |
| `FormInteraction/` | §3.2, §4.2 | Raw behavioral logs per tool + analysis scripts + results |
| `ContentModification/` | §3.3, §4.3 | Hidden prompt texts, concealment CSS, and results |
| `Crawl4AI/` | §3.3 | Web-scraper client scripts used in the content-modification experiment |
| `EPD/` | §3.4, §4.4 | Express server for the frozen-checkout e-commerce site + results |
| `data/` | — | Master experiment log (all sheets) and dual-request detection dataset |

## Setup Packages

The three experiments are also packaged as installable instruments that deploy
the same measurement onto an arbitrary site. They are maintained in separate
repositories.

| Experiment | Package | Repository |
|---|---|---|
| Form interaction (§3.2) | `panda-forms` | https://github.com/moizali01/dynamic-forms-npm | 
| Content modification (§3.3) | TODO | TODO: repository URL | 
| EPD (§3.4) | `eipd` | https://github.com/moizali01/eipd-npm | 

Each is an npm package that can be added to any website.

## Existing Defenses (`ExistingDefenses/`)

Per-agent verdicts for the defenses surveyed in §4.1 (IP type, Cloudflare Crawl
Control / AI Bot Blocking, JA4 dual-request, reCAPTCHA v3, Turnstile) are in
`ExistingDefenses_Results.xlsx` (sheets *Network Defenses* and *Env. Validation
Defenses*). The CAPTCHA test pages themselves live in `TestSite/captcha-tests/`,
and the dual-request dataset is `data/dual-req.csv`.

## Test Site (`TestSite/`)

Express server that serves the forms and CAPTCHA pages.

```bash
cd TestSite
npm install express cors axios body-parser dotenv
node server.js          # listens on port 5001 (override with PORT)
```

Routes:

- `/` — index linking to all test pages
- `/dynamic-form` — the standard dynamic form (with dropdowns)
- `/pledge-form` — the simplified variant (no dropdowns)
- `/captchav3`, `/turnstile` — reCAPTCHA v3 and Cloudflare Turnstile pages
- `/log-interaction`, `/tracker_endpoint` — telemetry endpoints written by `tracker.js`

CAPTCHA server-side verification needs keys in `TestSite/.env` (the forms work
without them):

```bash
PORT=5001
RECAPTCHA_SECRET_KEY=your_recaptcha_v3_secret_key
CLOUDFLARE_SECRET_KEY=your_turnstile_secret_key
```

`tracker.js` is the client-side script injected into the form pages; it records
keystrokes (keydown/keyup), mouse movement/clicks, and field-reveal timestamps via a
MutationObserver.

## Form Interaction (`FormInteraction/`)

Behavioral telemetry collected from each tool on the two form variants.

- `logs/<task>/<tool>/` — raw JSONL logs per tool (`comet`, `claude`, `nova`,
  `manus`, `director`, `atlas` / `chatgpt_atlas`, `chrome-devtools-mcp`,
  `chrome_autofill`, `human`), where `<task>` is `simpleForm` or `dynamicForm`.
  Each tool has an `interaction-log.jsonl` (field reveals/interactions) and a
  `tracker-log.jsonl` (keyboard/mouse events). Not every tool appears under both
  tasks: `director` and `manus` are present only under `simpleForm`.
- `logs/adaptive/<simple|dynamic>/<tool>/` — logs for the adaptive runs, where the
  agent was prompted to imitate human typing and mouse behavior. The tracker/interaction files are
  `tracker-pledge-form.jsonl` / `pledge-form-interactions.jsonl` on the simple form
  and `tracker-dynamic-form.jsonl` / `dynamic-form-interactions.jsonl` on the
  dynamic one. Only `comet`,
  `claude`, and `devtools` were collected on the dynamic form.
- `dynamic_form_prompt.txt` — the exact task prompt given to every agent
  (Appendix A.1 of the paper).
- `dynamic_form_prompt_adaptive.txt` — the exact task prompt given to every agent for the adaptive attacker experiment.
- `FormInteraction_Results.xlsx` — aggregated metrics (sheets *Dynamic Form* and
  *Simplified Dynamic Form*).

Analysis scripts (run from inside `FormInteraction/`):

```bash
# Reaction-time metrics (min, max, mean, median) per session
node analyze_interaction.js logs/dynamicForm/comet/interaction-log.jsonl

# Keyboard/mouse metrics (dwell time, movements, keypresses, clicks) per session
node analyze_tracker.js logs/simpleForm/comet/tracker-log.jsonl
```

Swap the log path to target a different tool or task.

### Classifier (§4.2, Figure 2)

Turns the signals above into a single per-form difference score (0.0 = human,
1.0 = fully automated). One logistic-regression model per form, trained on the
standard logs with `human_all` as the human class.

- `formfeatures.py` — feature extraction: runs the two Node extractors and joins
  tracker sessions to interaction sessions by start time.
- `train_model.py` — fits one model per form, saves it to `model_output/`.
- `score_logs.py` — scores a log folder against a saved model.
- `run_all_scores.sh` — runs every condition in Figure 2.

```bash
cd FormInteraction
python train_model.py                              # both forms, writes model_output/
python score_logs.py logs/adaptive/simple/comet --form simpleForm --label comet_adaptive
./run_all_scores.sh                                # everything -> model_output/all_scores.csv
```

`run_all_scores.sh` produces both halves of Figure 2: the leave-one-agent-out half
retrains with each agent held out and scores that agent, and the adaptive half
scores the `logs/adaptive/` runs against the full model. Results go to
`model_output/all_scores.csv`, full output to `model_output/run_all_scores.log`.
Both halves retrain in place, so the script's order matters; it ends with a
full-corpus retrain. The human baselines in Figure 2 are the K-fold results over `human_all`.


## Content Modification (`ContentModification/`)

Assets for the hidden-prompt injection experiment on the WordPress test site.

- `prompts/` — the injected prompt text, one file per category: `defensive.txt`,
  `hidden_promotion.txt`, `opposite_information.txt`, `additional_informaton.txt`,
  `abusive.txt`.
- `task_prompts.txt` — the exact task prompts issued to the clients (standard
  summary, product overview, browser assistant, and visual-layer/OCR variants;
  Appendix A.2 of the paper).
- `concealment.css` — the `.zero-text-injection` class that hides injected text from
  human viewers while keeping it in the DOM for agents (DOM-layer concealment).
- `visual_layer_concealment.html` — the canvas script that renders the injected
  prompt as low-opacity pixels, absent from the DOM and accessibility tree
  (visual-layer concealment, reachable only by clients that rasterize the page).
- `Content_Modification_Results.xlsx` — per-run verdicts (Worked/Partial/Failed) for
  all 13 clients across the five categories, one sheet per category plus a
  *Summary Matrix*.
- `Repetition_Results.xlsx` — the repetition variant (defensive prompt embedded
  N ∈ {1, 3, 5, 7} times), one sheet per repetition level.
- `AgentShield_OCR_Experiment_Log.xlsx` — per-run results for the visual-layer (OCR)
  injection experiment using the Additional Information payload (sheets *OCR
  Additional Information* and *OCR Summary Matrix*).

## Crawl4AI (`Crawl4AI/`)

The two scraper scripts used as the Web Scraper client (both read `GEMINI_API_KEY`
from the environment):

```bash
python Crawl4AI/product_crawler.py   # structured product data: name, price, features, rating
python Crawl4AI/article_crawler.py   # article extraction/summarization
```

## Extinction-Induced Policy Drift (`EPD/`)

Express server hosting the mock e-commerce checkout flow (product → buy → payment)
with the frozen checkout button and concealed fallback instruction. The `/track`
endpoint logs checkout clicks, hidden-instruction executions, and hallucinated URLs.

```bash
cd EPD
npm install
node server.js          # listens on http://127.0.0.1:3009
```

`prompt.txt` contains the agent task prompt and the concealed fallback instruction
embedded in the product page (Appendix A.3 of the paper).

Per-run behavioral footprints (hidden-instruction execution, timeout compliance,
user solicitation, retries, URL hallucination, abortion, timing) are in
`EPD_Results.xlsx` (sheet *EPD*).

## Data (`data/`)

- `AgentShield_Experiment_Log_Final.xlsx` — master log of all experiments, one sheet
  per experiment, including the exact response from each run of each tool. The
  per-experiment Excel files above are subsets of this log.
- `dual-req.csv` — correlated Zeek TLS handshakes and nginx requests used to detect
  the dual-request pattern (§3.1).

All IP addresses and domain names in the data are redacted or replaced with
`example.com` for anonymity.
