# First deploy, step by step

From nothing to Amiri Agent running in your own Google Cloud project. About an hour, mostly waiting.
Replace `<…>` with your own values. Run everything from the repository root.

**Never paste a secret into a chat, an issue or a file.** `secrets.sh` asks for each one in your terminal.

## 1. Tools (once)

```bash
brew install --cask google-cloud-sdk          # gcloud
brew install hashicorp/tap/terraform          # Terraform 1.6+
gcloud auth login                             # for gcloud and the scripts
gcloud auth application-default login         # for Terraform (a separate sign-in it needs)
```

Not on a Mac: [gcloud](https://cloud.google.com/sdk/docs/install), [Terraform](https://developer.hashicorp.com/terraform/install).
A warning about "no quota project" here is expected; step 2 sets it.

## 2. Project and billing

```bash
gcloud projects create <project-id> --name="Amiri Agent"
gcloud billing accounts list                                   # note the ACCOUNT_ID
gcloud billing projects link <project-id> --billing-account=<ACCOUNT_ID>
gcloud config set project <project-id>
gcloud auth application-default set-quota-project <project-id>
gcloud config set run/region <region>                          # e.g. asia-south1
```

- **Project ID:** 6–30 characters: lowercase letters, digits and hyphens. It's unique across Google Cloud and
  can't be changed. A project costs nothing by itself, and a new one is easy to delete as a whole later.
- **`set-quota-project` says the Service Usage API isn't enabled:** run
  `gcloud services enable serviceusage.googleapis.com`, then run it again.
- **A prompt to enable `compute.googleapis.com`:** answer **N**. It isn't used.

## 3. Your server's address

```bash
gcloud projects describe <project-id> --format='value(projectNumber)'
```

Your server will be at `amiri-server-<project-number>.<region>.run.app`. Note this hostname: the next step
needs it.

## 4. Keys from outside Google Cloud

**reCAPTCHA** ([google.com/recaptcha/admin/create](https://www.google.com/recaptcha/admin/create)):
- type: **Challenge (v2)**, "I'm not a robot" checkbox;
- domain: the hostname from step 3 (optionally also `localhost`);
- if it asks for a Google Cloud project, pick yours;
- keep the **site key** (not a secret) and the **secret key** (for step 7). If you only see one key, look for
  "legacy key" in the key's settings.

**Twelve Data** ([twelvedata.com](https://twelvedata.com), free plan): copy the API key. Use one key per
deployment: the free plan's 800 calls a day are shared by everything that uses the key.

## 5. Settings

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
gcloud config get project       # → project_id
gcloud config get account       # → operator_email
```

Fill in `infra/terraform/terraform.tfvars` (git ignores it):

| Setting | Value | Watch out |
|---|---|---|
| `project_id` | the project **ID** | not the project number |
| `region` | e.g. `asia-south1` | the same as in step 2 |
| `operator_email` | what `gcloud config get account` prints | the account you deploy with |
| `recaptcha_site_key` | the site key from step 4 | |
| `billing_account_id` | the ACCOUNT_ID from step 2 | optional: leave `""` for no budget alert |
| `budget_amount` | e.g. `20` | in your billing account's currency (see *Billing → Account management*) |

## 6. State bucket and the base

```bash
infra/scripts/bootstrap.sh       # a private bucket for Terraform's state, then terraform init
infra/scripts/deploy.sh base     # shows the plan, asks; about 10 minutes (the database is the slow part)
```

**After `base`, the Cloud Run page is still empty.** That's expected: the services come in step 9.

## 7. Secrets

```bash
infra/scripts/secrets.sh
```

It asks, without echoing, for the reCAPTCHA **secret** key and the Twelve Data key. It generates the rest
itself: the database user and its password, the session secret, and the key that encrypts an institution API's key.

**Check them** (nothing secret is printed):

```bash
get() { gcloud secrets versions access latest --secret="$1"; }
for s in DATABASE_URL SESSION_SECRET DATA_SECRET_KEY RECAPTCHA_SECRET TWELVEDATA_API_KEY; do
  v=$(get $s 2>/dev/null); echo "$s: length=${#v} spaces=$(printf '%s' "$v" | grep -c '[[:space:]]')"
done
curl -s "https://api.twelvedata.com/api_usage?apikey=$(get TWELVEDATA_API_KEY)" | head -c 120; echo
curl -s https://www.google.com/recaptcha/api/siteverify -d "secret=$(get RECAPTCHA_SECRET)" -d response=test; echo
```

Expect:
- every secret with a length and `spaces=0`;
- Twelve Data shows your usage, not 401;
- reCAPTCHA says `invalid-input-response`. That means the secret is right: only the fake response failed.
  `invalid-input-secret` means re-enter it.

To fix one: `infra/scripts/secrets.sh <NAME>`.

## 8. Images

```bash
infra/scripts/build.sh           # Cloud Build makes the four images in your project; about 5–10 minutes
```

You don't need Docker. The images are tagged with the current git commit.

## 9. Everything

```bash
infra/scripts/deploy.sh          # the four services and the tick; shows the plan, asks, applies
```

## 10. Check it runs

```bash
URL=$(terraform -chdir=infra/terraform output -raw server_url)
gcloud run services list                      # four services, each ✔
curl -s $URL/health; echo                     # {"status":"ok"}
curl -s $URL/api/v1/auth/config; echo         # … "asleep": false   (the server reached its database)
echo $URL
```

Open that URL in a normal browser window. **Use exactly this URL:** the bot check checks the hostname. There's
no login: tick "I'm not a robot" and Amiri Agent opens.

## 11. First use

The app starts empty:
1. **Institution:** set up your bank or insurer with the setup chat or the forms, and apply the proposals.
2. **Market series:** add the prices and rates to watch.
3. **Monitors:** draft them from the profile, then submit and approve them.

Then work through [TESTING.md](TESTING.md). For daily use (the on/off switch, shipping changes, logs, taking
it down), see [README.md](README.md).

## When a step fails

| Symptom | Fix |
|---|---|
| `bootstrap.sh`: "could not find default credentials" | `gcloud auth application-default login` (step 1) |
| Terraform: "API not enabled" or quota errors | `gcloud auth application-default set-quota-project <project-id>` (step 2) |
| `deploy.sh`: "No image_tag yet" | `build.sh` first (step 8) |
| A service fails to start: "secret … has no versions" | `secrets.sh` (step 7), then `deploy.sh` |
| `"asleep": true` in step 10 | the database isn't up yet (wait a few minutes), or `DATABASE_URL` is wrong: `secrets.sh DATABASE_URL`, then `deploy.sh` |
| The check: "the check didn't pass" | the reCAPTCHA key's domain isn't exactly the hostname from step 3, or you opened a different URL |
| Setting `allUsers` on the server fails | an organisation policy forbids public services: use a project outside that organisation |
