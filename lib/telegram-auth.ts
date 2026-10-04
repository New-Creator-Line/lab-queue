import "server-only";

import { and, eq, gt, ilike } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { getRosterMemberByUsername, type RosterMember } from "@/lib/roster";

const SESSION_COOKIE = "labq_session";

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export type TelegramProfile = {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
};

export class TelegramAccessError extends Error {
  constructor(
    public readonly code: "NOT_IN_ROSTER" | "ACCOUNT_ALREADY_BOUND",
  ) {
    super(code);
  }
}

export function randomToken(byteLength = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function verifyTelegramLogin(url: URL): Promise<TelegramProfile | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const receivedHash = url.searchParams.get("hash");
  const authDate = Number(url.searchParams.get("auth_date"));
  if (!botToken || !receivedHash || !Number.isFinite(authDate)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - authDate) > 15 * 60) return null;

  const dataCheckString = [...url.searchParams.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.digest("SHA-256", encoder.encode(botToken));
  const key = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(dataCheckString)),
  );

  if (!constantTimeEqual(bytesToHex(signature), receivedHash.toLowerCase())) return null;

  const id = url.searchParams.get("id");
  const firstName = url.searchParams.get("first_name")?.trim();
  if (!id || !firstName) return null;

  return {
    id,
    firstName,
    lastName: url.searchParams.get("last_name")?.trim() || null,
    username: url.searchParams.get("username")?.trim() || null,
    photoUrl: url.searchParams.get("photo_url") || null,
  };
}

export function isConfiguredAdmin(telegramId: string) {
  return (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(telegramId);
}

export function isSuperAdminIdentity(
  telegramId: string,
  username: string | null | undefined,
) {
  return Boolean(
    getRosterMemberByUsername(username)?.isAdmin || isConfiguredAdmin(telegramId),
  );
}

export async function authorizeTelegramProfile(profile: TelegramProfile): Promise<RosterMember> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, profile.id))
    .limit(1);

  // Once a roster username has logged in, its Telegram ID remains the identity
  // anchor even if the person later changes their public @username.
  const member =
    getRosterMemberByUsername(existing?.username) ??
    getRosterMemberByUsername(profile.username);
  if (!member) throw new TelegramAccessError("NOT_IN_ROSTER");

  const [claimedAccount] = await db
    .select({ telegramId: users.telegramId })
    .from(users)
    .where(ilike(users.username, member.username))
    .limit(1);
  if (claimedAccount && claimedAccount.telegramId !== profile.id) {
    throw new TelegramAccessError("ACCOUNT_ALREADY_BOUND");
  }

  return member;
}

export async function upsertTelegramUser(profile: TelegramProfile) {
  const db = getDb();
  const member = await authorizeTelegramProfile(profile);
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, profile.id))
    .limit(1);
  const { firstName, lastName } = officialName(member);
  const isAdmin =
    existing?.isAdmin || isSuperAdminIdentity(profile.id, member.username);

  if (existing) {
    await db
      .update(users)
      .set({
        username: member.username,
        firstName,
        lastName,
        displayName: member.displayName,
        photoUrl: profile.photoUrl ?? existing.photoUrl,
        subgroup: member.subgroup,
        rotationOrder: member.rotationOrder,
        isAdmin,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.telegramId, profile.id));
  } else {
    await db.insert(users).values({
      telegramId: profile.id,
      username: member.username,
      firstName,
      lastName,
      displayName: member.displayName,
      photoUrl: profile.photoUrl,
      subgroup: member.subgroup,
      rotationOrder: member.rotationOrder,
      isAdmin,
    });
  }

  return member;
}

function officialName(member: RosterMember) {
  const [lastName, firstName] = member.displayName.split(" ");
  return { firstName, lastName };
}

export async function createSession(telegramId: string) {
  const token = randomToken();
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  const db = getDb();
  await db.insert(sessions).values({ token, telegramId, expiresAt });
  return { token, expiresAt };
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.telegramId, users.telegramId))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!row?.user) return null;
  const member = getRosterMemberByUsername(row.user.username);
  if (!member) return null;

  const { firstName, lastName } = officialName(member);
  const isSuperAdmin = isSuperAdminIdentity(row.user.telegramId, member.username);
  const isAdmin = row.user.isAdmin || isSuperAdmin;
  const needsSync =
    row.user.displayName !== member.displayName ||
    row.user.firstName !== firstName ||
    row.user.lastName !== lastName ||
    row.user.subgroup !== member.subgroup ||
    row.user.rotationOrder !== member.rotationOrder ||
    row.user.isAdmin !== isAdmin;

  if (!needsSync) return { ...row.user, isSuperAdmin };

  await db
    .update(users)
    .set({
      firstName,
      lastName,
      displayName: member.displayName,
      subgroup: member.subgroup,
      rotationOrder: member.rotationOrder,
      isAdmin,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.telegramId, row.user.telegramId));

  return {
    ...row.user,
    firstName,
    lastName,
    displayName: member.displayName,
    subgroup: member.subgroup,
    rotationOrder: member.rotationOrder,
    isAdmin,
    isSuperAdmin,
  };
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export function getTelegramBotUsername() {
  return process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? null;
}
