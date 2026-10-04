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
    if (shouldRedirect) {
      return new Response(
        renderAuthFinishHtml("Вход уже выполнен", "Вы можете закрыть эту вкладку или перейти в очередь."),
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    }
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
    if (shouldRedirect) {
      return new Response(
        renderAuthFinishHtml("Вход уже выполнен", "Вы можете закрыть эту вкладку или перейти в очередь."),
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    }
    return Response.json({ expired: true }, { status: 410 });
  }
  const session = await createSession(challenge.telegramId);

  if (shouldRedirect) {
    return new Response(
      renderAuthFinishHtml("Вход подтверждён", "Закрываем вкладку и возвращаемся в очередь..."),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": sessionCookie(session.token),
        },
      },
    );
  }

  return Response.json({ authenticated: true });
}

function renderAuthFinishHtml(title: string, description: string) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Очередь 420604</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background: #0b1120;
      color: #f1f5f9;
      text-align: center;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #111c33;
      border: 1px solid #1e293b;
      padding: 36px 28px;
      border-radius: 24px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
    }
    .badge {
      width: 54px;
      height: 54px;
      border-radius: 16px;
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(74, 222, 128, 0.3);
      display: inline-grid;
      place-items: center;
      font-size: 26px;
      margin-bottom: 18px;
    }
    h1 { font-size: 22px; margin: 0 0 8px; letter-spacing: -0.02em; }
    p { color: #94a3b8; font-size: 14px; margin: 0 0 24px; line-height: 1.5; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 24px;
      background: #2563eb;
      color: white;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 700;
      font-size: 14px;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);
    }
    .btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">✓</div>
    <h1>${title}</h1>
    <p>${description}</p>
    <a class="btn" href="/">Перейти к расписанию</a>
  </div>
  <script>
    try {
      window.close();
    } catch (e) {}
    setTimeout(function() {
      window.location.replace('/');
    }, 600);
  </script>
</body>
</html>`;
}
