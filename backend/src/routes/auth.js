import { Router } from "express";
import { userByUsername, userById, updatePassword, updateProfile } from "../db.js";
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
    username: u.username,
    avatarUrl: u.avatar_url || undefined,
  };
}

// POST /auth/login
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required" });
  const user = userByUsername.get(username.trim());
  if (!user || !verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: "Invalid username or password" });
  res.json({ token: signToken({ uid: user.id, username: user.username }) });
});

// GET /auth/me
router.get("/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

// PUT /auth/profile — change name + username
router.put("/profile", requireAuth, (req, res) => {
  const { name, username } = req.body || {};
  if (!name?.trim() || !username?.trim())
    return res.status(400).json({ error: "Name and username are required" });
  const normalized = username.trim();
  const existing = userByUsername.get(normalized);
  if (existing && existing.id !== req.user.id)
    return res.status(400).json({ error: "Username is already in use" });
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
