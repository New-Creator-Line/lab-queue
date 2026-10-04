import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queues } from "@/db/schema";
import { isQueueLocked } from "@/lib/queue-lock";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const { queueId } = (await request.json()) as { queueId?: number };
    const db = getDb();
    const [queue] = await db.select().from(queues).where(eq(queues.id, Number(queueId))).limit(1);
    if (!queue) return Response.json({ error: "Очередь не найдена" }, { status: 404 });
    if (isQueueLocked(queue)) {
      return Response.json({ error: "Занятие уже закончилось — очередь заблокирована" }, { status: 409 });
    }
    await db
      .update(queueEntries)
      .set({ status: "left", completedAt: new Date().toISOString() })
      .where(
        and(
          eq(queueEntries.queueId, queue.id),
          eq(queueEntries.cycle, queue.currentCycle),
          eq(queueEntries.telegramId, user.telegramId),
        ),
      );
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось выйти из очереди" }, { status: 500 });
  }
}
