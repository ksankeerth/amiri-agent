# Deploy Austin Tech Bank in your own Google Cloud project

A checklist for a developer new to this deployment. You deploy the US demo bank into **your own** project, with
**your own** keys. The long guide is [`infra/SETUP.md`](../../infra/SETUP.md). This page lists what is
different for the US bank. Run everything from the repository root.

Never paste a secret into a chat, an issue or a file. `infra/scripts/secrets.sh` asks for them in your terminal.

## 1. ⚠ Getting the code

The branch `global-support` is local on the team lead's machine. **It has never been pushed.** Pushing is the
team lead's call. **Neither option below has been done yet.** Ask the team lead which one, and for the commit to
deploy.

- [ ] **Option (a): push to `origin`, with a tag.** The lead runs:
  ```bash
  git tag us-demo-1 <commit>
  git push origin global-support us-demo-1
  ```
  You then run `git clone <origin-url> amiri-agent && cd amiri-agent && git checkout us-demo-1`.
- [ ] **Option (b): a `git bundle` file, handed to you directly.** The lead runs:
  ```bash
  git bundle create us-demo-1.bundle global-support
  git bundle verify us-demo-1.bundle
  ```
  You run:
  ```bash
  git clone -b global-support us-demo-1.bundle amiri-agent && cd amiri-agent
  git checkout <commit>
  ```
- [ ] Check `git rev-parse --short HEAD` prints the `<commit>` you were given. `build.sh` tags the images with
      it, and adds `-dirty` if you changed files, so keep the tree clean.

## 2. Region and models

- [ ] **Pick a US region**, for example `us-central1`. It is the terraform variable `region` in
      `infra/terraform/terraform.tfvars` (it sets Cloud Run, Cloud SQL, Artifact Registry and Cloud Scheduler):
  ```
  region = "us-central1"
  ```
  Use the same region in `gcloud config set run/region us-central1` (SETUP.md step 2).
- [ ] **What `run.tf` does about the model location:** it sets `GOOGLE_CLOUD_LOCATION = "global"` for all four
      agents, fixed in `infra/terraform/run.tf`, not from `region`. So Gemini is called at the `global`
      location, whatever Cloud Run region you choose. There is no variable to change it.
- [ ] **Check each model is available at `global` in your project before you rely on it.** These are the
      defaults in the agents' `app/settings.py`:

  | Agent | Setting | Models |
  |---|---|---|
  | investigation, setup (also its router), radar, monitor | `AGENT_MODELS`, `ROUTER_MODELS`, `SEARCH_MODELS` | `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` |
  | monitor | `REVIEWER_MODELS` | `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite` |

  Each list is tried in order, so a missing model is skipped, not fatal. A missing first reviewer changes who
  reviews findings.
  How to check (you run it; a test call costs a fraction of a cent):
  - the Vertex AI **Model Garden** page in your console: search the model id; or
  - one test call, after `deploy.sh base` has enabled the APIs (repeat per id):
    ```bash
    curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
      "https://aiplatform.googleapis.com/v1/projects/<project-id>/locations/global/publishers/google/models/<model-id>:generateContent" \
      -d '{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}'
    ```
    A reply with `candidates` works. A `404` or "not found" means the model is not available to you.

## 3. Settings in `terraform.tfvars`

Copy `infra/terraform/terraform.tfvars.example` to `terraform.tfvars` (git ignores it) and fill in
`project_id`, `region`, `operator_email`, `recaptcha_site_key`. Then these:

- [ ] **`SUPPORTED_REGION=japac,us`.** The server default is `japac`, which refuses a US home country. The
      setting takes a comma list, so one deployment accepts both a Sri Lankan and a US bank (one at a time:
      a deployment holds one institution). `run.tf` has no variable of its own for it. But `server_env` in
      `variables.tf` is merged into the server's settings, so this works:
  ```
  server_env = { SUPPORTED_REGION = "japac,us" }
  ```
  `us` alone also works, and refuses a Sri Lankan home country. An empty value means the default (`japac`),
  not "anywhere". An id `regions.json` doesn't have is ignored, with a warning in the server's log.
  **Changing it later** is a Cloud Run revision update, not a full deploy: edit `server_env`, run
  `infra/scripts/deploy.sh`, and the plan shows one change, the server's environment. Applying it makes a new
  server revision in about a minute. There is no rebuild (`build.sh` is not needed) and the database is
  untouched. Do not use `gcloud run services update ... --update-env-vars` instead: Terraform would revert it
  on the next `deploy.sh`.
- [ ] **`INSTITUTION_ID`.** Terraform's variable is `institution_id`, default `serendib-bank`. Set:
  ```
  institution_id = "austin-tech-bank"
  ```
  `load_bundle.py` imports the profile under whatever id the server has (it reads `/api/v1/installation`), so
  the load works with any id. Matching the bundle's own id keeps the demo tidy.
