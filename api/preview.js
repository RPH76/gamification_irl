// Aperçu d'un lien produit pour le shop : trouve l'image de la page (og:image, twitter:image, JSON-LD…)
// et la renvoie en data URL ; le site la réduit puis la garde avec l'item.
// GET /api/preview?url=https://…   (en-tête X-Sync-Code obligatoire)   → { title, image }
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");

const MAX_PAGE = 1.5 * 1024 * 1024;  // les balises utiles sont dans le <head> : on lit au plus 1,5 Mo
const MAX_IMAGE = 2.5 * 1024 * 1024;
const TIMEOUT = 8000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/; // pas de SVG

function sameCode(given, expected) {
  const a = Buffer.from(String(given || "").trim().toUpperCase());
  const b = Buffer.from(String(expected || "").trim().toUpperCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function oops(message) {
  const e = new Error(message);
  e.forUser = true;
  return e;
}

// Refuse les adresses internes (le serveur ne doit pas servir de passerelle vers un réseau privé).
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return isPrivate(x.slice(7));
  return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
}

async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw oops("Ce lien n'est pas valide."); }
  if (!/^https?:$/.test(u.protocol)) throw oops("Le lien doit commencer par http:// ou https://.");
  if (process.env.PREVIEW_ALLOW_PRIVATE !== "1") {
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw oops("Ce site est introuvable.");
    if (addrs.some((a) => isPrivate(a.address))) throw oops("Ce lien n'est pas accessible.");
  }
  return u;
}

// Suit au plus 4 redirections, en revérifiant l'adresse à chaque étape.
async function get(raw, accept) {
  let url = raw;
  for (let hop = 0; hop < 5; hop++) {
    const u = await checkUrl(url);
    const r = await fetch(u, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const next = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && next) {
      url = new URL(next, u).href;
      continue;
    }
    if (!r.ok) throw oops(`Le site a répondu « ${r.status} ». Essaie le lien direct de l'image.`);
    return { res: r, url: u.href };
  }
  throw oops("Ce lien redirige trop de fois.");
}

// Lit la réponse jusqu'à `max` octets : au-delà, on coupe (page) ou on refuse (image).
async function readCapped(res, max, truncate) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      if (truncate) break;
      throw oops("Cette image est trop lourde (2,5 Mo au plus).");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrs(tag) {
  const o = {};
  tag.replace(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (m, k, v, a, b, c) => {
    o[k.toLowerCase()] = decode(a ?? b ?? c ?? "");
    return m;
  });
  return o;
}

// Cherche « image » dans le JSON-LD de la page (fiche produit), y compris dans @graph.
function ldImage(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = ldImage(n); if (f) return f; }
    return null;
  }
  if (node.image) {
    const im = Array.isArray(node.image) ? node.image[0] : node.image;
    if (typeof im === "string") return im;
    if (im && typeof im.url === "string") return im.url;
  }
  for (const k of ["@graph", "mainEntity", "itemListElement"]) {
    if (node[k]) { const f = ldImage(node[k]); if (f) return f; }
  }
  return null;
}

function findImage(html) {
  const metas = (html.match(/<meta\b[^>]*>/gi) || []).map(attrs);
  const meta = (...names) => {
    for (const n of names) {
      const m = metas.find((x) => (x.property || x.name || x.itemprop || "").toLowerCase() === n && x.content);
      if (m) return m.content;
    }
    return "";
  };
  let image = meta("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image");
  if (!image) {
    const link = (html.match(/<link\b[^>]*>/gi) || []).map(attrs).find((x) => /(^|\s)image_src(\s|$)/i.test(x.rel || "") && x.href);
    if (link) image = link.href;
  }
  if (!image) {
    for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try { image = ldImage(JSON.parse(m[1])) || ""; } catch { image = ""; }
      if (image) break;
    }
  }
  const title = meta("og:title", "twitter:title") || ((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "");
  return { image, title: decode(title).replace(/\s+/g, " ").trim() };
}

async function toDataUrl(res, type) {
  if (!IMAGE_TYPES.test(type)) {
    throw oops(type === "image/svg+xml" ? "Les images SVG ne sont pas acceptées." : "Ce lien ne mène pas à une image.");
  }
  const buf = await readCapped(res, MAX_IMAGE, false);
  return `data:${type};base64,${buf.toString("base64")}`;
}

const typeOf = (res) => (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.SYNC_CODE) return res.status(503).json({ error: "Synchronisation non configurée." });
  if (!sameCode(req.headers["x-sync-code"], process.env.SYNC_CODE)) {
    return res.status(401).json({ error: "Code de synchronisation incorrect." });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    const { res: page, url } = await get(String(req.query.url || ""), "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5");
    const type = typeOf(page);
    if (type.startsWith("image/")) {
      // Lien direct vers une image.
      return res.status(200).json({ title: "", image: await toDataUrl(page, type) });
    }
    const html = (await readCapped(page, MAX_PAGE, true)).toString("utf8");
    const found = findImage(html);
    if (!found.image) return res.status(422).json({ error: "Aucune image trouvée sur cette page. Essaie le lien direct de l'image." });
    const img = await get(new URL(found.image, url).href, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8");
    return res.status(200).json({ title: found.title.slice(0, 80), image: await toDataUrl(img.res, typeOf(img.res)) });
  } catch (e) {
    const message = e.forUser ? e.message
      : e.name === "TimeoutError" ? "Le site met trop de temps à répondre."
      : "Ce lien est injoignable.";
    return res.status(422).json({ error: message });
  }
};
