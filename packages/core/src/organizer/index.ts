import {
  mkdir,
  rename,
  copyFile,
  writeFile,
  readFile,
  access,
  rm,
} from "fs/promises";
import { constants } from "fs";
import path from "path";

export type OrganizationMode = "reference" | "copy" | "move";

export type OrganizeInput = {
  fileId: string;
  sourcePath: string;
  extension: string;
  title?: string;
  authors?: string[];
  publishedYear?: number;
  isbn13?: string;
};

export type OrganizePlanEntry = {
  fileId: string;
  sourcePath: string;
  targetPath: string;
  action: "copy" | "move" | "skip";
};

export type OrganizePlan = {
  mode: OrganizationMode;
  libraryRoot: string;
  template: string;
  entries: OrganizePlanEntry[];
};

export async function planOrganization(
  inputs: OrganizeInput[],
  options: {
    mode: OrganizationMode;
    libraryRoot: string;
    template?: string;
  }
): Promise<OrganizePlan> {
  const template = options.template ??
    "{Author}/{Title} ({Year}) [{ISBN13}].{ext}";
  const entries: OrganizePlanEntry[] = [];

  for (const input of inputs) {
    if (options.mode === "reference") {
      entries.push({
        fileId: input.fileId,
        sourcePath: input.sourcePath,
        targetPath: input.sourcePath,
        action: "skip",
      });
      continue;
    }

    const relativePath = renderTemplate(template, input);
    const targetPath = await resolveCollision(
      path.join(options.libraryRoot, relativePath)
    );

    entries.push({
      fileId: input.fileId,
      sourcePath: input.sourcePath,
      targetPath,
      action: options.mode === "copy" ? "copy" : "move",
    });
  }

  return {
    mode: options.mode,
    libraryRoot: options.libraryRoot,
    template,
    entries,
  };
}

export async function applyOrganization(plan: OrganizePlan) {
  const logEntries: Array<{
    action: "copy" | "move";
    from: string;
    to: string;
    timestamp: number;
  }> = [];

  for (const entry of plan.entries) {
    if (entry.action === "skip") continue;
    await mkdir(path.dirname(entry.targetPath), { recursive: true });
    if (entry.action === "copy") {
      await copyFile(entry.sourcePath, entry.targetPath);
    } else {
      await rename(entry.sourcePath, entry.targetPath);
    }
    logEntries.push({
      action: entry.action,
      from: entry.sourcePath,
      to: entry.targetPath,
      timestamp: Date.now(),
    });
  }

  const logPath = await writeLog(plan.libraryRoot, logEntries);
  return { logPath };
}

export async function rollbackOrganization(logPath: string) {
  const raw = await readFile(logPath, "utf8");
  const entries = JSON.parse(raw) as Array<{
    action: "copy" | "move";
    from: string;
    to: string;
  }>;

  for (const entry of entries.reverse()) {
    if (entry.action === "copy") {
      await rm(entry.to, { force: true }).catch(() => undefined);
    } else {
      await rename(entry.to, entry.from).catch(() => undefined);
    }
  }
}

function renderTemplate(template: string, input: OrganizeInput) {
  const author = sanitize(input.authors?.[0] ?? "Unknown Author");
  const title = sanitize(input.title ?? "Untitled");
  const year = input.publishedYear ? String(input.publishedYear) : "Unknown";
  const isbn13 = input.isbn13 ?? "Unknown";
  const ext = input.extension.replace(".", "");

  return template
    .replaceAll("{Author}", author)
    .replaceAll("{Title}", title)
    .replaceAll("{Year}", year)
    .replaceAll("{ISBN13}", isbn13)
    .replaceAll("{ext}", ext);
}

function sanitize(value: string) {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveCollision(targetPath: string) {
  if (!(await pathExists(targetPath))) return targetPath;
  const { dir, name, ext } = path.parse(targetPath);
  let index = 1;
  while (true) {
    const nextPath = path.join(dir, `${name} [${index}]${ext}`);
    if (!(await pathExists(nextPath))) return nextPath;
    index += 1;
  }
}

async function pathExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeLog(
  libraryRoot: string,
  entries: Array<{ action: string; from: string; to: string; timestamp: number }>
) {
  const logDir = path.join(libraryRoot, ".folio");
  await mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `organizer-log-${Date.now()}.json`);
  await writeFile(logPath, JSON.stringify(entries, null, 2), "utf8");
  return logPath;
}
