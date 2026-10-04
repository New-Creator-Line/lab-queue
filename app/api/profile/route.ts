import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST() {
  try {
    await requireCurrentUser();
    return Response.json(
      { error: "Имя и подгруппа назначаются автоматически по списку группы" },
      { status: 403 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Войдите через Telegram" }, { status: 401 });
    }
    return Response.json({ error: "Не удалось проверить профиль" }, { status: 500 });
  }
}
