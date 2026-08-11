import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_FILE || path.join(__dirname, "..", "data.sqlite");

export const db = new DatabaseSync(dbFile);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT,
    verified INTEGER DEFAULT 0,
    avatar_url TEXT,
    github_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS zones (
    _id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_verification',
    ownership_code TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    records TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ---------- templates ----------
export const templatesAll = db.prepare(
  "SELECT * FROM templates ORDER BY created_at DESC"
);
export const templateById = db.prepare("SELECT * FROM templates WHERE id = ?");
export const insertTemplate = db.prepare(
  "INSERT INTO templates (id, name, description, records) VALUES (?, ?, ?, ?)"
);
export const updateTemplate = db.prepare(
  "UPDATE templates SET name = ?, description = ?, records = ? WHERE id = ?"
);
export const deleteTemplateRow = db.prepare(
  "DELETE FROM templates WHERE id = ?"
);

// ---------- settings (dynamic config, overrides env) ----------
const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const setSettingStmt = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
export const getSetting = (key) => getSettingStmt.get(key)?.value;
export const setSetting = (key, value) => setSettingStmt.run(key, value);

// ---------- users ----------
export const userByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
export const userById = db.prepare("SELECT * FROM users WHERE id = ?");
export const firstUser = db.prepare("SELECT * FROM users ORDER BY id LIMIT 1");
export const insertUser = db.prepare(
  "INSERT INTO users (email, name, password_hash, verified) VALUES (?, ?, ?, ?)"
);
export const updatePassword = db.prepare(
  "UPDATE users SET password_hash = ? WHERE id = ?"
);
export const updateProfile = db.prepare(
  "UPDATE users SET name = ?, email = ? WHERE id = ?"
);

// ---------- seed admin (single account) ----------
const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users");
export function seedAdmin(hashPasswordFn) {
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = process.env.ADMIN_NAME || "Admin";
  if (!email || !password) {
    console.warn("[seed] ADMIN_EMAIL/ADMIN_PASSWORD not configured — no account created");
    return;
  }
  // Only create when no account exists — admin changing email won't trigger re-seed
  if (countUsers.get().n === 0) {
    insertUser.run(email, name, hashPasswordFn(password), 1);
    console.log(`[seed] Created admin account: ${email}`);
  }
}

// ---------- zones ----------
export const zonesByUser = db.prepare(
  "SELECT * FROM zones WHERE user_id = ? ORDER BY created_at DESC"
);
export const zoneById = db.prepare("SELECT * FROM zones WHERE _id = ?");
export const zoneByName = db.prepare("SELECT * FROM zones WHERE name = ?");
export const insertZone = db.prepare(
  "INSERT INTO zones (_id, user_id, name, status) VALUES (?, ?, ?, ?)"
);
export const updateZoneStatus = db.prepare(
  "UPDATE zones SET status = ?, updated_at = datetime('now') WHERE _id = ?"
);
export const deleteZoneRow = db.prepare("DELETE FROM zones WHERE _id = ?");
export const countZones = db.prepare("SELECT COUNT(*) AS n FROM zones");
