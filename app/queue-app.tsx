"use client";

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DoorOpen,
  ExternalLink,
  GraduationCap,
  LoaderCircle,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

type User = {
  telegramId: string;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  subgroup: number | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
};

type Subject = {
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

type Queue = {
  id: number;
  subjectKey: string;
  subjectName: string;
  subjectAbbrev: string;
  subgroup: number;
  currentCycle: number;
  lessonEndsAt: string | null;
  isLocked: boolean;
  waiting: Array<{
    id: number;
    telegramId: string;
    displayName: string;
    username: string | null;
    position: number;
  }>;
  completed: string[];
};

type DashboardData = {
  user: User;
  subjects: Subject[];
  queues: Queue[];
  scheduleAvailable: boolean;
};

type AdminUser = {
  telegramId: string;
  displayName: string;
  username: string | null;
  subgroup: number | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isProtected: boolean;
  isCurrentUser: boolean;
};

function formatScheduleDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Minsk",
  }).format(new Date(`${date}T12:00:00+03:00`));
}

function formatQueueDate(value: string | null) {
  if (!value) return "Дата занятия не указана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата занятия не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Minsk",
  }).format(date);
}

function queueDateKey(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Minsk",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatQueueDay(value: string | null) {
  if (!value) return "Без даты";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без даты";
  const day = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    timeZone: "Europe/Minsk",
  }).format(date);
  return day.slice(0, 1).toUpperCase() + day.slice(1);
}

function formatQueueDayDate(value: string | null) {
  if (!value) return "Дата занятия не указана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата занятия не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Minsk",
  }).format(date);
}

