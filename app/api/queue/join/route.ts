import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queues } from "@/db/schema";
import { createLessonEnd, isQueueLocked } from "@/lib/queue-lock";
import { getSubjects } from "@/lib/schedule";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    if (!user.subgroup) return Response.json({ error: "Сначала выберите подгруппу" }, { status: 400 });
    const payload = (await request.json()) as {
      subjectKey?: string;
      lessonDate?: string;
      lessonTime?: string;
      lessonType?: string;
    };
    const subject = (await getSubjects(user.subgroup)).find((item) => item.key === payload.subjectKey);
    if (!subject) return Response.json({ error: "Предмет не найден в расписании" }, { status: 400 });

    const lesson = subject.lessons.find(
      (item) =>
        item.date === payload.lessonDate &&
        item.time === payload.lessonTime &&
        item.type === payload.lessonType &&
        (item.subgroup === 0 || item.subgroup === user.subgroup),
    );
    if (!lesson) {
      return Response.json(
        { error: "Это занятие не относится к текущей неделе или твоей подгруппе" },
        { status: 400 },
      );
    }
    if (lesson.isPast) {
      return Response.json({ error: "На прошедшее занятие записаться нельзя" }, { status: 409 });
    }
    const lessonEndsAt = createLessonEnd(lesson.date, lesson.time);
    if (!lessonEndsAt) {
      return Response.json({ error: "Не удалось определить время окончания занятия" }, { status: 500 });
    }
    const queueSubgroup = lesson.subgroup === 0 ? 0 : user.subgroup;

    const db = getDb();
    let [queue] = await db
      .select()
      .from(queues)
      .where(
        and(
          eq(queues.subjectKey, subject.key),
          eq(queues.subgroup, queueSubgroup),
          eq(queues.lessonEndsAt, lessonEndsAt),
        ),
      )
      .limit(1);

    if (!queue) {
      const inserted = await db
        .insert(queues)
        .values({
          subjectKey: subject.key,
          subjectName: subject.name,
          subjectAbbrev: subject.abbrev,
          subgroup: queueSubgroup,
          lessonEndsAt,
        })
        .onConflictDoNothing()
        .returning();
      [queue] = inserted;
      if (!queue) {
        [queue] = await db
          .select()
          .from(queues)
          .where(
            and(
              eq(queues.subjectKey, subject.key),
              eq(queues.subgroup, queueSubgroup),
              eq(queues.lessonEndsAt, lessonEndsAt),
            ),
          )
          .limit(1);
      }
    } else if (queue.status === "closed" || isQueueLocked(queue)) {
      [queue] = await db
        .update(queues)
        .set({
          status: "open",
          currentCycle: queue.currentCycle + 1,
          createdAt: new Date().toISOString(),
          closedAt: null,
          lessonEndsAt,
        })
        .where(eq(queues.id, queue.id))
        .returning();
    } else if (!queue.lessonEndsAt) {
      [queue] = await db
        .update(queues)
        .set({ lessonEndsAt })
        .where(eq(queues.id, queue.id))
        .returning();
    }

    await db
      .insert(queueEntries)
      .values({ queueId: queue.id, cycle: queue.currentCycle, telegramId: user.telegramId })
      .onConflictDoUpdate({
        target: [queueEntries.queueId, queueEntries.cycle, queueEntries.telegramId],
        set: { status: "waiting", joinedAt: new Date().toISOString(), completedAt: null },
      });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json(
      { error: message.includes("BSUIR") ? "Расписание БГУИР временно недоступно" : "Не удалось встать в очередь" },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}
