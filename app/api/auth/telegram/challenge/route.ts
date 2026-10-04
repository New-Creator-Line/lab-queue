import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { telegramAuthChallenges } from "@/db/schema";
import {
  createSession,
  getTelegramBotUsername,
  randomToken,
  sessionCookie,
  TelegramAccessError,
  upsertTelegramUser,
} from "@/lib/telegram-auth";

const CHALLENGE_LIFETIME_SECONDS = 10 * 60;

export async function POST() {
  try {
    const botUsername = getTelegramBotUsername();
    if (!botUsername) {
      return Response.json(
        { error: "TELEGRAM_BOT_USERNAME не настроен в Vercel" },
        { status: 503 },
      );
    }

    const token = randomToken(24);
    const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_LIFETIME_SECONDS;
    const db = getDb();
    await db.insert(telegramAuthChallenges).values({ token, expiresAt });

    return Response.json({
      token,
      botUrl: `https://t.me/${botUsername}?start=login_${token}`,
    });
  } catch (error) {
    const cause = (error as { cause?: Error })?.cause?.message;
    const message = cause
      ? cause
      : error instanceof Error
        ? error.message
        : "Не удалось связаться с базой данных";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token")?.trim();
  const shouldRedirect = requestUrl.searchParams.get("finish") === "1";

  // При переходе из бота или перенаправлении браузера всегда мягко перенаправляем на главную
  if (!token || !/^[a-f0-9]{48}$/i.test(token)) {
    if (shouldRedirect) {
      return new Response(null, {
        status: 302,
        headers: { Location: new URL("/", request.url).toString() },
      });
    }
    return Response.json({ error: "Некорректная ссылка входа" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Сценарий перехода по ссылке завершения входа (кнопка в боте или авто-вход исходной вкладки)
  if (shouldRedirect) {
    // Ищем токен даже если другая вкладка уже успела его погасить (окно в 1 час)
    const [challenge] = await db
      .select()
      .from(telegramAuthChallenges)
      .where(
        and(
          eq(telegramAuthChallenges.token, token),
          gt(telegramAuthChallenges.expiresAt, now - 3600),
        ),
      )
      .limit(1);

    if (!challenge || !challenge.telegramId || !challenge.firstName) {
      // Если токен не найден или не подтверждён — редиректим на главную без сырых JSON-ошибок
      return new Response(null, {
        status: 302,
        headers: { Location: new URL("/", request.url).toString() },
      });
    }

    try {
      await upsertTelegramUser({
        id: challenge.telegramId,
        firstName: challenge.firstName,
        lastName: challenge.lastName,
        username: challenge.username,
        photoUrl: null,
      });
    } catch (error) {
      if (error instanceof TelegramAccessError) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: new URL("/?auth_error=forbidden", request.url).toString(),
          },
        });
      }
      throw error;
    }

    if (!challenge.consumedAt) {
      await db
        .update(telegramAuthChallenges)
        .set({ consumedAt: now })
        .where(eq(telegramAuthChallenges.token, token));
    }

    const session = await createSession(challenge.telegramId);

    // Чистый 302 редирект прямо на главную страницу расписания с установкой сессионной куки
    return new Response(null, {
      status: 302,
      headers: {
        Location: new URL("/", request.url).toString(),
        "Set-Cookie": sessionCookie(session.token),
      },
    });
  }

  // Фоновый опрос со стороны страницы логина (shouldRedirect === false)
  const [challenge] = await db
    .select()
    .from(telegramAuthChallenges)
    .where(
      and(
        eq(telegramAuthChallenges.token, token),
        gt(telegramAuthChallenges.expiresAt, now),
      ),
    )
    .limit(1);

  if (!challenge) {
    return Response.json({ expired: true }, { status: 410 });
  }

  if (!challenge.telegramId || !challenge.firstName) {
    return Response.json({ authenticated: false });
  }

  return Response.json({ authenticated: true });
}
