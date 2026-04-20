// 지갑스튜디오 라이선스 검증 Worker
// POST /verify { key } → { valid: bool, note?, expires? }
// POST /admin/issue { adminPassword, note } → { key }
// POST /admin/revoke { adminPassword, key } → { ok }
// POST /admin/list { adminPassword } → { keys: [...] }

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

function genKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Ambiguous 0/1/I/O 제외
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `ZIGAB-${block()}-${block()}-${block()}-${block()}`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "POST" && path === "/verify") {
        const { key } = await request.json();
        if (!key) return json({ valid: false, reason: "키 없음" }, 400);
        const raw = await env.LICENSES.get(key.toUpperCase());
        if (!raw) return json({ valid: false, reason: "유효하지 않은 키" });
        const data = JSON.parse(raw);
        if (data.revoked) return json({ valid: false, reason: "사용 중지된 키" });
        // last_used 업데이트 (non-blocking)
        data.last_used = new Date().toISOString();
        data.use_count = (data.use_count || 0) + 1;
        await env.LICENSES.put(key.toUpperCase(), JSON.stringify(data));
        return json({ valid: true, note: data.note || "", issued: data.issued });
      }

      if (request.method === "POST" && path === "/admin/issue") {
        const { adminPassword, note, buyer, phone } = await request.json();
        if (adminPassword !== env.ADMIN_PASSWORD) return json({ error: "unauthorized" }, 401);
        const key = genKey();
        const data = {
          issued: new Date().toISOString(),
          note: note || "",
          buyer: buyer || "",
          phone: phone || "",
          revoked: false,
          use_count: 0,
        };
        await env.LICENSES.put(key, JSON.stringify(data));
        return json({ ok: true, key });
      }

      if (request.method === "POST" && path === "/admin/revoke") {
        const { adminPassword, key } = await request.json();
        if (adminPassword !== env.ADMIN_PASSWORD) return json({ error: "unauthorized" }, 401);
        const raw = await env.LICENSES.get(key.toUpperCase());
        if (!raw) return json({ ok: false, reason: "없는 키" });
        const data = JSON.parse(raw);
        data.revoked = true;
        data.revoked_at = new Date().toISOString();
        await env.LICENSES.put(key.toUpperCase(), JSON.stringify(data));
        return json({ ok: true });
      }

      if (request.method === "POST" && path === "/admin/list") {
        const { adminPassword } = await request.json();
        if (adminPassword !== env.ADMIN_PASSWORD) return json({ error: "unauthorized" }, 401);
        const keys = [];
        const list = await env.LICENSES.list({ limit: 1000 });
        for (const k of list.keys) {
          const raw = await env.LICENSES.get(k.name);
          if (raw) keys.push({ key: k.name, ...JSON.parse(raw) });
        }
        return json({ keys });
      }

      if (path === "/health") return json({ ok: true, service: "jigab-license" });
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
