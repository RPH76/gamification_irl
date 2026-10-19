// Synchronisation €RAPH entre appareils : une seule version de référence, gardée dans Redis (Upstash).
// GET  /api/state            → { state, rev }
// PUT  /api/state {state, baseRev} → { rev } si personne n'a écrit entre-temps, sinon 409 { state, rev }
// Chaque requête doit porter le code de synchronisation dans l'en-tête X-Sync-Code.
const crypto = require("crypto");

const KEY = "eraph:state";
const REV = "eraph:rev";
const BACKUPS = "eraph:backups"; // les 60 dernières versions, en cas de pépin

// Écriture atomique : refusée si la version du serveur a changé depuis celle que l'appareil connaît.
const COMPARE_AND_SET = `
local cur = redis.call('GET', KEYS[2]) or '0'
if cur ~= ARGV[1] then return {0, cur} end
redis.call('SET', KEYS[1], ARGV[2])
local rev = redis.call('INCR', KEYS[2])
redis.call('LPUSH', KEYS[3], ARGV[2])
redis.call('LTRIM', KEYS[3], 0, 59)
return {1, tostring(rev)}
`;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(cfg, command) {
  const r = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `Redis ${r.status}`);
  return data.result;
}

function sameCode(given, expected) {
  const a = Buffer.from(String(given || "").trim().toUpperCase());
  const b = Buffer.from(String(expected || "").trim().toUpperCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cfg = redisConfig();
  if (!cfg || !process.env.SYNC_CODE) {
    return res.status(503).json({ error: "Synchronisation non configurée." });
  }
  if (!sameCode(req.headers["x-sync-code"], process.env.SYNC_CODE)) {
    return res.status(401).json({ error: "Code de synchronisation incorrect." });
  }
  try {
    if (req.method === "GET") {
      const [state, rev] = await Promise.all([redis(cfg, ["GET", KEY]), redis(cfg, ["GET", REV])]);
      return res.status(200).json({ state: state ? JSON.parse(state) : null, rev: Number(rev || 0) });
    }
    if (req.method === "PUT") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (!body.state || typeof body.state !== "object") {
        return res.status(400).json({ error: "Données manquantes." });
      }
      const [ok, rev] = await redis(cfg, [
        "EVAL", COMPARE_AND_SET, "3", KEY, REV, BACKUPS,
        String(Number(body.baseRev) || 0), JSON.stringify(body.state),
      ]);
      if (Number(ok) === 1) return res.status(200).json({ rev: Number(rev) });
      const state = await redis(cfg, ["GET", KEY]);
      return res.status(409).json({ state: state ? JSON.parse(state) : null, rev: Number(rev) });
    }
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Méthode non autorisée." });
  } catch (e) {
    return res.status(502).json({ error: "Serveur de données injoignable." });
  }
};
