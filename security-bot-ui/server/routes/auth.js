"use strict";
const express = require("express");
const bcrypt  = require("bcryptjs");
const db      = require("../db");
const router  = express.Router();

router.get("/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Oturum açılmamış" });
  res.json({ id: req.session.user.id, username: req.session.user.username, role: req.session.user.role });
});

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli" });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ ok: true, username: user.username, role: user.role });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.post("/change-password", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Oturum açılmamış" });
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error: "Mevcut ve yeni şifre gerekli" });

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.user.id);
  if (!bcrypt.compareSync(current, user.password))
    return res.status(403).json({ error: "Mevcut şifre hatalı" });

  const hash = bcrypt.hashSync(next, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, user.id);
  res.json({ ok: true });
});

module.exports = router;
