import { describe, expect, it } from "vitest";
import { parseSemesterSubjects } from "@/lib/schedule";

describe("Schedule parsing for all semester subjects", () => {
  it("extracts and deduplicates subjects across all weeks and subgroups, merging lesson types", () => {
    const mockPayload = {
      schedules: {
        Понедельник: [
          {
            subject: "АМД",
            subjectFullName: "Анализ многомерных данных",
            lessonTypeAbbrev: "ЛР",
            numSubgroup: 1,
            startLessonTime: "09:00",
            endLessonTime: "10:20",
            weekNumber: [1, 3],
          },
          {
            subject: "АМД",
            subjectFullName: "Анализ многомерных данных",
            lessonTypeAbbrev: "ЛР",
            numSubgroup: 2,
            startLessonTime: "10:35",
            endLessonTime: "11:55",
            weekNumber: [1, 3],
          },
          {
            subject: "ОМО",
            subjectFullName: "Основы машинного обучения",
            lessonTypeAbbrev: "ЛР",
            numSubgroup: 1,
            startLessonTime: "12:25",
            endLessonTime: "13:45",
            weekNumber: [2, 4],
          },
        ],
        Вторник: [
          {
            subject: "СУБД",
            subjectFullName: "Системы управления базами данных",
            lessonTypeAbbrev: "ЛР",
            numSubgroup: 1,
            startLessonTime: "09:00",
            endLessonTime: "10:20",
            weekNumber: [1, 3],
          },
          {
            subject: "СУБД",
            subjectFullName: "Системы управления базами данных",
            lessonTypeAbbrev: "ПЗ",
            numSubgroup: 0,
            startLessonTime: "10:35",
            endLessonTime: "11:55",
            weekNumber: [2, 4],
          },
        ],
      },
      nextSchedules: {
        Среда: [
          {
            subject: "ТиМАУ",
            subjectFullName: "Теория и методы автоматического управления",
            lessonTypeAbbrev: "ПЗ",
            numSubgroup: 0,
            startLessonTime: "14:00",
            endLessonTime: "15:20",
            weekNumber: [2, 4],
          },
        ],
      },
    };

    const subjects = parseSemesterSubjects(mockPayload);

    expect(subjects).toHaveLength(4);

    // Sorted alphabetically by name (Russian locale):
    // 1. АМД — Анализ многомерных данных
    // 2. ОМО — Основы машинного обучения
    // 3. СУБД — Системы управления базами данных
    // 4. ТиМАУ — Теория и методы автоматического управления
    expect(subjects[0].abbrev).toBe("АМД");
    expect(subjects[0].lessonTypes).toEqual(["ЛР"]);
    expect(subjects[0].isWholeGroup).toBe(false);

    expect(subjects[1].abbrev).toBe("ОМО");
    expect(subjects[1].lessonTypes).toEqual(["ЛР"]);
    expect(subjects[1].isWholeGroup).toBe(false);

    expect(subjects[2].abbrev).toBe("СУБД");
    expect(subjects[2].lessonTypes).toEqual(["ЛР", "ПЗ"]);
    expect(subjects[2].isWholeGroup).toBe(false);

    expect(subjects[3].abbrev).toBe("ТиМАУ");
    expect(subjects[3].lessonTypes).toEqual(["ПЗ"]);
    expect(subjects[3].isWholeGroup).toBe(true);
  });

  it("filters out lectures (ЛК) and excluded subjects (физкультура, инф. час)", () => {
    const mockPayload = {
      schedules: {
        Понедельник: [
          {
            subject: "ВысшМат",
            subjectFullName: "Высшая математика",
            lessonTypeAbbrev: "ЛК", // Lecture - must be excluded
            numSubgroup: 0,
            startLessonTime: "09:00",
            endLessonTime: "10:20",
          },
          {
            subject: "ФизК",
            subjectFullName: "Физическая культура",
            lessonTypeAbbrev: "ПЗ", // Excluded subject
            numSubgroup: 0,
            startLessonTime: "10:35",
            endLessonTime: "11:55",
          },
          {
            subject: "Инф. час",
            subjectFullName: "Информационный час",
            lessonTypeAbbrev: "ПЗ", // Excluded subject
            numSubgroup: 0,
            startLessonTime: "12:00",
            endLessonTime: "13:00",
          },
          {
            subject: "СтатМОД",
            subjectFullName: "Статистические методы обработки данных",
            lessonTypeAbbrev: "ЛР",
            numSubgroup: 1,
            startLessonTime: "13:30",
            endLessonTime: "14:50",
          },
        ],
      },
    };

    const subjects = parseSemesterSubjects(mockPayload);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].abbrev).toBe("СтатМОД");
    expect(subjects[0].name).toBe("Статистические методы обработки данных");
  });
});
