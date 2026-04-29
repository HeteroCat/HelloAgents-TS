/**
 * HelloAgents base exception class
 */
export class HelloAgentsException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HelloAgentsException';
  }
}

/**
 * LLM related exceptions
 */
export class LLMException extends HelloAgentsException {
  constructor(message: string) {
    super(message);
    this.name = 'LLMException';
  }
}

/**
 * Agent related exceptions
 */
export class AgentException extends HelloAgentsException {
  constructor(message: string) {
    super(message);
    this.name = 'AgentException';
  }
}

/**
 * Configuration related exceptions
 */
export class ConfigException extends HelloAgentsException {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigException';
  }
}

/**
 * Tool related exceptions
 */
export class ToolException extends HelloAgentsException {
  constructor(message: string) {
    super(message);
    this.name = 'ToolException';
  }
}
