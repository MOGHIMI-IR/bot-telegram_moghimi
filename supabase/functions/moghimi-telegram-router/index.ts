import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BOT_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const MOBILE_WEBHOOK_SECRET = Deno.env.get("MOBILE_BOT_WEBHOOK_SECRET") || BOT_SECRET;
const MOBILE_FUNCTION_URL = "https://qaxiunpklkbgfjwmpwfp.supabase.co/functions/v1/moghimi-telegram";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function forwardToAndroidBot(update: unknown): Promise<Response> {
  const response = await fetch(MOBILE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": MOBILE_WEBHOOK_SECRET
    },
    body: JSON.stringify(update)
  });
  const raw = await response.text();
  if (!response.ok) {
    console.error("android_bot_forward_failed", response.status);
    return json({ ok: false, code: "android_bot_temporarily_unavailable" }, 502);
  }
  let result: any = null;
  try { result = raw ? JSON.parse(raw) : null; } catch { }
  if (result?.ok === false) {
    console.error("android_bot_forward_rejected", result.code ?? "unknown");
    return json({ ok: false, code: "android_bot_rejected_update" }, 502);
  }
  return json({ ok: true });
}

Deno.serve(async (request: Request) => {
  if (request.method === "GET" || request.method === "HEAD") {
    const ready = Boolean(BOT_SECRET && MOBILE_WEBHOOK_SECRET);
    const response = json({
      ok: ready,
      service: "moghimi-telegram-router",
      mobile_forward_configured: Boolean(MOBILE_WEBHOOK_SECRET),
      platform: "android_only"
    }, ready ? 200 : 503);
    return request.method === "HEAD"
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  }

  if (request.method !== "POST")
    return json({ ok: false, code: "method_not_allowed" }, 405);

  if (!BOT_SECRET || !MOBILE_WEBHOOK_SECRET)
    return json({ ok: false, code: "not_configured" }, 503);

  if (request.headers.get("x-telegram-bot-api-secret-token") !== BOT_SECRET)
    return json({ ok: false }, 401);

  try {
    const update = await request.json();
    return await forwardToAndroidBot(update);
  } catch (error) {
    console.error("moghimi-telegram-router", error instanceof Error ? error.message : "forward_failed");
    return json({ ok: false, code: "forward_failed" }, 502);
  }
});
