import {
  createSession,
  sessionCookie,
  TelegramAccessError,
  upsertTelegramUser,
  verifyTelegramLogin,
} from "@/lib/telegram-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const profile = await verifyTelegramLogin(url);
  if (!profile) return new Response("Не удалось подтвердить вход через Telegram", { status: 401 });

  try {
    await upsertTelegramUser(profile);
  } catch (error) {
    if (error instanceof TelegramAccessError) {
      return new Response("Этот Telegram-аккаунт не входит в список группы 420604", {
        status: 403,
      });
    }
    throw error;
  }
  const session = await createSession(profile.id);
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sessionCookie(session.token) },
  });
}
