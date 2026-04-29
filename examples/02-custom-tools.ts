/**
 * HelloAgents TypeScript - 自定义工具
 *
 * 演示如何创建和注册自定义工具：
 * 1. 继承 Tool 基类
 * 2. 注册到 ToolRegistry
 * 3. 使用 SimpleAgent 进行 Function Calling
 *
 * 运行方式:
 *   npx ts-node examples/02-custom-tools.ts
 */

import {
  SimpleAgent,
  HelloAgentsLLM,
  Tool,
  ToolParameter,
  ToolResponse,
  ToolRegistry,
} from '../src';

// --- 自定义工具：天气查询（模拟） ---
class WeatherTool extends Tool {
  name = "get_weather";
  description = "查询指定城市的天气情况";

  getParameters(): ToolParameter[] {
    return [
      {
        name: "city",
        type: "string",
        description: "城市名称",
        required: true,
      },
    ];
  }

  run(params: Record<string, any>): ToolResponse {
    const city = params.city || "未知";
    // 模拟天气数据
    const mockWeather: Record<string, string> = {
      "北京": "晴天，25°C，微风",
      "上海": "多云，28°C，东南风3级",
      "深圳": "阵雨，30°C，湿度85%",
    };
    const weather = mockWeather[city] || `${city}：晴，22°C`;
    return ToolResponse.success(weather, { city, weather });
  }
}

// --- 自定义工具：单位转换 ---
class UnitConverterTool extends Tool {
  name = "convert_unit";
  description = "单位转换工具，支持温度、长度、重量等";

  getParameters(): ToolParameter[] {
    return [
      { name: "value", type: "number", description: "数值", required: true },
      { name: "from_unit", type: "string", description: "源单位", required: true },
      { name: "to_unit", type: "string", description: "目标单位", required: true },
    ];
  }

  run(params: Record<string, any>): ToolResponse {
    const { value, from_unit, to_unit } = params;

    const conversions: Record<string, (v: number) => number> = {
      "celsius_fahrenheit": (v) => v * 9 / 5 + 32,
      "fahrenheit_celsius": (v) => (v - 32) * 5 / 9,
      "km_miles": (v) => v * 0.621371,
      "miles_km": (v) => v / 0.621371,
      "kg_pounds": (v) => v * 2.20462,
      "pounds_kg": (v) => v / 2.20462,
    };

    const key = `${from_unit.toLowerCase()}_${to_unit.toLowerCase()}`;
    const converter = conversions[key];

    if (!converter) {
      return ToolResponse.error(
        "INVALID_PARAM",
        `不支持的转换: ${from_unit} -> ${to_unit}`
      );
    }

    const result = converter(value);
    return ToolResponse.success(
      `${value} ${from_unit} = ${result.toFixed(2)} ${to_unit}`,
      { value, from_unit, to_unit, result }
    );
  }
}

async function main() {
  const llm = new HelloAgentsLLM();

  // 创建工具注册表并注册工具
  const registry = new ToolRegistry();
  registry.registerTool(new WeatherTool());
  registry.registerTool(new UnitConverterTool());

  console.log("已注册工具:", registry.listTools());

  // 创建带工具的 Agent
  const agent = new SimpleAgent(
    "tool-agent",
    llm,
    "你是一个有用的助手，可以查询天气和进行单位转换。",
    null,           // config
    registry,       // toolRegistry
    true,           // enableToolCalling
    5               // maxToolIterations
  );

  // 测试工具调用
  console.log("\n=== 天气查询 ===");
  const r1 = await agent.run("北京今天天气怎么样？");
  console.log(`回复: ${r1}\n`);

  console.log("=== 单位转换 ===");
  const r2 = await agent.run("把100华氏度转换成摄氏度");
  console.log(`回复: ${r2}\n`);

  console.log("=== 复合任务 ===");
  const r3 = await agent.run("上海天气如何？另外帮我把10公里换算成英里");
  console.log(`回复: ${r3}`);
}

main().catch(console.error);
