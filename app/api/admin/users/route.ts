import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  isSuperAdminIdentity,
  requireCurrentUser,
} from "@/lib/telegram-auth";

function isProtectedAdmin(user: typeof users.$inferSelect) {
  return isSuperAdminIdentity(user.telegramId, user.username);
}

export async function GET() {
  try {
    const admin = await requireCurrentUser();
    if (!admin.isSuperAdmin) {
      return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const registeredUsers = await getDb()
      .select()
      .from(users)
      .orderBy(asc(users.subgroup), asc(users.rotationOrder), asc(users.displayName));

    return Response.json({
      users: registeredUsers.map((user) => ({
        telegramId: user.telegramId,
        displayName: user.displayName,
        username: user.username,
        subgroup: user.subgroup,
        isAdmin: user.isAdmin || isProtectedAdmin(user),
        isSuperAdmin: isProtectedAdmin(user),
        isProtected: isProtectedAdmin(user),
        isCurrentUser: user.telegramId === admin.telegramId,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Войдите через Telegram" }, { status: 401 });
    }
    return Response.json({ error: "Не удалось загрузить участников" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireCurrentUser();
    if (!admin.isSuperAdmin) {
      return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const payload = (await request.json()) as {
      telegramId?: string;
      isAdmin?: boolean;
    };
    const telegramId = payload.telegramId?.trim();
    if (!telegramId || typeof payload.isAdmin !== "boolean") {
      return Response.json({ error: "Некорректные данные" }, { status: 400 });
    }
    if (telegramId === admin.telegramId) {
      return Response.json(
        { error: "Нельзя изменить собственные права администратора" },
        { status: 409 },
      );
    }

    const db = getDb();
    const [target] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    if (!target) {
      return Response.json({ error: "Участник ещё не входил на сайт" }, { status: 404 });
    }
    if (!payload.isAdmin && isProtectedAdmin(target)) {
      return Response.json(
        { error: "Права основного администратора закреплены в настройках" },
        { status: 409 },
      );
    }

    await db
      .update(users)
      .set({ isAdmin: payload.isAdmin, updatedAt: new Date().toISOString() })
      .where(eq(users.telegramId, telegramId));

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Войдите через Telegram" }, { status: 401 });
    }
    return Response.json({ error: "Не удалось изменить права" }, { status: 500 });
  }
}
