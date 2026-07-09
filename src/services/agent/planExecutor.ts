/**
 * planExecutor — Thực thi DecomposedPlan tuần tự
 *
 * Xử lý:
 * 1. Validate plan (không circular dependency, tool tồn tại)
 * 2. Resolve dependencies ($step_N.field → giá trị thực)
 * 3. Evaluate conditions ($1.data.existed === true → skip/bỏ qua)
 * 4. Execute từng step, thu thập kết quả
 * 5. Trả về logs + aggregated results
 */
import type { DecomposedPlan, PlanStep } from './queryDecomposer.ts';
import {
  createProductFromName,
  updateProductFields,
  deleteProductById,
  findProductsByName,
  ensureBrand,
  searchTrending,
} from './adminTools.ts';
import type { ToolResult } from './adminTools.ts';

/** Kết quả của 1 step */
interface StepResult {
  stepId: number;
  tool: string;
  description: string;
  success: boolean;
  data: any;
  message: string;
  skipped: boolean;
  skipReason?: string;
}

/** Kết quả thực thi toàn bộ plan */
export interface PlanExecutionResult {
  success: boolean;
  results: StepResult[];
  logs: string[];
  summary: string;
}

/** Map tool name → executor function */
type ToolExecutor = (args: Record<string, any>) => Promise<ToolResult>;

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  generate_product: async (args) => {
    return createProductFromName(args.name, {
      price: args.price,
      brand: args.brand,
    });
  },
  update_product: async (args) => {
    return updateProductFields(args.id, args.fields);
  },
  delete_product: async (args) => {
    return deleteProductById(args.id);
  },
  find_products: async (args) => {
    return findProductsByName(args.query, args.limit || 5);
  },
  ensure_brand: async (args) => {
    return ensureBrand(args.name);
  },
  search_trending: async (args) => {
    return searchTrending(args.brand, args.query, args.limit || 5);
  },
};

/**
 * Resolve tham chiếu $step_N.field trong args
 * VD: "$step_2.data.products[0].name" → giá trị thực từ results
 */
function resolveArg(value: any, results: Map<number, ToolResult>): any {
  if (typeof value !== 'string') return value;

  const refMatch = value.match(/^\$(\d+)\.(.+)$/);
  if (!refMatch) return value;

  const stepId = parseInt(refMatch[1], 10);
  const path = refMatch[2];

  const result = results.get(stepId);
  if (!result) {
    console.warn(`⚠️ [PlanExecutor] Cannot resolve $${stepId} — step not executed yet`);
    return value;
  }

  // Navigate path: "data.products[0].name"
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: any = result;
  for (const part of parts) {
    if (current === null || current === undefined) return value;
    current = current[part];
  }
  return current ?? value;
}

/**
 * Resolve tất cả args trong 1 step
 */
function resolveArgs(args: Record<string, any>, results: Map<number, ToolResult>): Record<string, any> {
  const resolved: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    resolved[key] = resolveArg(value, results);
  }
  return resolved;
}

/**
 * Evaluate condition string với kết quả hiện có
 * VD: "$1.data.existed === true" → boolean
 */
