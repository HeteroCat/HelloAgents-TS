import { Tool, ToolParameter } from '../base';
import { ToolResponse } from '../response';
import { ToolErrorCode } from '../errors';

/**
 * CalculatorTool - 执行数学计算
 */
export class CalculatorTool extends Tool {
    private static readonly OPERATORS: Record<string, (a: number, b: number) => number> = {
        '+': (a, b) => a + b,
        '-': (a, b) => a - b,
        '*': (a, b) => a * b,
        '/': (a, b) => a / b,
        '**': (a, b) => Math.pow(a, b),
        '%': (a, b) => a % b,
    };

    private static readonly FUNCTIONS: Record<string, (...args: number[]) => number> = {
        'abs': Math.abs,
        'round': Math.round,
        'max': Math.max,
        'min': Math.min,
        'sqrt': Math.sqrt,
        'sin': Math.sin,
        'cos': Math.cos,
        'tan': Math.tan,
        'log': Math.log,
        'exp': Math.exp,
        'pow': Math.pow,
        'pi': () => Math.PI,
        'e': () => Math.E,
    };

    constructor() {
        super(
            "python_calculator",
            "执行数学计算。支持基本运算、数学函数等。例如：2+3*4, sqrt(16), sin(pi/2)等。"
        );
    }

    getParameters(): ToolParameter[] {
        return [
            {
                name: "input",
                type: "string",
                description: "要计算的数学表达式，支持基本运算和数学函数",
                required: true
            }
        ];
    }

    async run(parameters: Record<string, any>): Promise<ToolResponse> {
        const expression = parameters.input || parameters.expression || "";

        if (!expression) {
            return ToolResponse.error(
                ToolErrorCode.INVALID_PARAM,
                "计算表达式不能为空"
            );
        }

        console.log(`🧮 正在计算: ${expression}`);

        try {
            // 在生产环境中建议使用专门的数学库如 mathjs
            // 这里实现一个简单的、安全的评估逻辑
            const result = this.safeEval(expression);
            const resultStr = String(result);

            console.log(`✅ 计算结果: ${resultStr}`);

            return ToolResponse.success(
                `计算结果: ${resultStr}`,
                {
                    expression,
                    result,
                    result_str: resultStr,
                    result_type: typeof result
                }
            );
        } catch (e) {
            const errorMsg = `计算失败: ${e instanceof Error ? e.message : String(e)}`;
            console.error(`❌ ${errorMsg}`);
            return ToolResponse.error(
                ToolErrorCode.EXECUTION_ERROR,
                errorMsg,
                undefined,
                { expression }
            );
        }
    }

    /**
     * 安全评估数学表达式
     * 注意：这是一个简化版的 AST 评估实现
     */
    private safeEval(expr: string): number {
        // 处理常量
        const constants: Record<string, number> = {
            'pi': Math.PI,
            'e': Math.E
        };

        // 简单的替换和清理
        let sanitized = expr.replace(/\s+/g, '');
        
        // 这是一个非常简化的评估器，实际应用中建议使用 mathjs
        // 为了满足 "recursive AST-like evaluator" 的要求，我们在这里实现一个基础版本
        
        const tokenize = (str: string): string[] => {
            const tokens: string[] = [];
            let numberBuffer = '';
            let nameBuffer = '';
            
            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                if (/[0-9.]/.test(char)) {
                    numberBuffer += char;
                } else if (/[a-zA-Z]/.test(char)) {
                    nameBuffer += char;
                } else {
                    if (numberBuffer) {
                        tokens.push(numberBuffer);
                        numberBuffer = '';
                    }
                    if (nameBuffer) {
                        tokens.push(nameBuffer);
                        nameBuffer = '';
                    }
                    
                    // 处理双字符操作符 **
                    if (char === '*' && str[i + 1] === '*') {
                        tokens.push('**');
                        i++;
                    } else {
                        tokens.push(char);
                    }
                }
            }
            
            if (numberBuffer) tokens.push(numberBuffer);
            if (nameBuffer) tokens.push(nameBuffer);
            
            return tokens;
        };

        const tokens = tokenize(sanitized);
        let pos = 0;

        const parseExpression = (): number => {
            let result = parseTerm();
            while (tokens[pos] === '+' || tokens[pos] === '-') {
                const op = tokens[pos++];
                const right = parseTerm();
                if (op === '+') result += right;
                else result -= right;
            }
            return result;
        };

        const parseTerm = (): number => {
            let result = parsePower();
            while (tokens[pos] === '*' || tokens[pos] === '/') {
                const op = tokens[pos++];
                const right = parsePower();
                if (op === '*') result *= right;
                else result /= right;
            }
            return result;
        };

        const parsePower = (): number => {
            let result = parseFactor();
            while (tokens[pos] === '**') {
                pos++;
                const right = parsePower(); // 右结合
                result = Math.pow(result, right);
            }
            return result;
        };

        const parseFactor = (): number => {
            const token = tokens[pos++];
            
            if (token === '-') {
                return -parseFactor();
            }
            
            if (token === '(') {
                const result = parseExpression();
                if (tokens[pos++] !== ')') throw new Error('预期 ")"');
                return result;
            }
            
            if (!isNaN(Number(token))) {
                return Number(token);
            }
            
            if (constants[token] !== undefined) {
                return constants[token];
            }
            
            if (CalculatorTool.FUNCTIONS[token]) {
                if (tokens[pos++] !== '(') throw new Error(`函数 ${token} 缺少 "("`);
                const args: number[] = [];
                if (tokens[pos] !== ')') {
                    args.push(parseExpression());
                    while (tokens[pos] === ',') {
                        pos++;
                        args.push(parseExpression());
                    }
                }
                if (tokens[pos++] !== ')') throw new Error(`函数 ${token} 缺少 ")"`);
                return CalculatorTool.FUNCTIONS[token](...args);
            }
            
            throw new Error(`未知 token: ${token}`);
        };

        return parseExpression();
    }
}
