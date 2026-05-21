/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../contentGenerator.js';
import type { Config } from '../../config/config.js';
import { BedrockContentGenerator } from './bedrockContentGenerator.js';

export { BedrockContentGenerator } from './bedrockContentGenerator.js';
export {
  BEDROCK_API_KEY_ENV,
  BEDROCK_DEFAULT_REGION,
  BEDROCK_MODEL_ID,
  loadBedrockBearerToken,
  loadBedrockSecrets,
  resolveBedrockRegion,
} from './secrets.js';

export function createBedrockContentGenerator(
  contentGeneratorConfig: ContentGeneratorConfig,
  cliConfig: Config,
): ContentGenerator {
  return new BedrockContentGenerator(contentGeneratorConfig, cliConfig);
}