function evaluateCondition(condition: string, results: Map<number, ToolResult>): boolean {
  try {
    // Replace $N.field với giá trị thực
    let expr = condition;
    const refRegex = /\$(\d+)\.([a-zA-Z0-9_.\[\]]+)/g;
    expr = expr.replace(refRegex, (_match, stepId: string, path: string) => {
      const sid = parseInt(stepId, 10);
      const result = results.get(sid);
      if (!result) return 'undefined';

      const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
      let current: any = result;
      for (const part of parts) {
        if (current === null || current === undefined) return 'undefined';
        current = current[part];
      }
      return JSON.stringify(current);
    });

    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${expr})`);
    return !!fn();
  } catch (err) {
    console.warn(`⚠️ [PlanExecutor] Condition eval error: "${condition}" → ${err}`);
    return true; // default: execute step nếu không parse được condition
  }
}

/**
 * Validate plan — check circular deps, tool tồn tại
 */
function validatePlan(plan: DecomposedPlan): string | null {
  const stepIds = new Set(plan.steps.map(s => s.id));

  for (const step of plan.steps) {
    // Check tool exists
    if (!TOOL_EXECUTORS[step.tool]) {
      return `Step ${step.id}: tool "${step.tool}" không tồn tại. Tools hợp lệ: ${Object.keys(TOOL_EXECUTORS).join(', ')}`;
    }

    // Check dependencies reference valid steps
    for (const depId of step.dependsOn) {
      if (!stepIds.has(depId)) {
        return `Step ${step.id}: dependsOn step ${depId} không tồn tại trong plan`;
      }
      // Circular check: a step cannot depend on itself or a higher ID
      if (depId >= step.id) {
        return `Step ${step.id}: circular dependency — dependsOn ${depId} >= self`;
      }
    }
  }

  return null;
}

/**
 * executePlan — Thực thi toàn bộ plan
 */
export async function executePlan(
  plan: DecomposedPlan,
): Promise<PlanExecutionResult> {
  const results = new Map<number, ToolResult>();
  const stepResults: StepResult[] = [];
  const logs: string[] = [];

  // Validate
  const validationError = validatePlan(plan);
  if (validationError) {
    return {
      success: false,
      results: [],
      logs: [`Plan validation failed: ${validationError}`],
      summary: `Lỗi plan: ${validationError}`,
    };
  }

  // Execute tuần tự theo id
  const sortedSteps = [...plan.steps].sort((a, b) => a.id - b.id);

  for (const step of sortedSteps) {
    console.log(`▶️ [PlanExecutor] Step ${step.id}: ${step.tool} — ${step.description}`);

    // Check dependencies đã hoàn thành
    let depsFailed = false;
    for (const depId of step.dependsOn) {
      const depResult = results.get(depId);
      if (!depResult) {
        stepResults.push({
          stepId: step.id,
          tool: step.tool,
          description: step.description,
          success: false,
          data: null,
          message: `Phụ thuộc step ${depId} chưa được thực thi`,
          skipped: true,
          skipReason: `Dependency step ${depId} not executed`,
        });
        logs.push(`Step ${step.id}: SKIPPED — depends on step ${depId} (not executed)`);
        depsFailed = true;
        break;
      }
    }
    if (depsFailed) continue;

    // Check condition
    if (step.condition) {
      const shouldExecute = evaluateCondition(step.condition, results);
      if (!shouldExecute) {
        stepResults.push({
          stepId: step.id,
          tool: step.tool,
          description: step.description,
          success: true,
          data: null,
          message: 'Đã bỏ qua (condition not met)',
          skipped: true,
          skipReason: `Condition "${step.condition}" evaluated to false`,
        });
        logs.push(`Step ${step.id}: SKIPPED — condition "${step.condition}" = false`);
        continue;
      }
    }

    // Resolve args
    const resolvedArgs = resolveArgs(step.args, results);
    console.log(`  Args: ${JSON.stringify(resolvedArgs)}`);

    // Execute
    const executor = TOOL_EXECUTORS[step.tool];
    const toolResult = await executor(resolvedArgs);
    results.set(step.id, toolResult);

    logs.push(`Step ${step.id}: ${step.description} → ${toolResult.message}`);

    stepResults.push({
      stepId: step.id,
      tool: step.tool,
      description: step.description,
      success: toolResult.success,
      data: toolResult.data,
      message: toolResult.message,
      skipped: false,
    });

    // Nếu step thất bại và là critical → dừng plan
    if (!toolResult.success && step.tool !== 'search_trending' && step.tool !== 'find_products') {
      logs.push(`Plan dừng tại step ${step.id} do lỗi critical`);
      break;
    }
  }

  const allSuccess = stepResults.every(r => r.success || r.skipped);
  return {
    success: allSuccess,
    results: stepResults,
    logs,
    summary: '', // Sẽ được Gemini tóm tắt sau
  };
}

/**
 * summarizeExecution — Dùng Gemini tóm tắt kết quả plan execution
 */
export async function summarizeExecution(
  executionResult: PlanExecutionResult,
): Promise<string> {
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  const { generateText } = await import('ai');

  const provider = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  const logsText = executionResult.logs.join('\n');
  const resultsText = executionResult.results
    .map(r => `[${r.skipped ? 'SKIP' : r.success ? 'OK' : 'FAIL'}] ${r.description}: ${r.message}`)
    .join('\n');

  try {
    const summary = await (generateText as any)({
      model: provider.interactions('gemini-3.1-flash-lite-preview'),
      system: 'Bạn là AdminAI. Tóm tắt kết quả thực thi plan bằng tiếng Việt ngắn gọn, thân thiện. Chỉ dùng thông tin có sẵn, không tự suy diễn.',
      messages: [{
        role: 'user',
        content: `Kết quả thực thi plan:\n${resultsText}\n\nLogs:\n${logsText}\n\nHãy tóm tắt cho admin biết đã làm được những gì.`,
      }],
    });

    return summary.text || executionResult.logs.join('\n');
  } catch {
    return executionResult.logs.join('\n');
  }
}

/**
 * Append supplement link nếu có sản phẩm được tạo
 */
export function appendSupplementLink(summary: string, executionResult: PlanExecutionResult): string {
  const createdCount = executionResult.results.filter(r => r.tool === 'generate_product' && r.success && !r.skipped).length;
  if (createdCount > 0) {
    return summary + `\n\nCó ${createdCount} sản phẩm cần bổ sung thông tin. Vào trang Bổ sung sản phẩm để hoàn thiện: /admin/products/supplement`;
  }
  return summary;
}
