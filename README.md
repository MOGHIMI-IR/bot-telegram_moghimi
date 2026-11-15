# Moghimi V2Ray — Telegram Bot

کد رسمی بات فروش اشتراک و پشتیبانی Moghimi V2Ray.

## ساختار

- `supabase/functions/moghimi-telegram/index.ts`: کد وب‌هوک تلگرام (Supabase Edge Function).
- `.env.example`: نام متغیرهای لازم؛ هیچ مقدار محرمانه‌ای در این مخزن قرار نمی‌گیرد.

## معماری اجرا

بات روی **Supabase Edge Functions** اجرا می‌شود؛ GitHub فقط برای نگهداری نسخهٔ کد و تاریخچهٔ تغییرات است. خالی‌بودن این مخزن به‌تنهایی باعث ازکارافتادن بات نمی‌شود، اما نگهداری کد در مخزن برای پشتیبان‌گیری و انتشار نسخه‌ها توصیه می‌شود.

Project ref فعلی: `qaxiunpklkbgfjwmpwfp`

Endpoint:
`https://qaxiunpklkbgfjwmpwfp.supabase.co/functions/v1/moghimi-telegram`

## پیش‌نیاز امنیتی

**توکن قبلی بات را دوباره استفاده نکن.** چون قبلاً در گفت‌وگو افشا شده، ابتدا در BotFather آن را باطل و توکن تازه تولید کن. توکن تازه، رمز وب‌هوک، شناسهٔ عددی مدیران و شماره کارت را فقط در Supabase Secrets ذخیره کن؛ هرگز آن‌ها را داخل GitHub، APK یا این فایل README ننویس.

Secrets موردنیاز:

- `TELEGRAM_BOT_TOKEN`: توکن تازهٔ بات از BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: رشتهٔ تصادفی حداقل ۳۲ کاراکتری؛ دقیقاً همان مقداری که هنگام ثبت webhook استفاده می‌شود.
- `TELEGRAM_ADMIN_IDS`: شناسهٔ عددی مدیران تلگرام، چند شناسه با کاما جدا شوند.
- `PAYMENT_CARD_NUMBER`: شماره کارت مقصد پرداخت.
- Supabase خودش `SUPABASE_URL` و کلید دسترسی سرویس را برای Edge Function فراهم می‌کند؛ service-role key را در کلاینت اندروید قرار نده.

نمونهٔ نام متغیرها در `.env.example` آمده و مقادیر آن عمداً خالی‌اند.

## انتشار تابع

با Supabase CLI و پروژهٔ درست لینک‌شده:

```bash
supabase functions deploy moghimi-telegram --project-ref qaxiunpklkbgfjwmpwfp --no-verify-jwt
```

تابع در مسیر `supabase/functions/moghimi-telegram/index.ts` قرار دارد. قبل از انتشار، همهٔ Secrets بالا را در Supabase تنظیم کن.

## ثبت وب‌هوک تلگرام

پس از تولید و تنظیم توکن و secret جدید، در ترمینال امن خود:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  --data-urlencode "url=https://qaxiunpklkbgfjwmpwfp.supabase.co/functions/v1/moghimi-telegram" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
```

وضعیت را بررسی کن:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

در پاسخ باید URL همین Edge Function دیده شود و خطای webhook نداشته باشی. تا وقتی توکن جدید و Secrets تنظیم نشده‌اند، webhook را با توکن افشاشده فعال نکن.

## روند خرید و فعال‌سازی اشتراک

1. کاربر در بات `/start` را می‌زند و «خرید اشتراک» را انتخاب می‌کند.
2. طرح ثابت یا سفارشی را انتخاب می‌کند. طرح سفارشی برای تعیین مبلغ به مدیر ارجاع می‌شود.
3. کاربر پرداخت می‌کند و تصویر رسید را در همان گفت‌وگو می‌فرستد.
4. مدیر با `/orders` سفارش‌ها را می‌بیند و رسید را تأیید یا رد می‌کند.
5. پس از تأیید، بات کد فعال‌سازی یک‌بارمصرف می‌سازد و برای کاربر می‌فرستد.
6. کاربر در برنامه وارد صفحهٔ «پروفایل»، دستگاهش را با همان نام کاربری تلگرام ثبت می‌کند و کد را در «فعال‌سازی اشتراک» وارد می‌کند.
7. سرور کد را اعتبارسنجی و مصرف می‌کند و اشتراک را به همان دستگاه وصل می‌کند؛ سپس برنامه وضعیت و سهمیه را تازه می‌کند.

**تأیید پرداخت فعلاً دستی است** و مدیر باید رسید را بررسی کند. بات به‌تنهایی تراکنش بانکی را تأیید نمی‌کند.

## فرمان‌های مدیر

- `/orders` یا `/admin`: سفارش‌های باز.
- `/threads`: گفت‌وگوهای پشتیبانی باز.
- دکمه‌های داخل پیام‌ها: تعیین مبلغ، تأیید/رد رسید، پاسخ و بستن گفت‌وگو.

## نکات مهم

- کد فعال‌سازی یک‌بارمصرف است و فقط برای مدت محدود قابل استفاده است.
- نام کاربری تلگرام سفارش باید با حساب تلگرام فرستنده یکی باشد.
- این مخزن عمومی است؛ هیچ توکن، رمز، service-role key یا اطلاعات محرمانه‌ای را اینجا commit نکن.
