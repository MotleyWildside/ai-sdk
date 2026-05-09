import { LLMPermanentError, LLMTransientError } from "../../errors";

export type ProviderErrorExtractor = (payload: unknown) => string | undefined;

export function makeTransientProviderError(options: {
	provider: string;
	model: string;
	message: string;
	statusCode?: number;
	cause?: Error;
}): LLMTransientError {
	return new LLMTransientError(options);
}

export function makePermanentProviderError(options: {
	provider: string;
	model: string;
	message: string;
	statusCode?: number;
	cause?: Error;
}): LLMPermanentError {
	return new LLMPermanentError(options);
}

export async function readJsonResponse<T>(options: {
	response: Response;
	provider: string;
	model: string;
}): Promise<T> {
	try {
		return (await options.response.json()) as T;
	} catch (error) {
		throw makePermanentProviderError({
			message: `${options.provider} returned invalid JSON: ${String(error)}`,
			provider: options.provider,
			model: options.model,
			statusCode: options.response.status,
		});
	}
}

export function errorFromHttpResponse(options: {
	status: number;
	payload: unknown;
	provider: string;
	model: string;
	extractErrorMessage?: ProviderErrorExtractor;
}): LLMTransientError | LLMPermanentError {
	const message =
		options.extractErrorMessage?.(options.payload) ??
		defaultErrorMessageFromPayload(options.payload);
	const fullMessage = `${options.provider} request failed with HTTP ${options.status}: ${message}.`;
	if (options.status === 429 || options.status >= 500) {
		return makeTransientProviderError({
			message: fullMessage,
			provider: options.provider,
			model: options.model,
			statusCode: options.status,
		});
	}
	return makePermanentProviderError({
		message: fullMessage,
		provider: options.provider,
		model: options.model,
		statusCode: options.status,
	});
}

function defaultErrorMessageFromPayload(payload: unknown): string {
	if (!payload || typeof payload !== "object") return String(payload);
	const record = payload as Record<string, unknown>;
	if (typeof record.error === "string") return record.error;
	if (typeof record.message === "string") return record.message;
	if (record.details !== undefined) return JSON.stringify(record.details);
	return JSON.stringify(payload);
}
