type QueueLesson = {
  lessonEndsAt: string | null;
};

export function getQueueLessonEnd(queue: QueueLesson) {
  if (!queue.lessonEndsAt) return null;
  const timestamp = Date.parse(queue.lessonEndsAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function createLessonEnd(date: string, lessonTime: string) {
  const endTime = lessonTime.split("–").at(-1)?.trim();
  if (!endTime || !/^\d{2}:\d{2}$/.test(endTime)) return null;
  const timestamp = Date.parse(`${date}T${endTime}:00+03:00`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function isQueueLocked(queue: QueueLesson, now = new Date()) {
  const lessonEnd = getQueueLessonEnd(queue);
  return lessonEnd !== null && lessonEnd <= now.getTime();
}
