import { changeBrigadeLeader } from "@/lib/brigades";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = (await request.json()) as {
      brigadeId?: number;
      newLeaderTelegramId?: string;
    };

    if (!body.brigadeId || !body.newLeaderTelegramId) {
      return Response.json({ error: "Некорректные параметры" }, { status: 400 });
    }

    await changeBrigadeLeader(
      body.brigadeId,
      body.newLeaderTelegramId,
      user.telegramId,
      user.isAdmin,
    );

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сменить лидера бригады";
    return Response.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 },
    );
  }
}
