import type { Env, JwtPayload } from "./types";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function hashPassword(password: string, salt?: string): Promise<string> {
  const s =
    salt ||
    b64url(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(s),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256
  );
  return `pbkdf2$100000$${s}$${b64url(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const salt = parts[2]!;
  const next = await hashPassword(password, salt);
  return next === stored;
}

export async function signJwt(
  payload: Omit<JwtPayload, "exp">,
  secret: string,
  ttlSec = 60 * 60 * 24 * 30
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const body: JwtPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(body)));
  const data = `${h}.${p}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${b64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, fromB64url(s!), enc.encode(data));
  if (!ok) return null;
  try {
    const payload = JSON.parse(dec.decode(fromB64url(p!))) as JwtPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

export function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of buf) out += alphabet[b % alphabet.length];
  return out;
}

export async function registerUser(
  env: Env,
  username: string,
  password: string,
  nickname: string
): Promise<{ ok: true; token: string; user: { id: string; username: string; nickname: string } } | { ok: false; error: string }> {
  const u = username.trim();
  const n = nickname.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
    return { ok: false, error: "用户名需 3–20 位字母数字下划线" };
  }
  if (password.length < 4 || password.length > 64) {
    return { ok: false, error: "密码长度 4–64" };
  }
  if (!n || n.length > 20) {
    return { ok: false, error: "昵称 1–20 字" };
  }

  const id = newId();
  const password_hash = await hashPassword(password);
  try {
    await env.DB.prepare(
      "INSERT INTO play_users (id, username, password_hash, nickname) VALUES (?, ?, ?, ?)"
    )
      .bind(id, u, password_hash, n)
      .run();
  } catch (e: unknown) {
    const msg = String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return { ok: false, error: "用户名已存在" };
    }
    return { ok: false, error: "注册失败" };
  }

  const token = await signJwt({ sub: id, username: u, nickname: n }, env.JWT_SECRET);
  await maybeMirrorUser(env, id, u, n);
  return { ok: true, token, user: { id, username: u, nickname: n } };
}

export async function loginUser(
  env: Env,
  username: string,
  password: string
): Promise<{ ok: true; token: string; user: { id: string; username: string; nickname: string } } | { ok: false; error: string }> {
  const row = await env.DB.prepare(
    "SELECT id, username, password_hash, nickname FROM play_users WHERE username = ? COLLATE NOCASE"
  )
    .bind(username.trim())
    .first<{ id: string; username: string; password_hash: string; nickname: string }>();

  if (!row) return { ok: false, error: "用户名或密码错误" };
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return { ok: false, error: "用户名或密码错误" };

  const token = await signJwt(
    { sub: row.id, username: row.username, nickname: row.nickname },
    env.JWT_SECRET
  );
  return {
    ok: true,
    token,
    user: { id: row.id, username: row.username, nickname: row.nickname },
  };
}

export async function updateNickname(
  env: Env,
  userId: string,
  nickname: string
): Promise<{ ok: true; nickname: string } | { ok: false; error: string }> {
  const n = nickname.trim();
  if (!n || n.length > 20) return { ok: false, error: "昵称 1–20 字" };
  await env.DB.prepare("UPDATE play_users SET nickname = ? WHERE id = ?").bind(n, userId).run();
  return { ok: true, nickname: n };
}

async function maybeMirrorUser(env: Env, id: string, username: string, nickname: string) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/play_users`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id, username, nickname }),
    });
  } catch {
    /* optional */
  }
}

export async function saveSession(
  env: Env,
  row: {
    id: string;
    room_code: string;
    host_user_id: string;
    config_json: string;
    started_at: string;
    ended_at: string;
    duration_hours: number;
    settlement_json: string;
  }
) {
  await env.DB.prepare(
    `INSERT INTO play_sessions (id, room_code, host_user_id, config_json, started_at, ended_at, duration_hours, settlement_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.room_code,
      row.host_user_id,
      row.config_json,
      row.started_at,
      row.ended_at,
      row.duration_hours,
      row.settlement_json
    )
    .run();

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/play_sessions`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: row.id,
          room_code: row.room_code,
          host_user_id: row.host_user_id,
          config: JSON.parse(row.config_json),
          started_at: row.started_at,
          ended_at: row.ended_at,
          duration_hours: row.duration_hours,
          settlement: JSON.parse(row.settlement_json),
        }),
      });
    } catch {
      /* optional */
    }
  }
}
