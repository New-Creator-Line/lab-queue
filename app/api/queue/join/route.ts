import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queues } from "@/db/schema";
import { getSubjectSettings, getUserBrigade } from "@/lib/brigades";
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

    const hasBrigades = await getSubjectSettings(subject.key);
    let userBrigade: Awaited<ReturnType<typeof getUserBrigade>> = null;
    if (hasBrigades) {
      userBrigade = await getUserBrigade(subject.key, user.telegramId);
      if (!userBrigade) {
        return Response.json(
          { error: "Для записи на это занятие необходимо создать или вступить в бригаду" },
          { status: 400 },
        );
      }
    }

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

    const now = new Date().toISOString();

    if (hasBrigades && userBrigade) {
      const memberIds = userBrigade.members.map((m) => m.telegramId);
      await db.transaction(async (tx) => {
        // Check if any member is already waiting
        const waitingMembers = await tx
          .select()
          .from(queueEntries)
          .where(
            and(
              eq(queueEntries.queueId, queue.id),
              eq(queueEntries.cycle, queue.currentCycle),
              eq(queueEntries.status, "waiting"),
              inArray(queueEntries.telegramId, memberIds),
            ),
          );

        const isFullyWaiting =
          waitingMembers.length === memberIds.length &&
          waitingMembers.every((w) => w.brigadeId === userBrigade.id);

        if (isFullyWaiting) {
          // All members already registered as this brigade, nothing to insert
          return;
        }

        for (const memberId of memberIds) {
          await tx
            .insert(queueEntries)
            .values({
              queueId: queue.id,
              cycle: queue.currentCycle,
              telegramId: memberId,
              brigadeId: userBrigade.id,
              status: "waiting",
              joinedAt: now,
            })
            .onConflictDoUpdate({
              target: [queueEntries.queueId, queueEntries.cycle, queueEntries.telegramId],
              set: {
                brigadeId: userBrigade.id,
                status: "waiting",
                joinedAt: now,
                completedAt: null,
              },
            });
        }
      });
    } else {
      await db
        .insert(queueEntries)
        .values({
          queueId: queue.id,
          cycle: queue.currentCycle,
          telegramId: user.telegramId,
          brigadeId: null,
          status: "waiting",
          joinedAt: now,
        })
        .onConflictDoUpdate({
          target: [queueEntries.queueId, queueEntries.cycle, queueEntries.telegramId],
          set: {
            brigadeId: null,
            status: "waiting",
            joinedAt: now,
            completedAt: null,
          },
        });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json(
      { error: message.includes("BSUIR") ? "Расписание БГУИР временно недоступно" : (message || "Не удалось встать в очередь") },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}
