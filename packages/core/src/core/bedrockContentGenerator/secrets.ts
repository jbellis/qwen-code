/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BEDROCK_MODEL_ID = 'anthropic.claude-sonnet-4-6';
export const BEDROCK_API_KEY_ENV = 'AWS_BEARER_TOKEN_BEDROCK';
export const BEDROCK_DEFAULT_REGION = 'us-east-1';

const BEDROCK_SECRET_FILES = [
  'aws_bearer_token_bedrock',
  'bedrock_api_key',
] as const;

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

export function loadBedrockSecrets(): Record<string, string> {
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

    if (
      BEDROCK_SECRET_FILES.includes(
        entry.name as (typeof BEDROCK_SECRET_FILES)[number],
      ) &&
      !env[BEDROCK_API_KEY_ENV]
    ) {
      env[BEDROCK_API_KEY_ENV] = content.trim();
    }
  }

  return env;
}

export function loadBedrockBearerToken(): string | undefined {
  return (
    process.env[BEDROCK_API_KEY_ENV] ||
    loadBedrockSecrets()[BEDROCK_API_KEY_ENV]
  );
}

export function resolveBedrockRegion(): string {
  return (
    process.env['AWS_REGION'] ||
    process.env['AWS_DEFAULT_REGION'] ||
    process.env['BEDROCK_REGION'] ||
    BEDROCK_DEFAULT_REGION
  );
}
