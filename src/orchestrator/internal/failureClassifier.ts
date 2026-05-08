import { PIPELINE_STATUS } from "../constants";
import { PipelineAbortedError, PipelineDefinitionError, StepExecutionError } from "../errors";
import type { BaseContext, PipelineRunResult, StepOutcome } from "../types";

export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function classifyStepException(error: unknown): StepOutcome {
	return {
		type: "failed",
		error: toError(error),
		retryable: false,
	};
}

export function classifyRunFailure(params: {
	error: unknown;
	traceId: string;
	stepName?: string;
}): StepExecutionError | PipelineAbortedError {
	const { error, traceId, stepName } = params;

	if (error instanceof PipelineAbortedError) {
		return error;
	}

	return new StepExecutionError(
		`Unexpected error during pipeline execution: ${toError(error).message}`,
		traceId,
		stepName,
		500,
		error,
	);
}

export function shouldPropagateRunFailure(error: unknown): error is PipelineDefinitionError {
	return error instanceof PipelineDefinitionError;
}

export function failedRunResult<C extends BaseContext>(
	ctx: C,
	error: StepExecutionError | PipelineAbortedError,
): PipelineRunResult<C> {
	return { status: PIPELINE_STATUS.FAILED, ctx, error };
}
