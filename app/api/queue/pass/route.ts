import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { queuePasses, queues } from "@/db/schema";
import { getOpenQueues } from "@/lib/queue-data";
import { isQueueLocked } from "@/lib/queue-lock";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    if (!user.subgroup) {
      return Response.json({ error: "Подгруппа не определена" }, { status: 400 });
    }

    const payload = (await request.json()) as { queueId?: number };
    const queueId = Number(payload.queueId);
    if (!Number.isInteger(queueId)) {
      return Response.json({ error: "Некорректная очередь" }, { status: 400 });
    }

    const db = getDb();
    const [queue] = await db
      .select()
      .from(queues)
      .where(
        and(
          eq(queues.id, queueId),
          or(eq(queues.subgroup, 0), eq(queues.subgroup, user.subgroup)),
          eq(queues.status, "open"),
        ),
      )
      .limit(1);
    if (!queue) {
      return Response.json({ error: "Очередь не найдена" }, { status: 404 });
    }
    if (isQueueLocked(queue)) {
      return Response.json({ error: "Занятие уже закончилось — очередь заблокирована" }, { status: 409 });
    }

    const currentQueue = (await getOpenQueues(user.subgroup)).find(
      (item) => item.id === queue.id,
    );
    const currentPosition = currentQueue?.waiting.findIndex(
      (entry) => entry.telegramId === user.telegramId,
    ) ?? -1;
    const promoted = currentQueue?.waiting[currentPosition + 1];
    if (currentPosition === -1) {
      return Response.json({ error: "Ты не находишься в этой очереди" }, { status: 409 });
    }
    if (!promoted) {
      return Response.json({ error: "Ты уже последний в очереди" }, { status: 409 });
    }

    await db.insert(queuePasses).values({
      queueId: queue.id,
      cycle: queue.currentCycle,
      passerTelegramId: user.telegramId,
      promotedTelegramId: promoted.telegramId,
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Войдите через Telegram" }, { status: 401 });
    }
    return Response.json({ error: "Не удалось уступить место" }, { status: 500 });
  }
}
