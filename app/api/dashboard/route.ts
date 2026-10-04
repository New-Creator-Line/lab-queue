import { getOpenQueues } from "@/lib/queue-data";
import { getSubjects } from "@/lib/schedule";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    if (!user.subgroup) return Response.json({ user, subjects: [], queues: [] });

    const [subjectsResult, queues] = await Promise.all([
      getSubjects(user.subgroup).then(
        (subjects) => ({ subjects, scheduleAvailable: true }),
        () => ({ subjects: [], scheduleAvailable: false }),
      ),
      getOpenQueues(user.subgroup, user.isAdmin),
    ]);
    return Response.json({ user, queues, ...subjectsResult });
  } catch {
    return Response.json({ error: "Сессия истекла" }, { status: 401 });
  }
}
