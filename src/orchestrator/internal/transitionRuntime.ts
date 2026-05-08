import { PIPELINE_STATUS, TRANSITION_TYPE } from "../constants";
import { PipelineDefinitionError, StepExecutionError } from "../errors";
import type { BaseContext, PipelineRunResult, Transition, ContextAdjustment } from "../types";
import type { PipelineObserver } from "../observers";

export type TransitionApplication<C extends BaseContext> =
	| { type: "finish"; result: PipelineRunResult<C> }
	| { type: "continue"; nextStepName: string };

export class TransitionRuntime<C extends BaseContext> {
	constructor(
		private readonly stepsByName: Map<string, unknown>,
		private readonly stepOrder: string[],
		private readonly observer: PipelineObserver,
	) {}

	applyContextAdjustment(ctx: C, adjustment: ContextAdjustment<C>, traceId: string): C {
		switch (adjustment.type) {
			case "none":
				return ctx;
			case "patch":
				return { ...ctx, ...adjustment.patch };
			case "override": {
				const next = adjustment.ctx;
				return next.traceId ? next : { ...next, traceId };
			}
			default: {
				const _exhaustive: never = adjustment;
				throw new Error(`Unknown context adjustment type: ${JSON.stringify(_exhaustive)}`);
			}
		}
	}

	async apply(params: {
		transition: Transition;
		ctx: C;
		currentStepName: string;
		traceId: string;
		startTime: number;
		signal?: AbortSignal;
	}): Promise<TransitionApplication<C>> {
		const { transition, ctx, currentStepName, traceId, startTime, signal } = params;
		const durationMs = Date.now() - startTime;

		switch (transition.type) {
			case TRANSITION_TYPE.NEXT: {
				const currentIndex = this.stepOrder.indexOf(currentStepName);
				if (currentIndex === -1 || currentIndex >= this.stepOrder.length - 1) {
					this.observer.onRunFinish({ traceId, outcome: PIPELINE_STATUS.OK, durationMs });
					return { type: "finish", result: { status: PIPELINE_STATUS.OK, ctx } };
				}
				return { type: "continue", nextStepName: this.stepOrder[currentIndex + 1] };
			}

			case TRANSITION_TYPE.GOTO: {
				this.assertKnownStep(transition.stepName, "GOTO");
				return { type: "continue", nextStepName: transition.stepName };
			}

			case TRANSITION_TYPE.RETRY: {
				const targetStep = transition.stepName ?? currentStepName;
				this.assertKnownStep(targetStep, "RETRY");
				await this.waitForRetryDelay(transition.delayMs, signal);
				return { type: "continue", nextStepName: targetStep };
			}

			case TRANSITION_TYPE.STOP: {
				this.observer.onRunFinish({ traceId, outcome: PIPELINE_STATUS.OK, durationMs });
				return { type: "finish", result: { status: PIPELINE_STATUS.OK, ctx } };
			}

			case TRANSITION_TYPE.FAIL: {
				const error = new StepExecutionError(
					transition.error.message,
					traceId,
					currentStepName,
					transition.statusCode,
					transition.error,
				);
				this.observer.onError({ traceId, stepName: currentStepName, error });
				this.observer.onRunFinish({ traceId, outcome: PIPELINE_STATUS.FAILED, durationMs });
				return { type: "finish", result: { status: PIPELINE_STATUS.FAILED, ctx, error } };
			}

			case TRANSITION_TYPE.DEGRADE: {
				this.observer.onRunFinish({ traceId, outcome: PIPELINE_STATUS.OK, durationMs });
				return {
					type: "finish",
					result: { status: PIPELINE_STATUS.OK, ctx, degraded: { reason: transition.reason } },
				};
			}

			default: {
				const _exhaustive: never = transition;
				throw new Error(`Unknown transition type: ${JSON.stringify(_exhaustive)}`);
			}
		}
	}

	private assertKnownStep(stepName: string, transitionType: "GOTO" | "RETRY"): void {
		if (this.stepsByName.has(stepName)) {
			return;
		}
		throw new PipelineDefinitionError(
			`${transitionType} transition to unknown step: "${stepName}"`,
		);
	}

	private async waitForRetryDelay(delayMs: number | undefined, signal: AbortSignal | undefined) {
		if (!delayMs || delayMs <= 0) {
			return;
		}

		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(resolve, delayMs);
			signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					reject(
						signal.reason instanceof Error
							? signal.reason
							: new Error("Aborted during retry delay"),
					);
				},
				{ once: true },
			);
		});
	}
}
