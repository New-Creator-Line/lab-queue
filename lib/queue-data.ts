import { and, asc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { brigades, queueEntries, queuePasses, queues, rotations, users } from "@/db/schema";
import { isQueueLocked } from "@/lib/queue-lock";
import { getRosterMemberByUsername } from "@/lib/roster";
import { isExcludedSubject } from "@/lib/schedule";

export type ProcessedMemberDetail = {
  id: number;
  telegramId: string;
  displayName: string;
  username: string | null;
  subgroup: number | null;
  isLeader: boolean;
};

export type ProcessedWaitingEntry = {
  id: number;
  telegramId: string;
  displayName: string;
  username: string | null;
  subgroup: number | null;
  status: "waiting";
  position: number;
  joinedAt: string;
  brigadeId?: number | null;
  brigadeName?: string | null;
  leaderTelegramId?: string | null;
  leaderDisplayName?: string | null;
  members?: ProcessedMemberDetail[];
};

export type ProcessedServedEntry = {
  id: number;
  telegramId: string;
  displayName: string;
  username: string | null;
  subgroup: number | null;
  status: "served";
  position: number | null;
  joinedAt: string;
  completedAt: string | null;
  brigadeId?: number | null;
  brigadeName?: string | null;
  leaderTelegramId?: string | null;
  leaderDisplayName?: string | null;
  members?: ProcessedMemberDetail[];
};

export type ProcessedSkippedEntry = {
  id: number;
  telegramId: string;
  displayName: string;
  username: string | null;
  subgroup: number | null;
  status: "skipped" | "left";
  position: null;
  joinedAt: string;
  completedAt: string | null;
};

export type ProcessedQueueDetails = {
  waiting: ProcessedWaitingEntry[];
  served: ProcessedServedEntry[];
  skipped: ProcessedSkippedEntry[];
  completedNames: string[];
};

function getQueueSortTimestamp(q: { lessonEndsAt: string | null; createdAt: string }): number {
  if (q.lessonEndsAt) {
    const parsed = Date.parse(q.lessonEndsAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.parse(q.createdAt) || 0;
}

export async function computeQueueSequence(
  subjectKeys: string[],
): Promise<Map<number, ProcessedQueueDetails>> {
  if (subjectKeys.length === 0) return new Map();

  const db = getDb();

  // 1. Fetch all queues for these subjects
  const allQueues = (
    await db
      .select()
      .from(queues)
      .where(inArray(queues.subjectKey, subjectKeys))
  ).sort((a, b) => getQueueSortTimestamp(a) - getQueueSortTimestamp(b) || a.id - b.id);

  if (allQueues.length === 0) return new Map();

  const allQueueIds = allQueues.map((q) => q.id);

  // 2. Fetch all entries, rotations, and passes
  const [entryRows, rotationRows, passRows, allUsers] = await Promise.all([
    db
      .select({ entry: queueEntries, user: users, brigade: brigades })
      .from(queueEntries)
      .innerJoin(users, eq(queueEntries.telegramId, users.telegramId))
      .leftJoin(brigades, eq(queueEntries.brigadeId, brigades.id))
      .where(inArray(queueEntries.queueId, allQueueIds)),
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
      .where(inArray(queuePasses.queueId, allQueueIds))
      .orderBy(asc(queuePasses.id)),
    db.select().from(users),
  ]);

  const userMap = new Map(allUsers.map((u) => [u.telegramId, u]));

  // Index entries by queueId
  const entriesByQueue = new Map<number, typeof entryRows>();
  for (const row of entryRows) {
    if (!getRosterMemberByUsername(row.user.username)) continue;
    const list = entriesByQueue.get(row.entry.queueId) ?? [];
    list.push(row);
    entriesByQueue.set(row.entry.queueId, list);
  }

  // Index passes by queueId
  const passesByQueue = new Map<number, typeof passRows>();
  for (const pass of passRows) {
    const list = passesByQueue.get(pass.queueId) ?? [];
    list.push(pass);
    passesByQueue.set(pass.queueId, list);
  }

  // Index rotations by subjectKey and subgroup
  const rotationsBySubject = new Map(
    rotationRows.map((row) => [
      `${row.rotation.subjectKey}\u0000${row.rotation.subgroup}`,
      row,
    ]),
  );

  // Group queues by `${subjectKey}\u0000${subgroup}`
  const queuesBySubjectSubgroup = new Map<string, typeof allQueues>();
  for (const queue of allQueues) {
    const key = `${queue.subjectKey}\u0000${queue.subgroup}`;
    const list = queuesBySubjectSubgroup.get(key) ?? [];
    list.push(queue);
    queuesBySubjectSubgroup.set(key, list);
  }

  const results = new Map<number, ProcessedQueueDetails>();

  const globalReset = rotationsBySubject.get("__all__\u0000-1");
  const globalResetTime = globalReset?.rotation.updatedAt
    ? Date.parse(globalReset.rotation.updatedAt)
    : 0;

  // Process each subject + subgroup in chronological order
  for (const [key, subjectQueues] of queuesBySubjectSubgroup.entries()) {
    const [subjectKey] = key.split("\u0000");
    const subjectReset = rotationsBySubject.get(`${subjectKey}\u0000-1`);
    const subjectResetTime = subjectReset?.rotation.updatedAt
      ? Date.parse(subjectReset.rotation.updatedAt)
      : 0;
    const resetTime = Math.max(globalResetTime, subjectResetTime);

    const rotation = rotationsBySubject.get(key);
    let currentLastOrder = rotation?.lastServedUsername
      ? (getRosterMemberByUsername(rotation.lastServedUsername)?.listNumber ?? 0)
      : 0;

    // Map: telegramId -> order index in the previous unserved queue
    let currentUnservedMap = new Map<string, number>();
    let hasAppliedReset = false;

    for (const queue of subjectQueues) {
      const queueTime = getQueueSortTimestamp(queue);
      if (
        resetTime > 0 &&
        !hasAppliedReset &&
        (queue.status === "open" || queueTime >= resetTime)
      ) {
        hasAppliedReset = true;
        currentLastOrder = 0;
        currentUnservedMap.clear();
      }
      const rows = (entriesByQueue.get(queue.id) ?? []).filter(
        (r) => r.entry.cycle === queue.currentCycle,
      );
      const passes = (passesByQueue.get(queue.id) ?? []).filter(
        (p) => p.cycle === queue.currentCycle,
      );

      const waitingRows = rows.filter(({ entry }) => entry.status === "waiting");
      const servedRows = rows
        .filter(({ entry }) => entry.status === "served")
        .sort((a, b) => {
          const timeA = a.entry.completedAt ? Date.parse(a.entry.completedAt) : 0;
          const timeB = b.entry.completedAt ? Date.parse(b.entry.completedAt) : 0;
          return timeA - timeB;
        });
      const skippedRows = rows.filter(
        ({ entry }) => entry.status === "skipped" || entry.status === "left",
      );

      // Group waiting rows into slots: individual or brigade
      const waitingSlotsMap = new Map<
        string,
        {
          slotKey: string;
          isBrigade: boolean;
          brigadeId: number | null;
          brigadeName: string | null;
          leaderTelegramId: string;
          leaderDisplayName: string;
          leaderUsername: string | null;
          primaryEntryId: number;
          subgroup: number | null;
          joinedAt: string;
          members: ProcessedMemberDetail[];
        }
      >();

      for (const row of waitingRows) {
        const isBrigade = !!row.entry.brigadeId && !!row.brigade;
        const slotKey = isBrigade ? `brigade-${row.entry.brigadeId}` : `user-${row.user.telegramId}`;
        const leaderUser = isBrigade
          ? (userMap.get(row.brigade!.leaderTelegramId) ?? row.user)
          : row.user;

        let slot = waitingSlotsMap.get(slotKey);
        if (!slot) {
          slot = {
            slotKey,
            isBrigade,
            brigadeId: isBrigade ? row.brigade!.id : null,
            brigadeName: isBrigade ? row.brigade!.name : null,
            leaderTelegramId: leaderUser.telegramId,
            leaderDisplayName: leaderUser.displayName,
            leaderUsername: leaderUser.username,
            primaryEntryId: row.entry.id,
            subgroup: isBrigade ? row.brigade!.subgroup : row.user.subgroup,
            joinedAt: row.entry.joinedAt,
            members: [],
          };
          waitingSlotsMap.set(slotKey, slot);
        }

        if (row.user.telegramId === leaderUser.telegramId) {
          slot.primaryEntryId = row.entry.id;
        }

        slot.members.push({
          id: row.entry.id,
          telegramId: row.user.telegramId,
          displayName: row.user.displayName,
          username: row.user.username,
          subgroup: row.user.subgroup,
          isLeader: row.user.telegramId === leaderUser.telegramId,
        });
      }

      const waitingSlots = [...waitingSlotsMap.values()];
      for (const slot of waitingSlots) {
        slot.members.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
      }

      // 1. Sort waiting slots using two-tier comparator:
      // Tier 1: unserved from previous queue in their reserved order
      // Tier 2: new registrations, circular roster order of leader after currentLastOrder
      waitingSlots.sort((left, right) => {
        const leftUnservedIdx = currentUnservedMap.get(left.leaderTelegramId);
        const rightUnservedIdx = currentUnservedMap.get(right.leaderTelegramId);

        const leftIsUnserved = leftUnservedIdx !== undefined;
        const rightIsUnserved = rightUnservedIdx !== undefined;

        if (leftIsUnserved && !rightIsUnserved) return -1;
        if (!leftIsUnserved && rightIsUnserved) return 1;

        if (leftIsUnserved && rightIsUnserved) {
          return leftUnservedIdx - rightUnservedIdx;
        }

        const leftOrder =
          getRosterMemberByUsername(left.leaderUsername)?.listNumber ?? Number.MAX_SAFE_INTEGER;
        const rightOrder =
          getRosterMemberByUsername(right.leaderUsername)?.listNumber ?? Number.MAX_SAFE_INTEGER;

        const leftSection = leftOrder > currentLastOrder ? 0 : 1;
        const rightSection = rightOrder > currentLastOrder ? 0 : 1;
        return leftSection - rightSection || leftOrder - rightOrder;
      });

      // 2. Apply in-queue passes / swaps
      for (const pass of passes) {
        const passerIndex = waitingSlots.findIndex(
          (s) =>
            s.leaderTelegramId === pass.passerTelegramId ||
            s.members.some((m) => m.telegramId === pass.passerTelegramId),
        );
        const promotedIndex = waitingSlots.findIndex(
          (s) =>
            s.leaderTelegramId === pass.promotedTelegramId ||
            s.members.some((m) => m.telegramId === pass.promotedTelegramId),
        );
        if (passerIndex === -1 || promotedIndex === -1 || passerIndex >= promotedIndex) continue;
        const [promoted] = waitingSlots.splice(promotedIndex, 1);
        waitingSlots.splice(passerIndex, 0, promoted);
      }

      // Group served rows into slots
      const servedSlotsMap = new Map<
        string,
        {
          slotKey: string;
          isBrigade: boolean;
          brigadeId: number | null;
          brigadeName: string | null;
          leaderTelegramId: string;
          leaderDisplayName: string;
          leaderUsername: string | null;
          primaryEntryId: number;
          subgroup: number | null;
          joinedAt: string;
          completedAt: string | null;
          members: ProcessedMemberDetail[];
        }
      >();

      for (const row of servedRows) {
        const isBrigade = !!row.entry.brigadeId && !!row.brigade;
        const slotKey = isBrigade ? `brigade-${row.entry.brigadeId}` : `user-${row.user.telegramId}`;
        const leaderUser = isBrigade
          ? (userMap.get(row.brigade!.leaderTelegramId) ?? row.user)
          : row.user;

        let slot = servedSlotsMap.get(slotKey);
        if (!slot) {
          slot = {
            slotKey,
            isBrigade,
            brigadeId: isBrigade ? row.brigade!.id : null,
            brigadeName: isBrigade ? row.brigade!.name : null,
            leaderTelegramId: leaderUser.telegramId,
            leaderDisplayName: leaderUser.displayName,
            leaderUsername: leaderUser.username,
            primaryEntryId: row.entry.id,
            subgroup: isBrigade ? row.brigade!.subgroup : row.user.subgroup,
            joinedAt: row.entry.joinedAt,
            completedAt: row.entry.completedAt,
            members: [],
          };
          servedSlotsMap.set(slotKey, slot);
        }

        if (row.user.telegramId === leaderUser.telegramId) {
          slot.primaryEntryId = row.entry.id;
        }

        slot.members.push({
          id: row.entry.id,
          telegramId: row.user.telegramId,
          displayName: row.user.displayName,
          username: row.user.username,
          subgroup: row.user.subgroup,
          isLeader: row.user.telegramId === leaderUser.telegramId,
        });
      }

      const servedSlots = [...servedSlotsMap.values()].sort((a, b) => {
        const timeA = a.completedAt ? Date.parse(a.completedAt) : 0;
        const timeB = b.completedAt ? Date.parse(b.completedAt) : 0;
        return timeA - timeB;
      });

      // Store processed details for this queue
      results.set(queue.id, {
        waiting: waitingSlots.map((slot, index) => ({
          id: slot.primaryEntryId,
          telegramId: slot.leaderTelegramId,
          displayName: slot.isBrigade ? slot.brigadeName! : slot.leaderDisplayName,
          username: slot.leaderUsername,
          subgroup: slot.subgroup,
          status: "waiting",
          position: index + 1,
          joinedAt: slot.joinedAt,
          brigadeId: slot.brigadeId,
          brigadeName: slot.brigadeName,
          leaderTelegramId: slot.leaderTelegramId,
          leaderDisplayName: slot.leaderDisplayName,
          members: slot.members,
        })),
        served: servedSlots.map((slot, index) => ({
          id: slot.primaryEntryId,
          telegramId: slot.leaderTelegramId,
          displayName: slot.isBrigade ? slot.brigadeName! : slot.leaderDisplayName,
          username: slot.leaderUsername,
          subgroup: slot.subgroup,
          status: "served",
          position: index + 1,
          joinedAt: slot.joinedAt,
          completedAt: slot.completedAt,
          brigadeId: slot.brigadeId,
          brigadeName: slot.brigadeName,
          leaderTelegramId: slot.leaderTelegramId,
          leaderDisplayName: slot.leaderDisplayName,
          members: slot.members,
        })),
        skipped: skippedRows.map(({ entry, user }) => ({
          id: entry.id,
          telegramId: user.telegramId,
          displayName: user.displayName,
          username: user.username,
          subgroup: user.subgroup,
          status: entry.status as "skipped" | "left",
          position: null,
          joinedAt: entry.joinedAt,
          completedAt: entry.completedAt,
        })),
        completedNames: servedSlots.map((slot) =>
          slot.isBrigade
            ? `${slot.brigadeName} (${slot.members.map((m) => m.displayName).join(", ")})`
            : slot.leaderDisplayName,
        ),
      });

      // 3. Update rotation state for future lessons in the semester
      if (servedSlots.length > 0) {
        const lastServed = servedSlots[servedSlots.length - 1];
        const lastMember = getRosterMemberByUsername(lastServed.leaderUsername);
        if (lastMember) {
          currentLastOrder = lastMember.listNumber;
        }
      }

      // 4. Update unserved tail for the next lesson
      if (waitingSlots.length > 0) {
        currentUnservedMap = new Map();
        for (let i = 0; i < waitingSlots.length; i++) {
          const slot = waitingSlots[i];
          currentUnservedMap.set(slot.leaderTelegramId, i);
          for (const m of slot.members) {
            currentUnservedMap.set(m.telegramId, i);
          }
        }
      } else if (rows.length > 0) {
        // Queue had entries and all of them were served, so unserved tail is empty
        currentUnservedMap.clear();
      }
      // If rows.length === 0 (empty queue), keep currentUnservedMap untouched
    }
  }

  return results;
}

function getCurrentWeekRange() {
  const minskCalendar = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const monday = new Date(
    Date.UTC(
      minskCalendar.getUTCFullYear(),
      minskCalendar.getUTCMonth(),
      minskCalendar.getUTCDate(),
    ),
  );
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  const formatIsoDate = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  return { mondayDate: formatIsoDate(monday), sundayDate: formatIsoDate(sunday) };
}

function getQueueMinskDateString(q: { lessonEndsAt: string | null; createdAt: string }): string {
  const ts = getQueueSortTimestamp(q);
  if (!ts) return "";
  const minskDate = new Date(ts + 3 * 60 * 60 * 1000);
  return `${minskDate.getUTCFullYear()}-${String(minskDate.getUTCMonth() + 1).padStart(2, "0")}-${String(minskDate.getUTCDate()).padStart(2, "0")}`;
}

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

  const { mondayDate, sundayDate } = getCurrentWeekRange();

  const visibleQueues = queueRows.filter((item) => {
    if (isExcludedSubject(item.subjectAbbrev, item.subjectName)) return false;
    const dateStr = getQueueMinskDateString(item);
    if (!dateStr) return true;
    return dateStr >= mondayDate && dateStr <= sundayDate;
  });
  if (visibleQueues.length === 0) return [];

  const subjectKeys = [...new Set(visibleQueues.map((q) => q.subjectKey))];
  const detailsMap = await computeQueueSequence(subjectKeys);

  return visibleQueues.map((queue) => {
    const details = detailsMap.get(queue.id);
    return {
      ...queue,
      isLocked: isQueueLocked(queue),
      waiting: details?.waiting ?? [],
      completed: details?.completedNames ?? [],
    };
  });
}
