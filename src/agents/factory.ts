import { Agent } from '../core/agent';
import { HelloAgentsLLM } from '../core/llm';
import { Config } from '../core/config';
import { ToolRegistry } from '../tools/registry';
import { SimpleAgent } from './simple-agent';
import { ReActAgent } from './react-agent';
import { ReflectionAgent } from './reflection-agent';
import { PlanSolveAgent } from './plan-solve-agent';

/**
 * Agent Factory Function
 */
export function createAgent(
  agentType: string,
  name: string,
  llm: HelloAgentsLLM,
  toolRegistry: ToolRegistry | null = null,
  config: Config | null = null,
  systemPrompt: string | null = null
): Agent {
  const type = agentType.toLowerCase();

  switch (type) {
    case 'react':
      return new ReActAgent(name, llm, toolRegistry, systemPrompt, config);
    case 'reflection':
      return new ReflectionAgent(name, llm, systemPrompt, config, 3, toolRegistry);
    case 'plan':
    case 'plan-solve':
      return new PlanSolveAgent(name, llm, systemPrompt, config, null, null, toolRegistry);
    case 'simple':
      return new SimpleAgent(name, llm, systemPrompt, config, toolRegistry);
    default:
      throw new Error(`Unsupported agent type: ${agentType}. Supported types: react, reflection, plan, simple`);
  }
}

/**
 * Default subagent factory function
 */
export function defaultSubagentFactory(
  agentType: string,
  llm: HelloAgentsLLM,
  toolRegistry: ToolRegistry | null = null,
  config: Config | null = null
): Agent {
  const cfg = config || new Config();
  const name = `subagent-${agentType}`;
  const systemPrompt = _getSystemPromptForType(agentType);

  const subagent = createAgent(agentType, name, llm, toolRegistry, cfg, systemPrompt);

  if ('maxSteps' in subagent) {
    (subagent as any).maxSteps = cfg.subagentMaxSteps;
  }

  return subagent;
}

/**
 * Get type-specific system prompt
 */
function _getSystemPromptForType(agentType: string): string {
  const prompts: Record<string, string> = {
    react: `你是一个高效的任务执行专家。

目标：快速完成指定的子任务。

规则：
- 使用可用工具高效完成任务
- 保持输出简洁明了
- 在规定步数内完成`,
    reflection: `你是一个反思型专家。

目标：深入分析问题并提供高质量的解决方案。

规则：
- 先给出初步方案
- 反思并改进方案
- 输出最终优化结果`,
    plan: `你是一个任务规划专家。

目标：将复杂任务分解为可执行的步骤。

规则：
- 分析任务需求
- 制定详细的执行计划
- 标注步骤依赖关系`,
    simple: `你是一个简洁高效的助手。

目标：直接回答问题或完成任务。

规则：
- 保持回答简洁
- 直接给出结果
- 避免冗余信息`
  };

  return prompts[agentType.toLowerCase()] || prompts.simple;
}
