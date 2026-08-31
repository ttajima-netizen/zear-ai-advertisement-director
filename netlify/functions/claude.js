// Netlify Function: ブラウザからのリクエストを受け取り、サーバー側で
// ANTHROPIC_API_KEY を付与して Anthropic API に転送するプロキシ。
// APIキーはこの関数の外（Netlifyの環境変数）にのみ存在し、
// ブラウザ側のJS・HTMLには一切露出しない。

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set on the server." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { "Content-Type": "application/json" },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Upstream request to Anthropic API failed", detail: String(e) }),
    };
  }
};
