/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const QWEN_CODER_MODEL_ID = 'qwen/qwen3-coder';
export const QWEN_CODER_BASE_URL = 'https://openrouter.ai/api/v1';
export const QWEN_API_KEY_ENV = 'OPENROUTER_API_KEY';
export const QWEN_OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';

const OPENROUTER_SECRET_FILE = 'openrouter_api_key';

function getSecretsPath(): string | undefined {
  const home = os.homedir();
  return home ? path.join(home, '.secrets') : undefined;
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function parseSecretContent(content: string): Record<string, string> {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)]),
      );
    }
  } catch {
    // Fall through to shell-style KEY=value parsing.
  }

  return parseEnvFile(content);
}

export function loadQwenSecrets(): Record<string, string> {
  const secretsPath = getSecretsPath();
  if (!secretsPath || !fs.existsSync(secretsPath)) return {};

  const stat = fs.statSync(secretsPath);
  if (!stat.isDirectory()) {
    return parseSecretContent(fs.readFileSync(secretsPath, 'utf8'));
  }

  const env: Record<string, string> = {};
  for (const entry of fs.readdirSync(secretsPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const fullPath = path.join(secretsPath, entry.name);
    const content = fs.readFileSync(fullPath, 'utf8');
    Object.assign(env, parseSecretContent(content));

    if (entry.name === OPENROUTER_SECRET_FILE && !env[QWEN_API_KEY_ENV]) {
      env[QWEN_API_KEY_ENV] = content.trim();
    }
  }

  return env;
}

export function loadQwenApiKey(): string | undefined {
  const secrets = loadQwenSecrets();
  return (
    process.env[QWEN_API_KEY_ENV] ||
    process.env[QWEN_OPENAI_API_KEY_ENV] ||
    secrets[QWEN_API_KEY_ENV] ||
    secrets[QWEN_OPENAI_API_KEY_ENV]
  );
}
