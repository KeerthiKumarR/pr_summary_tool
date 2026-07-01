# PR → Drive Auto-Summary (any repo / any org): Setup

This polls GitHub every 30 minutes for PRs you've merged anywhere, and
summarizes any new ones into a shared Drive folder. No changes needed in
Music Blocks or any other repo — everything runs from this repo alone.

## 1. Google OAuth2 Client Setup

To authorize the Action to write directly to your Google Drive:
1. Go to **console.cloud.google.com** → select/create a Google Cloud project.
2. Enable the **Google Drive API** for the project.
3. Go to **APIs & Services → OAuth consent screen**:
   - Set the User Type to **External** (or Internal if you are on a Google Workspace domain).
   - Fill in the required app information (app name, email, etc.).
   - Under **Scopes**, add `https://www.googleapis.com/auth/drive.file`.
   - Under **Test Users**, add your own Google email address (so Google allows you to log in during authorization).
4. Go to **APIs & Services → Credentials**:
   - Click **Create Credentials** → **OAuth client ID**.
   - Select **Web application** as the application type.
   - Add Authorized redirect URIs: `http://localhost:3000/oauth2callback`.
   - Click **Create** to obtain your `Client ID` and `Client Secret`.
5. Add these credentials as secrets in your GitHub repository:
   - Name: `GDRIVE_OAUTH_CLIENT_ID`
   - Name: `GDRIVE_OAUTH_CLIENT_SECRET`

## 2. Obtain Refresh Token

1. Set the credentials in your local environment:
   ```bash
   export GDRIVE_OAUTH_CLIENT_ID="your_client_id"
   export GDRIVE_OAUTH_CLIENT_SECRET="your_client_secret"
   ```
2. Navigate to `scripts/pr-drive-summary/` and run the helper script:
   ```bash
   node get-refresh-token.mjs
   ```
3. Open the printed authorization URL in your browser, log in with your Google account, and grant the request permissions.
4. The terminal will print your **OAuth Refresh Token**. Add this to your GitHub repository secrets:
   - Name: `GDRIVE_OAUTH_REFRESH_TOKEN`

## 3. Configure Target Folder (Optional)

Create a folder in Google Drive where you want the docs to be saved. Grab the folder ID from the folder's URL and add it as a secret in your repository:
   - Name: `GDRIVE_FOLDER_ID`

## 4. Groq API key

console.groq.com → API Keys → add as secret `GROQ_API_KEY`.

## 5. Your GitHub username

Settings → Secrets and variables → Actions → **Variables** tab → New
repository variable:
- Name: `GH_USERNAME`
- Value: your GitHub username (exactly as it appears in your profile URL)

This is required — the poller searches GitHub for `author:<GH_USERNAME>`.

## 6. GITHUB_TOKEN

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
