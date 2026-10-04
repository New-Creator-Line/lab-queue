import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { queues } from "@/db/schema";
import { isQueueLocked } from "@/lib/queue-lock";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  try {
    const admin = await requireCurrentUser();
    if (!admin.isAdmin) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    const { queueId } = (await request.json()) as { queueId?: number };
    const db = getDb();
    const [queue] = await db.select().from(queues).where(eq(queues.id, Number(queueId))).limit(1);
    if (!queue) return Response.json({ error: "Очередь не найдена" }, { status: 404 });
    if (isQueueLocked(queue)) {
      return Response.json({ error: "Занятие уже закончилось — очередь заблокирована" }, { status: 409 });
    }
    await db
      .update(queues)
      .set({ status: "closed", closedAt: new Date().toISOString() })
      .where(eq(queues.id, Number(queueId)));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось закрыть очередь" }, { status: 500 });
  }
}
