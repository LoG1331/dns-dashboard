import { Router } from "express";
import { userByEmail, userById, updatePassword, updateProfile } from "../db.js";
import {
  signToken,
  hashPassword,
  verifyPassword,
  requireAuth,
} from "../auth.js";

const router = Router();

const PASSWORD_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const PASSWORD_MSG =
  "Password must be at least 8 characters with uppercase, lowercase, number and special character";

function publicUser(u) {
  return {
    name: u.name,
    email: u.email,
    username: u.name,
    avatarUrl: u.avatar_url || undefined,
  };
}

// POST /auth/login
router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });
  const user = userByEmail.get(email.toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: signToken({ uid: user.id, email: user.email }) });
});

// GET /auth/me
router.get("/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

// PUT /auth/profile — change name + email
router.put("/profile", requireAuth, (req, res) => {
  const { name, email } = req.body || {};
  if (!name?.trim() || !email?.trim())
    return res.status(400).json({ error: "Name and email are required" });
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized))
    return res.status(400).json({ error: "Invalid email address" });
  const existing = userByEmail.get(normalized);
  if (existing && existing.id !== req.user.id)
    return res.status(400).json({ error: "Email is already in use" });
  updateProfile.run(name.trim(), normalized, req.user.id);
  res.json(publicUser(userById.get(req.user.id)));
});

// POST /auth/change-password
router.post("/change-password", requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword)
    return res.status(400).json({ error: "Missing required fields" });
  if (!verifyPassword(oldPassword, req.user.password_hash))
    return res.status(400).json({ error: "Current password is incorrect" });
  if (!PASSWORD_RE.test(newPassword))
    return res.status(400).json({ error: PASSWORD_MSG });
  updatePassword.run(hashPassword(newPassword), req.user.id);
  res.json({ message: "Password updated successfully" });
});

export default router;
