import { asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queuePasses, queues, rotations, users } from "@/db/schema";
import { isQueueLocked } from "@/lib/queue-lock";
import { getRosterMemberByUsername } from "@/lib/roster";
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

    const queueIds = queueRows.map((q) => q.id);

    // 3. Загружаем участников, ротации и пропуски
    const [entryRows, passRows, rotationRows] = await Promise.all([
      db
        .select({ entry: queueEntries, user: users })
        .from(queueEntries)
        .innerJoin(users, eq(queueEntries.telegramId, users.telegramId))
        .where(inArray(queueEntries.queueId, queueIds))
        .orderBy(asc(queueEntries.joinedAt)),
      db
        .select()
        .from(queuePasses)
        .where(inArray(queuePasses.queueId, queueIds))
        .orderBy(queuePasses.id),
      db
        .select({
          rotation: rotations,
          lastServedUsername: users.username,
        })
        .from(rotations)
        .leftJoin(users, eq(rotations.lastServedTelegramId, users.telegramId)),
    ]);

    const entriesByQueue = new Map<number, (typeof entryRows)[number][]>();
    for (const row of entryRows) {
      const list = entriesByQueue.get(row.entry.queueId) ?? [];
      list.push(row);
      entriesByQueue.set(row.entry.queueId, list);
    }

    const passesByQueue = new Map<number, (typeof passRows)[number][]>();
    for (const pass of passRows) {
      const list = passesByQueue.get(pass.queueId) ?? [];
      list.push(pass);
      passesByQueue.set(pass.queueId, list);
    }

    const rotationsBySubject = new Map(
      rotationRows.map((row) => [
        `${row.rotation.subjectKey}\u0000${row.rotation.subgroup}`,
        row,
      ]),
    );

    const detailedQueues = queueRows.map((queue) => {
      const rows = entriesByQueue.get(queue.id) ?? [];
      const passes = passesByQueue.get(queue.id) ?? [];
      const rotation = rotationsBySubject.get(`${queue.subjectKey}\u0000${queue.subgroup}`);
      const lastOrder = rotation?.lastServedUsername
        ? (getRosterMemberByUsername(rotation.lastServedUsername)?.listNumber ?? 0)
        : 0;

      // Ожидающие с учетом ротации и уступленных мест
      const waitingRows = rows
        .filter(({ entry }) => entry.status === "waiting")
        .sort((left, right) => {
          const leftOrder =
            getRosterMemberByUsername(left.user.username)?.listNumber ?? Number.MAX_SAFE_INTEGER;
          const rightOrder =
            getRosterMemberByUsername(right.user.username)?.listNumber ?? Number.MAX_SAFE_INTEGER;
          const leftSection = leftOrder > lastOrder ? 0 : 1;
          const rightSection = rightOrder > lastOrder ? 0 : 1;
          return leftSection - rightSection || leftOrder - rightOrder;
        });

      for (const pass of passes) {
        if (pass.cycle !== queue.currentCycle) continue;
        const passerIndex = waitingRows.findIndex(
          ({ user }) => user.telegramId === pass.passerTelegramId,
        );
        const promotedIndex = waitingRows.findIndex(
          ({ user }) => user.telegramId === pass.promotedTelegramId,
        );
        if (passerIndex === -1 || promotedIndex === -1 || passerIndex >= promotedIndex) continue;
        const [promoted] = waitingRows.splice(promotedIndex, 1);
        waitingRows.splice(passerIndex, 0, promoted);
      }

      const waiting = waitingRows.map(({ entry, user }, index) => ({
        id: entry.id,
        telegramId: user.telegramId,
        displayName: user.displayName,
        username: user.username,
        subgroup: user.subgroup,
        status: "waiting" as const,
        position: index + 1,
        joinedAt: entry.joinedAt,
      }));

      // Сдавшие студенты (по времени завершения)
      const served = rows
        .filter(({ entry }) => entry.status === "served")
        .sort((a, b) => (a.entry.completedAt ?? a.entry.joinedAt).localeCompare(b.entry.completedAt ?? b.entry.joinedAt))
        .map(({ entry, user }, index) => ({
          id: entry.id,
          telegramId: user.telegramId,
          displayName: user.displayName,
          username: user.username,
          subgroup: user.subgroup,
          status: "served" as const,
          position: index + 1,
          joinedAt: entry.joinedAt,
          completedAt: entry.completedAt,
        }));

      // Пропустившие или вышедшие
      const skipped = rows
        .filter(({ entry }) => entry.status === "skipped" || entry.status === "left")
        .map(({ entry, user }) => ({
          id: entry.id,
          telegramId: user.telegramId,
          displayName: user.displayName,
          username: user.username,
          subgroup: user.subgroup,
          status: entry.status as "skipped" | "left",
          joinedAt: entry.joinedAt,
          completedAt: entry.completedAt,
        }));

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
        totalEntries: rows.length,
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
