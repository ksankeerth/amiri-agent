# Testing a deployment on Google Cloud

A checklist for a fresh deployment, in priority order. Each step proves one link in the chain, so stop at
the first one that fails: everything after it depends on it. "Where to look" points at the place that usually
explains a failure. The deploy guide is [README.md](README.md); its §3 has the log filters.

```bash
# used below
R=<region>
URL=$(terraform -chdir=infra/terraform output -raw server_url)
agent_url() { gcloud run services describe "amiri-$1" --region "$R" --format='value(status.url)'; }
```

## P0: is it up? (blocking: nothing else works without these)

- [ ] **1. The plan is what you expect** (before applying)
  - Expect: only creates on a first deploy, no destroys. `allUsers` only on `amiri-server`. The database's
    `activation_policy` matches `awake`.
  - Where to look: the plan output from `deploy.sh`. Don't apply a surprise.
- [ ] **2. The images were built**
  - How: `build.sh` ends with SUCCESS, and Artifact Registry shows `server`, `investigation`, `monitor`,
    `setup` and `radar` with the same tag.
  - Where to look: Cloud Build history and its log.
- [ ] **3. All five services are ready**
  - How: `gcloud run services list --region $R`
  - Expect: five services, each ✔ with a serving revision.
  - Where to look: the service's revision logs. "Secret … has no versions" means run `secrets.sh`. A crash
    at startup shows its traceback in Error Reporting.
- [ ] **4. The server answers, and has reached its database**
  - How: `curl -s $URL/health` and `curl -s $URL/api/v1/auth/config`
  - Expect: `{"status":"ok"}`, and `"asleep": false`. The second proves the Cloud SQL socket, the
    `DATABASE_URL` secret and the migrations.
  - Where to look: `asleep: true` means read the server's first WARNING (`amiri.sleep`): a wrong password,
    socket path or database name.
- [ ] **5. The agents are private**
  - How: `curl -s -o /dev/null -w '%{http_code}\n' $(agent_url setup)/health`
  - Expect: `403` (no token, no entry). The same for `investigation` and `monitor`.
  - Where to look: if it says 200, an agent is public: check its IAM.
- [ ] **6. The bot check works on the real URL** (no login)
  - How: open `$URL` in a normal browser window, tick "I'm not a robot".
  - Expect: the app opens straight away, with no button and no code. The log shows `bot check passed`.
    In a private window the check shows again.
  - Where to look: `bot check refused … hostname=…` means the reCAPTCHA key lacks that hostname, or you
    opened a different URL than `server_url`.

## P1: does each connection work? (the parts that only exist in the cloud)

