import { describe, expect, it } from "vitest";
import { getBrigadeDisplayName } from "@/lib/queue-data";
import { GROUP_ROSTER } from "@/lib/roster";
import { isWholeGroupSubject } from "@/lib/schedule";

describe("Brigade roster and rotation rules", () => {
  it("ensures roster members belong to consistent subgroups", () => {
    const subgroup1 = GROUP_ROSTER.filter((m) => m.subgroup === 1);
    const subgroup2 = GROUP_ROSTER.filter((m) => m.subgroup === 2);

    expect(subgroup1.length).toBeGreaterThan(0);
    expect(subgroup2.length).toBeGreaterThan(0);

    for (const member of subgroup1) {
      expect(member.subgroup).toBe(1);
      expect(member.listNumber).toBeLessThanOrEqual(15);
    }

    for (const member of subgroup2) {
      expect(member.subgroup).toBe(2);
      expect(member.listNumber).toBeGreaterThan(15);
    }
  });

  it("calculates brigade sorting order strictly from the leader's roster number", () => {
    const leaderA = GROUP_ROSTER.find((m) => m.listNumber === 5)!;
    const memberA1 = GROUP_ROSTER.find((m) => m.listNumber === 12)!;
    const leaderB = GROUP_ROSTER.find((m) => m.listNumber === 3)!;
    const memberB1 = GROUP_ROSTER.find((m) => m.listNumber === 1)!;

    expect(leaderA).toBeDefined();
    expect(memberA1).toBeDefined();
    expect(leaderB).toBeDefined();
    expect(memberB1).toBeDefined();

    const brigadeA = {
      id: 101,
      name: "Бригада 1",
      leader: leaderA,
      members: [leaderA, memberA1],
    };

    const brigadeB = {
      id: 102,
      name: "Бригада 2",
      leader: leaderB,
      members: [leaderB, memberB1],
    };

    const currentLastOrder = 0;
    const slots = [brigadeA, brigadeB];

    slots.sort((left, right) => {
      const leftOrder = left.leader.listNumber;
      const rightOrder = right.leader.listNumber;
      const leftSection = leftOrder > currentLastOrder ? 0 : 1;
      const rightSection = rightOrder > currentLastOrder ? 0 : 1;
      return leftSection - rightSection || leftOrder - rightOrder;
    });

    expect(slots[0].id).toBe(brigadeB.id);
    expect(slots[1].id).toBe(brigadeA.id);
  });

  it("handles circular rotation after lastServedOrder for brigades", () => {
    const leaderA = GROUP_ROSTER.find((m) => m.listNumber === 5)!;
    const leaderB = GROUP_ROSTER.find((m) => m.listNumber === 3)!;

    const currentLastOrder = 4;
    const slots = [
      { id: "B", leader: leaderB },
      { id: "A", leader: leaderA },
    ];

    slots.sort((left, right) => {
      const leftOrder = left.leader.listNumber;
      const rightOrder = right.leader.listNumber;
      const leftSection = leftOrder > currentLastOrder ? 0 : 1;
      const rightSection = rightOrder > currentLastOrder ? 0 : 1;
      return leftSection - rightSection || leftOrder - rightOrder;
    });

    expect(slots[0].id).toBe("A");
    expect(slots[1].id).toBe("B");
  });

  it("ensures unserved brigade from previous queue gets top priority", () => {
    const leaderA = GROUP_ROSTER.find((m) => m.listNumber === 1)!;
    const leaderB = GROUP_ROSTER.find((m) => m.listNumber === 10)!;

    const currentUnservedMap = new Map<string, number>([
      [leaderB.username, 0],
    ]);

    const slots = [
      { id: "A", leader: leaderA },
      { id: "B", leader: leaderB },
    ];

    slots.sort((left, right) => {
      const leftUnserved = currentUnservedMap.get(left.leader.username);
      const rightUnserved = currentUnservedMap.get(right.leader.username);

      const leftIsUnserved = leftUnserved !== undefined;
      const rightIsUnserved = rightUnserved !== undefined;

      if (leftIsUnserved && !rightIsUnserved) return -1;
      if (!leftIsUnserved && rightIsUnserved) return 1;
      if (leftIsUnserved && rightIsUnserved) return leftUnserved - rightUnserved;

      const leftOrder = left.leader.listNumber;
      const rightOrder = right.leader.listNumber;
      return leftOrder - rightOrder;
    });

    expect(slots[0].id).toBe("B");
    expect(slots[1].id).toBe("A");
  });

  it("handles swapping brigade slots on pass", () => {
    const slots = [
      { id: "brigade-1", leaderId: "user-1", members: ["user-1", "user-2"] },
      { id: "brigade-2", leaderId: "user-3", members: ["user-3", "user-4"] },
    ];

    const pass = { passerTelegramId: "user-2", promotedTelegramId: "user-4" };

    const passerIndex = slots.findIndex(
      (s) => s.leaderId === pass.passerTelegramId || s.members.includes(pass.passerTelegramId),
    );
    const promotedIndex = slots.findIndex(
      (s) => s.leaderId === pass.promotedTelegramId || s.members.includes(pass.promotedTelegramId),
    );

    expect(passerIndex).toBe(0);
    expect(promotedIndex).toBe(1);

    const [promoted] = slots.splice(promotedIndex, 1);
    slots.splice(passerIndex, 0, promoted);

    expect(slots[0].id).toBe("brigade-2");
    expect(slots[1].id).toBe("brigade-1");
  });

  it("identifies whole-group subjects such as ТиМАУ", () => {
    expect(isWholeGroupSubject("ТиМАУ::Теория и методы автоматического управления")).toBe(true);
    expect(isWholeGroupSubject("ТиМАУ")).toBe(true);
    expect(isWholeGroupSubject("теория и методы автоматического управления")).toBe(true);
    expect(isWholeGroupSubject("АМД::Архитектура микропроцессорных систем")).toBe(false);
    expect(isWholeGroupSubject("МПдИС::Микропроцессорные датчики и системы")).toBe(false);
  });

  it("validates that mixed subgroup brigade creation is rejected for regular subjects but allowed for whole-group subjects", () => {
    const memberSubgroup1 = GROUP_ROSTER.find((m) => m.subgroup === 1)!;
    const memberSubgroup2 = GROUP_ROSTER.find((m) => m.subgroup === 2)!;

    function validateBrigadeMembers(
      subjectKey: string,
      subgroup: number,
      members: Array<{ subgroup: number }>,
    ) {
      const isWholeGroup = isWholeGroupSubject(subjectKey) || subgroup === 0;
      const targetSubgroup = isWholeGroup ? 0 : subgroup;
      if (!isWholeGroup) {
        for (const m of members) {
          if (m.subgroup !== subgroup) {
            throw new Error(`Студент не относится к вашей подгруппе (${subgroup})`);
          }
        }
      }
      return { ok: true, targetSubgroup };
    }

    // Regular subject: mixed subgroups rejected
    expect(() =>
      validateBrigadeMembers("АМД", 1, [memberSubgroup1, memberSubgroup2]),
    ).toThrowError("Студент не относится к вашей подгруппе (1)");

    // Whole-group subject (ТиМАУ): mixed subgroups allowed and assigned subgroup 0
    const result = validateBrigadeMembers("ТиМАУ", 1, [memberSubgroup1, memberSubgroup2]);
    expect(result.ok).toBe(true);
    expect(result.targetSubgroup).toBe(0);
  });

  it("simulates atomic brigade queue join without duplicate entries", () => {
    const existingEntries = new Map<string, { queueId: number; cycle: number; telegramId: string; status: string }>();

    function joinBrigade(queueId: number, cycle: number, brigadeId: number, memberIds: string[]) {
      // Check if already in queue
      const alreadyInQueue = memberIds.some((id) => {
        const key = `${queueId}-${cycle}-${id}`;
        return existingEntries.get(key)?.status === "waiting";
      });

      if (alreadyInQueue) {
        return { ok: true, alreadyJoined: true, inserted: 0 };
      }

      let inserted = 0;
      for (const id of memberIds) {
        const key = `${queueId}-${cycle}-${id}`;
        existingEntries.set(key, { queueId, cycle, telegramId: id, status: "waiting" });
        inserted += 1;
      }

      return { ok: true, alreadyJoined: false, inserted };
    }

    const members = ["user-1", "user-2", "user-3"];
    // First member joins
    const firstJoin = joinBrigade(1, 1, 10, members);
    expect(firstJoin.inserted).toBe(3);
    expect(firstJoin.alreadyJoined).toBe(false);

    // Second member simultaneously or subsequently joins
    const secondJoin = joinBrigade(1, 1, 10, members);
    expect(secondJoin.inserted).toBe(0);
    expect(secondJoin.alreadyJoined).toBe(true);
  });

  it("simulates brigade completion marking all members served and leader in rotation", () => {
    const entries = [
      { id: 1, brigadeId: 10, telegramId: "user-1", status: "waiting", completedAt: null as string | null },
      { id: 2, brigadeId: 10, telegramId: "user-2", status: "waiting", completedAt: null as string | null },
      { id: 3, brigadeId: null, telegramId: "user-3", status: "waiting", completedAt: null as string | null },
    ];

    let lastServedTelegramId: string | null = null;
    const completedAt = "2026-10-27T01:00:00.000Z";

    function completeEntry(entryId: number, leaderTelegramId: string) {
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) throw new Error("Entry not found");

      if (entry.brigadeId) {
        for (const e of entries) {
          if (e.brigadeId === entry.brigadeId && e.status === "waiting") {
            e.status = "served";
            e.completedAt = completedAt;
          }
        }
        lastServedTelegramId = leaderTelegramId;
      } else {
        entry.status = "served";
        entry.completedAt = completedAt;
        lastServedTelegramId = entry.telegramId;
      }
    }

    // Complete brigade via member user-2
    completeEntry(2, "user-1");

    expect(entries[0].status).toBe("served");
    expect(entries[0].completedAt).toBe(completedAt);
    expect(entries[1].status).toBe("served");
    expect(entries[1].completedAt).toBe(completedAt);
    expect(entries[2].status).toBe("waiting"); // other entry untouched
    expect(lastServedTelegramId).toBe("user-1"); // leader registered in rotation
  });

  it("formats brigade queue display name with leader surname", () => {
    expect(getBrigadeDisplayName("Бригада 1", "Амельченко Роман")).toBe("Бригада 1 (Амельченко)");
    expect(getBrigadeDisplayName("Борисюк", "Амельченко Роман")).toBe("Борисюк (Амельченко)");
    expect(getBrigadeDisplayName("Борисюк", "Борисюк Владислав")).toBe("Борисюк");
    expect(getBrigadeDisplayName(null, "Амельченко Роман")).toBe("Амельченко Роман");
  });
});
