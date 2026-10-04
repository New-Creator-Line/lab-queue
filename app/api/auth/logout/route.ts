import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { sessions } from "@/db/schema";
import { clearSessionCookie } from "@/lib/telegram-auth";

export async function POST() {
  const token = (await cookies()).get("labq_session")?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.token, token));
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": clearSessionCookie() },
  });
}
