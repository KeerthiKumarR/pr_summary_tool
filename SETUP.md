# PR → Drive Auto-Summary (any repo / any org): Setup

This polls GitHub every 30 minutes for PRs you've merged anywhere, and
summarizes any new ones into a shared Drive folder. No changes needed in
Music Blocks or any other repo — everything runs from this repo alone.

## 1. Google service account (already done if you completed this earlier)

If not done yet:
1. console.cloud.google.com → create/select a project → enable **Google
   Drive API**.
2. IAM & Admin → Service Accounts → Create service account → Keys → Add
   Key → Create new key → JSON.
3. Base64-encode it:
   - macOS: `base64 -i key.json | tr -d '\n'`
   - Linux: `base64 -w0 key.json`
4. Add as repo secret `GDRIVE_SERVICE_ACCOUNT_B64`.

## 2. Share your Drive folder

Share the target Drive folder with the service account's `client_email`
(Editor access). Get the folder ID from its URL and add it as secret
`GDRIVE_FOLDER_ID`.

## 3. Groq API key

console.groq.com → API Keys → add as secret `GROQ_API_KEY`.

## 4. Your GitHub username

Settings → Secrets and variables → Actions → **Variables** tab → New
repository variable:
- Name: `GH_USERNAME`
- Value: your GitHub username (exactly as it appears in your profile URL)

This is required — the poller searches GitHub for `author:<GH_USERNAME>`.

## 5. GITHUB_TOKEN

Provided automatically. Used both to search/read PR data and to commit the
state file back to this repo, so the workflow needs `contents: write`
permission (already set in the workflow file).

## How it works

- Runs every 30 minutes (`schedule: cron`), or trigger manually any time
  from the Actions tab (`workflow_dispatch`).
- Searches for PRs you merged in the last 7 days on every run (a rolling
  window, since GitHub's search only has day-level date precision).
- Tracks which PRs it's already summarized in
  `scripts/pr-drive-summary/state/last-run.json`, so re-scanning the same
  week doesn't create duplicate Drive docs. This file gets committed back
  automatically after each run.
- Only sees **public repositories** by default. If you ever need it to see
  a private repo you don't own, you'd need a personal access token with
  access to that repo, added as a separate secret, and the script updated
  to use it instead of `GITHUB_TOKEN` for those calls — not set up here.

## Testing it

Go to the Actions tab → select this workflow → **Run workflow** (manual
trigger) rather than waiting up to 30 minutes for the schedule. Check the
run logs for how many PRs it found, and check your Drive folder afterward.

## Notes / things you might want to tweak

- `LOOKBACK_DAYS` (in `poll-and-summarize.mjs`) controls how far back each
  search looks — 7 days by default. Increase it if you're worried about a
  gap (e.g. Actions being paused), decrease it to reduce search result
  volume.
- Scheduled workflows can be delayed by GitHub during high load — treat
  "every 30 minutes" as "roughly every 30 minutes, sometimes more."
- If a summary fails partway (e.g. Groq API hiccup), that PR is not marked
  processed and will be retried on the next run automatically.
