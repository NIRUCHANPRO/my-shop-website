// File path: netlify/functions/api.js

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO; // Format: "username/repo-name"
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
  const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "admin123";
  const FILE_PATH = "db.json";

  const githubApiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;

  async function readGithubDb() {
    const res = await fetch(`${githubApiUrl}?ref=${GITHUB_BRANCH}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "SmartShop-AnandMela-Backend"
      }
    });
    if (!res.ok) throw new Error(`GitHub Read Error: ${res.status}`);
    const fileData = await res.json();
    const content = JSON.parse(Buffer.from(fileData.content, "base64").toString("utf-8"));
    return { content, sha: fileData.sha };
  }

  async function writeGithubDb(updatedData, sha, commitMessage) {
    const updatedContent = Buffer.from(JSON.stringify(updatedData, null, 2), "utf-8").toString("base64");
    const putRes = await fetch(githubApiUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "SmartShop-AnandMela-Backend"
      },
      body: JSON.stringify({
        message: commitMessage,
        content: updatedContent,
        sha: sha,
        branch: GITHUB_BRANCH
      })
    });
    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub Write Failed: ${errText}`);
    }
  }

  try {
    // GET Request: Load latest store data
    if (event.httpMethod === "GET") {
      if (!GITHUB_TOKEN || !GITHUB_REPO) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ fallback: true, message: "Using local db.json" })
        };
      }
      const { content } = await readGithubDb();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(content)
      };
    }

    // POST Request
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      // 1. Owner Login Check
      if (body.action === "login") {
        if (body.password === OWNER_PASSWORD) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }
        return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Galat Password!" }) };
      }

      // 2. Customer New Order (Saves directly to Admin Panel)
      if (body.action === "customer_order") {
        if (!GITHUB_TOKEN || !GITHUB_REPO) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, localOnly: true }) };
        }
        const { content, sha } = await readGithubDb();
        if (!Array.isArray(content.ordersList)) content.ordersList = [];
        content.ordersList.unshift(body.order);
        content.siteConfig.orders = content.ordersList.length;
        await writeGithubDb(content, sha, `New Order from ${body.order.customerName}`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: content }) };
      }

      // 3. Customer New Message (Saves directly to Admin Inbox)
      if (body.action === "customer_message") {
        if (!GITHUB_TOKEN || !GITHUB_REPO) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, localOnly: true }) };
        }
        const { content, sha } = await readGithubDb();
        if (!Array.isArray(content.messagesList)) content.messagesList = [];
        content.messagesList.unshift(body.messageData);
        await writeGithubDb(content, sha, `New Message from ${body.messageData.name}`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: content }) };
      }

      // 4. Student Live Shoutout Wall Post (Saves directly to Shoutout Wall)
      if (body.action === "customer_shoutout") {
        if (!GITHUB_TOKEN || !GITHUB_REPO) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, localOnly: true }) };
        }
        const { content, sha } = await readGithubDb();
        if (!Array.isArray(content.shoutoutsList)) content.shoutoutsList = [];
        content.shoutoutsList.unshift(body.shoutout);
        if (content.shoutoutsList.length > 40) content.shoutoutsList = content.shoutoutsList.slice(0, 40);
        await writeGithubDb(content, sha, `New Shoutout from ${body.shoutout.name}`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: content }) };
      }

      // 5. Owner Full Save
      if (body.action === "save") {
        if (body.password !== OWNER_PASSWORD) {
          return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Unauthorized!" }) };
        }
        if (!GITHUB_TOKEN || !GITHUB_REPO) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, localOnly: true }) };
        }
        let sha = undefined;
        try {
          const current = await readGithubDb();
          sha = current.sha;
        } catch (e) {}

        await writeGithubDb(body.data, sha, "Owner Dashboard Update");
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid action" }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
