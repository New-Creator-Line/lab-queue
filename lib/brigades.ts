import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { brigadeMembers, brigades, subjectSettings, users } from "@/db/schema";
import { GROUP_ROSTER, normalizeTelegramUsername } from "@/lib/roster";

export type BrigadeMemberDetail = {
  telegramId: string;
  displayName: string;
  username: string | null;
  subgroup: number | null;
  isLeader: boolean;
};

export type BrigadeWithMembers = {
  id: number;
  subjectKey: string;
  subgroup: number;
  name: string;
  leaderTelegramId: string;
  leaderDisplayName: string;
  createdAt: string;
  members: BrigadeMemberDetail[];
};

export async function getSubjectSettings(subjectKey: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(subjectSettings)
    .where(eq(subjectSettings.subjectKey, subjectKey))
    .limit(1);
  return row?.hasBrigades ?? false;
}

export async function getAllSubjectSettings(): Promise<Record<string, boolean>> {
  const db = getDb();
  const rows = await db.select().from(subjectSettings);
  const result: Record<string, boolean> = {};
  for (const row of rows) {
    result[row.subjectKey] = row.hasBrigades;
  }
  return result;
}

export async function setSubjectBrigadesEnabled(
  subjectKey: string,
  hasBrigades: boolean,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .insert(subjectSettings)
    .values({
      subjectKey,
      hasBrigades,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subjectSettings.subjectKey,
      set: {
        hasBrigades,
        updatedAt: now,
      },
    });
}

export async function getUserBrigade(
  subjectKey: string,
  telegramId: string,
): Promise<BrigadeWithMembers | null> {
  const db = getDb();
  // Find brigadeId where user is a member
  const [membership] = await db
    .select({ brigadeId: brigadeMembers.brigadeId })
    .from(brigadeMembers)
    .where(
      and(
        eq(brigadeMembers.subjectKey, subjectKey),
        eq(brigadeMembers.telegramId, telegramId),
      ),
    )
    .limit(1);

  if (!membership) return null;

  const [brigadeRow] = await db
    .select({
      brigade: brigades,
      leader: users,
    })
    .from(brigades)
    .innerJoin(users, eq(brigades.leaderTelegramId, users.telegramId))
    .where(eq(brigades.id, membership.brigadeId))
    .limit(1);

  if (!brigadeRow) return null;

  const memberRows = await db
    .select({
      member: brigadeMembers,
      user: users,
    })
    .from(brigadeMembers)
    .innerJoin(users, eq(brigadeMembers.telegramId, users.telegramId))
    .where(eq(brigadeMembers.brigadeId, membership.brigadeId));

  const members: BrigadeMemberDetail[] = memberRows.map(({ user }) => ({
    telegramId: user.telegramId,
    displayName: user.displayName,
    username: user.username,
    subgroup: user.subgroup,
    isLeader: user.telegramId === brigadeRow.brigade.leaderTelegramId,
  }));

  // Ensure leader is first
  members.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));

  return {
    id: brigadeRow.brigade.id,
    subjectKey: brigadeRow.brigade.subjectKey,
    subgroup: brigadeRow.brigade.subgroup,
    name: brigadeRow.brigade.name,
    leaderTelegramId: brigadeRow.brigade.leaderTelegramId,
    leaderDisplayName: brigadeRow.leader.displayName,
    createdAt: brigadeRow.brigade.createdAt,
    members,
  };
}

