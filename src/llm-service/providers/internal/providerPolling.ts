import { LLMTransientError } from "../../errors";
import { makePermanentProviderError, makeTransientProviderError } from "./providerErrors";

export type ProviderPollOptions<T> = {
	fetchResult: () => Promise<T>;
	isSuccess: (result: T) => boolean;
	isFailure?: (result: T) => boolean;
	getFailureMessage?: (result: T) => string;
	intervalMs: number;
	maxAttempts: number;
	signal?: AbortSignal;
	model: string;
	timeoutMessage?: string;
};

export async function sleepWithAbort(options: {
	ms: number;
	provider: string;
	signal?: AbortSignal;
}): Promise<void> {
	if (options.signal?.aborted) throw options.signal.reason;

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(resolve, options.ms);
		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(options.signal?.reason ?? new Error(`${options.provider} request aborted.`));
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function pollUntil<T>(provider: string, options: ProviderPollOptions<T>): Promise<T> {
	for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
		const result = await options.fetchResult();
		if (options.isSuccess(result)) return result;
		if (options.isFailure?.(result)) {
			throw makePermanentProviderError({
				message: options.getFailureMessage?.(result) ?? `${provider} task failed.`,
				provider,
				model: options.model,
			});
		}
		if (attempt < options.maxAttempts) {
			await sleepWithAbort({
				ms: options.intervalMs,
				provider,
				signal: options.signal,
			});
		}
	}

	throw makeTransientProviderError({
		message: options.timeoutMessage ?? `Timed out waiting for ${provider} operation.`,
		provider,
		model: options.model,
	});
}

export function isProviderPollTimeout(error: unknown): error is LLMTransientError {
	return error instanceof LLMTransientError;
}
