import { google } from "googleapis";
import http from "node:http";
import { URL } from "node:url";

const CLIENT_ID = process.env.GDRIVE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const PORT = 3000;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Set GDRIVE_OAUTH_CLIENT_ID and GDRIVE_OAUTH_CLIENT_SECRET env vars before running this script."
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive.file"],
});

console.log("\nOpen this URL in your browser and log in with the Google");
console.log("account whose Drive you want summaries saved to:\n");
console.log(authUrl);
console.log("\nWaiting for you to complete the login...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("No code received.");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Success — you can close this tab and return to the terminal.");

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\nRefresh token (save this as the GDRIVE_OAUTH_REFRESH_TOKEN secret):\n");
    console.log(tokens.refresh_token);
    console.log("\nDone. You can close this terminal now.\n");
  } catch (err) {
    console.error("Failed to exchange code for tokens:", err.message);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log(`Local server listening on http://localhost:${PORT} for the OAuth redirect.`);
});
