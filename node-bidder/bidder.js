// bidder.js
import express from "express";
import zlib from "zlib";

function makeApp() {
    const app = express(); // no global body parser

    app.post("/bid", (req, res) => {
    let aborted = false;
    req.on("aborted", () => { aborted = true; });

        // Drain body; keep small prefix to sniff tmax/id
    let first = Buffer.alloc(0);
    req.on("data", (chunk) => {
        if (first.length < 8192) {
            first = Buffer.concat([first, chunk]).slice(0, 8192);
        }
    });

      req.on("end", () => {
          const s = first.toString("utf8");

          // Extract tmax (fallback 300)
          let tmax = 300;
          try {
              const m = /"tmax"\s*:\s*(\d+)/.exec(s);
              if (m) tmax = Math.max(1, parseInt(m[1], 10) || 300);
        } catch { /* ignore */ }

          // Tuning knobs
          const minDelay = Number(process.env.MIN_DELAY_MS ?? 120);
          const headroomMs = Number(process.env.HEADROOM_MS ?? 3);
          const lateFrac = Number(process.env.LATE_FRACTION ?? 0.20);
          const lateSpanMs = Number.isFinite(+process.env.LATE_SPAN_MS)
              ? +process.env.LATE_SPAN_MS
            : Math.max(20, Math.floor(tmax * 0.5));

          // Decide delay (≥ minDelay, ~20% late)
          const maxOnTime = Math.max(0, tmax - headroomMs);
          const canOnTimeAboveMin = maxOnTime > minDelay;

          let delay;
          const roll = Math.random();
          if (roll < lateFrac || !canOnTimeAboveMin) {
              const base = Math.max(minDelay, tmax + 1);
            delay = base + Math.floor(Math.random() * Math.max(1, lateSpanMs));
        } else {
            const span = Math.max(0, maxOnTime - minDelay);
            delay = minDelay + Math.floor(Math.random() * (span + 1));
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

            // gzip disabled by default to avoid CPU churn; enable with GZIP=1
            const doGzip = process.env.GZIP === "1" &&
                String(req.headers["accept-encoding"] || "").includes("gzip");

            if (doGzip) {
                // async gzip (non-blocking)
                zlib.gzip(Buffer.from(payload, "utf8"), (err, gz) => {
                    if (err) {
                        res.status(200).set("Content-Type", "application/json").send(payload);
                    } else {
              res.status(200)
                  .set("Content-Type", "application/json")
                  .set("Content-Encoding", "gzip")
                  .send(gz);
                  }
              });
        } else {
              res.status(200).set("Content-Type", "application/json").send(payload);
          }
      }, delay);
    });
  });

    return app;
}

// Multi-port: comma-separated env PORTS, e.g. "9100,9101,9102,9103,9104"
const ports = (process.env.PORTS || "9100,9101,9102,9103,9104")
    .split(",").map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);

const app = makeApp();
ports.forEach(p => app.listen(p, "0.0.0.0", () => console.log(`Stub bidder listening on :${p}`)));