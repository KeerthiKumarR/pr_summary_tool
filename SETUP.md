# PR → Drive Auto-Summary: Setup

Drop `.github/workflows/pr-merge-summary.yml` and `scripts/pr-drive-summary/` into
the root of your repo (or a fork/personal repo you control — you'll need admin
rights to add secrets). Then:

## 1. Google service account (so the Action can write to Drive)

1. Go to console.cloud.google.com → create a project (or reuse one) → enable
   the **Google Drive API**.
2. IAM & Admin → Service Accounts → Create service account. No roles needed at
   the project level.
3. Open the service account → Keys → Add key → JSON. This downloads a file
   like `key.json`.
4. Base64-encode it and copy the output:
   ```
   base64 -w0 key.json
   ```
5. In your GitHub repo: Settings → Secrets and variables → Actions → New
   repository secret:
   - Name: `GDRIVE_SERVICE_ACCOUNT_B64`
   - Value: the base64 string from step 4

## 2. Share the Drive folder

1. Create (or pick) a Drive folder for your PR write-ups.
2. Open the service account's JSON key file, find the `client_email` field
   (looks like `something@project.iam.gserviceaccount.com`).
3. Share the Drive folder with that email address (Editor access).
4. Grab the folder ID from the folder's URL:
   `https://drive.google.com/drive/folders/<THIS_PART>`
5. Add a repo secret:
   - Name: `GDRIVE_FOLDER_ID`
   - Value: the folder ID

## 3. Groq API key

1. Get a key from console.groq.com (Keys).
2. Add a repo secret:
   - Name: `GROQ_API_KEY`
   - Value: your key

Note: this uses your own API credits — the summary call is small (~1-2k
tokens per PR), so cost is negligible.

## 4. (Recommended) Filter to specific people

Music Blocks has many contributors — you probably want summaries for just
yourself and a few friends, not every merge in the repo. Add a repo
**variable** (not secret):

- Settings → Secrets and variables → Actions → Variables tab → New variable
- Name: `PR_AUTHOR_FILTER`
- Value: a comma-separated list of GitHub usernames, e.g. `you,friend1,friend2`

Leave it unset if you want every merged PR in the repo summarized. Each
person's summary is saved as its own doc named `PR-<number>-<author>-<title>`,
so they're easy to tell apart in the folder.

## 5. GITHUB_TOKEN

Nothing to do — GitHub provides this automatically to Actions.

## Done

Merge any PR (or wait for one of yours to get merged) and check the workflow
run under the Actions tab, then check your Drive folder for a new Google Doc
named `PR-<number>-<author>-<title>`.

## Notes / things you might want to tweak

- If you contribute to multiple repos, you'll need to add this workflow +
  secrets to each one separately (GitHub Actions run per-repo).
- Currently uploads as a Google Doc (converted from markdown on upload). If
  you'd rather have plain `.md` files in Drive, change `mimeType` in
  `uploadToDrive()` in `summarize-pr.mjs` from
  `application/vnd.google-apps.document` to `text/markdown`.
- The diff excerpt sent to the LLM is capped at patches under 2000 chars each
  to keep the prompt small — big files just get their filename + line-count
  listed without a diff.
