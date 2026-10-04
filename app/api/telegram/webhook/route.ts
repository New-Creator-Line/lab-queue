import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { telegramAuthChallenges } from "@/db/schema";
import {
  authorizeTelegramProfile,
  TelegramAccessError,
} from "@/lib/telegram-auth";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    from?: {
      id?: number | string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    text?: string;
  };
};

function telegramApi(method: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token ? `https://api.telegram.org/bot${token}/${method}` : null;
}

async function sendMessage(
  chatId: number | string,
  text: string,
  siteUrl?: string,
  buttonText?: string,
) {
  const endpoint = telegramApi("sendMessage");
  if (!endpoint) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (siteUrl && buttonText) {
    body.reply_markup = {
      inline_keyboard: [[{ text: buttonText, url: siteUrl }]],
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`);
  }
}

async function confirmLogin(
  token: string,
  message: NonNullable<TelegramUpdate["message"]>,
) {
  const chatId = message.chat?.id;
  const sender = message.from;
  const telegramId = sender?.id;
  const firstName = sender?.first_name?.trim();
  if (chatId === undefined || telegramId === undefined || !firstName) return false;

  let accessError: TelegramAccessError | null = null;
  try {
    await authorizeTelegramProfile({
      id: String(telegramId),
      firstName,
      lastName: sender?.last_name?.trim() || null,
      username: sender?.username?.trim() || null,
      photoUrl: null,
    });
  } catch (error) {
    if (error instanceof TelegramAccessError) accessError = error;
    else throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  const confirmed = await db
    .update(telegramAuthChallenges)
    .set({
      telegramId: String(telegramId),
      firstName,
      lastName: sender?.last_name?.trim() || null,
      username: sender?.username?.trim() || null,
    })
    .where(
      and(
        eq(telegramAuthChallenges.token, token),
        gt(telegramAuthChallenges.expiresAt, now),
        isNull(telegramAuthChallenges.consumedAt),
        isNull(telegramAuthChallenges.telegramId),
      ),
    )
    .returning({ token: telegramAuthChallenges.token });

  if (confirmed.length === 0) {
    const [alreadyConfirmed] = await db
      .select()
      .from(telegramAuthChallenges)
      .where(
        and(
          eq(telegramAuthChallenges.token, token),
          eq(telegramAuthChallenges.telegramId, String(telegramId)),
        ),
      )
      .limit(1);

    if (alreadyConfirmed) {
      await sendMessage(
        chatId,
        "Вход уже подтверждён ✅\n\nВы в системе. Можете возвращаться во вкладку браузера к расписанию.",
      );
      return true;
    }

    await sendMessage(
      chatId,
      "Эта ссылка входа уже использована или устарела. Вернитесь на сайт и попробуйте ещё раз.",
    );
    return true;
  }

  if (accessError) {
    await sendMessage(
      chatId,
      accessError.code === "ACCOUNT_ALREADY_BOUND"
        ? "Этот участник группы уже привязан к другому Telegram-аккаунту. Если это ошибка, обратитесь к администратору."
        : "Доступ закрыт: этот Telegram-аккаунт не входит в утверждённый список группы 420604.",
    );
    return true;
  }

  await sendMessage(
    chatId,
    "Вход подтверждён ✅\n\nВы успешно вошли в Очередь 420604. Возвращайтесь во вкладку браузера — расписание уже открыто!",
  );
  return true;
}

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const message = update.message;
  const chatId = message?.chat?.id;
  if (!message || chatId === undefined) return Response.json({ ok: true });

  const text = message.text?.trim() ?? "";
  const siteUrl = new URL(request.url).origin;
  const loginMatch = text.match(/^\/start(?:@\w+)?\s+login_([a-f0-9]{48})$/i);
  if (loginMatch && (await confirmLogin(loginMatch[1], message))) {
    return Response.json({ ok: true });
  }

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendMessage(
      chatId,
      "Привет! Это электронная очередь группы 420604. Открой сайт, выбери вход через Telegram и нажми Start по одноразовой ссылке.",
      siteUrl,
      "Открыть очередь",
    );
  }

  return Response.json({ ok: true });
}
