#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_MODEL_ID = 'qwen/qwen3-coder';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const QWEN_TOKEN_ENV = 'OPENROUTER_API_KEY';
const OPENAI_TOKEN_ENV = 'OPENAI_API_KEY';
const SECRETS_PATH = path.join(os.homedir(), '.secrets');
const SECRET_FILE_ENV_KEYS = new Map([['openrouter_api_key', QWEN_TOKEN_ENV]]);

function parseEnvFile(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }

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

function parseSecretContent(content) {
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

function loadSecrets() {
  if (!fs.existsSync(SECRETS_PATH)) {
    return {};
  }

  const stat = fs.statSync(SECRETS_PATH);
  if (!stat.isDirectory()) {
    return parseSecretContent(fs.readFileSync(SECRETS_PATH, 'utf8'));
  }

  const env = {};
  for (const entry of fs.readdirSync(SECRETS_PATH, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const envKey = SECRET_FILE_ENV_KEYS.get(entry.name);
    if (!envKey) {
      continue;
    }

    const content = fs.readFileSync(
      path.join(SECRETS_PATH, entry.name),
      'utf8',
    );
    Object.assign(env, parseSecretContent(content));
    if (!env[envKey] && !env[OPENAI_TOKEN_ENV]) {
      env[envKey] = content.trim();
    }
  }

  return env;
}

function getConfig() {
  const env = { ...process.env, ...loadSecrets() };

  return {
    apiKey: env[QWEN_TOKEN_ENV] || env[OPENAI_TOKEN_ENV],
    baseUrl: DEFAULT_BASE_URL,
    modelId: DEFAULT_MODEL_ID,
  };
}

async function main() {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error(
      `Missing Qwen API key. Set ${QWEN_TOKEN_ENV}, ${OPENAI_TOKEN_ENV}, ` +
        'or ~/.secrets/openrouter_api_key.',
    );
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: qwen3 coder smoke test ok',
        },
      ],
      max_tokens: 32,
      temperature: 0,
    }),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Qwen request failed (${response.status} ${response.statusText}): ${responseText}`,
    );
  }

  const parsed = JSON.parse(responseText);
  const text = parsed.choices?.[0]?.message?.content?.trim();

  console.log(`model=${config.modelId}`);
  console.log(`baseUrl=${config.baseUrl}`);
  console.log(`reply=${text}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
