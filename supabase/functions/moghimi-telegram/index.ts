import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const HOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const URL = Deno.env.get("SUPABASE_URL") ?? "";
const DB_KEY = (() => {
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""; }
  catch { return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""; }
})();
const ADMINS = new Set((Deno.env.get("TELEGRAM_ADMIN_IDS") ?? "").split(",").map(s => s.trim()).filter(Boolean));
const CARD = Deno.env.get("PAYMENT_CARD_NUMBER") ?? "";
const TG = "https://api.telegram.org/bot" + TOKEN;
const EXPECTED_BOT_USERNAME = "Moghimi_vpn_bot";
const json = (v: unknown, status=200) => new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json"}});
const html = (s: string) => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
function dbHeaders() {
  const h: Record<string,string> = { apikey: DB_KEY, "content-type":"application/json" };
  if (DB_KEY.startsWith("eyJ")) h.authorization = "Bearer " + DB_KEY;
  return h;
}
async function db(path:string,method="GET",body?:unknown,prefer?:string) {
  const h=dbHeaders(); if(prefer) h.prefer=prefer;
  const r=await fetch(URL+"/rest/v1/"+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text(); if(!r.ok) throw new Error("db_"+r.status);
  return t?JSON.parse(t):null;
}
async function tg(method:string,data:Record<string,unknown>) {
  const r=await fetch(TG+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
  const v=await r.json(); if(!v.ok) throw new Error("telegram_"+method);
  return v.result;
}
async function send(chat:number|string,text:string,markup?:unknown) {
  return tg("sendMessage",{chat_id:chat,text,parse_mode:"HTML",...(markup?{reply_markup:markup}:{})});
}
async function setState(id:number,chat:number,state:string,data:Record<string,unknown>={}) {
  await db("bot_user_states?on_conflict=telegram_user_id","POST",
    {telegram_user_id:id,telegram_chat_id:chat,state,data,updated_at:new Date().toISOString()},
    "resolution=merge-duplicates");
}
async function getState(id:number) {
  const r=await db("bot_user_states?telegram_user_id=eq."+id+"&select=*");
  return r[0]??null;
}
function mainMenu() {
  return {inline_keyboard:[
    [{text:"🛒 خرید اشتراک",callback_data:"buy"}],
    [{text:"💬 ارتباط با پشتیبانی",callback_data:"support"}]
  ]};
}
function plansMenu() {
  return {inline_keyboard:[
    [{text:"۱ ماهه · ۱۰ گیگ · ۱۰۰٬۰۰۰ تومان",callback_data:"fixed"}],
    [{text:"حجم و مدت دلخواه",callback_data:"custom"}],
    [{text:"بازگشت",callback_data:"home"}]
  ]};
}
function code() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
}
async function sendAdmins(text:string,markup?:unknown) {
  for(const admin of ADMINS) { try { await send(admin,text,markup); } catch(e) { console.error("admin_notify",String(e)); } }
}
function receiptButtons(id:string) {
  return {inline_keyboard:[
    [{text:"✅ تأیید و صدور کد",callback_data:"approve:"+id}],
    [{text:"❌ رد رسید",callback_data:"reject:"+id}]
  ]};
}
async function orderPayment(order:any) {
  await send(order.telegram_chat_id,
    "سفارش شما ثبت شد.\n\nنام کاربری: <b>@"+html(order.telegram_username)+"</b>\nمدت: <b>"+order.plan_days+" روز</b>\nحجم: <b>"+(Number(order.plan_bytes)/1073741824).toFixed(2)+" گیگابایت</b>\nمبلغ: <b>"+Number(order.amount_toman).toLocaleString("en-US")+" تومان</b>\n\nشماره کارت:\n<code>"+CARD+"</code>\n\nپس از واریز، تصویر فیش را همین‌جا ارسال کن.\nمهلت پرداخت ۱۲ ساعت است؛ بعد از آن سفارش منقضی می‌شود.");
  await setState(Number(order.telegram_user_id),Number(order.telegram_chat_id),"receipt",{order_id:order.id});
}
async function expireOrders(userId:number) {
  await db("purchase_orders?telegram_user_id=eq."+userId+"&status=in.(awaiting_payment,awaiting_quote)&payment_deadline_at=lt."+encodeURIComponent(new Date().toISOString()),
    "PATCH",{status:"expired"},"return=minimal");
}
async function activeThread(userId:number) {
  const r=await db("support_threads?telegram_user_id=eq."+userId+"&status=eq.open&select=*&order=opened_at.desc&limit=1");
  return r[0]??null;
}
async function createOrder(user:any,phone:string,state:any) {
  const data=state.data;
  const order={
    telegram_user_id:user.id, telegram_username:data.username, telegram_chat_id:user.chat_id,
    phone, plan_kind:data.plan_kind, plan_bytes:data.plan_bytes, plan_days:data.plan_days,
    amount_toman:data.amount_toman??null,
    status:data.plan_kind==="fixed"?"awaiting_payment":"awaiting_quote",
    payment_deadline_at:new Date(Date.now()+12*3600000).toISOString()
  };
  const rows=await db("purchase_orders","POST",order,"return=representation");
  const o=rows[0];
  if(data.plan_kind==="fixed") await orderPayment(o);
  else {
    await setState(user.id,user.chat_id,"idle");
    await send(user.chat_id,"درخواست اشتراک دلخواه ثبت شد؛ مبلغ پس از بررسی به همین‌جا اعلام می‌شود.");
    await sendAdmins("🧾 درخواست قیمت‌گذاری اشتراک دلخواه\nسفارش: <code>"+o.id+"</code>\nکاربر: @"+html(o.telegram_username)+"\nشماره: "+o.phone+"\nمدت: "+o.plan_days+" روز\nحجم: "+(o.plan_bytes/1073741824).toFixed(2)+" GB",
      {inline_keyboard:[[{text:"💰 تعیین مبلغ",callback_data:"quote:"+o.id}]]});
  }
}
async function callback(update:any) {
  const q=update.callback_query, user=q.from, chat=q.message?.chat?.id??user.id, d=String(q.data??"");
  await tg("answerCallbackQuery",{callback_query_id:q.id});
  if(d==="home") return send(chat,"به بات Moghimi V2Ray خوش آمدی. یکی از گزینه‌ها را انتخاب کن:",mainMenu());
  if(d==="buy") return send(chat,"طرح اشتراک را انتخاب کن:",plansMenu());
  if(d==="fixed") {
    await setState(user.id,chat,"username",{plan_kind:"fixed",plan_days:30,plan_bytes:10*1073741824,amount_toman:100000});
    return send(chat,"نام کاربری تلگرامت را دقیق وارد کن (بدون @).");
  }
  if(d==="custom") {
    await setState(user.id,chat,"days");
    return send(chat,"مدت اشتراک را به روز وارد کن (۱ تا ۳۶۵۰).");
  }
  if(d==="support") {
    const old=await activeThread(user.id);
    if(old) { await setState(user.id,chat,"support",{thread_id:old.id}); return send(chat,"مکالمه پشتیبانی باز است. پیام یا فایل بفرست؛ برای پایان /close را بزن."); }
    const rows=await db("support_threads","POST",{telegram_user_id:user.id,telegram_chat_id:chat,telegram_username:user.username??null,status:"open"},"return=representation");
    const th=rows[0];
    await setState(user.id,chat,"support",{thread_id:th.id});
    await send(chat,"به پشتیبانی وصل شدی. پیام یا فایل خودت را بفرست؛ برای پایان /close را بزن.");
    await sendAdmins("💬 گفت‌وگوی پشتیبانی جدید\nکاربر: @"+html(user.username??String(user.id))+"\nشناسه: <code>"+th.id+"</code>",
      {inline_keyboard:[[{text:"↩️ پاسخ",callback_data:"reply:"+th.id},{text:"🔒 بستن",callback_data:"close:"+th.id}]]});
    return;
  }
  if(!ADMINS.has(String(user.id))) return;
  if(d.startsWith("quote:")) {
    await setState(user.id,chat,"admin_quote",{order_id:d.slice(6)});
    return send(chat,"مبلغ را به تومان و فقط به‌صورت عدد وارد کن.");
  }
  if(d.startsWith("approve:")) {
    const id=d.slice(8);
    const rows=await db("purchase_orders?id=eq."+id+"&select=*"), o=rows[0];
    if(!o||o.status!=="receipt_submitted") return send(chat,"سفارش برای تأیید در وضعیت معتبر نیست.");
    const raw=code(), digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
    const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
    const codes=await db("activation_codes","POST",{
      order_id:o.id,code_hash:hash,telegram_user_id:o.telegram_user_id,
      telegram_username:o.telegram_username,phone:o.phone,granted_bytes:o.plan_bytes,
      duration_days:o.plan_days,expires_at:new Date(Date.now()+7*86400000).toISOString()
    },"return=representation");
    await db("purchase_orders?id=eq."+id,"PATCH",{status:"approved",reviewed_at:new Date().toISOString(),reviewed_by:user.id,activation_code_id:codes[0].id},"return=minimal");
    await send(o.telegram_chat_id,"پرداخت تأیید شد ✅\nکد فعال‌سازی:\n<code>"+raw+"</code>\n\nدر برنامه، صفحه پروفایل، کد را ثبت کن. کد یک‌بارمصرف است.");
    return send(chat,"تأیید شد و کد فعال‌سازی برای کاربر ارسال شد.");
  }
  if(d.startsWith("reject:")) {
    const id=d.slice(7), rows=await db("purchase_orders?id=eq."+id+"&select=*"), o=rows[0];
    if(o?.status==="receipt_submitted") {
      await db("purchase_orders?id=eq."+id,"PATCH",{status:"rejected",reviewed_at:new Date().toISOString(),reviewed_by:user.id},"return=minimal");
      await send(o.telegram_chat_id,"رسید تأیید نشد. برای پیگیری با پشتیبانی پیام بده.");
      await send(chat,"رسید رد شد.");
    }
    return;
  }
  if(d.startsWith("reply:")) {
    await setState(user.id,chat,"admin_reply",{thread_id:d.slice(6)});
    return send(chat,"متن یا فایل پاسخ را ارسال کن.");
  }
  if(d.startsWith("close:")) {
    const id=d.slice(6), rows=await db("support_threads?id=eq."+id+"&select=telegram_chat_id,status"), th=rows[0];
    if(th?.status==="open") {
      await db("support_threads?id=eq."+id,"PATCH",{status:"closed",closed_at:new Date().toISOString(),closed_by:user.id},"return=minimal");
      await send(th.telegram_chat_id,"مکالمه پشتیبانی پایان یافت. هر زمان خواستی می‌توانی دوباره پیام بدهی.");
      await send(chat,"مکالمه بسته شد.");
    }
  }
}
async function adminMessage(msg:any,st:any) {
  const user=msg.from, chat=msg.chat.id, text=String(msg.text??msg.caption??"").trim();
  if(st?.state==="admin_quote") {
    const amount=Number(text.replace(/[,\s٬]/g,""));
    if(!Number.isSafeInteger(amount)||amount<1000||amount>1000000000) return send(chat,"مبلغ معتبر نیست.");
    const id=String(st.data.order_id), rows=await db("purchase_orders?id=eq."+id+"&select=*"), o=rows[0];
    if(!o||o.status!=="awaiting_quote"||Date.now()>new Date(o.payment_deadline_at).getTime()) {
      await setState(user.id,chat,"idle"); return send(chat,"این سفارش دیگر قابل قیمت‌گذاری نیست.");
    }
    await db("purchase_orders?id=eq."+id,"PATCH",{amount_toman:amount,status:"awaiting_payment",payment_deadline_at:new Date(Date.now()+12*3600000).toISOString()},"return=minimal");
    await orderPayment({...o,amount_toman:amount});
    await setState(user.id,chat,"idle"); return send(chat,"مبلغ ثبت شد و اطلاعات پرداخت ارسال شد.");
  }
  if(st?.state==="admin_reply") {
    const id=String(st.data.thread_id), rows=await db("support_threads?id=eq."+id+"&status=eq.open&select=*"), th=rows[0];
    if(!th) { await setState(user.id,chat,"idle"); return send(chat,"این مکالمه بسته شده است."); }
    const photo=msg.photo?.at(-1)?.file_id, doc=msg.document?.file_id, video=msg.video?.file_id, voice=msg.voice?.file_id;
    const file=photo??doc??video??voice??null, type=photo?"photo":doc?"document":video?"video":voice?"voice":"text";
    await db("support_messages","POST",{thread_id:id,sender_kind:"admin",sender_telegram_id:user.id,message_type:type,message_text:text||null,telegram_file_id:file,telegram_message_id:msg.message_id},"return=minimal");
    if(photo) await tg("sendPhoto",{chat_id:th.telegram_chat_id,photo,caption:text||"پاسخ پشتیبانی"});
    else if(doc) await tg("sendDocument",{chat_id:th.telegram_chat_id,document:doc,caption:text||"پاسخ پشتیبانی"});
    else if(video) await tg("sendVideo",{chat_id:th.telegram_chat_id,video,caption:text||"پاسخ پشتیبانی"});
    else if(voice) await tg("sendVoice",{chat_id:th.telegram_chat_id,voice});
    else await send(th.telegram_chat_id,"پشتیبانی:\n"+html(text));
    await db("support_threads?id=eq."+id,"PATCH",{last_message_at:new Date().toISOString()},"return=minimal");
    await setState(user.id,chat,"idle"); return send(chat,"پاسخ ارسال شد.");
  }
  if(text==="/admin"||text==="/orders") {
    const orders=await db("purchase_orders?status=in.(awaiting_quote,awaiting_payment,receipt_submitted)&select=id,telegram_username,phone,plan_bytes,plan_days,amount_toman,status&order=created_at.desc&limit=20");
    if(!orders.length) return send(chat,"سفارش بازی نیست.");
    for(const o of orders) {
      const k=o.status==="receipt_submitted"?receiptButtons(o.id):o.status==="awaiting_quote"?{inline_keyboard:[[{text:"تعیین مبلغ",callback_data:"quote:"+o.id}]]}:undefined;
      await send(chat,"سفارش <code>"+o.id+"</code>\n@"+html(o.telegram_username)+" · "+o.plan_days+" روز · "+(o.plan_bytes/1073741824).toFixed(2)+"GB · "+o.status,k);
    }
    return;
  }
  if(text==="/threads") {
    const threads=await db("support_threads?status=eq.open&select=id,telegram_user_id,telegram_username&order=last_message_at.desc&limit=20");
    for(const th of threads) await send(chat,"مکالمه <code>"+th.id+"</code>\n@"+html(th.telegram_username??String(th.telegram_user_id)),
      {inline_keyboard:[[{text:"پاسخ",callback_data:"reply:"+th.id},{text:"بستن",callback_data:"close:"+th.id}]]});
    if(!threads.length) await send(chat,"مکالمه بازی نیست.");
    return;
  }
}
async function userMessage(msg:any,st:any) {
  const user=msg.from, chat=msg.chat.id, text=String(msg.text??msg.caption??"").trim();
  if(text==="/start") return send(chat,"سلام 👋\nبه بات رسمی Moghimi V2Ray خوش آمدی.\nیکی از گزینه‌ها را انتخاب کن:",mainMenu());
  await expireOrders(user.id);

  if(st?.state==="days") {
    const days=Number(text); if(!Number.isInteger(days)||days<1||days>3650) return send(chat,"مدت باید بین ۱ تا ۳۶۵۰ روز باشد.");
    await setState(user.id,chat,"gigabytes",{plan_days:days}); return send(chat,"حجم را به گیگابایت وارد کن (۱ تا ۵۰۰۰).");
  }
  if(st?.state==="gigabytes") {
    const gb=Number(text.replace(",",".")); if(!Number.isFinite(gb)||gb<1||gb>5000) return send(chat,"حجم باید بین ۱ تا ۵۰۰۰ گیگابایت باشد.");
    await setState(user.id,chat,"username",{plan_kind:"custom",plan_days:st.data.plan_days,plan_bytes:Math.round(gb*1073741824)});
    return send(chat,"نام کاربری تلگرامت را دقیق وارد کن (بدون @).");
  }
  if(st?.state==="username") {
    const name=text.replace(/^@/,"");
    if(!/^[A-Za-z0-9_]{5,32}$/.test(name)) return send(chat,"نام کاربری معتبر نیست.");
    if(!user.username||name.toLowerCase()!==user.username.toLowerCase()) return send(chat,"نام کاربری واردشده با نام حساب فعلی تلگرامت یکی نیست. نام کاربری دقیق همین حساب را وارد کن.");
    await setState(user.id,chat,"phone",{...st.data,username:name});
    return send(chat,"شماره موبایل را وارد کن؛ باید با 09 شروع شود و دقیقاً ۱۱ رقم باشد.");
  }
  if(st?.state==="phone") {
    if(!/^09\d{9}$/.test(text)) return send(chat,"شماره موبایل باید با ۰۹ شروع شود و دقیقاً ۱۱ رقم باشد.");
    return createOrder({id:user.id,chat_id:chat},text,st);
  }
  if(st?.state==="receipt") {
    const orderId=st.data.order_id, rows=await db("purchase_orders?id=eq."+orderId+"&telegram_user_id=eq."+user.id+"&select=*"), o=rows[0];
    if(!o||o.status!=="awaiting_payment"||Date.now()>new Date(o.payment_deadline_at).getTime()) {
      await setState(user.id,chat,"idle"); return send(chat,"مهلت پرداخت تمام شده یا سفارش معتبر نیست. برای سفارش جدید /start را بزن.");
    }
    const photo=msg.photo?.at(-1)?.file_id, doc=msg.document?.file_id, file=photo??doc;
    if(!file) return send(chat,"لطفاً عکس فیش را به‌صورت عکس یا فایل ارسال کن.");
    await db("purchase_orders?id=eq."+orderId,"PATCH",{status:"receipt_submitted",receipt_file_id:file,receipt_message_id:msg.message_id,receipt_submitted_at:new Date().toISOString()},"return=minimal");
    await sendAdmins("📥 رسید پرداخت جدید\nسفارش: <code>"+orderId+"</code>\nکاربر: @"+html(o.telegram_username)+"\nتلفن: "+o.phone+"\nمبلغ: "+Number(o.amount_toman).toLocaleString("en-US")+" تومان",receiptButtons(orderId));
    for(const admin of ADMINS) {
      try { if(photo) await tg("sendPhoto",{chat_id:admin,photo,caption:"رسید سفارش "+orderId}); else await tg("sendDocument",{chat_id:admin,document:doc,caption:"رسید سفارش "+orderId}); } catch {}
    }
    await setState(user.id,chat,"receipt_submitted",{order_id:orderId});
    return send(chat,"رسید دریافت شد ✅\nحداکثر تا یک روز کاری بررسی می‌شود و پس از تأیید، کد فعال‌سازی ارسال خواهد شد.");
  }
  if(st?.state==="receipt_submitted") return send(chat,"رسیدت در صف بررسی است. پس از تأیید، کد فعال‌سازی را همین‌جا می‌فرستیم.");

  if(text==="/close") {
    const th=await activeThread(user.id);
    if(!th) return send(chat,"مکالمه بازی نداری.");
    await db("support_threads?id=eq."+th.id,"PATCH",{status:"closed",closed_at:new Date().toISOString(),close_reason:"closed_by_user"},"return=minimal");
    await setState(user.id,chat,"idle"); await sendAdmins("کاربر @"+html(user.username??String(user.id))+" مکالمه را بست.");
    return send(chat,"مکالمه بسته شد. هر زمان خواستی دوباره به پشتیبانی پیام بده.");
  }
  const th=await activeThread(user.id);
  if(th&&(st?.state==="support"||!text.startsWith("/"))) {
    const photo=msg.photo?.at(-1)?.file_id, doc=msg.document?.file_id, video=msg.video?.file_id, voice=msg.voice?.file_id;
    const file=photo??doc??video??voice??null, type=photo?"photo":doc?"document":video?"video":voice?"voice":"text";
    await db("support_messages","POST",{thread_id:th.id,sender_kind:"user",sender_telegram_id:user.id,message_type:type,message_text:text||null,telegram_file_id:file,telegram_message_id:msg.message_id},"return=minimal");
    await db("support_threads?id=eq."+th.id,"PATCH",{last_message_at:new Date().toISOString()},"return=minimal");
    for(const admin of ADMINS) {
      try {
        await send(admin,"💬 پیام پشتیبانی\nکاربر: @"+html(user.username??String(user.id))+"\n"+html(text).slice(0,1800),
          {inline_keyboard:[[{text:"↩️ پاسخ",callback_data:"reply:"+th.id},{text:"🔒 بستن",callback_data:"close:"+th.id}]]});
        if(photo) await tg("sendPhoto",{chat_id:admin,photo});
        else if(doc) await tg("sendDocument",{chat_id:admin,document:doc});
        else if(video) await tg("sendVideo",{chat_id:admin,video});
        else if(voice) await tg("sendVoice",{chat_id:admin,voice});
      } catch {}
    }
    return send(chat,"پیامت به پشتیبانی ارسال شد ✅");
  }
  return send(chat,"برای شروع /start را بزن.",mainMenu());
}

const healthJson = (value:unknown,status=200) => new Response(JSON.stringify(value),{
  status,
  headers:{
    "content-type":"application/json",
    "cache-control":"no-store",
    "access-control-allow-origin":"https://moghimi-ir.github.io"
  }
});
async function healthCheck() {
  if(!TOKEN||!DB_KEY||!URL||!HOOK_SECRET||!CARD||ADMINS.size===0) {
    return healthJson({ok:false,code:"not_configured"},503);
  }
  try {
    // A tiny read-only database request counts as user DB activity.
    // Also verify that the Telegram token remains valid.
    await db("bot_user_states?select=telegram_user_id&limit=1");
    const me = await tg("getMe",{});
    if(!me?.is_bot || !me?.username || String(me.username).toLowerCase() !== EXPECTED_BOT_USERNAME.toLowerCase()) throw new Error("telegram_bot_check_failed");
    // Restore Telegram's webhook to this fixed official endpoint if missing.
    const expectedWebhook = "https://hxfnoaeyjnkecegpppcy.supabase.co/functions/v1/moghimi-telegram-router";
    const routerHealthResponse = await fetch(expectedWebhook);
    let routerHealth: any = null;
    try { routerHealth = await routerHealthResponse.json(); } catch {}
    if (!routerHealthResponse.ok || !routerHealth?.ok || !routerHealth?.mobile_forward_configured) {
      return healthJson({
        ok:false,service:"moghimi-telegram",database:"ok",telegram:"ok",
        webhook:"router_not_ready",router_database:routerHealth?.windows_database??false,
        mobile_forward:routerHealth?.mobile_forward_configured??false
      },503);
    }
    let webhook = await tg("getWebhookInfo",{});
    let webhookSetAttempted = false;
    if(webhook?.url !== expectedWebhook) {
      await tg("setWebhook",{
        url:expectedWebhook,
        secret_token:HOOK_SECRET,
        allowed_updates:["message","callback_query"]
      });
      webhookSetAttempted = true;
      webhook = await tg("getWebhookInfo",{});
    }
    const webhookUrlMatches = webhook?.url === expectedWebhook;
    const webhookLastError = typeof webhook?.last_error_message === "string"
      ? webhook.last_error_message : null;
    const webhookReady = webhookUrlMatches;
    return healthJson({
      ok:webhookReady,
      service:"moghimi-telegram",
      database:"ok",
      telegram:"ok",
      webhook:webhookReady ? "ok" : "not_ready",
      webhook_url:webhook?.url ?? null,
      webhook_url_matches:webhookUrlMatches,
      webhook_pending_update_count: Number(webhook?.pending_update_count ?? 0),
      webhook_last_error_date: webhook?.last_error_date ?? null,
      webhook_last_error_message: webhookLastError,
      webhook_set_attempted:webhookSetAttempted,
      bot_username:me.username
    },webhookReady ? 200 : 503);
  } catch(e) {
    console.error("moghimi-health",e instanceof Error?e.message:"health_check_failed");
    return healthJson({ok:false,code:"health_check_failed"},503);
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==="GET" || req.method==="HEAD") {
    const result = await healthCheck();
    if(req.method==="HEAD") {
      return new Response(null,{status:result.status,headers:result.headers});
    }
    return result;
  }
  if(req.method!=="POST") return json({ok:false},405);
  if(!TOKEN||!DB_KEY||!URL||!HOOK_SECRET||!CARD||ADMINS.size===0) return json({ok:false,code:"not_configured"},503);
  if(req.headers.get("x-telegram-bot-api-secret-token")!==HOOK_SECRET) return json({ok:false},401);
  try {
    const u=await req.json();
    if(u.callback_query) {
      await callback(u);
    } else if(u.message) {
      const m=u.message, admin=ADMINS.has(String(m.from?.id));
      const st=await getState(m.from.id);
      if(admin) await adminMessage(m,st);
      else await userMessage(m,st);
    }
    return json({ok:true});
  } catch(e) {
    console.error("moghimi-telegram",e instanceof Error?e.message:"failed");
    return json({ok:false},500);
  }
});