export async function getSubjectBrigades(
  subjectKey: string,
  subgroup?: number,
): Promise<BrigadeWithMembers[]> {
  const db = getDb();

  const query = db
    .select({
      brigade: brigades,
      leader: users,
    })
    .from(brigades)
    .innerJoin(users, eq(brigades.leaderTelegramId, users.telegramId))
    .where(
      subgroup
        ? and(eq(brigades.subjectKey, subjectKey), eq(brigades.subgroup, subgroup))
        : eq(brigades.subjectKey, subjectKey),
    );

  const brigadeRows = await query;
  if (brigadeRows.length === 0) return [];

  const brigadeIds = brigadeRows.map((b) => b.brigade.id);

  const memberRows = await db
    .select({
      member: brigadeMembers,
      user: users,
    })
    .from(brigadeMembers)
    .innerJoin(users, eq(brigadeMembers.telegramId, users.telegramId))
    .where(inArray(brigadeMembers.brigadeId, brigadeIds));

  const membersByBrigade = new Map<number, BrigadeMemberDetail[]>();
  for (const { member, user } of memberRows) {
    const list = membersByBrigade.get(member.brigadeId) ?? [];
    list.push({
      telegramId: user.telegramId,
      displayName: user.displayName,
      username: user.username,
      subgroup: user.subgroup,
      isLeader: false,
    });
    membersByBrigade.set(member.brigadeId, list);
  }

  return brigadeRows.map(({ brigade, leader }) => {
    const rawMembers = membersByBrigade.get(brigade.id) ?? [];
    const members = rawMembers.map((m) => ({
      ...m,
      isLeader: m.telegramId === brigade.leaderTelegramId,
    }));
    members.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));

    return {
      id: brigade.id,
      subjectKey: brigade.subjectKey,
      subgroup: brigade.subgroup,
      name: brigade.name,
      leaderTelegramId: brigade.leaderTelegramId,
      leaderDisplayName: leader.displayName,
      createdAt: brigade.createdAt,
      members,
    };
  });
}

export async function getAvailableStudentsForSubject(
  subjectKey: string,
  subgroup: number,
): Promise<Array<{ telegramId: string; displayName: string; username: string | null }>> {
  const db = getDb();

  // Find all telegramIds already in a brigade for this subject
  const occupiedRows = await db
    .select({ telegramId: brigadeMembers.telegramId })
    .from(brigadeMembers)
    .where(eq(brigadeMembers.subjectKey, subjectKey));

  const occupiedSet = new Set(occupiedRows.map((r) => r.telegramId));

  // Also match existing registered users in this subgroup
  const registeredUsers = await db
    .select()
    .from(users)
    .where(eq(users.subgroup, subgroup));

  const registeredUserMap = new Map(
    registeredUsers.map((u) => [normalizeTelegramUsername(u.username), u]),
  );

  // Return all roster members from this subgroup that are registered and not yet occupied
  const available: Array<{ telegramId: string; displayName: string; username: string | null }> = [];

  for (const rosterMember of GROUP_ROSTER) {
    if (rosterMember.subgroup !== subgroup) continue;
    const user = registeredUserMap.get(normalizeTelegramUsername(rosterMember.username));
    if (user && !occupiedSet.has(user.telegramId)) {
      available.push({
        telegramId: user.telegramId,
        displayName: user.displayName,
        username: user.username,
      });
    }
  }

  return available;
}

