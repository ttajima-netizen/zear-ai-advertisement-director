// Netlify Function: フロント（index.html）からは今まで通り
// { model, max_tokens, system, messages:[{role,content}], tools? } という
// Anthropic Messages API形式のリクエストが届く。
// これをGoogle Gemini API（無料枠あり・クレカ不要）の形式に変換して呼び出し、
// レスポンスも { content: [{type:"text", text: "..."}] } という
// Anthropic形式に整形して返す（フロント側のパース処理は変更不要にするため）。
//
// 必要な環境変数: GEMINI_API_KEY
// 取得場所: https://aistudio.google.com/apikey （Googleアカウントのみ、クレカ不要）

const GEMINI_MODEL = "gemini-3.6-flash"; // 2026年7月リリースの最新Flashモデル。無料枠あり（目安：15 RPM / 1,500 RPD）

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "GEMINI_API_KEY is not set on the server." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const system = payload.system || "";
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const maxTokens = payload.max_tokens || 1000;

  // Anthropic形式のmessagesをGemini形式のcontentsに変換
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));

  const geminiBody = {
    contents,
    generationConfig: {
      // Gemini 3.x系は既定で「思考」にも出力トークンと処理時間を使うため、
      // 余裕を持たせて打ち切り・タイムアウトを防ぐ
      maxOutputTokens: Math.max(maxTokens, 2048),
      responseMimeType: "application/json", // JSONのみを出力させる（前置き・コードフェンス防止）
      // gemini-3.x系はthinkingBudgetではなくthinkingLevelを使う（混在させると400エラーになる）。
      // 完全オフにはできないため、最小のlowを指定して応答時間を短縮する。
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
  if (system) {
    geminiBody.systemInstruction = { parts: [{ text: system }] };
  }
  // 注：Anthropicのweb_searchツール（tools）はGemini側では未対応のため、
  // 指定されていても無視して通常生成にフォールバックする。

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(geminiBody),
    });

    const raw = await upstream.text();

    if (!upstream.ok) {
      return {
        statusCode: upstream.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Gemini API error", detail: raw }),
      };
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: "Invalid response from Gemini", detail: raw }) };
    }

    const candidate = (data.candidates || [])[0];
    const text = candidate && candidate.content && Array.isArray(candidate.content.parts)
      ? candidate.content.parts.filter((p) => !p.thought).map((p) => p.text || "").join("")
      : "";

    if (!text) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Gemini returned an empty response", detail: raw }),
      };
    }

    // フロント側の既存パース処理（data.content から type:"text" を探す）に
    // そのまま合わせられるよう、Anthropic互換の形にラップして返す
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text }] }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Upstream request to Gemini API failed", detail: String(e) }),
    };
  }
};
