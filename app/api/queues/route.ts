import { getOpenQueues } from "@/lib/queue-data";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    if (!user.subgroup) return Response.json({ queues: [] });

    const queues = await getOpenQueues(user.subgroup, user.isAdmin);
    return Response.json({ queues });
  } catch {
    return Response.json({ error: "Сессия истекла" }, { status: 401 });
  }
}
