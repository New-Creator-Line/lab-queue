import {
  createOrUpdateBrigade,
  disbandBrigade,
  getAvailableStudentsForSubject,
  getSubjectBrigades,
  getSubjectSettings,
  getUserAllBrigades,
  getUserBrigade,
} from "@/lib/brigades";
import { requireCurrentUser } from "@/lib/telegram-auth";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const url = new URL(request.url);
    const subjectKey = url.searchParams.get("subjectKey");

    if (!subjectKey) {
      const myBrigades = await getUserAllBrigades(user.telegramId);
      return Response.json({ myBrigades });
    }

    const [hasBrigades, myBrigade, allBrigades, availableStudents] = await Promise.all([
      getSubjectSettings(subjectKey),
      getUserBrigade(subjectKey, user.telegramId),
      getSubjectBrigades(subjectKey, user.isAdmin ? undefined : (user.subgroup ?? undefined)),
      user.subgroup ? getAvailableStudentsForSubject(subjectKey, user.subgroup) : Promise.resolve([]),
    ]);

    return Response.json({
      hasBrigades,
      myBrigade,
      allBrigades,
      availableStudents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить данные о бригадах";
    return Response.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    if (!user.subgroup) {
      return Response.json({ error: "Сначала выберите подгруппу в профиле" }, { status: 400 });
    }

    const body = (await request.json()) as {
      subjectKey?: string;
      name?: string;
      memberTelegramIds?: string[];
    };

    if (!body.subjectKey) {
      return Response.json({ error: "Не указан предмет" }, { status: 400 });
    }

    const rawName = body.name?.trim() || `Бригада (${user.displayName})`;
    const name = rawName.slice(0, 50);
    const memberTelegramIds = Array.isArray(body.memberTelegramIds) ? body.memberTelegramIds : [];

    const brigade = await createOrUpdateBrigade({
      subjectKey: body.subjectKey,
      name,
      leaderTelegramId: user.telegramId,
      memberTelegramIds,
      subgroup: user.subgroup,
    });

    return Response.json({ ok: true, brigade });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить бригаду";
    return Response.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = (await request.json()) as { brigadeId?: number };

    if (!body.brigadeId) {
      return Response.json({ error: "Не указан ID бригады" }, { status: 400 });
    }

    await disbandBrigade(body.brigadeId, user.telegramId, user.isAdmin);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось расформировать бригаду";
    return Response.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 },
    );
  }
}
