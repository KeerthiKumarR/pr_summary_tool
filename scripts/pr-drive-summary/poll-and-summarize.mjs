import { Octokit } from "@octokit/rest";
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";

const {
  GITHUB_TOKEN,
  GH_USERNAME,
  GROQ_API_KEY,
  GDRIVE_FOLDER_ID,
} = process.env;

// Change this if Groq deprecates the model — check console.groq.com.
const GROQ_MODEL = "llama-3.3-70b-versatile";

// Rolling lookback window. GitHub's search "merged:" qualifier is
// day-granular, so we always re-search the last N days and rely on the
// processed-PR state list to skip duplicates, rather than trying to track
// an exact "since" timestamp.
const LOOKBACK_DAYS = 7;

// Cap how many processed-PR entries we keep, so the state file doesn't
// grow forever.
const MAX_STATE_ENTRIES = 1000;

const STATE_PATH = path.join(process.cwd(), "state", "last-run.json");

const octokit = new Octokit({ auth: GITHUB_TOKEN });

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { processedPRs: Array.isArray(parsed.processedPRs) ? parsed.processedPRs : [] };
  } catch {
    return { processedPRs: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function lookbackDateString(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function main() {
  if (!GH_USERNAME) {
    throw new Error("GH_USERNAME repo variable is required (your GitHub username).");
  }

  const state = loadState();
  const processedSet = new Set(state.processedPRs);

  const sinceDate = lookbackDateString(LOOKBACK_DAYS);
  const query = `is:pr is:merged author:${GH_USERNAME} merged:>=${sinceDate}`;

  console.log(`Query: ${query}`);

  const results = await octokit.paginate(octokit.search.issuesAndPullRequests, {
    q: query,
    sort: "updated",
    order: "asc",
    per_page: 50,
  });

  console.log(`Search returned ${results.length} merged PR(s) in the lookback window.`);

  const newlyProcessed = [];

  for (const item of results) {
    // item.repository_url looks like https://api.github.com/repos/OWNER/REPO
    const parts = item.repository_url.split("/");
    const owner = parts[parts.length - 2];
    const repo = parts[parts.length - 1];
    const key = `${owner}/${repo}#${item.number}`;

    if (processedSet.has(key)) {
      continue;
    }

    try {
      await summarizeAndUpload(owner, repo, item.number);
      newlyProcessed.push(key);
      processedSet.add(key);
    } catch (err) {
      console.error(`Failed to summarize ${key}:`, err.message);
      // Don't mark as processed — it'll be retried next run.
    }
  }

  console.log(`Summarized ${newlyProcessed.length} new PR(s).`);

  const combined = [...processedSet];
  const trimmed = combined.slice(Math.max(0, combined.length - MAX_STATE_ENTRIES));
  saveState({ processedPRs: trimmed });
}

async function summarizeAndUpload(owner, repo, prNumber) {
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const fileList = files
    .map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");

  const patchExcerpts = files
    .filter((f) => f.patch && f.patch.length < 2000)
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``)
    .join("\n\n");

  const prompt = `You are summarizing a merged GitHub pull request for a personal contribution log.

Repository: ${owner}/${repo}
PR #${pr.number}: ${pr.title}
Author: ${pr.user.login}
Merged at: ${pr.merged_at}
URL: ${pr.html_url}

Description provided by author:
${pr.body || "(no description)"}

Files changed:
${fileList}

Diff excerpts (may be partial):
${patchExcerpts || "(no small diffs available)"}

Write a concise summary (4-8 sentences) covering:
1. What problem or bug this PR fixed / what it added
2. The key technical changes made
3. Any notable edge cases or non-obvious decisions
4. Tests added, if any

Keep it factual and terse, no fluff, no marketing language. Plain prose, not bullet points unless truly needed.`;

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!groqRes.ok) {
    throw new Error(`Groq API error: ${groqRes.status} ${await groqRes.text()}`);
  }

  const groqData = await groqRes.json();
  const summary = groqData.choices?.[0]?.message?.content;

  if (!summary) {
    throw new Error(`Groq API returned no summary content: ${JSON.stringify(groqData)}`);
  }

  const docContent = `# PR #${pr.number}: ${pr.title}

**Repo:** ${owner}/${repo}
**Merged:** ${pr.merged_at}
**Link:** ${pr.html_url}

## Summary

${summary}

## Files changed

${fileList}
`;

  await uploadToDrive(owner, repo, pr, docContent);
}

async function uploadToDrive(owner, repo, pr, content) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GDRIVE_OAUTH_CLIENT_ID,
    process.env.GDRIVE_OAUTH_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GDRIVE_OAUTH_REFRESH_TOKEN,
  });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  const fileName = `PR-${owner}-${repo}-${pr.number}-${pr.title}`
    .slice(0, 140)
    .replace(/[\\/:*?"<>|]/g, "-");

  const tmpPath = `/tmp/${fileName}.md`;
  fs.writeFileSync(tmpPath, content, "utf-8");

  await drive.files.create({
    requestBody: {
      name: fileName,
      parents: GDRIVE_FOLDER_ID ? [GDRIVE_FOLDER_ID] : undefined,
      mimeType: "application/vnd.google-apps.document",
    },
    media: {
      mimeType: "text/markdown",
      body: fs.createReadStream(tmpPath),
    },
  });

  console.log(`Uploaded summary for ${owner}/${repo}#${pr.number} as "${fileName}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
