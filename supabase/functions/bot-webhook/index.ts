// Bendor-X Telegram bot webhook: /start and Telegram Stars payments.
const APP_URL = "https://tendorx.github.io/BendorX/";
const BOT_TOKEN_NAMES = ["BENDORX_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "TENDORX_BOT_TOKEN", "BOT_TOKEN"];
function hex(bytes: Uint8Array) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}
async function webhookSecret(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${token}:bendorx-welcome-webhook-v1`));
  return hex(new Uint8Array(digest));
}
async function getBotToken() {
  const candidates = [...new Set(BOT_TOKEN_NAMES.map((name) => (Deno.env.get(name) || "").trim()).filter(Boolean))];
  for (const token of candidates) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const result = await response.json();
      if (response.ok && result?.ok === true && result.result?.username?.toLowerCase() === "bendorx_bot") return token;
    } catch { /* Try another configured token. */ }
  }
  throw new Error("BendorX bot token is not configured");
}
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char] || char));
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function telegram(token: string, method: string, payload: unknown) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error(`Telegram ${method} failed: ${result?.error_code ?? response.status}`);
  return result.result;
}
function dbConfig() {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Supabase service configuration missing");
  return { url, key };
}
async function dbRequest(path: string, method = "GET", body?: unknown, prefer?: string) {
  const { url, key } = dbConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status} ${JSON.stringify(payload)?.slice(0, 250)}`);
  return payload;
}
async function answerPreCheckout(token: string, queryId: string, ok: boolean, errorMessage?: string) {
  await telegram(token, "answerPreCheckoutQuery", {
    pre_checkout_query_id: queryId, ok,
    ...(ok ? {} : { error_message: errorMessage || "Не удалось проверить заказ. Создайте новый счёт." }),
  });
}
async function handlePreCheckout(token: string, query: any) {
  const payload = String(query?.invoice_payload || "");
  const tid = Number(query?.from?.id);
  const amount = Number(query?.total_amount);
  const currency = String(query?.currency || "");
  let order: any = null;
  try {
    if (!payload.startsWith("bendorx_promo_") || !Number.isSafeInteger(tid) || tid <= 0 || currency !== "XTR") {
      await answerPreCheckout(token, String(query.id), false, "Некорректные данные заказа.");
      return;
    }
    const rows = await dbRequest(`promotions?invoice_payload=eq.${encodeURIComponent(payload)}&select=id,community_id,telegram_user_id,duration_days,stars_amount,status,expires_at`);
    order = Array.isArray(rows) ? rows[0] : null;
    if (!order || order.status !== "pending" || Number(order.telegram_user_id) !== tid ||
        Number(order.stars_amount) !== amount || new Date(order.expires_at).getTime() <= Date.now()) {
      await answerPreCheckout(token, String(query.id), false, "Заказ не найден или срок его действия истёк. Создайте новый счёт.");
      return;
    }
    const communities = await dbRequest(`communities?id=eq.${Number(order.community_id)}&owner_tid=eq.${tid}&status=eq.approved&select=id`);
    if (!Array.isArray(communities) || !communities.length) {
      await answerPreCheckout(token, String(query.id), false, "Канал больше не доступен для продвижения.");
      return;
    }
    await answerPreCheckout(token, String(query.id), true);
  } catch (error) {
    console.error("Pre-checkout validation failed:", error instanceof Error ? error.message : "unknown");
    try { await answerPreCheckout(token, String(query.id), false, "Временная ошибка проверки заказа. Попробуйте позже."); } catch {}
  }
}
async function handleSuccessfulPayment(token: string, message: any) {
  const payment = message?.successful_payment;
  const payload = String(payment?.invoice_payload || "");
  const tid = Number(message?.from?.id);
  const amount = Number(payment?.total_amount);
  const chargeId = String(payment?.telegram_payment_charge_id || "");
  if (!payload.startsWith("bendorx_promo_") || !chargeId || payment?.currency !== "XTR") {
    console.error("Unexpected successful payment update");
    return;
  }
  const rows = await dbRequest(`promotions?invoice_payload=eq.${encodeURIComponent(payload)}&select=id,community_id,telegram_user_id,duration_days,stars_amount,status,telegram_payment_charge_id`);
  const order: any = Array.isArray(rows) ? rows[0] : null;
  if (!order || Number(order.telegram_user_id) !== tid || Number(order.stars_amount) !== amount) {
    console.error("Successful payment does not match a promotion order");
    return;
  }
  if (order.status === "active" && order.telegram_payment_charge_id === chargeId) return;
  if (order.status !== "pending") {
    console.error("Successful payment received for non-pending order", order.id);
    return;
  }
  const community = await dbRequest(`communities?id=eq.${Number(order.community_id)}&owner_tid=eq.${tid}&status=eq.approved&select=id`);
  if (!Array.isArray(community) || !community.length) {
    console.error("Paid promotion community is no longer approved", order.id);
    return;
  }
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + Number(order.duration_days) * 24 * 60 * 60 * 1000);
  // There is one advertising slot; the newest successful payment takes it.
  await dbRequest(`promotions?status=eq.active&id=neq.${Number(order.id)}`, "PATCH", { status: "expired" }, "return=minimal");
  await dbRequest(`promotions?id=eq.${Number(order.id)}&status=eq.pending`, "PATCH", {
    status: "active",
    telegram_payment_charge_id: chargeId,
    paid_at: startsAt.toISOString(),
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  }, "return=minimal");
  try {
    await telegram(token, "sendMessage", {
      chat_id: message.chat.id,
      text: `⭐ Оплата получена! Ваше сообщество размещено в Bendor-X на ${Number(order.duration_days)} дн. Продвижение автоматически завершится ${endsAt.toLocaleString("ru-RU")}.`,
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error("Promotion payment confirmation message failed:", error instanceof Error ? error.message : "unknown");
  }
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  try {
    const token = await getBotToken();
    const expectedSecret = await webhookSecret(token);
    const receivedSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (receivedSecret !== expectedSecret) return new Response("Unauthorized", { status: 401 });
    const update = await req.json();
    if (update?.pre_checkout_query) {
      await handlePreCheckout(token, update.pre_checkout_query);
      return new Response("ok", { status: 200 });
    }
    const message = update?.message;
    if (message?.successful_payment) {
      await handleSuccessfulPayment(token, message);
      return new Response("ok", { status: 200 });
    }
    const text = String(message?.text || "").trim();
    const chatId = message?.chat?.id;
    if (message?.chat?.type !== "private" || !chatId || !/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
      return new Response("ok", { status: 200 });
    }
    const firstName = escapeHtml(message?.from?.first_name || "друг");
    const welcome = [
      `Привет, ${firstName}! 👋`, "", "<b>Добро пожаловать в Bendor-X!</b>", "",
      "Здесь ты можешь находить интересные Telegram-каналы и сообщества, продвигать собственный проект, получать голоса и следить за статистикой публикаций.", "",
      "Нажми кнопку ниже, чтобы открыть каталог и начать пользоваться приложением. 🚀",
    ].join("\n");
    await telegram(token, "sendMessage", {
      chat_id: chatId, text: welcome, parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "🚀 Открыть приложение", web_app: { url: APP_URL } }]] },
    });
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("Bendor-X webhook failed:", error instanceof Error ? error.message : "unknown");
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
