import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queues, rotations } from "@/db/schema";
import { isQueueLocked } from "@/lib/queue-lock";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const admin = await requireCurrentUser();
    if (!admin.isAdmin) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    const { entryId, action } = (await request.json()) as {
      entryId?: number;
      action?: "served" | "skipped";
    };
    if (!entryId || !["served", "skipped"].includes(action ?? "")) {
      return Response.json({ error: "Некорректное действие" }, { status: 400 });
    }

    const db = getDb();
    const [row] = await db
      .select({ entry: queueEntries, queue: queues })
      .from(queueEntries)
      .innerJoin(queues, eq(queueEntries.queueId, queues.id))
      .where(eq(queueEntries.id, Number(entryId)))
      .limit(1);
    if (!row || row.entry.cycle !== row.queue.currentCycle) {
      return Response.json({ error: "Запись не найдена" }, { status: 404 });
    }
    if (isQueueLocked(row.queue)) {
      return Response.json({ error: "Занятие уже закончилось — очередь заблокирована" }, { status: 409 });
    }

    await db
      .update(queueEntries)
      .set({ status: action, completedAt: new Date().toISOString() })
      .where(eq(queueEntries.id, row.entry.id));

    if (action === "served") {
      await db
        .insert(rotations)
        .values({
          subjectKey: row.queue.subjectKey,
          subgroup: row.queue.subgroup,
          lastServedTelegramId: row.entry.telegramId,
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: [rotations.subjectKey, rotations.subgroup],
          set: {
            lastServedTelegramId: row.entry.telegramId,
            updatedAt: new Date().toISOString(),
          },
        });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось обновить очередь" }, { status: 500 });
  }
}
