/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { createDebugLogger } from '../utils/debugLogger.js';

const debugLogger = createDebugLogger('BIFROST_WORKSPACE');
const BIFROST_SERVER_NAME = 'bifrost';
const ACTIVATE_WORKSPACE_TOOL = 'mcp__bifrost__activate_workspace';

/**
 * Best-effort synchronization for Bifrost's analyzer root. Worktree tools
 * should still succeed when Bifrost is disabled, not built, or still starting.
 */
export async function activateBifrostWorkspace(
  config: Config,
  workspacePath: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const registry = config.getToolRegistry();
    let tool = await registry.ensureTool(ACTIVATE_WORKSPACE_TOOL);
    if (!tool) {
      await registry.discoverToolsForServer(BIFROST_SERVER_NAME);
      tool = await registry.ensureTool(ACTIVATE_WORKSPACE_TOOL);
    }
    if (!tool) {
      debugLogger.debug(
        `Bifrost activate_workspace tool not available for ${workspacePath}`,
      );
      return;
    }

    const result = await tool
      .build({ workspace_path: workspacePath })
      .execute(signal);
    if (result.error) {
      debugLogger.warn(
        `Bifrost activate_workspace failed for ${workspacePath}: ${result.error.message}`,
      );
    }
  } catch (error) {
    debugLogger.warn(
      `Bifrost workspace activation skipped for ${workspacePath}: ${error}`,
    );
  }
}
