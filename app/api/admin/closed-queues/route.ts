import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queues } from "@/db/schema";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function GET() {
  try {
    const admin = await requireCurrentUser();
    if (!admin.isAdmin) return Response.json({ error: "Недостаточно прав" }, { status: 403 });

    const db = getDb();
    const closedList = await db
      .select({
        id: queues.id,
        subjectKey: queues.subjectKey,
        subjectName: queues.subjectName,
        subjectAbbrev: queues.subjectAbbrev,
        subgroup: queues.subgroup,
        lessonEndsAt: queues.lessonEndsAt,
        currentCycle: queues.currentCycle,
        closedAt: queues.closedAt,
      })
      .from(queues)
      .where(eq(queues.status, "closed"))
      .orderBy(desc(queues.closedAt))
      .limit(15);

    if (closedList.length === 0) {
      return Response.json({ queues: [] });
    }

    const queueIds = closedList.map((q) => q.id);
    const entries = await db
      .select({
        queueId: queueEntries.queueId,
        cycle: queueEntries.cycle,
        status: queueEntries.status,
      })
      .from(queueEntries)
      .where(
        and(
          inArray(queueEntries.queueId, queueIds),
          eq(queueEntries.status, "waiting"),
        ),
      );

    const counts = new Map<number, number>();
    for (const entry of entries) {
      counts.set(entry.queueId, (counts.get(entry.queueId) ?? 0) + 1);
    }

    const result = closedList.map((q) => ({
      ...q,
      waitingCount: counts.get(q.id) ?? 0,
    }));

    return Response.json({ queues: result });
  } catch {
    return Response.json({ error: "Не удалось загрузить закрытые очереди" }, { status: 500 });
  }
}
