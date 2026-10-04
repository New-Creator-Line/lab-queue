import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queuePasses, queues, rotations, users } from "@/db/schema";
import { isQueueLocked } from "@/lib/queue-lock";
import { getRosterMemberByUsername } from "@/lib/roster";
import { isExcludedSubject } from "@/lib/schedule";

export async function getOpenQueues(subgroup: number, includeAll = false) {
  const db = getDb();
  const queueRows = await db
    .select()
    .from(queues)
    .where(
      includeAll
        ? eq(queues.status, "open")
        : and(
            eq(queues.status, "open"),
            or(eq(queues.subgroup, 0), eq(queues.subgroup, subgroup)),
          ),
    );

  const visibleQueues = queueRows.filter(
    (item) => !isExcludedSubject(item.subjectAbbrev, item.subjectName),
  );
  if (visibleQueues.length === 0) return [];

  const entryCycles = visibleQueues.map((queue) =>
    and(
      eq(queueEntries.queueId, queue.id),
      eq(queueEntries.cycle, queue.currentCycle),
    ),
  );
  const passCycles = visibleQueues.map((queue) =>
    and(
      eq(queuePasses.queueId, queue.id),
      eq(queuePasses.cycle, queue.currentCycle),
    ),
  );

  const [entryRows, rotationRows, passRows] = await Promise.all([
    db
      .select({ entry: queueEntries, user: users })
      .from(queueEntries)
      .innerJoin(users, eq(queueEntries.telegramId, users.telegramId))
      .where(or(...entryCycles)),
    db
      .select({
        rotation: rotations,
        lastServedUsername: users.username,
      })
      .from(rotations)
      .leftJoin(users, eq(rotations.lastServedTelegramId, users.telegramId)),
    db
      .select()
      .from(queuePasses)
      .where(or(...passCycles))
      .orderBy(queuePasses.id),
  ]);

  const entriesByQueue = new Map<number, (typeof entryRows)[number][]>();
  for (const row of entryRows) {
    if (!getRosterMemberByUsername(row.user.username)) continue;
    const rows = entriesByQueue.get(row.entry.queueId) ?? [];
    rows.push(row);
    entriesByQueue.set(row.entry.queueId, rows);
  }

  const passesByQueue = new Map<number, typeof passRows>();
  for (const pass of passRows) {
    const rows = passesByQueue.get(pass.queueId) ?? [];
    rows.push(pass);
    passesByQueue.set(pass.queueId, rows);
  }

  const rotationsBySubject = new Map(
    rotationRows.map((row) => [
      `${row.rotation.subjectKey}\u0000${row.rotation.subgroup}`,
      row,
    ]),
  );

  const result = [];
  for (const queue of visibleQueues) {
    const rows = entriesByQueue.get(queue.id) ?? [];
    const rotation = rotationsBySubject.get(
      `${queue.subjectKey}\u0000${queue.subgroup}`,
    );
    const lastOrder = rotation?.lastServedUsername
      ? (getRosterMemberByUsername(rotation.lastServedUsername)?.listNumber ?? 0)
      : 0;

    const waitingRows = rows
      .filter(({ entry }) => entry.status === "waiting")
      .sort((left, right) => {
        const leftOrder =
          getRosterMemberByUsername(left.user.username)?.listNumber ??
          Number.MAX_SAFE_INTEGER;
        const rightOrder =
          getRosterMemberByUsername(right.user.username)?.listNumber ??
          Number.MAX_SAFE_INTEGER;
        const leftSection = leftOrder > lastOrder ? 0 : 1;
        const rightSection = rightOrder > lastOrder ? 0 : 1;
        return leftSection - rightSection || leftOrder - rightOrder;
      });

    const passes = passesByQueue.get(queue.id) ?? [];

    for (const pass of passes) {
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

    const waiting = waitingRows
      .map(({ entry, user }, index) => ({
        id: entry.id,
        telegramId: user.telegramId,
        displayName: user.displayName,
        username: user.username,
        position: index + 1,
        joinedAt: entry.joinedAt,
      }));

    result.push({
      ...queue,
      isLocked: isQueueLocked(queue),
      waiting,
      completed: rows
        .filter(({ entry }) => entry.status === "served")
        .map(({ user }) => user.displayName),
    });
  }
  return result;
}