function queueCountLabel(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} очередей`;
  if (last === 1) return `${count} очередь`;
  if (last >= 2 && last <= 4) return `${count} очереди`;
  return `${count} очередей`;
}

function lessonEndTimestamp(date: string, lessonTime: string) {
  const endTime = lessonTime.split("–").at(-1)?.trim();
  if (!endTime) return Number.NaN;
  return Date.parse(`${date}T${endTime}:00+03:00`);
}

function subscribeTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    media.removeEventListener("change", callback);
  };
}

function getThemeSnapshot(): "light" | "dark" {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getThemeServerSnapshot(): "light" | "dark" {
  return "light";
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    localStorage.setItem("theme", next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    window.dispatchEvent(new Event("storage"));
  }

  return (
    <button
      className="icon-button"
      type="button"
      onClick={toggle}
      title={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"}
      aria-label="Переключить тему"
    >
      {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

function TelegramLogin({ botUsername }: { botUsername: string | null }) {
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const authWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!botUsername) return;
    let active = true;
    let pollTimer: number | undefined;
    const controller = new AbortController();

    async function beginLogin() {
      setBotUrl(null);
      setError("");
      try {
        const response = await fetch("/api/auth/telegram/challenge", {
          method: "POST",
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          token?: string;
          botUrl?: string;
          error?: string;
        };
        if (!response.ok || !data.token || !data.botUrl) {
          throw new Error(data.error ?? "Не удалось создать ссылку входа");
        }
        if (!active) return;
        setBotUrl(data.botUrl);

        const token = data.token;
        pollTimer = window.setInterval(async () => {
          if (!active) return;
          try {
            const checkResp = await fetch(`/api/auth/telegram/challenge?token=${encodeURIComponent(token)}`);
            if (!checkResp.ok) return;
            const checkData = (await checkResp.json()) as { authenticated?: boolean };
            if (checkData.authenticated) {
              window.clearInterval(pollTimer);
              try {
                if (authWindowRef.current && !authWindowRef.current.closed) {
                  authWindowRef.current.close();
                }
              } catch {
                // игнорируем ошибку закрытия окна, если браузер блокирует или окно уже закрыто
              }
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.href = `/api/auth/telegram/challenge?token=${encodeURIComponent(token)}&finish=1`;
            }
          } catch {
            // сетевые задержки поллинга
          }
        }, 1500);
      } catch (loginError) {
        if (!active || (loginError instanceof DOMException && loginError.name === "AbortError")) return;
        setError(loginError instanceof Error ? loginError.message : "Не удалось начать вход");
      }
    }

    void beginLogin();
    return () => {
      active = false;
      if (pollTimer) window.clearInterval(pollTimer);
      controller.abort();
    };
  }, [attempt, botUsername]);

  if (!botUsername) {
    return (
      <div className="setup-note">
        Для запуска входа владелец должен подключить Telegram-бота.
      </div>
    );
  }
  return (
    <div className="telegram-actions">
      {botUrl ? (
        <a
          className="bot-start-link"
          href={botUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault();
            try {
              const popup = window.open(botUrl, "_blank");
              authWindowRef.current = popup;
            } catch {
              window.location.href = botUrl;
            }
          }}
        >
          Открыть Telegram <ExternalLink size={16} />
        </a>
      ) : !error ? (
        <span className="telegram-loading"><LoaderCircle className="spin" size={18} /> Готовим вход…</span>
      ) : null}
      {botUrl && !error && <span className="telegram-status">Нажми Start, затем «Вернуться в очередь»</span>}
      {error && (
        <>
          <span className="telegram-error">{error}</span>
          <button className="telegram-retry" type="button" onClick={() => setAttempt((value) => value + 1)}>
            Попробовать ещё раз
          </button>
        </>
      )}
    </div>
  );
}

function LoginScreen({ botUsername, isPreview }: { botUsername: string | null; isPreview?: boolean }) {
  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <div className="brand">
          <span className="brand-mark"><GraduationCap size={22} /></span>
          <span>Очередь 420604</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {isPreview && <span className="nav-pill" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>🟡 Предпросмотр (Preview)</span>}
          <span className="nav-pill">БГУИР · ФИТУ</span>
          <ThemeToggle />
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <h1>Сдавай работы<br /><em>в свою очередь.</em></h1>
          <div className="login-card">
            <div>
              <strong>Войти через Telegram</strong>
              <span>Открой бота и нажми Start — без отдельного сообщения</span>
            </div>
            <TelegramLogin botUsername={botUsername} />
          </div>
        </div>

        <div className="hero-visual" aria-label="Пример электронной очереди">
          <div className="visual-glow" />
          <div className="queue-preview">
            <div className="preview-head">
              <div><span className="tiny-label">Лабораторная</span><h2>Базы данных</h2></div>
              <span className="live-badge"><i /> запись открыта</span>
            </div>
            <div className="preview-meta"><Clock3 size={16} /> Понедельник, 17:05 <span>·</span> 604–5 к.</div>
            <div className="preview-list">
              {["Алексей П.", "Мария К.", "Вы"].map((name, index) => (
                <div className={`preview-person ${index === 2 ? "is-you" : ""}`} key={name}>
                  <span className="number">{index + 1}</span>
                  <span className="avatar">{name.slice(0, 1)}</span>
                  <strong>{name}</strong>
                  {index === 0 && <span className="next-label">следующий</span>}
                  {index === 2 && <span className="you-label">ваше место</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function RosterProfileError() {
  return (
    <main className="onboarding-shell">
      <div className="onboarding-card">
        <span className="brand-mark large"><ShieldCheck size={26} /></span>
        <span className="step-label">Проверка профиля</span>
        <h1>Не удалось определить подгруппу</h1>
        <p>Выйди и зайди снова через Telegram. Имя и подгруппа будут назначены автоматически по списку группы.</p>
        <form action="/api/auth/logout" method="post">
          <button className="primary-button" type="submit">Выйти и войти снова <LogOut size={18} /></button>
        </form>
      </div>
    </main>
  );
}

function Dashboard({ initialUser, isPreview }: { initialUser: User; isPreview?: boolean }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshAnimation, setRefreshAnimation] = useState(0);
  const [view, setView] = useState<"subjects" | "queues" | "admins">("subjects");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);

  const refreshAll = useCallback(async (quiet = false) => {
    if (!quiet) setError("");
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("DASHBOARD_LOAD_FAILED");
      setData((await response.json()) as DashboardData);
    } catch {
      setError("Не удалось обновить данные. Попробуйте ещё раз.");
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  const refreshQueues = useCallback(async (quiet = false) => {
    if (!quiet) {
      setError("");
      setRefreshing(true);
    }
    try {
      const response = await fetch("/api/queues", { cache: "no-store" });
      if (!response.ok) throw new Error("QUEUES_LOAD_FAILED");
      const result = (await response.json()) as { queues: Queue[] };
      setData((current) => current ? { ...current, queues: result.queues } : current);
    } catch {
      if (!quiet) setError("Не удалось обновить очереди. Попробуйте ещё раз.");
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  const loadAdminUsers = useCallback(async () => {
    setAdminUsersLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const result = (await response.json()) as { users?: AdminUser[]; error?: string };
      if (!response.ok || !result.users) {
        throw new Error(result.error ?? "Не удалось загрузить участников");
      }
      setAdminUsers(result.users);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить участников");
    } finally {
      setAdminUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refreshAll(), 0);
    const timer = window.setInterval(() => void refreshQueues(true), 15_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [refreshAll, refreshQueues]);

  function removeEntryOptimistically(queueId: number, entryId: number) {
    setData((current) => current ? {
      ...current,
      queues: current.queues.map((queue) => queue.id === queueId ? {
        ...queue,
        waiting: queue.waiting
          .filter((entry) => entry.id !== entryId)
          .map((entry, index) => ({ ...entry, position: index + 1 })),
      } : queue),
    } : current);
  }

  function moveEntryOptimistically(
    queueId: number,
    entryId: number,
    direction: "up" | "down",
  ) {
    setData((current) => current ? {
      ...current,
      queues: current.queues.map((queue) => {
        if (queue.id !== queueId) return queue;
        const waiting = [...queue.waiting];
        const index = waiting.findIndex((entry) => entry.id === entryId);
        const nextIndex = index + (direction === "up" ? -1 : 1);
        if (index < 0 || nextIndex < 0 || nextIndex >= waiting.length) return queue;
        [waiting[index], waiting[nextIndex]] = [waiting[nextIndex], waiting[index]];
        return {
          ...queue,
          waiting: waiting.map((entry, position) => ({
            ...entry,
            position: position + 1,
          })),
        };
      }),
    } : current);
  }

  function closeQueueOptimistically(queueId: number) {
    setData((current) => current ? {
      ...current,
      queues: current.queues.filter((queue) => queue.id !== queueId),
    } : current);
  }

  function handleManualRefresh() {
    setRefreshAnimation((value) => value + 1);
    void (view === "queues" ? refreshQueues() : refreshAll());
  }

  async function act(
    path: string,
    body: object,
    key: string,
    optimisticUpdate?: () => void,
  ) {
    setPendingKey(key);
    setError("");
    optimisticUpdate?.();
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Не удалось выполнить действие");
        await refreshQueues(true);
      } else if (optimisticUpdate) {
        void refreshQueues(true);
      } else {
        await refreshQueues(true);
      }
    } catch {
      setError("Не удалось выполнить действие. Попробуйте ещё раз.");
      await refreshQueues(true);
    } finally {
      setPendingKey(null);
    }
  }

  async function toggleAdmin(user: AdminUser) {
    const nextValue = !user.isAdmin;
    setPendingKey(`admin-${user.telegramId}`);
    setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId: user.telegramId, isAdmin: nextValue }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось изменить права");
      setAdminUsers((current) =>
        current.map((item) =>
          item.telegramId === user.telegramId ? { ...item, isAdmin: nextValue } : item,
        ),
      );
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Не удалось изменить права");
    } finally {
      setPendingKey(null);
    }
  }

  const myQueues = useMemo(
    () => data?.queues.filter((queue) => queue.waiting.some((entry) => entry.telegramId === initialUser.telegramId)) ?? [],
    [data, initialUser.telegramId],
  );

  const queueDays = useMemo(() => {
    const visibleQueues = (data?.queues ?? [])
      .filter((queue) => initialUser.isAdmin || myQueues.some((item) => item.id === queue.id))
      .sort((left, right) => {
        const leftTime = left.lessonEndsAt ? Date.parse(left.lessonEndsAt) : Number.MAX_SAFE_INTEGER;
        const rightTime = right.lessonEndsAt ? Date.parse(right.lessonEndsAt) : Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime || left.subjectName.localeCompare(right.subjectName, "ru");
      });
    const days = new Map<string, { date: string | null; queues: Queue[] }>();

    for (const queue of visibleQueues) {
      const key = queueDateKey(queue.lessonEndsAt) ?? "without-date";
      const day = days.get(key) ?? { date: queue.lessonEndsAt, queues: [] };
      day.queues.push(queue);
      days.set(key, day);
    }

    return [...days.entries()].map(([key, day]) => ({ key, ...day }));
  }, [data, initialUser.isAdmin, myQueues]);

  const scheduleWeeks = useMemo(() => {
    type ScheduleItem = { subject: Subject; lesson: Subject["lessons"][number] };
    const weeks = new Map<
      number,
      { weekNumber: number; days: Map<string, { day: string; date: string; items: ScheduleItem[] }> }
    >();
    const seen = new Set<string>();

    for (const subject of data?.subjects ?? []) {
      for (const lesson of subject.lessons) {
        const lessonKey = `${subject.key}::${lesson.date}::${lesson.time}::${lesson.type}::${lesson.room}`;
        if (seen.has(lessonKey)) continue;
        seen.add(lessonKey);
        const week = weeks.get(lesson.weekOffset) ?? {
          weekNumber: lesson.weekNumber,
          days: new Map(),
        };
        const dayKey = `${lesson.date}::${lesson.day}`;
        const day = week.days.get(dayKey) ?? {
          day: lesson.day,
          date: lesson.date,
          items: [],
        };
        day.items.push({ subject, lesson });
        week.days.set(dayKey, day);
        weeks.set(lesson.weekOffset, week);
      }
    }

    return [...weeks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([weekOffset, week]) => ({
        weekOffset,
        weekNumber: week.weekNumber,
        days: [...week.days.values()]
          .sort((left, right) => left.date.localeCompare(right.date))
          .map((day) => ({
            ...day,
            items: day.items.sort((left, right) => left.lesson.time.localeCompare(right.lesson.time)),
          })),
      }));
  }, [data]);

  const viewHeading =
    view === "subjects"
      ? { title: "Расписание по дням", description: "Только лабораторные и практические занятия." }
      : view === "queues"
        ? { title: "Твои очереди", description: "Порядок обновляется автоматически каждые 15 секунд." }
        : { title: "Администраторы", description: "Назначение прав среди участников, которые уже входили на сайт." };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-mark"><GraduationCap size={21} /></span><span>Очередь 420604</span></div>
        <div className="header-actions">
          {isPreview && <span className="group-badge" style={{ background: "#fef3c7", color: "#92400e", borderColor: "#fde68a" }}>🟡 Preview среда</span>}
          <span className="group-badge">Подгруппа {initialUser.subgroup}</span>
          <div className="profile-chip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {initialUser.photoUrl ? <img src={initialUser.photoUrl} alt="" /> : <span>{initialUser.displayName.slice(0, 1)}</span>}
            <div><strong>{initialUser.displayName}</strong>{initialUser.isAdmin && <small><ShieldCheck size={12} /> {initialUser.isSuperAdmin ? "суперадминистратор" : "администратор"}</small>}</div>
          </div>
          <ThemeToggle />
          <form action="/api/auth/logout" method="post"><button className="icon-button" title="Выйти"><LogOut size={18} /></button></form>
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar">
          <div className="semester-card"><span>Осенний семестр</span><strong>3 курс · ФИТУ</strong><small>Группа 420604</small></div>
          <nav>
            <button className={view === "subjects" ? "active" : ""} onClick={() => setView("subjects")}><BookOpen size={18} /> Расписание</button>
            <button className={view === "queues" ? "active" : ""} onClick={() => setView("queues")}><Users size={18} /> <span className="tab-desktop">Мои очереди</span><span className="tab-mobile">Очереди</span> {myQueues.length > 0 && <b>{myQueues.length}</b>}</button>
            {initialUser.isSuperAdmin && <button className={view === "admins" ? "active" : ""} onClick={() => { setView("admins"); void loadAdminUsers(); }}><ShieldCheck size={18} /> <span className="tab-desktop">Администраторы</span><span className="tab-mobile">Админы</span></button>}
          </nav>
          <a className="source-link" href="https://iis.bsuir.by/schedule/420604" target="_blank" rel="noreferrer">Расписание БГУИР <ExternalLink size={14} /></a>
        </aside>

        <section className="content">
          <div className="content-heading">
            <div><span className="eyebrow light">Подгруппа {initialUser.subgroup}</span><h1>{viewHeading.title}</h1><p>{viewHeading.description}</p></div>
            {view !== "admins" && (
              <button
                className="refresh-button"
                disabled={refreshing}
                onClick={handleManualRefresh}
                title="Обновить расписание и очереди"
                aria-label="Обновить"
              >
                <RefreshCw
                  className={refreshAnimation > 0 ? "refresh-turn" : undefined}
                  key={refreshAnimation}
                  size={17}
                />
                <span className="refresh-label">{refreshing ? "Обновляем…" : "Обновить"}</span>
              </button>
            )}
          </div>

          {error && <div className="error-banner"><X size={17} />{error}</div>}
          {!data && !error && <div className="loading-state"><LoaderCircle className="spin" /><span>Загружаем расписание и очереди…</span></div>}

          {data && view === "subjects" && (
            <>
              {!data.scheduleAvailable && <div className="warning-card">Расписание БГУИР сейчас недоступно. Уже созданные очереди продолжают работать.</div>}
              <div className="week-schedule">
                {scheduleWeeks.map(({ weekOffset, weekNumber, days }) => (
                  <section className="schedule-week-block" key={weekOffset}>
                    <div className="schedule-week-heading">
                      <div><span>{weekOffset === 0 ? "Текущая неделя" : "Следующая неделя"}</span><strong>Неделя №{weekNumber}</strong></div>
                      <small>{formatScheduleDate(days[0].date)} — {formatScheduleDate(days[days.length - 1].date)}</small>
                    </div>
                    {days.map(({ day, date, items }) => (
                      <section className="day-section" key={date}>
                        <div className="day-heading">
                          <div className="day-title"><h2>{day}</h2><span className="day-date">{formatScheduleDate(date)}</span></div>
                          <span className="day-count">{items.length} {items.length === 1 ? "занятие" : "занятия"}</span>
                        </div>
                        <div className="subject-grid">
                          {items.map(({ subject, lesson }, index) => {
                            const queueSubgroup = lesson.subgroup === 0 ? 0 : initialUser.subgroup;
                            const lessonEnd = lessonEndTimestamp(lesson.date, lesson.time);
                            const existingQueue = data.queues.find(
                              (item) =>
                                item.subjectKey === subject.key &&
                                item.subgroup === queueSubgroup &&
                                item.lessonEndsAt !== null &&
                                Date.parse(item.lessonEndsAt) === lessonEnd,
                            );
                            const queue = existingQueue?.isLocked && !lesson.isPast ? undefined : existingQueue;
                            const myEntry = queue?.waiting.find((entry) => entry.telegramId === initialUser.telegramId);
                            const key = `${subject.key}-${date}-${lesson.time}-${lesson.type}`;
                            return (
                              <article className={lesson.isPast ? "subject-card is-past" : "subject-card"} key={key} style={{ "--delay": `${index * 35}ms` } as React.CSSProperties}>
                                <div className="subject-top"><span className="subject-code">{subject.abbrev}</span><div className="type-tags"><span>{lesson.type}</span><span className="subgroup-tag">{lesson.subgroup === 0 ? "Вся группа" : `${lesson.subgroup}-я подгруппа`}</span></div></div>
                                <h2>{subject.name}</h2>
                                <div className="lesson-line"><Clock3 size={15} /><span>{lesson.time}</span><span className="dot">·</span><DoorOpen size={15} /><span>{lesson.room}</span></div>
                                <div className="card-bottom">
                                  {queue ? <span className="queue-count"><Users size={16} /> {queue.waiting.length} в очереди</span> : <span className="queue-empty">Очередь пока пуста</span>}
                                  {lesson.isPast ? (
                                    <button className="past-button" disabled>Занятие прошло</button>
                                  ) : myEntry ? (
                                    <button className="joined-button" onClick={() => setView("queues")}><CheckCircle2 size={18} /> Вы №{myEntry.position}<ChevronRight size={17} /></button>
                                  ) : (
                                    <button className="join-button" disabled={pendingKey === subject.key} onClick={() => act("/api/queue/join", { subjectKey: subject.key, lessonDate: lesson.date, lessonTime: lesson.time, lessonType: lesson.type }, subject.key)}>
                                      {pendingKey === subject.key ? <LoaderCircle className="spin" size={18} /> : <>Хочу сдавать <ArrowRight size={17} /></>}
                                    </button>
                                  )}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </section>
                ))}
              </div>
            </>
          )}

          {data && view === "queues" && (
            <div className="queue-days">
              {myQueues.length === 0 && !initialUser.isAdmin ? (
                <div className="empty-state"><span><Users size={30} /></span><h2>Ты пока не записан</h2><p>Выбери предмет и нажми «Хочу сдавать».</p><button onClick={() => setView("subjects")}>К предметам <ArrowRight size={17} /></button></div>
              ) : (
                queueDays.map((day) => (
                  <section className="day-section queue-day-section" key={day.key}>
                    <div className="day-heading">
                      <div className="day-title">
                        <h2>{formatQueueDay(day.date)}</h2>
                        <span className="day-date">{formatQueueDayDate(day.date)}</span>
                      </div>
                      <span className="day-count">{queueCountLabel(day.queues.length)}</span>
                    </div>
                    <div className="queue-stack">
                      {day.queues.map((queue) => {
                        const myEntry = queue.waiting.find((entry) => entry.telegramId === initialUser.telegramId);
                        return (
                          <article className={queue.isLocked ? "queue-card is-locked" : "queue-card"} key={queue.id}>
                            <div className="queue-card-head">
                              <div>
                                <span>{queue.subjectAbbrev} · {queue.subgroup === 0 ? "Вся группа" : `Подгруппа ${queue.subgroup}`}</span>
                                <h2>{queue.subjectName}</h2>
                                <p className="queue-lesson-date"><CalendarDays size={15} /> {formatQueueDate(queue.lessonEndsAt)}</p>
                              </div>
                              {queue.isLocked ? <span className="locked-badge">занятие завершено</span> : <span className="live-badge"><i /> запись открыта</span>}
                            </div>
                            {myEntry && <div className="position-banner"><span>Твоё место</span><strong>№ {myEntry.position}</strong><small>{myEntry.position === 1 ? "Ты следующий" : `Перед тобой ${myEntry.position - 1}`}</small></div>}
                            <div className="actual-list">
                              {queue.waiting.length === 0 && <p className="empty-list">В очереди никого нет</p>}
                              {queue.waiting.map((entry) => (
                                <div className={entry.telegramId === initialUser.telegramId ? "actual-person is-me" : "actual-person"} key={entry.id}>
                                  <span className="actual-number">{entry.position}</span>
                                  <span className="actual-avatar">{entry.displayName.slice(0, 1)}</span>
                                  <div><strong>{entry.displayName}</strong>{entry.telegramId === initialUser.telegramId && <small>это ты</small>}</div>
                                  {entry.position === 1 && <span className="next-label">следующий</span>}
                                  {initialUser.isAdmin && !queue.isLocked && (
                                    <div className="admin-entry-actions">
                                      <button title="Поднять на одну позицию" disabled={entry.position === 1 || pendingKey === `up-${entry.id}`} onClick={() => act("/api/admin/reorder", { entryId: entry.id, direction: "up" }, `up-${entry.id}`, () => moveEntryOptimistically(queue.id, entry.id, "up"))}><ArrowUp size={15} /></button>
                                      <button title="Опустить на одну позицию" disabled={entry.position === queue.waiting.length || pendingKey === `down-${entry.id}`} onClick={() => act("/api/admin/reorder", { entryId: entry.id, direction: "down" }, `down-${entry.id}`, () => moveEntryOptimistically(queue.id, entry.id, "down"))}><ArrowDown size={15} /></button>
                                      <button title="Сдавал" disabled={pendingKey === `served-${entry.id}`} onClick={() => act("/api/admin/entry", { entryId: entry.id, action: "served" }, `served-${entry.id}`, () => removeEntryOptimistically(queue.id, entry.id))}><Check size={16} /></button>
                                      <button title="Удалить из очереди" disabled={pendingKey === `skip-${entry.id}`} onClick={() => act("/api/admin/entry", { entryId: entry.id, action: "skipped" }, `skip-${entry.id}`, () => removeEntryOptimistically(queue.id, entry.id))}><X size={15} /></button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            <div className="queue-actions">
                              {queue.isLocked && <span className="queue-locked-note">Изменения недоступны после окончания занятия</span>}
                              {myEntry && !queue.isLocked && (
                                <>
                                  <button className="complete-button" disabled={pendingKey === `complete-${queue.id}`} onClick={() => act("/api/queue/complete", { queueId: queue.id }, `complete-${queue.id}`, () => removeEntryOptimistically(queue.id, myEntry.id))}>
                                    {pendingKey === `complete-${queue.id}` ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />} Я сдал
                                  </button>
                                  {myEntry.position < queue.waiting.length && (
                                    <button className="pass-button" disabled={pendingKey === `pass-${queue.id}`} onClick={() => act("/api/queue/pass", { queueId: queue.id }, `pass-${queue.id}`, () => moveEntryOptimistically(queue.id, myEntry.id, "down"))}>
                                      {pendingKey === `pass-${queue.id}` ? <LoaderCircle className="spin" size={16} /> : <ChevronRight size={16} />} Уступить место
                                    </button>
                                  )}
                                  <button className="leave-button" disabled={pendingKey === `leave-${queue.id}`} onClick={() => act("/api/queue/leave", { queueId: queue.id }, `leave-${queue.id}`, () => removeEntryOptimistically(queue.id, myEntry.id))}>Выйти из очереди</button>
                                </>
                              )}
                              {initialUser.isAdmin && !queue.isLocked && <button className="close-button" onClick={() => act("/api/admin/close", { queueId: queue.id }, `close-${queue.id}`, () => closeQueueOptimistically(queue.id))}>Закрыть очередь</button>}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>
          )}

          {data && view === "admins" && initialUser.isSuperAdmin && (
            <section className="admin-users-card">
              <div className="admin-users-intro">
                <div>
                  <strong>Управление правами</strong>
                  <p>Назначенные администраторы смогут редактировать очереди. Управлять правами может только суперадминистратор.</p>
                </div>
                <span>{adminUsers.filter((user) => user.isAdmin).length} админ.</span>
              </div>
              {adminUsersLoading ? (
                <div className="admin-users-loading"><LoaderCircle className="spin" size={20} /> Загружаем участников…</div>
              ) : (
                <div className="admin-users-list">
                  {adminUsers.map((user) => {
                    const disabled = user.isCurrentUser || user.isProtected || pendingKey === `admin-${user.telegramId}`;
                    return (
                      <div className="admin-user" key={user.telegramId}>
                        <span className="actual-avatar">{user.displayName.slice(0, 1)}</span>
                        <div className="admin-user-info">
                          <strong>{user.displayName}</strong>
                          <small>@{user.username ?? "без username"} · подгруппа {user.subgroup ?? "—"}</small>
                        </div>
                        {user.isAdmin && <span className="admin-status"><ShieldCheck size={14} /> {user.isSuperAdmin ? "суперадмин" : "администратор"}</span>}
                        <button
                          className={user.isAdmin ? "admin-toggle remove" : "admin-toggle"}
                          disabled={disabled}
                          title={user.isCurrentUser ? "Нельзя изменить собственные права" : user.isProtected ? "Основной администратор закреплён в настройках" : undefined}
                          onClick={() => void toggleAdmin(user)}
                        >
                          {pendingKey === `admin-${user.telegramId}` ? <LoaderCircle className="spin" size={16} /> : user.isAdmin ? "Снять права" : "Назначить"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="admin-users-note">В списке отображаются участники, которые хотя бы один раз вошли на сайт через Telegram.</p>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

export function QueueApp({
  botUsername,
  initialUser,
  isPreview,
}: {
  botUsername: string | null;
  initialUser: User | null;
  isPreview?: boolean;
}) {
  if (!initialUser) return <LoginScreen botUsername={botUsername} isPreview={isPreview} />;
  if (!initialUser.subgroup) return <RosterProfileError />;
  return <Dashboard initialUser={initialUser} isPreview={isPreview} />;
}
