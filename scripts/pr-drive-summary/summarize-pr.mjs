import { Octokit } from "@octokit/rest";
import { google } from "googleapis";
import fs from "node:fs";

const {
  GITHUB_TOKEN,
  REPO,
  PR_NUMBER,
  GROQ_API_KEY,
  GOOGLE_APPLICATION_CREDENTIALS,
  GDRIVE_FOLDER_ID,
  PR_AUTHOR_FILTER,
} = process.env;

const [owner, repo] = REPO.split("/");
const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function main() {
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: Number(PR_NUMBER),
  });

  // Only summarize PRs from an allowlist of authors, if one is set
  // (recommended for multi-contributor repos like musicblocks).
  // PR_AUTHOR_FILTER can be a comma-separated list, e.g. "you,friend1,friend2".
  if (PR_AUTHOR_FILTER) {
    const allowed = PR_AUTHOR_FILTER.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(pr.user.login.toLowerCase())) {
      console.log(
        `Skipping PR #${PR_NUMBER}: author ${pr.user.login} not in allowlist [${allowed.join(", ")}]`
      );
      return;
    }
  }

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: Number(PR_NUMBER),
    per_page: 100,
  });

  const fileList = files
    .map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");

  // Keep prompt size sane: only include patches under 2000 chars
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
      model: "llama-3.3-70b-versatile",
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

  await uploadToDrive(pr, docContent);
}

async function uploadToDrive(pr, content) {
  const auth = new google.auth.GoogleAuth({
    keyFile: GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const drive = google.drive({ version: "v3", auth });

  const fileName = `PR-${pr.number}-${pr.user.login}-${pr.title}`
    .slice(0, 120)
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

  console.log(`Uploaded summary for PR #${pr.number} to Google Drive as "${fileName}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
