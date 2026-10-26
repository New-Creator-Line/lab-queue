import { getAllSubjectSettings, setSubjectBrigadesEnabled } from "@/lib/brigades";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    if (!user) return Response.json({ error: "Необходима авторизация" }, { status: 401 });
    const settings = await getAllSubjectSettings();
    return Response.json({ settings });
  } catch {
    return Response.json({ error: "Не удалось получить настройки предметов" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    if (!user.isAdmin) {
      return Response.json({ error: "Недостаточно прав администратора" }, { status: 403 });
    }

    const { subjectKey, hasBrigades } = (await request.json()) as {
      subjectKey?: string;
      hasBrigades?: boolean;
    };

    if (!subjectKey || typeof hasBrigades !== "boolean") {
      return Response.json({ error: "Некорректные параметры" }, { status: 400 });
    }

    await setSubjectBrigadesEnabled(subjectKey, hasBrigades);
    return Response.json({ ok: true, subjectKey, hasBrigades });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось обновить настройки";
    return Response.json({ error: message }, { status: 500 });
  }
}
