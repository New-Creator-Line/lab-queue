import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { queueEntries, queuePasses, queues, rotations } from "@/db/schema";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const admin = await requireCurrentUser();
    if (!admin.isAdmin) {
      return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      subjectKey?: string;
    };
    const subjectKey = body.subjectKey?.trim();
    const isAll = !subjectKey || subjectKey === "all";

    const db = getDb();
    const now = new Date().toISOString();

    if (!isAll) {
      // 1. Reset marker for this specific subject
      await db
        .insert(rotations)
        .values({
          subjectKey,
          subgroup: -1,
          lastServedTelegramId: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [rotations.subjectKey, rotations.subgroup],
          set: {
            lastServedTelegramId: null,
            updatedAt: now,
          },
        });

      // 2. Clear lastServedTelegramId for this subject's real subgroups
      await db
        .update(rotations)
        .set({
          lastServedTelegramId: null,
          updatedAt: now,
        })
        .where(eq(rotations.subjectKey, subjectKey));

      // 3. Find open queues for this subject
      const openQueues = await db
        .select({ id: queues.id })
        .from(queues)
        .where(and(eq(queues.subjectKey, subjectKey), eq(queues.status, "open")));

      if (openQueues.length > 0) {
        const queueIds = openQueues.map((q) => q.id);
        // Clear in-queue passes
        await db
          .delete(queuePasses)
          .where(inArray(queuePasses.queueId, queueIds));

        // Reset served and skipped back to waiting in open queues
        await db
          .update(queueEntries)
          .set({ status: "waiting", completedAt: null })
          .where(
            and(
              inArray(queueEntries.queueId, queueIds),
              inArray(queueEntries.status, ["served", "skipped"]),
            ),
          );
      }
    } else {
      // 1. Global reset marker
      await db
        .insert(rotations)
        .values({
          subjectKey: "__all__",
          subgroup: -1,
          lastServedTelegramId: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [rotations.subjectKey, rotations.subgroup],
          set: {
            lastServedTelegramId: null,
            updatedAt: now,
          },
        });

      // 2. Clear lastServedTelegramId for all rotations
      await db
        .update(rotations)
        .set({
          lastServedTelegramId: null,
          updatedAt: now,
        });

      // 3. Find all open queues
      const openQueues = await db
        .select({ id: queues.id })
        .from(queues)
        .where(eq(queues.status, "open"));

      if (openQueues.length > 0) {
        const queueIds = openQueues.map((q) => q.id);
        // Clear in-queue passes
        await db
          .delete(queuePasses)
          .where(inArray(queuePasses.queueId, queueIds));

        // Reset served and skipped back to waiting in open queues
        await db
          .update(queueEntries)
          .set({ status: "waiting", completedAt: null })
          .where(
            and(
              inArray(queueEntries.queueId, queueIds),
              inArray(queueEntries.status, ["served", "skipped"]),
            ),
          );
      }
    }

    return Response.json({ ok: true, resetAt: now });
  } catch (error) {
    console.error("Failed to reset queue rotation:", error);
    return Response.json(
      { error: "Не удалось сбросить порядок очередей" },
      { status: 500 },
    );
  }
}
