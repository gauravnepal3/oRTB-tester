// server.js  (multi-port)
import express from "express";
import zlib from "zlib";

function makeApp() {
    const app = express();
    app.post("/bid", (req, res) => {
    let aborted = false;
    req.on("aborted", () => { aborted = true; });

    let first = Buffer.alloc(0);
    req.on("data", (chunk) => {
        if (first.length < 4096) first = Buffer.concat([first, chunk]).slice(0, 4096);
    });

      req.on("end", () => {
          const s = first.toString("utf8");
          const m = /"tmax"\s*:\s*(\d+)/.exec(s);
          const tmax = m ? parseInt(m[1], 10) : 300;
          const delay = Math.floor(Math.random() * Math.max(1, tmax));

        setTimeout(() => {
            if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;

          const payload = JSON.stringify({
              id: /"id"\s*:\s*"([^"]*)"/.exec(s)?.[1] ?? "",
            upstream: "node",
            ts: Date.now(),
            took_ms: delay,
            echo_tmax: tmax,
            blob: "x".repeat(2048)
        });

          if ((req.headers["accept-encoding"] || "").includes("gzip")) {
              const gz = zlib.gzipSync(Buffer.from(payload, "utf8"));
            res.status(200).set("Content-Type", "application/json").set("Content-Encoding", "gzip").send(gz);
        } else {
              res.status(200).set("Content-Type", "application/json").send(payload);
          }
      }, delay);
    });
  });
    return app;
}

// Read comma-separated list of ports
const ports = (process.env.PORTS || "9100,9101,9102,9103,9104")
    .split(",").map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);

const app = makeApp();
ports.forEach(p => app.listen(p, "0.0.0.0", () => console.log(`Stub bidder listening on :${p}`)));