- [ ] **7. The setup chat answers** (server → setup agent → Vertex AI → back to the server)
  - How: on the empty Institution page, write "We're a commercial bank in Sri Lanka".
  - Expect: a reply or a question within about 30 s. The setup agent's log shows `turn … in institution:
    question|proposal …`.
  - Where to look:
    - `assistant_unavailable` or 403: the server lacks `run.invoker` on the agent;
    - `models_unavailable`: the agent's account lacks `aiplatform.user`, or the model isn't available at
      `global`;
    - `server_unavailable` or 401 on its tools: the setup agent's account is missing from `INTERNAL_CALLERS`.
- [ ] **8. Set up the institution, the real first run**
  - How: through the chat, or the forms: create the institution, then add its footprint, two products and
    one risk. Apply the proposals.
  - Expect: the profile fills; History shows "assistant" for the chat's changes.
- [ ] **9. Market series fetch** (the Twelve Data secret)
  - How: on Market series, add USD/LKR, then Refresh.
  - Expect: prices appear; the state goes from `pending` or `warming up` to `normal`.
  - Where to look: `series … fetching from Twelve Data fails` in the server log means a wrong key or a used-up
    daily limit.
- [ ] **10. The tick runs from Cloud Scheduler** (OIDC token, audience, `INTERNAL_CALLERS`)
  - How: `gcloud scheduler jobs run amiri-tick --location $R`
  - Expect: the Scheduler log shows 200. The server log shows one line: `tick … ms: market_series …`.
  - Where to look: 401 means the audience isn't `server_url`, or the scheduler account isn't in
    `INTERNAL_CALLERS`.
- [ ] **11. A monitor check runs in the background** (monitor agent, `cpu_idle = false`)
  - How: draft a monitor from the risk, submit it, approve it, and let a tick (or step 10) start its check.
  - Expect: the check completes within a few minutes. The monitor agent logs `check … finished in … s: N
    findings`. The Monitors page shows the result.
  - Where to look: a check stuck at `running` means the agent stopped mid-run (a restart, or CPU throttled),
    so check `cpu_idle` on its revision. A "quota" error means monitor-check (search grounding) quota on your
    project.
- [ ] **12. An investigation reaches an alert** (investigation agent, its callback to the server)
  - How: on Market series, use *Simulate a move* on USD/LKR (a sandbox finding), then run a tick.
  - Expect: the investigation agent logs `investigation … finished: N events …`, and an event and an alert
    appear.
  - Where to look: 401 on its calls back means the investigation account is missing from `INTERNAL_CALLERS`
    (`DATA_AUTH=id_token`).
- [ ] **13. Radar reads the news** (radar agent, BigQuery, its custom role)
  - How: on the Radar page, *Check now* (one of the day's 5), then run a tick a minute later.
  - Expect: the radar agent logs `bigquery: N rows, 0.9 GB processed` and `radar … finished`; the page shows
    the run's funnel and its stories, and the sent ones appear on Findings.
  - Where to look: "BigQuery's job list couldn't be read" means the agent account is missing the
    `amiriRadarBigQuery` role (`bigquery.jobs.list`); "Access Denied" on the query means `bigquery.jobs.create`.
    The day's bytes are on the Radar page (*Today's reading budget*).
- [ ] **14. A Studio scenario runs, records and replays**
  - How: in the Scenario Studio, run a scenario to the end, then Replay it.
  - Expect: alerts appear during the run; the replay plays without the agents.

## P2: can we operate it? (before anyone else uses it)

- [ ] **15. The switch: asleep and back, nothing lost**
  - How: `infra/scripts/awake.sh off`, open `$URL`, then `infra/scripts/awake.sh on`, wait a few minutes, and
    click *Check again*.
  - Expect:
    - off: the paused page shows, and the Scheduler job is paused;
    - on: the app comes back without a redeploy, with the profile, series and alerts as they were.
- [ ] **16. The logs make a problem easy to find**
  - How: run the "what went wrong in the last day" filter (README §3) after a normal day.
  - Expect: quiet, or only real problems. Open a line → *Show entries for this trace* shows the whole request.
- [ ] **17. No prompt text anywhere**
  - How:
    - in Trace Explorer, open a setup-agent turn and its `call_llm` span;
    - search the logs for words you typed in the chat.
  - Expect: `gcp.vertex.agent.llm_request` is `{}`, and your words aren't in any log.
- [ ] **18. Errors are grouped**
  - How: open Error Reporting.
  - Expect: empty, or each problem listed once. Turn on notifications for new errors.
- [ ] **19. Ship a change**
  - How: change something small, then `build.sh` and `deploy.sh`.
  - Expect: the plan changes only the images. No downtime on the server. The registry keeps at most three
    images per service.
- [ ] **20. Replace a secret**
  - How: `secrets.sh SESSION_SECRET`, then `deploy.sh`.
  - Expect: everyone is signed out; the secret has one active version.
- [ ] **21. Cold start is acceptable**
  - How: after 20 minutes idle, time the first page load, and the first chat turn.
  - Expect: a few seconds for the server. Note the setup agent's first turn. If it's too slow for reviewers,
    consider `min_instance_count = 1` on the server, which has a cost.

## P3: safe and affordable for a public URL

- [ ] **22. Locked down for strangers**
  - How: on `$URL`:
    - `curl -s $URL/api/v1/installation` without a cookie;
    - `curl -s -A GPTBot $URL/`;
    - `curl -s $URL/robots.txt`;
    - `curl -s $URL/docs`.
  - Expect: 401; 403; `Disallow: /`; 401. Prototype reset is refused with `reset_off`
    (`PROTOTYPE_RESET=false`): the button still shows, but nothing is wiped.
- [ ] **23. The database isn't reachable from the internet**
  - How: Cloud SQL → Connections.
  - Expect: no authorised networks; the connection requires SSL or the connector.
- [ ] **24. The cost is what we expect**
  - How: after 24 hours, Billing → Reports, filtered to the project.
  - Expect: mostly Cloud SQL; Cloud Run, logging and the registry near zero. The budget exists, with its
    thresholds.
- [ ] **25. A teammate can do it alone**
  - How: one teammate deploys into their own project with only `README.md`.
  - Expect: it works. Fix the guide wherever they had to ask.

## P4: before handing the URL to reviewers

- [ ] **26. The demo state** (optional): the demo bank and its monitors, a recorded Studio scenario, and
      alerts, so reviewers see something on day one.
- [ ] **27. A phone and dark mode:** the bot check, the Overview, the Alerts page.
- [ ] **28. The deployment is awake** for the whole review period.

Record what failed, why, and the fix, so the next deployment is quicker.
