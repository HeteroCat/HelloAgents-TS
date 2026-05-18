const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const pkg = require('../package.json');
const lib = require('../dist');

function testExports() {
  const required = [
    'HelloAgentsLLM',
    'Config',
    'Message',
    'SimpleAgent',
    'ReActAgent',
    'ReflectionAgent',
    'PlanSolveAgent',
    'Tool',
    'ToolRegistry',
    'ToolResponse',
    'HistoryManager',
    'TokenCounter',
    'ObservationTruncator',
    'SessionStore',
    'TraceLogger',
    'SkillLoader',
  ];

  for (const name of required) {
    assert.ok(lib[name], `missing export: ${name}`);
  }
}

function testToolBaseCompatibility() {
  class DemoTool extends lib.Tool {
    name = 'demo_tool';
    description = 'demo';
    getParameters() {
      return [];
    }
    run() {
      return lib.ToolResponse.success('ok');
    }
  }

  const tool = new DemoTool();
  assert.equal(tool.name, 'demo_tool');
  assert.equal(tool.description, 'demo');
}

function testContextComponents() {
  const counter = new lib.TokenCounter('gpt-4o');
  assert.ok(counter.countText('hello world') > 0);

  const history = new lib.HistoryManager(2, 0.7);
  history.append(new lib.Message('q1', 'user'));
  history.append(new lib.Message('a1', 'assistant'));
  history.append(new lib.Message('q2', 'user'));
  history.append(new lib.Message('a2', 'assistant'));
  history.append(new lib.Message('q3', 'user'));
  history.append(new lib.Message('a3', 'assistant'));
  history.compress('summary');
  assert.ok(history.getHistory().length > 0);

  const truncator = new lib.ObservationTruncator(3, 1000, 'tail');
  const longOutput = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
  const truncated = truncator.truncate('demo_tool', longOutput);
  assert.equal(truncated.truncated, true);
}

function testSessionStore() {
  const dir = path.join(__dirname, '.tmp-sessions');
  fs.rmSync(dir, { recursive: true, force: true });

  const store = new lib.SessionStore(dir);
  const file = store.save(
    { name: 'demo', llm_provider: 'openai', llm_model: 'gpt-4o' },
    [new lib.Message('hello', 'user')],
    'hash-1',
    {},
    { created_at: new Date().toISOString() },
    'demo-session'
  );

  assert.ok(fs.existsSync(file));
  const loaded = store.load(file);
  assert.equal(loaded.agent_config.name, 'demo');
}

function testExamplesExist() {
  const examples = [
    '01-quickstart.ts',
    '02-custom-tools.ts',
    '03-react-agent.ts',
    '04-all-agents.ts',
    '05-context-engineering.ts',
  ];

  for (const example of examples) {
    const file = path.join(__dirname, '..', 'examples', example);
    assert.ok(fs.existsSync(file), `missing example: ${example}`);
  }
}

function main() {
  assert.equal(pkg.name, 'hello-agents-ts');
  testExports();
  testToolBaseCompatibility();
  testContextComponents();
  testSessionStore();
  testExamplesExist();
  console.log('smoke tests passed');
}

main();
