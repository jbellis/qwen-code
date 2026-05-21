#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_MODEL_ID = 'anthropic.claude-sonnet-4-6';
const DEFAULT_REGION = 'us-east-1';
const BEDROCK_TOKEN_ENV = 'AWS_BEARER_TOKEN_BEDROCK';
const SECRETS_PATH = path.join(os.homedir(), '.secrets');
const SECRET_FILE_ENV_KEYS = new Map([
  ['aws_bearer_token_bedrock', BEDROCK_TOKEN_ENV],
  ['bedrock_api_key', BEDROCK_TOKEN_ENV],
  ['bedrock_region', 'BEDROCK_REGION'],
]);

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

    const content = fs.readFileSync(path.join(SECRETS_PATH, entry.name), 'utf8');
    Object.assign(env, parseSecretContent(content));
    if (!env[envKey]) {
      env[envKey] = content.trim();
    }
  }

  return env;
}

function getConfig() {
  const env = { ...loadSecrets(), ...process.env };

  return {
    bearerToken: env[BEDROCK_TOKEN_ENV],
    region:
      env['AWS_REGION'] ??
      env['AWS_DEFAULT_REGION'] ??
      env['BEDROCK_REGION'] ??
      DEFAULT_REGION,
    modelId: DEFAULT_MODEL_ID,
  };
}

async function main() {
  const config = getConfig();
  if (!config.bearerToken) {
    throw new Error(
      `Missing Bedrock bearer token. Set ${BEDROCK_TOKEN_ENV}, ` +
        '~/.secrets/aws_bearer_token_bedrock, or ~/.secrets/bedrock_api_key.',
    );
  }

  const encodedModelId = encodeURIComponent(config.modelId);
  const url =
    `https://bedrock-runtime.${config.region}.amazonaws.com` +
    `/model/${encodedModelId}/invoke`;
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 48,
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly: bedrock sonnet smoke test ok',
      },
    ],
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.bearerToken}`,
      'content-type': 'application/json',
    },
    body,
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Bedrock request failed (${response.status} ${response.statusText}): ${responseText}`,
    );
  }

  const parsed = JSON.parse(responseText);
  const text = parsed.content
    ?.filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();

  console.log(`model=${config.modelId}`);
  console.log(`region=${config.region}`);
  console.log(`reply=${text}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
