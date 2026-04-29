// 지갑스튜디오 라이선스 검증 Worker
// POST /verify { key } → { valid: bool, note?, issued? }
// POST /admin/issue { adminPassword, note, buyer, phone } → { key }
// POST /admin/revoke { adminPassword, key } → { ok }
// POST /admin/unrevoke { adminPassword, key } → { ok }
// POST /admin/list { adminPassword } → { keys: [...] }
// POST /admin/restore { adminPassword, keys } → { ok, restored, skipped }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function readJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

function normalizeKey(key = "") {
  const raw = String(key).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  if (raw.startsWith("ZIGAB") && raw.length === 21) {
    return `ZIGAB-${raw.slice(5, 9)}-${raw.slice(9, 13)}-${raw.slice(13, 17)}-${raw.slice(17, 21)}`;
  }
  if (String(key).trim().toUpperCase().startsWith("ZIGAB-")) return String(key).trim().toUpperCase();
  return raw;
}

function genKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Ambiguous 0/1/I/O 제외
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `ZIGAB-${block()}-${block()}-${block()}-${block()}`;
}

function requireAdmin(env, adminPassword) {
  return !!env.ADMIN_PASSWORD && adminPassword === env.ADMIN_PASSWORD;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    try {
      if (path === "/health") {
        return json({ ok: true, service: "jigab-license", kv: !!env.LICENSES, time: new Date().toISOString() });
      }

      if (request.method === "POST" && path === "/verify") {
        const { key } = await readJson(request);
        const normalized = normalizeKey(key);
        if (!normalized) return json({ valid: false, reason: "키 없음" }, 400);
        const raw = await env.LICENSES.get(normalized);
        if (!raw) return json({ valid: false, reason: "유효하지 않은 키" });
        const data = JSON.parse(raw);
        if (data.revoked) return json({ valid: false, reason: "사용 중지된 키" });
        data.last_used = new Date().toISOString();
        data.use_count = (data.use_count || 0) + 1;
        await env.LICENSES.put(normalized, JSON.stringify(data));
        return json({ valid: true, key: normalized, note: data.note || "", buyer: data.buyer || "", issued: data.issued });
      }

      if (request.method === "POST" && path === "/admin/issue") {
        const { adminPassword, note, buyer, phone } = await readJson(request);
        if (!requireAdmin(env, adminPassword)) return json({ error: "unauthorized" }, 401);
        let key = genKey();
        while (await env.LICENSES.get(key)) key = genKey();
        const data = {
          issued: new Date().toISOString(),
          note: note || "",
          buyer: buyer || "",
          phone: phone || "",
          revoked: false,
          use_count: 0,
        };
        await env.LICENSES.put(key, JSON.stringify(data));
        return json({ ok: true, key, ...data });
      }

      if (request.method === "POST" && (path === "/admin/revoke" || path === "/admin/unrevoke")) {
        const { adminPassword, key } = await readJson(request);
        if (!requireAdmin(env, adminPassword)) return json({ error: "unauthorized" }, 401);
        const normalized = normalizeKey(key);
        const raw = await env.LICENSES.get(normalized);
        if (!raw) return json({ ok: false, reason: "없는 키" }, 404);
        const data = JSON.parse(raw);
        const revoke = path === "/admin/revoke";
        data.revoked = revoke;
        if (revoke) data.revoked_at = new Date().toISOString();
        else data.restored_at = new Date().toISOString();
        await env.LICENSES.put(normalized, JSON.stringify(data));
        return json({ ok: true, key: normalized, revoked: data.revoked });
      }

      if (request.method === "POST" && path === "/admin/list") {
        const { adminPassword } = await readJson(request);
        if (!requireAdmin(env, adminPassword)) return json({ error: "unauthorized" }, 401);
        const keys = [];
        let cursor;
        do {
          const list = await env.LICENSES.list({ limit: 1000, cursor });
          cursor = list.cursor;
          for (const k of list.keys) {
            const raw = await env.LICENSES.get(k.name);
            if (raw) keys.push({ key: k.name, ...JSON.parse(raw) });
          }
          if (list.list_complete) break;
        } while (cursor);
        return json({ keys });
      }

      if (request.method === "POST" && path === "/admin/restore") {
        const { adminPassword, keys } = await readJson(request);
        if (!requireAdmin(env, adminPassword)) return json({ error: "unauthorized" }, 401);
        if (!Array.isArray(keys)) return json({ error: "keys array required" }, 400);
        let restored = 0, skipped = 0;
        for (const entry of keys) {
          const normalized = normalizeKey(entry.key);
          if (!normalized) continue;
          const existing = await env.LICENSES.get(normalized);
          if (existing) { skipped++; continue; }
          const { key, ...data } = entry;
          await env.LICENSES.put(normalized, JSON.stringify({ ...data, restored_at: new Date().toISOString() }));
          restored++;
        }
        return json({ ok: true, restored, skipped });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e.message || String(e) }, 500);
    }
  },
};