export async function createOrUpdateBrigade(params: {
  subjectKey: string;
  name: string;
  leaderTelegramId: string;
  memberTelegramIds: string[];
  subgroup: number;
}): Promise<BrigadeWithMembers> {
  const { subjectKey, name, leaderTelegramId, subgroup } = params;
  const db = getDb();

  // Deduplicate member IDs and ensure leader is always included
  const memberSet = new Set(params.memberTelegramIds);
  memberSet.add(leaderTelegramId);
  const allMemberIds = [...memberSet];

  // Verify all members belong to the specified subgroup
  const memberUsers = await db
    .select()
    .from(users)
    .where(inArray(users.telegramId, allMemberIds));

  if (memberUsers.length !== allMemberIds.length) {
    throw new Error("Некоторые выбранные участники не найдены в системе");
  }

  for (const u of memberUsers) {
    if (u.subgroup !== subgroup) {
      throw new Error(`Студент ${u.displayName} не относится к вашей подгруппе (${subgroup})`);
    }
  }

  // Check if current user is already leading or part of a brigade for this subject
  const existingUserBrigade = await getUserBrigade(subjectKey, leaderTelegramId);

  await db.transaction(async (tx) => {
    let brigadeId: number;

    if (existingUserBrigade) {
      if (existingUserBrigade.leaderTelegramId !== leaderTelegramId) {
        throw new Error("Только лидер бригады может редактировать её состав");
      }
      brigadeId = existingUserBrigade.id;

      // Update brigade name
      await tx
        .update(brigades)
        .set({ name })
        .where(eq(brigades.id, brigadeId));

      // Remove existing members that are no longer in the list
      const removedIds = existingUserBrigade.members
        .map((m) => m.telegramId)
        .filter((id) => !memberSet.has(id));

      if (removedIds.length > 0) {
        await tx
          .delete(brigadeMembers)
          .where(
            and(
              eq(brigadeMembers.brigadeId, brigadeId),
              inArray(brigadeMembers.telegramId, removedIds),
            ),
          );
      }

      // Check if newly added members already belong to another brigade
      const existingMemberSet = new Set(existingUserBrigade.members.map((m) => m.telegramId));
      const newlyAddedIds = allMemberIds.filter((id) => !existingMemberSet.has(id));

      if (newlyAddedIds.length > 0) {
        const occupied = await tx
          .select({
            telegramId: brigadeMembers.telegramId,
            userName: users.displayName,
          })
          .from(brigadeMembers)
          .innerJoin(users, eq(brigadeMembers.telegramId, users.telegramId))
          .where(
            and(
              eq(brigadeMembers.subjectKey, subjectKey),
              inArray(brigadeMembers.telegramId, newlyAddedIds),
            ),
          );

        if (occupied.length > 0) {
          throw new Error(
            `Студент ${occupied[0].userName} уже состоит в бригаде по этому предмету`,
          );
        }
      }
    } else {
      // Check if ANY member is already in a brigade for this subject
      const occupied = await tx
        .select({
          telegramId: brigadeMembers.telegramId,
          userName: users.displayName,
        })
        .from(brigadeMembers)
        .innerJoin(users, eq(brigadeMembers.telegramId, users.telegramId))
        .where(
          and(
            eq(brigadeMembers.subjectKey, subjectKey),
            inArray(brigadeMembers.telegramId, allMemberIds),
          ),
        );

      if (occupied.length > 0) {
        throw new Error(
          `Студент ${occupied[0].userName} уже состоит в бригаде по этому предмету`,
        );
      }

      const [newBrigade] = await tx
        .insert(brigades)
        .values({
          subjectKey,
          subgroup,
          name,
          leaderTelegramId,
        })
        .returning();

      brigadeId = newBrigade.id;
    }

    // Insert new members
    for (const memberId of allMemberIds) {
      await tx
        .insert(brigadeMembers)
        .values({
          brigadeId,
          subjectKey,
          telegramId: memberId,
        })
        .onConflictDoNothing();
    }
  });

  const updated = await getUserBrigade(subjectKey, leaderTelegramId);
  if (!updated) {
    throw new Error("Не удалось создать бригаду");
  }
  return updated;
}

export async function disbandBrigade(
  brigadeId: number,
  requestedByTelegramId: string,
  isAdmin: boolean,
): Promise<void> {
  const db = getDb();
  const [brigade] = await db
    .select()
    .from(brigades)
    .where(eq(brigades.id, brigadeId))
    .limit(1);

  if (!brigade) {
    throw new Error("Бригада не найдена");
  }

  if (!isAdmin && brigade.leaderTelegramId !== requestedByTelegramId) {
    throw new Error("Только лидер бригады или администратор может её расформировать");
  }

  await db.delete(brigades).where(eq(brigades.id, brigadeId));
}

export async function changeBrigadeLeader(
  brigadeId: number,
  newLeaderTelegramId: string,
  requestedByTelegramId: string,
  isAdmin: boolean,
): Promise<void> {
  const db = getDb();
  const [brigade] = await db
    .select()
    .from(brigades)
    .where(eq(brigades.id, brigadeId))
    .limit(1);

  if (!brigade) {
    throw new Error("Бригада не найдена");
  }

  if (!isAdmin && brigade.leaderTelegramId !== requestedByTelegramId) {
    throw new Error("Только текущий лидер бригады или администратор может передать лидерство");
  }

  // Verify new leader is a member of this brigade
  const [isMember] = await db
    .select()
    .from(brigadeMembers)
    .where(
      and(
        eq(brigadeMembers.brigadeId, brigadeId),
        eq(brigadeMembers.telegramId, newLeaderTelegramId),
      ),
    )
    .limit(1);

  if (!isMember) {
    throw new Error("Новый лидер должен состоять в этой бригаде");
  }

  await db
    .update(brigades)
    .set({ leaderTelegramId: newLeaderTelegramId })
    .where(eq(brigades.id, brigadeId));
}
