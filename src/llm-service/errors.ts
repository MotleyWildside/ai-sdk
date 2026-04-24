export interface LLMErrorOptions {
	message: string;
	provider: string;
	model: string;
	promptId?: string;
	requestId?: string;
	statusCode?: number;
	cause?: Error;
}

export class LLMError extends Error {
	readonly provider: string;
	readonly model: string;
	readonly promptId?: string;
	readonly requestId?: string;
	readonly statusCode?: number;

	constructor(opts: LLMErrorOptions) {
		super(opts.message, { cause: opts.cause });
		this.name = "LLMError";
		this.provider = opts.provider;
		this.model = opts.model;
		this.promptId = opts.promptId;
		this.requestId = opts.requestId;
		this.statusCode = opts.statusCode;
		Object.setPrototypeOf(this, LLMError.prototype);
	}
}

/**
 * Transient errors that should be retried (timeouts, rate limits, 5xx)
 */
export class LLMTransientError extends LLMError {
	constructor(opts: LLMErrorOptions) {
		super(opts);
		this.name = "LLMTransientError";
		Object.setPrototypeOf(this, LLMTransientError.prototype);
	}
}

/**
 * Permanent errors that should not be retried (401, 403, invalid request)
 */
export class LLMPermanentError extends LLMError {
	constructor(opts: LLMErrorOptions) {
		super(opts);
		this.name = "LLMPermanentError";
		Object.setPrototypeOf(this, LLMPermanentError.prototype);
	}
}

export interface LLMParseErrorOptions extends LLMErrorOptions {
	rawOutput: string;
}

/**
 * JSON parsing errors
 */
export class LLMParseError extends LLMError {
	readonly rawOutput: string;

	constructor(opts: LLMParseErrorOptions) {
		super(opts);
		this.name = "LLMParseError";
		this.rawOutput = opts.rawOutput;
		Object.setPrototypeOf(this, LLMParseError.prototype);
	}
}

export interface LLMSchemaErrorOptions extends LLMErrorOptions {
	validationErrors: string[];
}

/**
 * Schema validation errors
 */
export class LLMSchemaError extends LLMError {
	readonly validationErrors: string[];

	constructor(opts: LLMSchemaErrorOptions) {
		super(opts);
		this.name = "LLMSchemaError";
		this.validationErrors = opts.validationErrors;
		Object.setPrototypeOf(this, LLMSchemaError.prototype);
	}
}
