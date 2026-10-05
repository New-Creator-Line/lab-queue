import "server-only";

export type RosterMember = {
  listNumber: number;
  displayName: string;
  username: string;
  subgroup: 1 | 2;
  rotationOrder: number;
  isAdmin: boolean;
};

const rosterSource = [
  ["Александренков Денис", "dharrisss"],
  ["Амельченко Роман", "ne_romchick"],
  ["Борисюк Илья", "qeliuns"],
  ["Винников Иван", "trista_baksov"],
  ["Гайдукевич Ксения", "Kseenia022"],
  ["Гузова Александра", "alex_red_star"],
  ["Гуренков Данила", "DanvFox12"],
  ["Драпеза Вероника", "kausaustralis"],
  ["Иосько Михаил", "misha_iosko"],
  ["Кацубо Андрей", "genii_na_prikole"],
  ["Кирилушкин Андрей", "aokihagaraxd"],
  ["Козлюк Павел", "paveel4"],
  ["Колесник Владислав", "g4rn0x"],
  ["Королев Илья", "triglet"],
  ["Куновский Дмитрий", "derevyannymackintosh"],
  ["Леоновец Дана", "mirrwsdcle"],
  ["Мамедов Рустам", "tamb1masaev"],
  ["Марчук Кирилл", "droripan_kirya"],
  ["Матусевич Егор", "Bul_Bashka"],
  ["Мидляр Илья", "andrewnewhite"],
  ["Могилевчик Тимофей", "Qwenger"],
  ["Попов Андрей", "tamakey"],
  ["Рогаль Алексей", "GRRAMPUMS"],
  ["Савин Тимофей", "kfc_serbia"],
  ["Савостикова Екатерина", "ykyshy11"],
  ["Третьяк Арсений", "CEHR55555"],
  ["Тузова Виктория", "vikatuzova"],
  ["Хмара Матвей", "xxx_moti_xxx"],
  ["Шпаковская Василиса", "daratolkaa"],
  ["Янушковский Алексей", "lexayanush"],
  ["Тестовый пользователь", "test_acc_dev"],
] as const;

export const GROUP_ROSTER: readonly RosterMember[] = rosterSource.map(
  ([displayName, username], index) => {
    const listNumber = index + 1;
    const subgroup = listNumber <= 15 ? 1 : 2;
    return {
      listNumber,
      displayName,
      username,
      subgroup,
      // Keep roster positions in a reserved range so they cannot collide with
      // profiles created by the old manual-registration flow.
      rotationOrder: 1000 + (subgroup === 1 ? listNumber : listNumber - 15),
      isAdmin: ["qeliuns", "dharrisss"].includes(username.toLowerCase()),
    };
  },
);

export function normalizeTelegramUsername(username: string | null | undefined) {
  return username?.trim().replace(/^@/, "").toLowerCase() ?? "";
}

export function getRosterMemberByUsername(username: string | null | undefined) {
  const normalized = normalizeTelegramUsername(username);
  if (!normalized) return null;
  return (
    GROUP_ROSTER.find(
      (member) => normalizeTelegramUsername(member.username) === normalized,
    ) ?? null
  );
}
