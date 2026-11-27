
// deno-lint-ignore-file no-explicit-any

// TENDORX API
// Авторизация только через проверенный Telegram initData.
// Service Role Key и токен бота хранятся только в Secrets Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const encoder = new TextEncoder();
const ALLOWED_CARD_THEMES = new Set(['violet','ocean','sunset','emerald','ruby','gold','blue','midnight','crimson','coral','pink','lavender','ice','turquoise','lime','forest','amber','copper','graphite','plum','mint','sand','aurora','galaxy','tropical','default']);
const ALLOWED_CARD_FRAMES = new Set(['none','claws','thorns','chain','royal']);
const ALLOWED_CARD_EMOJIS = new Set(['✨','🔥','⚡','🚀','💎','🎮','👑','🌸','⭐','🦋','🐼','🎯','💫','🌙','🍀','🎧','🧩','❤️','☀️','🪐']);

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function hmac(keyBytes: Uint8Array, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(data)),
  );
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(
      /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function positiveInteger(value: unknown) {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new ApiError(400, "Неверные параметры запроса");
  }

  return number;
}

// Автоматически подключаем /start webhook при первом запросе главного администратора.
async function ensureWelcomeWebhook(botToken: string) {
  const webhookUrl = "https://jbqyndtrbqmvzghqihak.supabase.co/functions/v1/bot-webhook";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${botToken}:bendorx-welcome-webhook-v1`),
  );
  const secretToken = toHex(new Uint8Array(digest));

  const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const info = await infoResponse.json().catch(() => null);
  if (!infoResponse.ok || info?.ok !== true) {
    throw new Error("Telegram getWebhookInfo failed");
  }
  if (info.result?.url === webhookUrl) return;

  const setResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    }),
  });
  const setResult = await setResponse.json().catch(() => null);
  if (!setResponse.ok || setResult?.ok !== true) {
    throw new Error(`Telegram setWebhook failed: ${setResult?.error_code ?? setResponse.status}`);
  }
}

// Проверка подлинности Telegram initData.
async function verifyTelegram(
  initData: string,
  botToken: string,
): Promise<any> {
  if (!initData || initData.length > 4096) {
    throw new ApiError(
      401,
      "Не удалось проверить авторизацию Telegram. Откройте приложение заново.",
    );
  }

  const params = new URLSearchParams(initData);

  const hashes = params.getAll("hash");
  const authDates = params.getAll("auth_date");
  const users = params.getAll("user");

  if (
    hashes.length !== 1 ||
    authDates.length !== 1 ||
    users.length !== 1
  ) {
    throw new ApiError(
      401,
      "Некорректные данные авторизации Telegram",
    );
  }

  const receivedHash = hashes[0];

  if (!/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new ApiError(401, "Некорректная подпись Telegram");
  }

  params.delete("hash");

  const checkString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // Telegram Web Apps initData: HMAC(key="WebAppData", message=botToken).
  const secretKey = await hmac(
    encoder.encode("WebAppData"),
    botToken,
  );

  const calculatedHash = toHex(
    await hmac(secretKey, checkString),
  );

  if (!safeEqual(calculatedHash, receivedHash.toLowerCase())) {
    throw new ApiError(
      401,
      "Не удалось проверить авторизацию Telegram. Откройте приложение заново.",
    );
  }

  const authDate = Number(authDates[0]);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(authDate) ||
    now - authDate > 3600 ||
    authDate - now > 30
  ) {
    throw new ApiError(
      401,
      "Сессия Telegram устарела. Откройте приложение заново.",
    );
  }

  let user: any;

  try {
    user = JSON.parse(users[0]);
  } catch {
    throw new ApiError(
      401,
      "Некорректные данные пользователя Telegram",
    );
  }

  if (
    !user ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0
  ) {
    throw new ApiError(
      401,
      "Не удалось определить пользователя Telegram",
    );
  }

  return user;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: HEADERS });
  }

  try {
    if (req.method !== "POST") {
      throw new ApiError(405, "Method not allowed");
    }

    // Проверяем оба допустимых имени секрета, не выводя значения секретов в логи.
    const botTokenEntries = [
      ["BENDORX_BOT_TOKEN", (Deno.env.get("BENDORX_BOT_TOKEN") || "").trim()],
      ["TELEGRAM_BOT_TOKEN", (Deno.env.get("TELEGRAM_BOT_TOKEN") || "").trim()],
      ["TENDORX_BOT_TOKEN", (Deno.env.get("TENDORX_BOT_TOKEN") || "").trim()],
      ["BOT_TOKEN", (Deno.env.get("BOT_TOKEN") || "").trim()],
    ].filter((entry) => entry[1]).filter((entry, index, all) =>
      all.findIndex((candidate) => candidate[1] === entry[1]) === index
    );
    const botTokens = botTokenEntries.map((entry) => entry[1]);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!botTokens.length || !supabaseUrl || !serviceKey) {
      console.error("API configuration is incomplete");
      throw new ApiError(500, "Ошибка конфигурации сервера");
    }

    const rawBody = await req.text();

    if (rawBody.length > 8192) {
      throw new ApiError(413, "Слишком большой запрос");
    }

    let body: any;

    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new ApiError(400, "Некорректный JSON");
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw new ApiError(400, "Некорректный запрос");
    }

    // Подпись Telegram должна совпасть с токеном именно этого бота.
    // Не доверяем данным пользователя, пока одна из проверок не прошла.
    let user: any = null;
    let verified = false;
    let verifiedBotToken = "";
    let lastAuthError: unknown = null;

    for (const candidateToken of botTokens) {
      try {
        user = await verifyTelegram(
          String(body.initData ?? ""),
          candidateToken,
        );
        verifiedBotToken = candidateToken;
        verified = true;
        break;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        lastAuthError = error;
      }
    }

    if (!verified) {
      // Check which Telegram bot each configured token belongs to.
      // Log only variable names and public bot usernames, never tokens.
      const tokenChecks = await Promise.all(botTokenEntries.map(async (entry) => {
        try {
          const check = await fetch(`https://api.telegram.org/bot${entry[1]}/getMe`);
          const payload = await check.json();
          return {
            secretName: entry[0],
            validToken: payload?.ok === true,
            botUsername: payload?.ok === true ? payload.result?.username ?? null : null,
          };
        } catch {
          return { secretName: entry[0], validToken: false, botUsername: null };
        }
      }));
      let incomingUserId: number | null = null;
      try {
        const parsedUser = JSON.parse(new URLSearchParams(String(body.initData ?? "")).get("user") ?? "null");
        if (Number.isSafeInteger(parsedUser?.id) && parsedUser.id > 0) incomingUserId = parsedUser.id;
      } catch { /* unverified input; diagnostic only */ }
      console.warn("Telegram initData verification failed", {
        initDataLength: String(body.initData ?? "").length,
        tokenChecks,
        incomingUserMatchesStoredMaster: incomingUserId !== null
          ? incomingUserId === Number(Deno.env.get("MASTER_ADMIN_TID") || 0)
          : null,
        reason: lastAuthError instanceof Error ? lastAuthError.message : "unknown",
      });
      if (lastAuthError) throw lastAuthError;
      throw new ApiError(500, "Ошибка конфигурации сервера");
    }

    // Telegram ID берётся только из проверенного initData.
    const tid: number = user.id;

    // Membership is verified by Telegram for every protected API request.
    const membershipResponse = await fetch(
      `https://api.telegram.org/bot${verifiedBotToken}/getChatMember?chat_id=%40BendorX&user_id=${tid}`,
    );
    const membershipPayload = await membershipResponse.json().catch(() => null);
    if (!membershipResponse.ok || membershipPayload?.ok !== true) {
      console.error("Telegram membership check failed", membershipPayload?.error_code ?? membershipResponse.status);
      throw new ApiError(502, "Не удалось проверить подписку. Попробуйте ещё раз позже.");
    }
    const member = membershipPayload.result;
    const subscribed = member?.status === "creator" ||
      member?.status === "administrator" ||
      member?.status === "member" ||
      (member?.status === "restricted" && member?.is_member === true);

    if (body.action !== "check_subscription" && !subscribed) {
      throw new ApiError(403, "Для доступа к Bendor-X подпишись на канал @BendorX.");
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Вызов SQL-функций с безопасной обработкой ошибок.
    const rpc = async (
      functionName: string,
      args: Record<string, unknown>,
    ) => {
      const { data, error } = await db.rpc(functionName, args);

      if (error) {
        if (error.code === "TX403") {
          console.error(
            "Database permission error:",
            functionName,
            error.code,
          );

          throw new ApiError(403, "Недостаточно прав");
        }

        if (error.code === "TX429") {
          throw new ApiError(
            429,
            "Слишком много действий. Попробуйте позже.",
          );
        }

        if (/^TX/.test(error.code ?? "")) {
          // Тексты TX-ошибок написаны в SQL для пользователя и безопасны для показа.
          throw new ApiError(400, error.message || "Не удалось выполнить действие");
        }

        console.error(
          "Database RPC error:",
          functionName,
          error.code,
        );

        throw new ApiError(
          500,
          "Внутренняя ошибка сервера",
        );
      }

      return data;
    };

    // Обновление профиля пользователя.
    const displayName = cleanText(
      [user.first_name, user.last_name]
        .filter(Boolean)
        .join(" ") || "Пользователь",
      64,
    );

    const { error: profileError } = await db
      .from("profiles")
      .upsert(
        {
          tid,
          name: displayName,
          username: user.username ?? null,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "tid" },
      );

    if (profileError) {
      console.error(
        "Profile update failed:",
        profileError.code,
      );

      throw new ApiError(
        500,
        "Не удалось обновить профиль",
      );
    }

    // Назначение главного администратора.
    const masterTid = (
      Deno.env.get("MASTER_ADMIN_TID") ?? ""
    ).trim();

    if (masterTid) {
      if (!/^\d+$/.test(masterTid)) {
        console.error("MASTER_ADMIN_TID has invalid format");

        throw new ApiError(
          500,
          "Ошибка конфигурации администратора",
        );
      }

      if (String(tid) === masterTid) {
        const { error: adminError } = await db
          .from("profiles")
          .update({ role: "master_admin" })
          .eq("tid", tid);

        if (adminError) {
          console.error(
            "Master admin role update failed:",
            adminError.code,
          );

          throw new ApiError(
            500,
            "Не удалось проверить права администратора",
          );
        }
      }
    }

    // Регистрация webhook выполняется безопасно только от главного администратора.
    // Проверка URL предотвращает повторную настройку на каждом запросе.
    if (masterTid && String(tid) === masterTid) {
      try {
        await ensureWelcomeWebhook(verifiedBotToken);
      } catch (webhookError) {
        console.error("Bendor-X welcome webhook setup failed", webhookError instanceof Error ? webhookError.message : "unknown");
      }
    }

    let data: unknown;

    switch (body.action) {
      case "check_subscription": {
        data = { subscribed, channel: "@BendorX" };
        break;
      }

      case "me": {
        data = await rpc("tx_me", {
          p_tid: tid,
        });

        break;
      }

      case "vote": {
        data = await rpc("tx_vote", {
          p_tid: tid,
          p_id: positiveInteger(body.id),
        });

        break;
      }

      case "fav": {
        data = await rpc("tx_fav", {
          p_tid: tid,
          p_id: positiveInteger(body.id),
        });

        break;
      }

      case "community_stats": {
        data = await rpc("tx_community_stats", {
          p_tid: tid,
          p_id: positiveInteger(body.id),
        });
        break;
      }

      case "click": {
        const communityId = positiveInteger(body.id);

        // Не больше 60 кликов от одного пользователя за час.
        // Лимит хранится в Supabase и не сбрасывается при перезапуске API.
        await rpc("tx_rate_limit_consume", {
          p_action: "click",
          p_actor: tid,
          p_limit: 60,
          p_window_seconds: 3600,
        });

        await rpc("tx_track_click", {
          p_tid: tid,
          p_id: communityId,
        });

        data = true;
        break;
      }

      case "telegram_preview": {
        await rpc("tx_rate_limit_consume", {
          p_action: "telegram_preview",
          p_actor: tid,
          p_limit: 10,
          p_window_seconds: 3600,
        });

        const username = cleanText(body.username, 32).replace(/^@/, "").toLowerCase();
        if (!/^[a-z0-9_]{4,32}$/.test(username)) {
          throw new ApiError(400, "Укажи корректный публичный username Telegram.");
        }

        const chatResponse = await fetch(
          `https://api.telegram.org/bot${verifiedBotToken}/getChat?chat_id=${encodeURIComponent("@" + username)}`,
        );
        const chatPayload = await chatResponse.json().catch(() => null);
        if (!chatResponse.ok || chatPayload?.ok !== true || !chatPayload?.result) {
          console.warn("Telegram getChat failed", chatPayload?.error_code ?? chatResponse.status);
          throw new ApiError(422, "Не удалось получить данные этого сообщества. Проверь ссылку: для некоторых закрытых чатов боту нужен доступ. Можно заполнить поля вручную.");
        }

        const chat = chatPayload.result;
        if (!["channel", "group", "supergroup"].includes(String(chat.type))) {
          throw new ApiError(422, "Эта ссылка ведёт не на канал или группу Telegram.");
        }

        let avatarData: string | null = null;
        const photoFileId = chat.photo?.big_file_id || chat.photo?.small_file_id;
        if (photoFileId) {
          try {
            const fileResponse = await fetch(
              `https://api.telegram.org/bot${verifiedBotToken}/getFile?file_id=${encodeURIComponent(photoFileId)}`,
            );
            const filePayload = await fileResponse.json().catch(() => null);
            const filePath = filePayload?.ok === true ? filePayload.result?.file_path : null;
            const fileSize = Number(filePayload?.result?.file_size || 0);
            if (filePath && (!fileSize || fileSize <= 2 * 1024 * 1024)) {
              const imageResponse = await fetch(
                `https://api.telegram.org/file/bot${verifiedBotToken}/${filePath}`,
              );
              const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
              if (imageResponse.ok && contentType.startsWith("image/")) {
                const bytes = new Uint8Array(await imageResponse.arrayBuffer());
                if (bytes.length <= 2 * 1024 * 1024) {
                  let binary = "";
                  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                  }
                  avatarData = `data:${contentType};base64,${btoa(binary)}`;
                }
              }
            }
          } catch (photoError) {
            console.warn("Telegram chat photo download failed", photoError);
          }
        }

        data = {
          title: cleanText(chat.title || "", 80),
          description: cleanText(chat.description || "", 500),
          username: cleanText(chat.username || username, 32),
          kind: chat.type === "channel" ? "channel" : "group",
          avatar_data: avatarData,
        };
        break;
      }

      case "submit": {
        const tags = String(body.tags ?? "")
          .split(",")
          .map((tag: string) => cleanText(tag, 24))
          .filter(Boolean)
          .slice(0, 5);

        const cardTheme = ALLOWED_CARD_THEMES.has(String(body.card_theme)) ? String(body.card_theme) : 'violet';
        const cardFrame = ALLOWED_CARD_FRAMES.has(String(body.card_frame)) ? String(body.card_frame) : 'none';
        const cardEmoji = ALLOWED_CARD_EMOJIS.has(String(body.card_emoji)) ? String(body.card_emoji) : '✨';

        // Не даём одному пустому/устаревшему значению категории
        // прервать отправку всей заявки. Принимаем только реальные положительные ID.
        const categories = Array.isArray(body.categories)
          ? [...new Set(body.categories
              .map((value: unknown) => Number(value))
              .filter((value: number) => Number.isSafeInteger(value) && value > 0))]
          : [];
        if (categories.length < 1 || categories.length > 3) {
          throw new ApiError(400, "Выбери от 1 до 3 действующих категорий и попробуй ещё раз.");
        }

        data = await rpc("tx_submit_multi", {
          p_tid: tid,
          p_username: cleanText(body.username, 40),
          p_title: cleanText(body.title, 80),
          p_desc: cleanText(body.description, 500),
          p_cats: categories,
          p_tags: tags,
          p_kind: cleanText(body.kind, 12),
        });

        // Resolve the submitted community ID. Support numeric and object RPC return shapes.
        let communityId = Number(
          typeof data === "object" && data !== null
            ? (data as any).id ?? (data as any).community_id
            : data
        );

        if (!Number.isSafeInteger(communityId) || communityId <= 0) {
          const { data: submittedCommunity, error: lookupError } = await db
            .from("communities")
            .select("id")
            .eq("owner_tid", tid)
            .eq("username", cleanText(body.username, 40))
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lookupError || !submittedCommunity?.id) {
            console.error("Community submit lookup failed:", lookupError?.code ?? "NOT_FOUND");
            throw new ApiError(500, "Заявка создана, но не удалось найти её для сохранения оформления.");
          }
          communityId = Number(submittedCommunity.id);
        }

        // Сохраняем выбранный тип напрямую, даже если RPC tx_submit не записал p_kind.
        const communityKind = body.kind === "channel" ? "channel" : "group";
        const { error: designError, count: designCount } = await db
          .from("communities")
          .update({ card_theme: cardTheme, card_frame: cardFrame, card_emoji: cardEmoji, kind: communityKind }, { count: "exact" })
          .eq("id", communityId)
          .eq("owner_tid", tid);

        if (designError || designCount === 0) {
          console.error("Community card design update failed:", designError?.code ?? "NO_ROWS_UPDATED");
          throw new ApiError(500, "Не удалось сохранить оформление карточки. Попробуйте отправить заявку ещё раз.");
        }

        const avatar = typeof body.avatar === "string" ? body.avatar : "";
        if (avatar) {
          if (!new RegExp(`^a/${tid}/[0-9a-f-]{36}\\.jpg$`).test(avatar)) throw new ApiError(400, "Некорректное изображение");
          const found: any = await db.storage.from("community-media").list(`a/${tid}`, { search: avatar.split("/")[2] });
          if (!found.data?.length) throw new ApiError(400, "Изображение не загружено, попробуйте ещё раз");
          const up = await db.from("communities").update({ avatar_path: avatar }).eq("id", communityId).eq("owner_tid", tid);
          if (up.error) console.error("avatar update error:", up.error.code);
        }

        // Send a best-effort notification to the private admin group.
        // A Telegram delivery failure must never undo a successfully created submission.
        const adminChatId = (Deno.env.get("BENDORX_ADMIN_CHAT_ID") || "").trim();
        if (adminChatId) {
          try {
            const { data: submitted, error: submittedError } = await db
              .from("communities")
              .select("id,title,username,link,kind,created_at,owner_tid")
              .eq("id", communityId)
              .eq("owner_tid", tid)
              .maybeSingle();

            if (submittedError || !submitted) {
              console.error("Admin notification: community lookup failed", submittedError?.code);
            } else {
              const kindLabel = submitted.kind === "channel" ? "Канал"
                : submitted.kind === "supergroup" ? "Супергруппа" : "Группа / чат";
              const userLabel = [displayName, user.username ? `@${cleanText(user.username, 32)}` : ""]
                .filter(Boolean).join(" ");
              const message = [
                "🔔 НОВАЯ ЗАЯВКА НА МОДЕРАЦИЮ",
                "",
                `Пользователь: ${userLabel}`,
                `Telegram ID: ${tid}`,
                `Название: ${cleanText(submitted.title, 80)}`,
                `Тип: ${kindLabel}`,
                `Ссылка: ${cleanText(submitted.link, 200)}`,
                `Заявка №: ${submitted.id}`,
                `Дата: ${new Date(submitted.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`,
                "",
                "Статус: ожидает проверки"
              ].join("\n");

              const telegramResponse = await fetch(`https://api.telegram.org/bot${verifiedBotToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: adminChatId, text: message, disable_web_page_preview: true })
              });
              const telegramResult = await telegramResponse.json();
              if (!telegramResponse.ok || telegramResult?.ok !== true) {
                console.error("Admin Telegram notification failed", telegramResult?.error_code ?? telegramResponse.status);
              }
            }
          } catch (notificationError) {
            console.error("Admin Telegram notification failed", notificationError);
          }
        } else {
          console.warn("BENDORX_ADMIN_CHAT_ID is not configured; notifications are disabled");
        }


        break;
      }

      case "queue": {
        const q = ((await rpc("tx_queue", { p_actor: tid })) ?? []) as Array<{ id: number }>;
        // tx_queue omits the community kind, so enrich queue items from the
        // communities table. Without this field the UI incorrectly falls back
        // to "Группа / чат" even for channels.
        const m: any = q.length ? await db.from("communities").select("id,avatar_path,kind").in("id", q.map((x) => x.id)) : { data: [] };
        const mp = new Map((m.data ?? []).map((x: any) => [x.id, { avatar_path: x.avatar_path, kind: x.kind }]));
        data = q.map((x) => {
          const extra = mp.get(x.id);
          return { ...x, avatar_path: extra?.avatar_path ?? null, kind: extra?.kind ?? x.kind ?? null };
        });
        break;
      }

      case "stats": {
        data = await rpc("tx_stats", {
          p_actor: tid,
        });

        break;
      }

      case "moderate": {
        const applicationId = positiveInteger(body.id);
        const moderationStatus = cleanText(body.status, 12).toLowerCase();
        const moderationReason = cleanText(body.reason, 300);

        await rpc("tx_moderate", {
          p_actor: tid,
          p_id: applicationId,
          p_status: moderationStatus,
          p_reason: moderationReason,
        });

        // После успешного решения модерации уведомляем владельца публикации
        // в личные сообщения. Недоступность Telegram-уведомления не отменяет решение.
        if (["approved", "rejected"].includes(moderationStatus)) {
          try {
            const [{ data: moderatedCommunity, error: communityError },
              { data: moderatorProfile, error: moderatorError }] = await Promise.all([
              db.from("communities")
                .select("id,title,username,kind,owner_tid")
                .eq("id", applicationId)
                .maybeSingle(),
              db.from("profiles")
                .select("role")
                .eq("tid", tid)
                .maybeSingle(),
            ]);

            if (communityError || !moderatedCommunity) {
              console.error("Moderation notification: community lookup failed", communityError?.code ?? "NOT_FOUND");
            } else {
              if (moderatorError) {
                console.warn("Moderation notification: moderator profile unavailable", moderatorError.code);
              }
              const kindLabel = moderatedCommunity.kind === "channel" ? "канал" : "группу / чат";
              const publicationTitle = cleanText(moderatedCommunity.title, 80);
              const publicationLink = cleanText(moderatedCommunity.username, 40);
              const ownerTid = Number(moderatedCommunity.owner_tid);

              if (Number.isSafeInteger(ownerTid) && ownerTid > 0) {
                const userMessage = moderationStatus === "approved"
                  ? [
                      "🎉 ВАША ПУБЛИКАЦИЯ ОДОБРЕНА!",
                      "",
                      `Ваш ${kindLabel} «${publicationTitle}» успешно прошёл модерацию и теперь доступен в каталоге BendorX.`,
                      publicationLink ? `Открыть: https://t.me/${publicationLink.replace(/^@/, "")}` : "",
                      "",
                      "Спасибо, что развиваете наше сообщество! 🚀",
                    ].filter(Boolean).join("\n")
                  : [
                      "❌ ВАША ПУБЛИКАЦИЯ ОТКЛОНЕНА",
                      "",
                      `К сожалению, ${kindLabel} «${publicationTitle}» не прошёл модерацию.`,
                      "",
                      `Причина: ${moderationReason || "не указана"}`,
                      "",
                      "Исправьте замечания и отправьте публикацию повторно.",
                    ].join("\n");

                const userTelegramResponse = await fetch(`https://api.telegram.org/bot${verifiedBotToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: ownerTid,
                    text: userMessage,
                    disable_web_page_preview: true,
                  }),
                });
                const userTelegramResult = await userTelegramResponse.json().catch(() => null);
                if (!userTelegramResponse.ok || userTelegramResult?.ok !== true) {
                  console.warn("Publication owner Telegram notification failed", {
                    error_code: userTelegramResult?.error_code ?? userTelegramResponse.status,
                    owner_tid: ownerTid,
                  });
                }
              } else {
                console.warn("Publication owner Telegram notification skipped: owner_tid is missing", applicationId);
              }

              // Сохраняем существующее уведомление в закрытый чат администраторов.
              const adminChatId = (Deno.env.get("BENDORX_ADMIN_CHAT_ID") || "").trim();
              if (adminChatId) {
                const role = String(moderatorProfile?.role || "").toLowerCase();
                const roleLabel = ["master_admin", "admin", "administrator"].includes(role)
                  ? "администратор"
                  : "модератор";
                const moderatorLabel = [
                  displayName,
                  user.username ? `@${cleanText(user.username, 32)}` : "",
                ].filter(Boolean).join(" ");
                const adminMessage = moderationStatus === "approved"
                  ? [
                      "✅ ЗАЯВКА ОДОБРЕНА",
                      "",
                      `Заявка №: ${moderatedCommunity.id}`,
                      `Название: ${publicationTitle}`,
                      `Тип: ${kindLabel}`,
                      `Одобрил: ${roleLabel} ${moderatorLabel}`,
                    ].join("\n")
                  : [
                      "❌ ЗАЯВКА ОТКЛОНЕНА",
                      "",
                      `Заявка №: ${moderatedCommunity.id}`,
                      `Название: ${publicationTitle}`,
                      `Тип: ${kindLabel}`,
                      `Отклонил: ${roleLabel} ${moderatorLabel}`,
                      `Причина: ${moderationReason || "не указана"}`,
                    ].join("\n");

                const adminTelegramResponse = await fetch(`https://api.telegram.org/bot${verifiedBotToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: adminChatId,
                    text: adminMessage,
                    disable_web_page_preview: true,
                  }),
                });
                const adminTelegramResult = await adminTelegramResponse.json().catch(() => null);
                if (!adminTelegramResponse.ok || adminTelegramResult?.ok !== true) {
                  console.error("Moderation admin Telegram notification failed", adminTelegramResult?.error_code ?? adminTelegramResponse.status);
                }
              }
            }
          } catch (notificationError) {
            console.error("Moderation Telegram notification failed", notificationError);
          }
        }

        data = true;
        break;
      }

      case "upload_url": {
        await rpc("tx_rate_limit_consume", { p_action: "upload", p_actor: tid, p_limit: 10, p_window_seconds: 3600 });
        const path = `a/${tid}/${crypto.randomUUID()}.jpg`;
        const signed: any = await db.storage.from("community-media").createSignedUploadUrl(path);
        if (signed.error || !signed.data) {
          console.error("signed upload error:", signed.error?.message);
          throw new ApiError(500, "Не удалось подготовить загрузку изображения. Проверьте, что выполнена миграция 004.");
        }
        data = { path, token: signed.data.token };
        break;
      }
      case "unvote": {
        await rpc("tx_rate_limit_consume", { p_action: "unvote", p_actor: tid, p_limit: 20, p_window_seconds: 3600 });
        data = await rpc("tx_unvote", { p_tid: tid, p_id: positiveInteger(body.id) });
        break;
      }
      case "notes_read": {
        data = await rpc("tx_notes_read", { p_tid: tid, p_id: body.id ? positiveInteger(body.id) : null });
        break;
      }
      case "admin_delete": {
        const { data: actor, error: actorError } = await db
          .from("profiles").select("role,banned").eq("tid", tid).maybeSingle();
        if (actorError || !["master_admin", "admin", "moderator"].includes(actor?.role) || actor?.banned) {
          throw new ApiError(403, "Недостаточно прав");
        }
        const communityId = positiveInteger(body.id);
        const { data: target, error: targetError } = await db
          .from("communities").select("id,title,username,avatar_path").eq("id", communityId).maybeSingle();
        if (targetError) throw new ApiError(500, "Не удалось найти сообщество");
        if (!target) throw new ApiError(404, "Сообщество уже удалено");
        const { error: deleteError } = await db.from("communities").delete().eq("id", communityId);
        if (deleteError) {
          console.error("Permanent community delete failed:", deleteError.code);
          throw new ApiError(500, "Не удалось полностью удалить сообщество. Проверьте связи в базе данных.");
        }
        // Удаляем фотографию канала из Storage; сбой очистки файла не возвращает запись в каталог.
        if (target.avatar_path) {
          const { error: mediaError } = await db.storage.from("community-media").remove([target.avatar_path]);
          if (mediaError) console.error("Community avatar cleanup failed:", mediaError.message);
        }
        const { error: auditError } = await db.from("audit_log").insert({
          actor_tid: tid, action: "community_permanent_delete",
          target: "community:" + communityId,
          details: { title: target.title, username: target.username }
        });
        if (auditError) console.error("Permanent delete audit write failed:", auditError.code);
        data = true;
        break;
      }
      case "admin_restore": {
        throw new ApiError(410, "Восстановление удалённых сообществ отключено: удаление теперь окончательное.");
      }
      case "admin_list": {
        // Старые записи, ранее скрытые через deleted_at, окончательно очищаются
        // при открытии панели. Новые удаления сразу выполняются через DELETE.
        const legacyDeleted = await rpc("tx_admin_communities", {
          p_actor: tid,
          p_deleted: true,
        }) as Array<{ id: number; avatar_path?: string | null }>;
        if (Array.isArray(legacyDeleted) && legacyDeleted.length) {
          const ids = legacyDeleted.map((item) => positiveInteger(item.id));
          const avatarPaths = legacyDeleted
            .map((item) => item.avatar_path)
            .filter((path): path is string => typeof path === "string" && path.length > 0);
          if (avatarPaths.length) {
            const { error: mediaError } = await db.storage.from("community-media").remove(avatarPaths);
            if (mediaError) console.error("Legacy deleted community media cleanup failed:", mediaError.message);
          }
          const { error: purgeError } = await db.from("communities").delete().in("id", ids);
          if (purgeError) {
            console.error("Legacy deleted communities purge failed:", purgeError.code);
            throw new ApiError(500, "Не удалось окончательно очистить старые удалённые сообщества.");
          }
        }
        data = await rpc("tx_admin_communities", {
          p_actor: tid,
          p_deleted: false,
        });
        break;
      }

      // Управление персоналом доступно исключительно master_admin.
      case "staff_list": {
        const { data: actor, error: actorError } = await db
          .from("profiles").select("role,banned").eq("tid", tid).maybeSingle();
        if (actorError || actor?.role !== "master_admin" || actor?.banned) {
          throw new ApiError(403, "Управлять ролями может только главный администратор");
        }
        const { data: staff, error: staffError } = await db
          .from("profiles")
          .select("tid,name,username,role,last_seen")
          .in("role", ["master_admin", "admin", "moderator"])
          .order("role", { ascending: true })
          .order("name", { ascending: true })
          .limit(200);
        if (staffError) throw new ApiError(500, "Не удалось загрузить список персонала");
        data = staff ?? [];
        break;
      }

      case "staff_search": {
        const { data: actor, error: actorError } = await db
          .from("profiles").select("role,banned").eq("tid", tid).maybeSingle();
        if (actorError || actor?.role !== "master_admin" || actor?.banned) {
          throw new ApiError(403, "Искать пользователей для назначения ролей может только главный администратор");
        }
        const needle = cleanText(body.query, 64).replace(/^@/, "");
        if (!needle) throw new ApiError(400, "Введи Telegram ID или username");
        let lookup = db.from("profiles").select("tid,name,username,role,last_seen");
        if (/^\\d+$/.test(needle)) {
          const targetTid = Number(needle);
          if (!Number.isSafeInteger(targetTid) || targetTid <= 0) throw new ApiError(400, "Некорректный Telegram ID");
          lookup = lookup.eq("tid", targetTid);
        } else {
          if (!/^[a-zA-Z0-9_]{4,32}$/.test(needle)) throw new ApiError(400, "Некорректный username");
          lookup = lookup.ilike("username", needle);
        }
        const { data: found, error: findError } = await lookup.maybeSingle();
        if (findError) throw new ApiError(500, "Не удалось выполнить поиск пользователя");
        if (!found) throw new ApiError(404, "Пользователь не найден. Он должен хотя бы один раз открыть Bendor-X.");
        data = found;
        break;
      }

      case "staff_set_role": {
        const { data: actor, error: actorError } = await db
          .from("profiles").select("role,banned").eq("tid", tid).maybeSingle();
        if (actorError || actor?.role !== "master_admin" || actor?.banned) {
          throw new ApiError(403, "Выдавать и снимать роли может только главный администратор");
        }
        const targetTid = positiveInteger(body.target_tid);
        const nextRole = cleanText(body.role, 20);
        if (!["user", "admin", "moderator"].includes(nextRole)) {
          throw new ApiError(400, "Недопустимая роль");
        }
        if (targetTid === tid) throw new ApiError(400, "Нельзя изменить собственную роль из этой панели");
        const { data: target, error: targetError } = await db
          .from("profiles").select("tid,name,username,role").eq("tid", targetTid).maybeSingle();
        if (targetError) throw new ApiError(500, "Не удалось проверить пользователя");
        if (!target) throw new ApiError(404, "Пользователь не найден");
        if (target.role === "master_admin") throw new ApiError(403, "Нельзя изменить роль главного администратора");
        const { error: updateError } = await db.from("profiles").update({ role: nextRole }).eq("tid", targetTid);
        if (updateError) throw new ApiError(500, "Не удалось изменить роль пользователя");
        const { error: auditError } = await db.from("audit_log").insert({
          actor_tid: tid,
          action: "staff_role_change",
          target: "user:" + targetTid,
          details: { from: target.role, to: nextRole, username: target.username ?? null }
        });
        if (auditError) console.error("Staff role audit write failed:", auditError.code);
        data = { tid: targetTid, role: nextRole };
        break;
      }

      default: {
        throw new ApiError(400, "Неизвестное действие");
      }
    }

    return response(200, {
      ok: true,
      data,
    });

  } catch (error) {
    if (error instanceof ApiError) {
      return response(error.status, {
        error: error.message,
      });
    }

    console.error("Unexpected API error:", error);

    return response(500, {
      error: "Внутренняя ошибка сервера",
    });
  }
});