- [ ] **`server_min_instances`** (default `0`). `0`: the server stops when idle, and the first visit after a
      quiet spell waits a few seconds. `1`: no wait, but one instance always on, roughly USD 10 or more a month.
      Leave `0`, unless people review the demo live.
- [ ] **The tick** is Cloud Scheduler `amiri-tick`, every 15 minutes (fixed in `run.tf`). Leave it.
- [ ] **Radar's daily slot:** leave `radar_every_minutes = 1440` and `radar_run_at = "06:00"`. `radar_run_at`
      is read in the bank's time zone, and the bundle sets `America/Chicago`. So `06:00` is already Austin time.
- [ ] While you load the bank, keep `prototype_reset = true` (the example has it). It lets you reset to
      empty and retry. Set it `false` afterwards if the URL is public.

## 4. Quotas

- [ ] **On day one, request higher Gemini (Vertex AI) quotas.** A new project starts low. The first
      *Check now* can fail with `429`. In the console, open IAM & Admin → Quotas, filter on the Vertex AI API and the
      models in section 2, and ask for an increase. Approval can take a while, so do it before the first load.

## 5. Spending

- [ ] **Budget alert.** Terraform makes it (`google_billing_budget.budget`, `infra/terraform/main.tf`) from
      two variables. It emails at 50%, 90% and 100%:
  ```
  billing_account_id = "<ACCOUNT_ID>"   # gcloud billing accounts list
  budget_amount      = 20               # your billing currency
  ```
- [ ] **BigQuery caps: leave them at their defaults.** Radar reads the public GDELT data in BigQuery. A run
      reads 0.75–1.35 GB (measured on 18–19 Nov; the most when its 24 hours span two whole UTC days). Expect
      about 5–6 GB a day (the daily run plus a few Check nows; at most 5 a day). That is inside the free 1 TiB a
      month per billing account. The settings:

  | Cap | Setting | Default |
  |---|---|---|
  | One query | `RADAR_MAX_BYTES_PER_QUERY` (server) and `BQ_MAX_BYTES_PER_QUERY` (radar agent) | 1.5 GB |
  | A day (UTC) | `RADAR_DAILY_BYTES_CAP` (server; terraform `radar_daily_bytes_cap`) and `BQ_DAILY_BYTES` (agent) | 20 GB |
  | A month | `BQ_MONTHLY_BYTES` (radar agent) | 600 GB |
  | Rows returned | `BQ_ROW_LIMIT` (agent) | 10,000 |
- [ ] **Check now:** leave `RADAR_RUN_NOW_PER_DAY` at 5 (terraform `radar_run_now_per_day`).
- [ ] **Monitors:** leave `MONITORS_LIVE_MAX` at 10 (there is no terraform variable; `server_env` could set it).
      The bank has 7 live monitors. A monitor is checked at most hourly (`MONITOR_MIN_FREQUENCY_MINUTES`, 60).

## 6. Deploy, step by step

Follow [`infra/SETUP.md`](../../infra/SETUP.md) in order. Your own project, your own keys.

- [ ] **1. Tools:** `gcloud`, Terraform 1.6+, `gcloud auth login`, `gcloud auth application-default login`.
- [ ] **2. Project and billing:** make a project, link billing, set the quota project and `run/region`.
- [ ] **3. Server address:** `gcloud projects describe <project-id> --format='value(projectNumber)'` gives the
      hostname `amiri-server-<project-number>.<region>.run.app`.
- [ ] **4. Keys:** a reCAPTCHA v2 checkbox key for that hostname, and **your own** Twelve Data key (free
      plan; its 800 calls a day are shared by everything on the key).
- [ ] **5. Settings:** fill `terraform.tfvars` with sections 2, 3 and 5 above.
- [ ] **6. `infra/scripts/bootstrap.sh`** (state bucket), then **`infra/scripts/deploy.sh base`** (about 10 minutes).
- [ ] **7. `infra/scripts/secrets.sh`** (asks for the reCAPTCHA secret and the Twelve Data key; makes the rest). Run
      the checks SETUP.md lists.
- [ ] **8. `infra/scripts/build.sh`** (Cloud Build makes the five images, 5–10 minutes).
- [ ] **9. `infra/scripts/deploy.sh`** (the five services and the tick).
- [ ] **10. Check:** `curl -s $URL/health`, and `curl -s $URL/api/v1/auth/config` shows `"asleep": false`.
      Open `$URL` in a browser (exactly this URL), tick the box. The app opens empty. Do not set up an
      institution by hand: section 7 does it.

## 7. Load the bank

The platform must be **empty** (no institution). A fresh deployment is. The script refuses otherwise.

