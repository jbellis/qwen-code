/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import type Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../../config/config.js';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../contentGenerator.js';
import { AnthropicContentConverter } from '../anthropicContentGenerator/converter.js';
import { RequestTokenEstimator } from '../../utils/request-tokenizer/index.js';
import { buildRuntimeFetchOptions } from '../../utils/runtimeFetchOptions.js';
import {
  BEDROCK_API_KEY_ENV,
  BEDROCK_MODEL_ID,
  loadBedrockBearerToken,
  resolveBedrockRegion,
} from './secrets.js';

type BedrockResponse = Anthropic.Message & {
  id?: string;
  model?: string;
};

export class BedrockContentGenerator implements ContentGenerator {
  private readonly converter: AnthropicContentConverter;

  constructor(
    private readonly contentGeneratorConfig: ContentGeneratorConfig,
    private readonly cliConfig: Config,
  ) {
    this.converter = new AnthropicContentConverter(
      BEDROCK_MODEL_ID,
      contentGeneratorConfig.schemaCompliance,
      contentGeneratorConfig.enableCacheControl,
    );
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const response = await this.invokeModel(request);
    return this.converter.convertAnthropicResponseToGemini(response);
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const response = await this.generateContent(request);

    async function* streamSingleResponse() {
      yield response;
    }

    return streamSingleResponse();
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    try {
      const estimator = new RequestTokenEstimator();
      const result = await estimator.calculateTokens(request);
      return { totalTokens: result.totalTokens };
    } catch {
      const content = JSON.stringify(request.contents);
      return { totalTokens: Math.ceil(content.length / 4) };
    }
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('Bedrock Sonnet does not support embeddings.');
  }

  useSummarizedThinking(): boolean {
    return false;
  }

  private async invokeModel(
    request: GenerateContentParameters,
  ): Promise<BedrockResponse> {
    const token =
      this.contentGeneratorConfig.apiKey || loadBedrockBearerToken();
    if (!token) {
      throw new Error(
        `Missing Bedrock bearer token. Set ${BEDROCK_API_KEY_ENV} or ~/.secrets/aws_bearer_token_bedrock.`,
      );
    }

    const region = resolveBedrockRegion();
    const encodedModelId = encodeURIComponent(BEDROCK_MODEL_ID);
    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodedModelId}/invoke`;
    const { system, messages } = this.converter.convertGeminiRequestToAnthropic(
      request,
      {
        enableCacheControl: false,
      },
    );
    const tools = request.config?.tools
      ? await this.converter.convertGeminiToolsToAnthropic(
          request.config.tools,
          { enableCacheControl: false },
        )
      : undefined;

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      system,
      messages,
      tools,
      max_tokens:
        this.contentGeneratorConfig.samplingParams?.max_tokens ??
        request.config?.maxOutputTokens ??
        8192,
      temperature:
        this.contentGeneratorConfig.samplingParams?.temperature ??
        request.config?.temperature,
      top_p:
        this.contentGeneratorConfig.samplingParams?.top_p ??
        request.config?.topP,
      top_k:
        this.contentGeneratorConfig.samplingParams?.top_k ??
        request.config?.topK,
    });

    const runtimeOptions = buildRuntimeFetchOptions(
      'anthropic',
      this.cliConfig.getProxy(),
    );
    const fetchImpl = runtimeOptions.fetch ?? fetch;
    const response = await fetchImpl(url, {
      ...runtimeOptions.fetchOptions,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body,
      signal: request.config?.abortSignal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Bedrock request failed (${response.status} ${response.statusText}): ${responseText}`,
      );
    }

    const parsed = JSON.parse(responseText) as BedrockResponse;
    parsed.model = parsed.model || BEDROCK_MODEL_ID;
    parsed.id = parsed.id || `bedrock-${Date.now()}`;
    return parsed;
  }
}
