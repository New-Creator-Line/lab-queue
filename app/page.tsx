import { getCurrentUser, getTelegramBotUsername } from "@/lib/telegram-auth";
import { QueueApp } from "./queue-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const botUsername = getTelegramBotUsername();

  const isPreview = process.env.VERCEL_ENV === "preview";

  return (
    <QueueApp
      botUsername={botUsername}
      isPreview={isPreview}
      initialUser={
        user
          ? {
              telegramId: user.telegramId,
              displayName: user.displayName,
              username: user.username,
              photoUrl: user.photoUrl,
              subgroup: user.subgroup,
              isAdmin: user.isAdmin,
              isSuperAdmin: user.isSuperAdmin,
            }
          : null
      }
    />
  );
}