- [ ] **Let the script's calls through: the login window.** With `auth_mode = "prototype"` (the default),
      every `/api/` call needs the browser cookie from the reCAPTCHA box, or a Google ID token.
      `demo/load_bundle.py` sends only an `X-Amiri-Actor` header, so against a public URL it gets
      `401 signed_out`. The team lead's decision: switch login off briefly, load, and switch it straight back on.
      While it is `off` the URL has no bot check at all, so do not share it, and keep the window short.
      Write the time down at each step:

  | Step | Time (UTC) |
  |---|---|
  | 1. In `terraform.tfvars` set `auth_mode = "off"`, then `infra/scripts/deploy.sh` and apply (a server revision, about a minute). `curl -s $URL/api/v1/auth/config` shows `"mode": "off"`. **Login is open from here.** |  |
  | 2. Look first, writes nothing: `python3 demo/load_bundle.py --file demo/austin-tech-bank/bundle.json --base-url $URL --actor John --plan` |  |
  | 3. Load it: the same command without `--plan` (below) |  |
  | 4. Set `auth_mode = "prototype"` again, then `deploy.sh` and apply |  |
  | 5. **Confirm the app asks for login again:** `curl -s $URL/api/v1/auth/config` shows `"mode": "prototype"`, `curl -s -o /dev/null -w '%{http_code}\n' $URL/api/v1/installation` prints `401`, and a private browser window on `$URL` shows the reCAPTCHA box. **Login is closed from here.** |  |
  | **How long it was open (step 1 to step 5)** |  |

- [ ] **The load (step 3).** Without `--skip-after-load` it also starts **one Radar run** and **one check of
      each of the 7 live monitors**. Those call Gemini, BigQuery and web search, so they cost a little. Use
      `--skip-after-load` to load without them, and keep the window shorter. A second person to approve is
      optional: add `--approver Maya`.
- [ ] Expect `Loaded: institution_id austin-tech-bank, series_added 4, monitors 7, monitors_live 7`.
      If a step fails, it stops and lists what it wrote. Reset the prototype to "empty" in the app (it needs
      `prototype_reset = true`) and run it again, still inside the window. If you have to stop, close the
      window first (steps 4 and 5) and open it again later.
- [ ] Open question: do QQQ, UNG, USO and IEF work on the free Twelve Data plan? Add them (the load does) and
      press Refresh on Market series. If a series stays `pending`, tell the team lead.

## 8. The first day

- [ ] Press **Check now** once on the Radar page (one of the day's 5).
- [ ] The tick (every 15 minutes) then checks the monitors. Do not press anything else.
- [ ] Keep a log of each warning. Copy this table and fill it in:

  | Time (UTC) | Source (Radar / monitor name / series) | Title | Product or team named |
  |---|---|---|---|
  |  |  |  |  |

## 9. Time it

The pitch may quote the real number. Write the time down at each point:

| Point | Time (UTC) |
|---|---|
| First command (`bootstrap.sh`) |  |
| `deploy.sh base` done |  |
| `build.sh` done |  |
| `deploy.sh` done, `/health` ok |  |
| Load finished |  |
| First Radar run finished |  |
| **First command to first Radar run** |  |

## 10. Expected cost

About **USD 3–6 a day**: the database (the main cost), Cloud Run, Gemini and web search. BigQuery stays inside
the free tier (section 5). Look at Billing → Reports for the project after 24 hours.

## 11. If Radar relevance still fails

The D4 acceptance check (Radar's US shortlist on topic) failed on 18 Nov: about 15 of 30 on topic (the pass
mark is 20) and 2 political titles. After the US recall was tightened, the 19 Nov run passed: 25 of 30 on topic,
none political, 3 stories sent. If your first runs look noisy again, tell the team lead, and **deploy anyway**:
the lead story (tech layoffs → Austin mortgages) arrives through the monitors "Tech layoffs at our customers'
employers" and "Austin housing and mortgage stress". They use web search and do not depend on Radar's recall.

## 11a. Known limits of the US pack

Recorded, not fixed. The US pack is tuned for **Texas and Silicon Valley**: its aliases, outlets and stations
are those places'. A nationwide US bank, or a bank in a state with short names or names with a compass word
(Ohio, Iowa, North Carolina), gets little home news by name: the pack has no aliases or outlets for them, and a
part-covered state counts only through its aliases. Its Radar shortlist then leans on the national wires and the
monitors. Tell the team lead before you demo such a bank.

## 12. Pause or roll back

- [ ] **Pause when nobody needs it:** `infra/scripts/awake.sh off`. It stops the database and pauses the tick.
      The app opens and says "paused". Storage, backups and the IP are still charged. Say yes to the plan it shows.
- [ ] **Back on:** `infra/scripts/awake.sh on` (the database takes a few minutes; nothing is lost).
- [ ] **Undo only the load:** reset the prototype to "empty" in the app, then load again.
- [ ] **Take it all down:** `infra/README.md` §5 (`protect_database = false`, `deploy.sh`, `terraform destroy`),
      or delete the project.
