import type {
	PipelineRunResult,
	PipelineStep,
	PipelinePolicy,
	PolicyDecisionInput,
	StepOutcome,
	StepResult,
	StepRunMeta,
	PipelineOrchestratorConfig,
	PipelineRunOptions,
	BaseContext,
} from "./types";
import { PipelineDefinitionError, PipelineAbortedError } from "./errors";
import { NoopPipelineObserver, type PipelineObserver } from "./observers";
import { getTraceId } from "./utils";
import { PIPELINE_STATUS, DEFAULT_MAX_TRANSITIONS } from "./constants";
import { DefaultPolicy } from "./policies/DefaultPolicy";
import { logger } from "../logger/logger";
import { TransitionRuntime } from "./internal/transitionRuntime";
import {
	classifyRunFailure,
	classifyStepException,
	failedRunResult,
	shouldPropagateRunFailure,
	toError,
} from "./internal/failureClassifier";

export class PipelineOrchestrator<C extends BaseContext> {
	private readonly stepsByName: Map<string, PipelineStep<C>>;
	private readonly stepOrder: string[];
	private readonly observer: PipelineObserver;
	private readonly policyFactory: () => PipelinePolicy<C>;
	private readonly maxTransitions: number;
	private readonly stepTimeoutMs: number | undefined;

	constructor(config: PipelineOrchestratorConfig<C>) {
		const stepsByName = new Map<string, PipelineStep<C>>();
		const stepOrder: string[] = [];

		for (const step of config.steps) {
			if (!step.name || !step.name.trim()) {
				throw new PipelineDefinitionError("Step name must be a non-empty string.");
			}
			if (stepsByName.has(step.name)) {
				throw new PipelineDefinitionError(
					`Duplicate step name: "${step.name}". Step names must be unique.`,
				);
			}
			stepsByName.set(step.name, step);
			stepOrder.push(step.name);
		}

		this.stepsByName = stepsByName;
		this.stepOrder = stepOrder;
		this.observer = config.observer ?? new NoopPipelineObserver();
		this.maxTransitions = config.maxTransitions ?? DEFAULT_MAX_TRANSITIONS;
		this.stepTimeoutMs = config.stepTimeoutMs;

		// Normalise policy to a factory so each run gets isolated policy state,
		// making concurrent run() calls safe when a factory is provided.
		const policyInput = config.policy ?? (() => new DefaultPolicy<C>());
		this.policyFactory =
			typeof policyInput === "function" ? policyInput : () => policyInput as PipelinePolicy<C>;
	}

