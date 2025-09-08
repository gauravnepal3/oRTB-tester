// server.js
import express from "express";
import zlib from "zlib";

function makeApp() {
    const app = express(); // do NOT add app.use(express.json())

    app.post("/bid", (req, res) => {
    let aborted = false;
    req.on("aborted", () => { aborted = true; });

        // Drain body; just keep a small prefix for tmax sniffing
    let first = Buffer.alloc(0);
    req.on("data", (chunk) => {
        if (first.length < 8192) {
            first = Buffer.concat([first, chunk]).slice(0, 8192);
        }
    });

      req.on("end", () => {
          const s = first.toString("utf8");
          // cheap tmax sniff: ..."tmax":123...
          let tmax = 300;
          try {
          const m = /"tmax"\s*:\s*(\d+)/.exec(s);
              if (m) tmax = Math.max(1, parseInt(m[1], 10) || 300);
          } catch { } // fallback 300

          // 80/20 on-time/late split (configurable)
          const lateFrac = Number(process.env.LATE_FRACTION ?? 0.20);
          const headroomMs = Number(process.env.HEADROOM_MS ?? 3); // keep on-time < tmax
          const lateSpanMs = Number.isFinite(Number(process.env.LATE_SPAN_MS))
              ? Number(process.env.LATE_SPAN_MS)
              : Math.max(20, Math.floor(tmax * 0.5)); // how far beyond tmax

          const roll = Math.random();
          let delay;
          if (roll < lateFrac) {
              // late: strictly > tmax
              delay = tmax + 1 + Math.floor(Math.random() * lateSpanMs);
          } else {
              // on-time: [0 .. tmax - headroom]
              const maxOnTime = Math.max(0, tmax - headroomMs);
              delay = Math.floor(Math.random() * (maxOnTime + 1));
          }

        setTimeout(() => {
            if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;

          const payload = JSON.stringify({
              id: /"id"\s*:\s*"([^"]*)"/.exec(s)?.[1] ?? "",
              upstream: "node",
              ts: Date.now(),
              took_ms: delay,
              echo_tmax: tmax,
              blob: "x".repeat(Number(process.env.BLOB_BYTES ?? 2048))
        });

            const acceptEnc = String(req.headers["accept-encoding"] || "");
            if (acceptEnc.includes("gzip")) {
              const gz = zlib.gzipSync(Buffer.from(payload, "utf8"));
                res.status(200)
                    .set("Content-Type", "application/json")
                    .set("Content-Encoding", "gzip")
                    .send(gz);
        } else {
                res.status(200)
                    .set("Content-Type", "application/json")
                    .send(payload);
          }
      }, delay);
    });
  });

    return app;
}

// Multi-port: comma-separated env PORTS, e.g. "9100,9101,9102,9103,9104"
const ports = (process.env.PORTS || "9100,9101,9102,9103,9104")
    .split(",").map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);

// one Express app can listen on multiple ports
const app = makeApp();
ports.forEach(p =>
    app.listen(p, "0.0.0.0", () => console.log(`Stub bidder listening on :${p}`))
);