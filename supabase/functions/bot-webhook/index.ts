// Bendor-X Telegram bot /start webhook.
// The bot token stays in Supabase project secrets and is never returned to clients.

const APP_URL = "https://tendorx.github.io/BendorX/";
const BOT_TOKEN_NAMES = [
  "BENDORX_BOT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TENDORX_BOT_TOKEN",
  "BOT_TOKEN",
];

function hex(bytes: Uint8Array) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function webhookSecret(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${token}:bendorx-welcome-webhook-v1`),
  );
  return hex(new Uint8Array(digest));
}

async function getBotToken() {
  const candidates = [...new Set(BOT_TOKEN_NAMES
    .map((name) => (Deno.env.get(name) || "").trim())
    .filter(Boolean))];

  for (const token of candidates) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const result = await response.json();
      if (response.ok && result?.ok === true && result.result?.username?.toLowerCase() === "bendorx_bot") {
        return token;
      }
    } catch {
      // Try the next configured token without logging its value.
    }
  }
  throw new Error("BendorX bot token is not configured");
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char] || char));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  try {
    const token = await getBotToken();
    const expectedSecret = await webhookSecret(token);
    const receivedSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";

    if (receivedSecret !== expectedSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const update = await req.json();
    const message = update?.message;
    const text = String(message?.text || "").trim();
    const chatId = message?.chat?.id;

    if (
      message?.chat?.type !== "private" ||
      !chatId ||
      !/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)
    ) {
      return new Response("ok", { status: 200 });
    }

    const firstName = escapeHtml(message?.from?.first_name || "друг");
    const welcome = [
      `Привет, ${firstName}! 👋`,
      "",
      "<b>Добро пожаловать в Bendor-X!</b>",
      "",
      "Здесь ты можешь находить интересные Telegram-каналы и сообщества, продвигать собственный проект, получать голоса и следить за статистикой публикаций.",
      "",
      "Нажми кнопку ниже, чтобы открыть каталог и начать пользоваться приложением. 🚀",
    ].join("\n");

    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: welcome,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: "🚀 Открыть приложение", web_app: { url: APP_URL } },
          ]],
        },
      }),
    });

    const result = await telegramResponse.json().catch(() => null);
    if (!telegramResponse.ok || result?.ok !== true) {
      console.error("Bendor-X welcome message failed", result?.error_code ?? telegramResponse.status);
      return new Response("Telegram delivery failed", { status: 502 });
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("Bendor-X bot webhook failed", error instanceof Error ? error.message : "unknown");
    return new Response("Internal error", { status: 500 });
  }
});
