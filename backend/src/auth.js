import crypto from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET || "dns-backend-insecure-default";
const TOKEN_TTL = 7 * 24 * 3600; // 7 days

const b64u = (buf) => Buffer.from(buf).toString("base64url");

// ---------- JWT (HS256, hand-rolled to avoid extra dependency) ----------
export function signToken(payload) {
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL })
  );
  const sig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest();
  const actual = Buffer.from(sig, "base64url");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual))
    return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- Password (scrypt) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length &&
    crypto.timingSafeEqual(candidate, expected);
}

// ---------- Auth middleware ----------
import { userById } from "./db.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  const user = userById.get(payload.uid);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }
  req.user = user;
  next();
}
