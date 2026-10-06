import { asc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { queues } from "@/db/schema";
import { computeQueueSequence } from "@/lib/queue-data";
import { isQueueLocked } from "@/lib/queue-lock";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function GET(request: Request) {
  try {
    const admin = await requireCurrentUser();
    if (!admin.isAdmin) return Response.json({ error: "Недостаточно прав" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const requestedDate = searchParams.get("date");

    const db = getDb();

    const dateExpr = sql<string>`TO_CHAR(COALESCE(${queues.lessonEndsAt}, ${queues.createdAt}) AT TIME ZONE 'Europe/Minsk', 'YYYY-MM-DD')`;

    // 1. Получаем все даты, в которых есть очереди
    const dateRows = await db
      .select({
        date: dateExpr,
        count: sql<number>`COUNT(${queues.id})::int`,
      })
      .from(queues)
      .groupBy(dateExpr)
      .orderBy(sql`${dateExpr} DESC`);

    const availableDates = dateRows.map((r) => ({
      date: r.date,
      count: r.count,
    }));

    if (availableDates.length === 0) {
      const fallbackDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
      return Response.json({ dates: [], selectedDate: fallbackDate, queues: [] });
    }

    const isValidRequestedDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate);
    const selectedDate = isValidRequestedDate
      ? requestedDate
      : availableDates[0].date;

    // 2. Получаем очереди за выбранный день
    const queueRows = await db
      .select()
      .from(queues)
      .where(sql`${dateExpr} = ${selectedDate}`)
      .orderBy(asc(queues.lessonEndsAt), asc(queues.id));

    if (queueRows.length === 0) {
      return Response.json({ dates: availableDates, selectedDate, queues: [] });
    }

    // 3. Вычисляем состояние очередей с учетом истории и ротации
    const subjectKeys = [...new Set(queueRows.map((q) => q.subjectKey))];
    const detailsMap = await computeQueueSequence(subjectKeys);

    const detailedQueues = queueRows.map((queue) => {
      const details = detailsMap.get(queue.id);
      const waiting = details?.waiting ?? [];
      const served = details?.served ?? [];
      const skipped = details?.skipped ?? [];

      return {
        id: queue.id,
        subjectKey: queue.subjectKey,
        subjectName: queue.subjectName,
        subjectAbbrev: queue.subjectAbbrev,
        subgroup: queue.subgroup,
        lessonEndsAt: queue.lessonEndsAt,
        currentCycle: queue.currentCycle,
        status: queue.status,
        createdAt: queue.createdAt,
        closedAt: queue.closedAt,
        isLocked: isQueueLocked(queue),
        served,
        waiting,
        skipped,
        totalEntries: waiting.length + served.length + skipped.length,
      };
    });

    return Response.json({
      dates: availableDates,
      selectedDate,
      queues: detailedQueues,
    });
  } catch (error) {
    console.error("Failed to load queue history:", error);
    return Response.json({ error: "Не удалось загрузить историю очередей" }, { status: 500 });
  }
}
