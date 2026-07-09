import { loginUser, registerUser, updateNickname, verifyJwt } from "./auth";
import type { Env } from "./types";

export { PokerRoom } from "./poker-room";

function corsHeaders(env: Env, request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "*";
  const allow = env.CORS_ORIGIN || "*";
  const allowed =
    allow === "*"
      ? origin || "*"
      : allow.split(",").map((s) => s.trim()).includes(origin)
        ? origin
        : allow.split(",")[0]!;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(env: Env, request: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env, request),
    },
  });
}

async function requireUser(env: Env, request: Request) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  return payload;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/" || path === "/health") {
        return json(env, request, { ok: true, service: "poker-play", ts: Date.now() });
      }

      if (path === "/api/register" && request.method === "POST") {
        const body = (await request.json()) as {
          username?: string;
          password?: string;
          nickname?: string;
        };
        const result = await registerUser(
          env,
          body.username || "",
          body.password || "",
          body.nickname || ""
        );
        return json(env, request, result, result.ok ? 200 : 400);
      }

      if (path === "/api/login" && request.method === "POST") {
        const body = (await request.json()) as { username?: string; password?: string };
        const result = await loginUser(env, body.username || "", body.password || "");
        return json(env, request, result, result.ok ? 200 : 401);
      }

      if (path === "/api/me" && request.method === "GET") {
        const user = await requireUser(env, request);
        if (!user) return json(env, request, { ok: false, error: "未登录" }, 401);
        return json(env, request, {
          ok: true,
          user: { id: user.sub, username: user.username, nickname: user.nickname },
        });
      }

      if (path === "/api/nickname" && request.method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json(env, request, { ok: false, error: "未登录" }, 401);
        const body = (await request.json()) as { nickname?: string };
        const result = await updateNickname(env, user.sub, body.nickname || "");
        if (!result.ok) return json(env, request, result, 400);
        // issue new token with updated nickname
        const { signJwt } = await import("./auth");
        const token = await signJwt(
          { sub: user.sub, username: user.username, nickname: result.nickname },
          env.JWT_SECRET
        );
        return json(env, request, {
          ok: true,
          nickname: result.nickname,
          token,
          user: { id: user.sub, username: user.username, nickname: result.nickname },
        });
      }

      if (path === "/api/rooms" && request.method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json(env, request, { ok: false, error: "未登录" }, 401);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const code = String(body.code || randomRoomCode()).toUpperCase();
        const id = env.POKER_ROOM.idFromName(code);
        const stub = env.POKER_ROOM.get(id);
        const resp = await stub.fetch(
          new Request("https://room/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: request.headers.get("Authorization") || "",
            },
            body: JSON.stringify({ ...body, code }),
          })
        );
        const data = await resp.json();
        return json(env, request, data, resp.status);
      }

      if (path.startsWith("/api/rooms/") && request.method === "GET") {
        const code = path.split("/").pop()!.toUpperCase();
        const id = env.POKER_ROOM.idFromName(code);
        const stub = env.POKER_ROOM.get(id);
        const resp = await stub.fetch(new Request("https://room/info"));
        const data = await resp.json();
        return json(env, request, data, resp.status);
      }

      // WebSocket upgrade to room
      if (path.startsWith("/ws/") && request.headers.get("Upgrade") === "websocket") {
        const code = path.split("/").pop()!.toUpperCase();
        const id = env.POKER_ROOM.idFromName(code);
        const stub = env.POKER_ROOM.get(id);
        return stub.fetch(request);
      }

      if (path === "/api/history" && request.method === "GET") {
        const user = await requireUser(env, request);
        if (!user) return json(env, request, { ok: false, error: "未登录" }, 401);
        const { results } = await env.DB.prepare(
          `SELECT id, room_code, started_at, ended_at, duration_hours, settlement_json
           FROM play_sessions
           WHERE settlement_json LIKE ?
           ORDER BY ended_at DESC
           LIMIT 20`
        )
          .bind(`%${user.sub}%`)
          .all();
        return json(env, request, { ok: true, sessions: results || [] });
      }

      return json(env, request, { ok: false, error: "not found" }, 404);
    } catch (e) {
      return json(
        env,
        request,
        { ok: false, error: e instanceof Error ? e.message : "server error" },
        500
      );
    }
  },
};

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of buf) out += alphabet[b % alphabet.length];
  return out;
}