	async run(initialCtx: C, opts?: PipelineRunOptions): Promise<PipelineRunResult<C>> {
		const traceId = getTraceId(initialCtx, opts);

		if (opts?.traceId && initialCtx.traceId && opts.traceId !== initialCtx.traceId) {
			logger.warn(
				`[PipelineOrchestrator] opts.traceId ("${opts.traceId}") differs from ctx.traceId ("${initialCtx.traceId}"). opts.traceId takes precedence.`,
			);
		}

		const startTime = Date.now();
		const signal = opts?.signal;
		let ctx = { ...initialCtx, traceId } as C;
		const transitionRuntime = new TransitionRuntime<C>(
			this.stepsByName,
			this.stepOrder,
			this.observer,
		);

		this.observer.onRunStart({ traceId });

		// Per-run policy instance — safe for concurrent run() calls when policyFactory
		// creates a new instance each time.
		const policy = this.policyFactory();
		policy.reset();

		let transitionCount = 0;
		// Per-step attempt counters and last outcomes — reset per run automatically
		// because they are local to this invocation.
		const attemptCounts = new Map<string, number>();
		const previousOutcomes = new Map<string, StepOutcome>();

		try {
			if (!this.stepOrder.length) {
				throw new PipelineDefinitionError("Pipeline has no steps.");
			}

			let currentStepName = this.stepOrder[0];
			let finalRunResult: PipelineRunResult<C> | undefined;

			while (!finalRunResult) {
				if (signal?.aborted) {
					throw new PipelineAbortedError(traceId, currentStepName, signal.reason);
				}

				if (++transitionCount > this.maxTransitions) {
					throw new PipelineDefinitionError(
						`Pipeline exceeded max transitions (${this.maxTransitions}). Possible infinite loop.`,
					);
				}

				const step = this.stepsByName.get(currentStepName);
				if (!step) {
					throw new PipelineDefinitionError(
						`Step "${currentStepName}" not found in pipeline definition.`,
					);
				}

				const attempt = (attemptCounts.get(currentStepName) ?? 0) + 1;
				attemptCounts.set(currentStepName, attempt);

				const meta: StepRunMeta = {
					attempt,
					previousOutcome: previousOutcomes.get(currentStepName),
					signal: signal ?? undefined,
				};

				const stepResult = await this.executeStep({ step, ctx, traceId, meta });
				previousOutcomes.set(currentStepName, stepResult.outcome);
				ctx = stepResult.ctx;

				const policyInput: PolicyDecisionInput<C> = {
					stepName: currentStepName,
					stepResult,
					traceId,
				};

				const policyOutput = await policy.decide(policyInput);
				const transition = policyOutput.transition;

				if (policyOutput.contextAdjustment) {
					ctx = transitionRuntime.applyContextAdjustment(
						ctx,
						policyOutput.contextAdjustment,
						traceId,
					);
				}

				this.observer.onTransition?.({ traceId, stepName: currentStepName, transition });

				const result = await transitionRuntime.apply({
					transition,
					ctx,
					currentStepName,
					traceId,
					startTime,
					signal,
				});

				if (result.type === "finish") {
					finalRunResult = result.result;
				} else {
					currentStepName = result.nextStepName;
				}
			}

			return finalRunResult;
		} catch (error) {
			// PipelineDefinitionError is a programmer mistake — let it propagate so
			// it surfaces loudly rather than being silently swallowed into a result.
			if (shouldPropagateRunFailure(error)) throw error;

			const durationMs = Date.now() - startTime;
			const pipelineError = classifyRunFailure({ error, traceId });

			this.observer.onError({ traceId, error: pipelineError });
			this.observer.onRunFinish({ traceId, outcome: PIPELINE_STATUS.FAILED, durationMs });

			return failedRunResult(ctx, pipelineError);
		}
	}

	private async executeStep(params: {
		step: PipelineStep<C>;
		ctx: C;
		traceId: string;
		meta: StepRunMeta;
	}): Promise<StepResult<C>> {
		const { step, ctx, traceId, meta } = params;
		const stepStartTime = Date.now();

		this.observer.onStepStart({ traceId, stepName: step.name });

		try {
			const stepPromise = step.run(ctx, meta);

			let stepResult: StepResult<C>;
			if (this.stepTimeoutMs !== undefined) {
				const timeoutPromise = new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error(`Step "${step.name}" timed out after ${this.stepTimeoutMs}ms`)),
						this.stepTimeoutMs,
					),
				);
				stepResult = await Promise.race([stepPromise, timeoutPromise]);
			} else {
				stepResult = await stepPromise;
			}

			const stepDurationMs = Date.now() - stepStartTime;
			this.observer.onStepFinish({
				traceId,
				stepName: step.name,
				outcome: stepResult.outcome,
				durationMs: stepDurationMs,
			});

			return stepResult;
		} catch (error) {
			const stepDurationMs = Date.now() - stepStartTime;
			const caughtError = toError(error);
			const exceptionOutcome = classifyStepException(caughtError);

			this.observer.onError({ traceId, stepName: step.name, error: caughtError });
			this.observer.onStepFinish({
				traceId,
				stepName: step.name,
				outcome: exceptionOutcome,
				durationMs: stepDurationMs,
			});

			return { ctx, outcome: exceptionOutcome };
		}
	}
}
