import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export interface SkillItem {
  name: string;
  description: string;
  shortDescription: string;
  path: string;
  scope: 'user' | 'workspace';
}

export interface SkillsListEntry {
  cwd: string;
  skills: SkillItem[];
}

function extractDescription(skillMdPath: string): string {
  try {
    const content = readFileSync(skillMdPath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      return trimmed;
    }
  } catch {
    // ignore read failures
  }
  return '';
}

function listSkillsInDir(baseDir: string, scope: 'user' | 'workspace'): SkillItem[] {
  if (!existsSync(baseDir)) return [];

  const skills: SkillItem[] = [];
  const entries = readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(baseDir, entry.name);
    const skillMdPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const description = extractDescription(skillMdPath);
    skills.push({
      name: entry.name,
      description,
      shortDescription: description,
      path: skillDir,
      scope,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function listSkillsForCwd(cwd: string): SkillsListEntry {
  const normalizedCwd = resolve(cwd || process.cwd());
  const userSkillsDir = join(homedir(), '.claude', 'skills');
  const workspaceSkillsDir = join(normalizedCwd, '.claude', 'skills');

  const byName = new Map<string, SkillItem>();

  for (const skill of listSkillsInDir(userSkillsDir, 'user')) {
    byName.set(skill.name, skill);
  }

  for (const skill of listSkillsInDir(workspaceSkillsDir, 'workspace')) {
    // workspace overrides user skill with same name
    byName.set(skill.name, skill);
  }

  const merged = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    cwd: normalizedCwd,
    skills: merged,
  };
}

export function listSkillsForCwds(cwds: string[]): SkillsListEntry[] {
  const unique = [...new Set(cwds.map((cwd) => resolve(cwd || process.cwd())))];
  return unique.map((cwd) => listSkillsForCwd(cwd));
}

export function inferWorkspaceNameFromCwd(cwd: string): string {
  return basename(resolve(cwd));
}
