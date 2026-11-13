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

  try {
    // GET Request: Load latest store data from GitHub
    if (event.httpMethod === "GET") {
      if (!GITHUB_TOKEN || !GITHUB_REPO) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ fallback: true, message: "Using local db.json" })
        };
      }

      const res = await fetch(`${githubApiUrl}?ref=${GITHUB_BRANCH}`, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "SmartShop-Netlify-Backend"
        }
      });

      if (!res.ok) {
        throw new Error(`GitHub Read Error: ${res.status}`);
      }

      const fileData = await res.json();
      const content = Buffer.from(fileData.content, "base64").toString("utf-8");
      return {
        statusCode: 200,
        headers,
        body: content
      };
    }

    // POST Request: Verify password or update database in GitHub
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      // Action 1: Verify Owner Login Password
      if (body.action === "login") {
        if (body.password === OWNER_PASSWORD) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
          };
        } else {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ success: false, error: "Galat Password! Access Denied." })
          };
        }
      }

      // Action 2: Save Updated Store Data to GitHub
      if (body.action === "save") {
        if (body.password !== OWNER_PASSWORD) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ success: false, error: "Unauthorized! Sahi password daalein." })
          };
        }

        if (!GITHUB_TOKEN || !GITHUB_REPO) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              localOnly: true,
              message: "Saved in browser! (Add GITHUB_TOKEN in Netlify for live cloud sync)"
            })
          };
        }

        // Step A: Fetch current file SHA from GitHub
        const getRes = await fetch(`${githubApiUrl}?ref=${GITHUB_BRANCH}`, {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "SmartShop-Netlify-Backend"
          }
        });

        let sha = undefined;
        if (getRes.ok) {
          const currentFile = await getRes.json();
          sha = currentFile.sha;
        }

        // Step B: Commit updated JSON back to GitHub
        const updatedContent = Buffer.from(JSON.stringify(body.data, null, 2), "utf-8").toString("base64");

        const putRes = await fetch(githubApiUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "SmartShop-Netlify-Backend"
          },
          body: JSON.stringify({
            message: "Owner Dashboard Update via SmartShop Panel",
            content: updatedContent,
            sha: sha,
            branch: GITHUB_BRANCH
          })
        });

        if (!putRes.ok) {
          const errText = await putRes.text();
          throw new Error(`GitHub Write Failed: ${errText}`);
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: "Changes saved live to GitHub!" })
        };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
