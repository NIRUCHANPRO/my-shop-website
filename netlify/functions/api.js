// File path: netlify/functions/api.js

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO; // Format: "username/repo-name"
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
  const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "admin123";
  const VIP_PASSWORD = process.env.VIP_PASSWORD || "abishai@nirwan";
  const FILE_PATH = "db.json";

  const githubApiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;

  // Fast GitHub DB Reader (Bypasses Cache for Instant Live Sync)
  async function readGithubDb() {
    const res = await fetch(`${githubApiUrl}?ref=${GITHUB_BRANCH}&t=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Cache-Control": "no-cache",
        "User-Agent": "SmartShop-Abishai-Nirwan-Backend"
      }
    });
    if (!res.ok) throw new Error(`GitHub Read Error: ${res.status}`);
    const fileData = await res.json();
    const content = JSON.parse(Buffer.from(fileData.content, "base64").toString("utf-8"));
    return { content, sha: fileData.sha };
  }

  // Fast GitHub DB Writer
  async function writeGithubDb(updatedData, sha, commitMessage) {
    const updatedContent = Buffer.from(JSON.stringify(updatedData, null, 2), "utf-8").toString("base64");
    const putRes = await fetch(githubApiUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "SmartShop-Abishai-Nirwan-Backend"
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
    // GET Request: Load latest live store data
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

    // POST Request: Handle Owner, VIP Teachers & Customer Actions
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      // 1. Owner Master Login Check
      if (body.action === "login") {
        if (body.password === OWNER_PASSWORD) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, role: "owner" }) };
        }
        return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Galat Owner Password!" }) };
      }

      // 2. VIP / Teacher Lounge Login Check (Password: abishai@nirwan)
      if (body.action === "vip_login") {
        if (body.password === VIP_PASSWORD || body.password === OWNER_PASSWORD) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, role: "vip" }) };
        }
        return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Invalid VIP Password! Use: abishai@nirwan" }) };
      }

      // 3. VIP Product Add / Remove ONLY (Cannot touch Owner Settings or Shutdown)
      if (body.action === "vip_save_products") {
        if (body.password !== VIP_PASSWORD && body.password !== OWNER_PASSWORD) {
          return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Unauthorized VIP Access!" }) };
        }
        if (!GITHUB_TOKEN || !GITHUB_REPO) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, localOnly: true }) };
        }
        const { content, sha } = await readGithubDb();
        content.products = Array.isArray(body.products) ? body.products : content.products;
        await writeGithubDb(content, sha, `VIP Panel Product Update by ${body.vipName || "VIP Teacher"}`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: content }) };
      }

      // 4. Customer New Order + Auto Leaderboard Rank Update
      if (body.action === "customer_order") {
        if (!GITHUB_TOKEN || !GITHUB_REPO) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, localOnly: true }) };
        }
        const { content, sha } = await readGithubDb();
        if (!Array.isArray(content.ordersList)) content.ordersList = [];
        content.ordersList.unshift(body.order);
        content.siteConfig.orders = content.ordersList.length;

        if (!Array.isArray(content.leaderboardList)) content.leaderboardList = [];
        const buyerName = body.order.customerName || "VIP Buyer";
        const buyerGroup = body.order.studentClass || "Anand Mela VIP";
        const spent = Number(body.order.totalAmount) || 0;

        const existingIdx = content.leaderboardList.findIndex(
          l => l.name.toLowerCase() === buyerName.toLowerCase()
        );
        if (existingIdx > -1) {
          content.leaderboardList[existingIdx].points += spent;
          content.leaderboardList[existingIdx].ordersCount = (content.leaderboardList[existingIdx].ordersCount || 1) + 1;
        } else {
          content.leaderboardList.push({
            id: "LB-" + Date.now(),
            name: buyerName,
            group: buyerGroup,
            points: spent,
            ordersCount: 1
          });
        }
        content.leaderboardList.sort((a, b) => b.points - a.points);

        await writeGithubDb(content, sha, `New Order from ${buyerName}`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: content }) };
      }

      // 5. Customer Message
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

      // 6. Customer Shoutout Wall
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

      // 7. Owner Master Full Save
      if (body.action === "save") {
        if (body.password !== OWNER_PASSWORD) {
          return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: "Unauthorized Owner!" }) };
        }
        if (!GITHUB_TOKEN || !GITHUB_REPO) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, localOnly: true }) };
        }
        let sha = undefined;
        try {
          const current = await readGithubDb();
          sha = current.sha;
        } catch (e) {}

        await writeGithubDb(body.data, sha, "Owner Master Dashboard Update");
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: body.data }) };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid action" }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
