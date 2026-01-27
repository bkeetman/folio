import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const version = process.env.GITHUB_REF_NAME?.replace(/^v/, "");
if (!version) {
  throw new Error("GITHUB_REF_NAME not set");
}

const releaseTag = `v${version}`;
const notes = `Release ${version}`;
const pubDate = new Date().toISOString();

const dmgDir = "apps/desktop/src-tauri/target/release/bundle/dmg";
const dmgFiles = readdirSync(dmgDir).filter((file) => file.endsWith(".dmg"));
if (!dmgFiles.length) {
  throw new Error("No dmg artifacts found");
}

const dmgName = dmgFiles[0];
const sigPath = join(dmgDir, `${dmgName}.sig`);
const signature = readFileSync(sigPath, "utf8").trim();

const url = `https://github.com/bkeetman/folio/releases/download/${releaseTag}/${dmgName}`;

const manifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    "darwin-aarch64": {
      url,
      signature,
    },
  },
};

writeFileSync("docs/latest.json", JSON.stringify(manifest, null, 2));
