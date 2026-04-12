import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const indexPath = path.join(root, "index.html");
const jsonPath = path.join(root, "profile-data.json");

const j = fs.readFileSync(jsonPath, "utf8").trim();
let html = fs.readFileSync(indexPath, "utf8");
const re = /<script type="application\/json" id="profile-embedded">[\s\S]*?<\/script>/m;
if (!re.test(html)) throw new Error("profile-embedded block not found");
html = html.replace(re, `<script type="application/json" id="profile-embedded">\n${j}\n  </script>`);
fs.writeFileSync(indexPath, html);
console.log("embedded ok");
