import { and, eq, gt, isNull } from "drizzle-orm";
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
  const botUsername = getTelegramBotUsername();
  if (!botUsername) {
    return Response.json({ error: "Telegram-бот не настроен" }, { status: 503 });
  }

  const token = randomToken(24);
  const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_LIFETIME_SECONDS;
  const db = getDb();
  await db.insert(telegramAuthChallenges).values({ token, expiresAt });

  return Response.json({
    token,
    botUrl: `https://t.me/${botUsername}?start=login_${token}`,
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token")?.trim();
  const shouldRedirect = requestUrl.searchParams.get("finish") === "1";
  if (!token || !/^[a-f0-9]{48}$/i.test(token)) {
    return Response.json({ error: "Некорректная ссылка входа" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const [challenge] = await db
    .select()
    .from(telegramAuthChallenges)
    .where(
      and(
        eq(telegramAuthChallenges.token, token),
        gt(telegramAuthChallenges.expiresAt, now),
        isNull(telegramAuthChallenges.consumedAt),
      ),
    )
    .limit(1);

  if (!challenge) {
    return Response.json({ expired: true }, { status: 410 });
  }
  if (!challenge.telegramId || !challenge.firstName) {
    return Response.json({ authenticated: false });
  }

  if (!shouldRedirect) {
    return Response.json({ authenticated: true });
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
      await db
        .update(telegramAuthChallenges)
        .set({ consumedAt: now })
        .where(eq(telegramAuthChallenges.token, token));
      return Response.json(
        {
          error:
            error.code === "ACCOUNT_ALREADY_BOUND"
              ? "Этот участник уже привязан к другому Telegram-аккаунту"
              : "Этот Telegram-аккаунт не входит в список группы 420604",
        },
        { status: 403 },
      );
    }
    throw error;
  }
  const claimed = await db
    .update(telegramAuthChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(telegramAuthChallenges.token, token),
        gt(telegramAuthChallenges.expiresAt, now),
        isNull(telegramAuthChallenges.consumedAt),
      ),
    )
    .returning({ token: telegramAuthChallenges.token });
  if (claimed.length === 0) {
    return Response.json({ expired: true }, { status: 410 });
  }
  const session = await createSession(challenge.telegramId);

  if (shouldRedirect) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: new URL("/", request.url).toString(),
        "Set-Cookie": sessionCookie(session.token),
      },
    });
  }

  return Response.json({ authenticated: true });
}
