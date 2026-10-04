import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queuePasses, queues } from "@/db/schema";
import { getOpenQueues } from "@/lib/queue-data";
import { isQueueLocked } from "@/lib/queue-lock";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const admin = await requireCurrentUser();
    if (!admin.isAdmin) {
      return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const payload = (await request.json()) as {
      entryId?: number;
      direction?: "up" | "down";
    };
    const entryId = Number(payload.entryId);
    if (!Number.isInteger(entryId) || !["up", "down"].includes(payload.direction ?? "")) {
      return Response.json({ error: "Некорректное действие" }, { status: 400 });
    }

    const db = getDb();
    const [row] = await db
      .select({ entry: queueEntries, queue: queues })
      .from(queueEntries)
      .innerJoin(queues, eq(queueEntries.queueId, queues.id))
      .where(eq(queueEntries.id, entryId))
      .limit(1);
    if (!row || row.entry.cycle !== row.queue.currentCycle) {
      return Response.json({ error: "Запись не найдена" }, { status: 404 });
    }
    if (isQueueLocked(row.queue)) {
      return Response.json({ error: "Занятие уже закончилось — очередь заблокирована" }, { status: 409 });
    }

    const visibleQueue = (await getOpenQueues(row.queue.subgroup)).find(
      (queue) => queue.id === row.queue.id,
    );
    const position = visibleQueue?.waiting.findIndex(
      (entry) => entry.id === row.entry.id,
    ) ?? -1;
    if (position === -1) {
      return Response.json({ error: "Участник уже не находится в очереди" }, { status: 409 });
    }

    const movingDown = payload.direction === "down";
    const neighbor = visibleQueue?.waiting[position + (movingDown ? 1 : -1)];
    if (!neighbor) {
      return Response.json({ error: "Дальше переместить нельзя" }, { status: 409 });
    }

    await db.insert(queuePasses).values({
      queueId: row.queue.id,
      cycle: row.queue.currentCycle,
      passerTelegramId: movingDown ? row.entry.telegramId : neighbor.telegramId,
      promotedTelegramId: movingDown ? neighbor.telegramId : row.entry.telegramId,
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Войдите через Telegram" }, { status: 401 });
    }
    return Response.json({ error: "Не удалось изменить порядок" }, { status: 500 });
  }
}
