"use strict";
const express = require("express");
const bus     = require("../emitter");
const { requireSession } = require("../middleware");
const router  = express.Router();

// SSE — canlı event akışı (oturum gerektirir)
router.get("/", requireSession, (req, res) => {
  res.setHeader("Content-Type",        "text/event-stream");
  res.setHeader("Cache-Control",       "no-cache");
  res.setHeader("Connection",          "keep-alive");
  res.setHeader("X-Accel-Buffering",   "no");  // Nginx proxy desteği
  res.flushHeaders();

  const write = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const onSignal    = d => write("signal",    d);
  const onReport    = d => write("report",    d);
  const onHeartbeat = d => write("heartbeat", d);

  bus.on("signal",    onSignal);
  bus.on("report",    onReport);
  bus.on("heartbeat", onHeartbeat);

  // Keep-alive ping her 25s
  const ka = setInterval(() => res.write(":ping\n\n"), 25_000);

  req.on("close", () => {
    clearInterval(ka);
    bus.off("signal",    onSignal);
    bus.off("report",    onReport);
    bus.off("heartbeat", onHeartbeat);
  });
});

module.exports = router;
