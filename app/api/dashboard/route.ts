import { getAllSubjectSettings } from "@/lib/brigades";
import { getOpenQueues } from "@/lib/queue-data";
import { getAllSemesterSubjects, getSubjects } from "@/lib/schedule";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    if (!user.subgroup) return Response.json({ user, subjects: [], allSubjects: [], queues: [], subjectSettings: {} });

    const [subjectsResult, queues, subjectSettings, allSubjects] = await Promise.all([
      getSubjects(user.subgroup).then(
        (subjects) => ({ subjects, scheduleAvailable: true }),
        () => ({ subjects: [], scheduleAvailable: false }),
      ),
      getOpenQueues(user.subgroup, user.isAdmin),
      getAllSubjectSettings(),
      getAllSemesterSubjects().catch(() => []),
    ]);
    return Response.json({ user, queues, subjectSettings, allSubjects, ...subjectsResult });
  } catch {
    return Response.json({ error: "Сессия истекла" }, { status: 401 });
  }
}
