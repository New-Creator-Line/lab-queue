const GROUP = "420604";
const SCHEDULE_CACHE_SECONDS = 60 * 60; // 1 час для структуры расписания
const WEEK_CACHE_SECONDS = 60 * 5; // 5 минут для номера учебной недели (быстрое обновление при смене недели)
const BSUIR_TIMEOUT_MS = 8_000;
const ALLOWED_TYPES = new Set(["ЛР", "ПЗ"]);
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_INDEX: Record<string, number> = {
  Понедельник: 0,
  Вторник: 1,
  Среда: 2,
  Четверг: 3,
  Пятница: 4,
  Суббота: 5,
  Воскресенье: 6,
};
const EXCLUDED_SUBJECTS = [
  /физическ.*культур/i,
  /информационн.*час/i,
];

export function isExcludedSubject(subject: string, subjectFullName: string) {
  const title = `${subject} ${subjectFullName}`;
  return EXCLUDED_SUBJECTS.some((pattern) => pattern.test(title));
}

type ApiLesson = {
  subject: string;
  subjectFullName: string;
  lessonTypeAbbrev: string;
  numSubgroup: number;
  startLessonTime: string;
  endLessonTime: string;
  auditories?: string[];
  weekNumber?: number[];
  dateLesson?: string | null;
  startLessonDate?: string | null;
  endLessonDate?: string | null;
  employees?: Array<{ firstName: string; lastName: string; middleName?: string }>;
};

type ApiSchedule = {
  schedules?: Record<string, ApiLesson[]>;
  nextSchedules?: Record<string, ApiLesson[]>;
};

export type SubjectSummary = {
  key: string;
  abbrev: string;
  name: string;
  lessonTypes: string[];
  lessons: Array<{
    day: string;
    type: string;
    subgroup: number;
    time: string;
    room: string;
    weeks: number[];
    date: string;
    isPast: boolean;
    weekNumber: number;
    weekOffset: number;
  }>;
};

function parseBelarusDate(value?: string | null) {
  if (!value) return null;
  const [day, month, year] = value.split(".").map(Number);
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getCurrentMonday(now = new Date()) {
  const minskCalendar = new Date(now.getTime() + MINSK_OFFSET_MS);
  const date = new Date(
    Date.UTC(
      minskCalendar.getUTCFullYear(),
      minskCalendar.getUTCMonth(),
      minskCalendar.getUTCDate(),
    ),
  );
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date;
}

function getLessonDate(day: string, monday: Date) {
  const dayIndex = DAY_INDEX[day];
  if (dayIndex === undefined) return null;
  const date = new Date(monday);
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date;
}

function isLessonActiveOnDate(lesson: ApiLesson, date: Date) {
  const exactDate = parseBelarusDate(lesson.dateLesson);
  if (exactDate) return exactDate.getTime() === date.getTime();
  const startDate = parseBelarusDate(lesson.startLessonDate);
  const endDate = parseBelarusDate(lesson.endLessonDate);
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function isLessonPast(date: string, endTime: string, now = new Date()) {
  const end = Date.parse(`${date}T${endTime}:00+03:00`);
  return Number.isFinite(end) && end <= now.getTime();
}

export async function getSubjects(subgroup?: number | null): Promise<SubjectSummary[]> {
  const [response, weekResponse] = await Promise.all([
    fetch(`https://iis.bsuir.by/api/v1/schedule?studentGroup=${GROUP}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: SCHEDULE_CACHE_SECONDS },
      signal: AbortSignal.timeout(BSUIR_TIMEOUT_MS),
    }),
    fetch("https://iis.bsuir.by/api/v1/schedule/current-week", {
      headers: { Accept: "application/json" },
      next: { revalidate: WEEK_CACHE_SECONDS },
      signal: AbortSignal.timeout(BSUIR_TIMEOUT_MS),
    }),
  ]);
  if (!response.ok) throw new Error(`BSUIR schedule returned ${response.status}`);
  if (!weekResponse.ok) throw new Error(`BSUIR current week returned ${weekResponse.status}`);

  const payload = (await response.json()) as ApiSchedule;
  const currentWeek = Number(await weekResponse.json());
  if (!Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > 4) {
    throw new Error("BSUIR current week is invalid");
  }
  const currentMonday = getCurrentMonday();
  const weeksToShow = [
    { weekNumber: currentWeek, weekOffset: 0, monday: currentMonday },
  ];
  const grouped = new Map<string, SubjectSummary>();

  const dayEntries = [
    ...Object.entries(payload.schedules ?? {}),
    ...Object.entries(payload.nextSchedules ?? {}),
  ];
  for (const [day, lessons] of dayEntries) {
    for (const lesson of lessons) {
      if (!ALLOWED_TYPES.has(lesson.lessonTypeAbbrev)) continue;
      if (isExcludedSubject(lesson.subject, lesson.subjectFullName)) continue;
      if (subgroup && lesson.numSubgroup !== 0 && lesson.numSubgroup !== subgroup) continue;

      for (const week of weeksToShow) {
        if (lesson.weekNumber?.length && !lesson.weekNumber.includes(week.weekNumber)) continue;

        const lessonDate = getLessonDate(day, week.monday);
        if (!lessonDate || !isLessonActiveOnDate(lesson, lessonDate)) continue;
        const date = formatIsoDate(lessonDate);

        const key = `${lesson.subject}::${lesson.subjectFullName}`;
        const current = grouped.get(key) ?? {
          key,
          abbrev: lesson.subject,
          name: lesson.subjectFullName,
          lessonTypes: [],
          lessons: [],
        };
        if (!current.lessonTypes.includes(lesson.lessonTypeAbbrev)) {
          current.lessonTypes.push(lesson.lessonTypeAbbrev);
        }
        const lessonSummary = {
          day,
          type: lesson.lessonTypeAbbrev,
          subgroup: lesson.numSubgroup,
          time: `${lesson.startLessonTime}–${lesson.endLessonTime}`,
          room: lesson.auditories?.join(", ") || "аудитория не указана",
          weeks: lesson.weekNumber ?? [],
          date,
          isPast: isLessonPast(date, lesson.endLessonTime),
          weekNumber: week.weekNumber,
          weekOffset: week.weekOffset,
        };
        const duplicate = current.lessons.some(
          (item) =>
            item.date === lessonSummary.date &&
            item.type === lessonSummary.type &&
            item.subgroup === lessonSummary.subgroup &&
            item.time === lessonSummary.time &&
            item.room === lessonSummary.room,
        );
        if (!duplicate) current.lessons.push(lessonSummary);
        grouped.set(key, current);
      }
    }
  }

  return [...grouped.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "ru"),
  );
}
