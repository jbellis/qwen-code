/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateContentParameters } from '@google/genai';
import type { Config } from '../../config/config.js';
import type { ContentGeneratorConfig } from '../contentGenerator.js';
import { BedrockContentGenerator } from './bedrockContentGenerator.js';

describe('BedrockContentGenerator', () => {
  const originalFetch = global.fetch;
  const originalAwsBearer = process.env['AWS_BEARER_TOKEN_BEDROCK'];
  const originalAwsRegion = process.env['AWS_REGION'];

  let mockConfig: Config;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'test-bedrock-token';
    process.env['AWS_REGION'] = 'us-west-2';
    mockConfig = {
      getProxy: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalAwsBearer === undefined) {
      delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
    } else {
      process.env['AWS_BEARER_TOKEN_BEDROCK'] = originalAwsBearer;
    }
    if (originalAwsRegion === undefined) {
      delete process.env['AWS_REGION'];
    } else {
      process.env['AWS_REGION'] = originalAwsRegion;
    }
    vi.restoreAllMocks();
  });

  it('emits cache_control checkpoints and forwards cache usage metadata across warm requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            id: 'msg-bedrock-1',
            model: 'us.anthropic.claude-sonnet-4-6',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'first' }],
            usage: {
              input_tokens: 2_500,
              cache_creation_input_tokens: 8_700,
              output_tokens: 400,
            },
          }),
        ),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            id: 'msg-bedrock-2',
            model: 'us.anthropic.claude-sonnet-4-6',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'second' }],
            usage: {
              input_tokens: 2_500,
              cache_read_input_tokens: 32_088,
              output_tokens: 400,
            },
          }),
        ),
      } as unknown as Response);
    global.fetch = fetchMock as typeof fetch;

    const generator = new BedrockContentGenerator(
      {
        model: 'us.anthropic.claude-sonnet-4-6',
        apiKey: 'unused-because-env-is-set',
        timeout: 10_000,
        maxRetries: 0,
        schemaCompliance: 'auto',
        samplingParams: { max_tokens: 100 },
      } as ContentGeneratorConfig,
      mockConfig,
    );

    const request = {
      model: 'models/ignored',
      contents: 'Hi',
      config: {
        systemInstruction: 'sys',
        tools: [
          {
            functionDeclarations: [
              { name: 'get_weather', description: 'Get weather' },
            ],
          },
        ],
      },
    } as unknown as GenerateContentParameters;

    const firstResponse = await generator.generateContent(request);
    const secondResponse = await generator.generateContent(request);

    expect(firstResponse.usageMetadata?.cachedContentTokenCount).toBe(0);
    expect(secondResponse.usageMetadata?.cachedContentTokenCount).toBe(32_088);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall?.[0]).toBe(
      'https://bedrock-runtime.us-west-2.amazonaws.com/model/us.anthropic.claude-sonnet-4-6/invoke',
    );

    const requestInit = firstCall?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body)) as {
      system?: Array<Record<string, unknown>>;
      messages?: Array<{ content?: Array<Record<string, unknown>> }>;
      tools?: Array<Record<string, unknown>>;
    };

    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'sys',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(body.tools?.[0]?.['cache_control']).toEqual({
      type: 'ephemeral',
    });
    expect(body.messages?.[0]?.content?.[0]?.['cache_control']).toEqual({
      type: 'ephemeral',
    });
  });
});
