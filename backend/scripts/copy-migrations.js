// bootstrap.sql lives under src/db but tsc only compiles .ts files, so it
// needs an explicit copy into dist after build.
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "src", "db", "bootstrap.sql");
const destDir = path.join(__dirname, "..", "dist", "db");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, "bootstrap.sql"));
