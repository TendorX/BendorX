
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

    // Проверяем оба допустимых имени секрета. Если старый секрет
    // TENDORX_BOT_TOKEN остался от прежнего бота, пробуем BOT_TOKEN.
    const botTokens = Array.from(new Set([
      Deno.env.get("TENDORX_BOT_TOKEN"),
      Deno.env.get("BOT_TOKEN"),
    ].map((value) => (value || "").trim()).filter(Boolean)));

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
    let lastAuthError: unknown = null;

    for (const candidateToken of botTokens) {
      try {
        user = await verifyTelegram(
          String(body.initData ?? ""),
          candidateToken,
        );
        verified = true;
        break;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        lastAuthError = error;
      }
    }

    if (!verified) {
      if (lastAuthError) throw lastAuthError;
      throw new ApiError(500, "Ошибка конфигурации сервера");
    }

    // Telegram ID берётся только из проверенного initData.
    const tid: number = user.id;

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

    let data: unknown;

    switch (body.action) {
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

      case "submit": {
        const tags = String(body.tags ?? "")
          .split(",")
          .map((tag: string) => cleanText(tag, 24))
          .filter(Boolean)
          .slice(0, 5);

        data = await rpc("tx_submit", {
          p_tid: tid,
          p_username: cleanText(body.username, 40),
          p_title: cleanText(body.title, 80),
          p_desc: cleanText(body.description, 500),
          p_cat: positiveInteger(body.category),
          p_tags: tags,
          p_kind: cleanText(body.kind, 12),
        });

        const avatar = typeof body.avatar === "string" ? body.avatar : "";
        if (avatar) {
          if (!new RegExp(`^a/${tid}/[0-9a-f-]{36}\\.jpg$`).test(avatar)) throw new ApiError(400, "Некорректное изображение");
          const found: any = await db.storage.from("community-media").list(`a/${tid}`, { search: avatar.split("/")[2] });
          if (!found.data?.length) throw new ApiError(400, "Изображение не загружено, попробуйте ещё раз");
          const up = await db.from("communities").update({ avatar_path: avatar }).eq("id", data as number).eq("owner_tid", tid);
          if (up.error) console.error("avatar update error:", up.error.code);
        }

        break;
      }

      case "queue": {
        const q = ((await rpc("tx_queue", { p_actor: tid })) ?? []) as Array<{ id: number }>;
        const m: any = q.length ? await db.from("communities").select("id,avatar_path").in("id", q.map((x) => x.id)) : { data: [] };
        const mp = new Map((m.data ?? []).map((x: any) => [x.id, x.avatar_path]));
        data = q.map((x) => ({ ...x, avatar_path: mp.get(x.id) ?? null }));
        break;
      }

      case "stats": {
        data = await rpc("tx_stats", {
          p_actor: tid,
        });

        break;
      }

      case "moderate": {
        await rpc("tx_moderate", {
          p_actor: tid,
          p_id: positiveInteger(body.id),
          p_status: cleanText(body.status, 12),
          p_reason: cleanText(body.reason, 300),
        });

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
        await rpc("tx_admin_delete", { p_actor: tid, p_id: positiveInteger(body.id) });
        data = true;
        break;
      }
      case "admin_restore": {
        await rpc("tx_admin_restore", { p_actor: tid, p_id: positiveInteger(body.id) });
        data = true;
        break;
      }
      case "admin_list": {
        data = await rpc("tx_admin_communities", { p_actor: tid, p_deleted: body.deleted === true });
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
