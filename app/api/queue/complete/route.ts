import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queues, rotations } from "@/db/schema";
import { isQueueLocked } from "@/lib/queue-lock";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const { queueId } = (await request.json()) as { queueId?: number };
    if (!queueId) {
      return Response.json({ error: "Очередь не указана" }, { status: 400 });
    }

    const db = getDb();
    const [row] = await db
      .select({ entry: queueEntries, queue: queues })
      .from(queueEntries)
      .innerJoin(queues, eq(queueEntries.queueId, queues.id))
      .where(
        and(
          eq(queues.id, Number(queueId)),
          eq(queues.status, "open"),
          eq(queueEntries.cycle, queues.currentCycle),
          eq(queueEntries.telegramId, user.telegramId),
          eq(queueEntries.status, "waiting"),
        ),
      )
      .limit(1);

    if (!row) {
      return Response.json({ error: "Ты не состоишь в этой очереди" }, { status: 404 });
    }
    if (isQueueLocked(row.queue)) {
      return Response.json({ error: "Занятие уже закончилось — очередь заблокирована" }, { status: 409 });
    }

    const completedAt = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx
        .update(queueEntries)
        .set({ status: "served", completedAt })
        .where(
          and(
            eq(queueEntries.id, row.entry.id),
            eq(queueEntries.status, "waiting"),
          ),
        );

      await tx
        .insert(rotations)
        .values({
          subjectKey: row.queue.subjectKey,
          subgroup: row.queue.subgroup,
          lastServedTelegramId: user.telegramId,
          updatedAt: completedAt,
        })
        .onConflictDoUpdate({
          target: [rotations.subjectKey, rotations.subgroup],
          set: {
            lastServedTelegramId: user.telegramId,
            updatedAt: completedAt,
          },
        });
    });

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось отметить сдачу" }, { status: 500 });
  }
}
