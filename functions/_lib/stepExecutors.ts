interface StepExecutionResult {
  output: Record<string, any>;
}

// TEMP STUB — real per-type logic comes after orchestration is verified.
// Revert to throw-per-type before building actual Groq/HTTP/DB integrations.
export async function executeStep(
  step: any,
  context: { previousOutput: any },
): Promise<StepExecutionResult> {
  return {
    output: {
      stubbed: true,
      stepType: step.type,
      receivedInput: context.previousOutput,
    },
  };
}
