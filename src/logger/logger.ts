import chalk from "chalk";
import type { LLMLogger } from "./types";

/**
 * Default logger implementation using console and chalk
 */
export class ConsoleLogger implements LLMLogger {
	private get isProduction(): boolean {
		return process.env.NODE_ENV === "production";
	}

	// Respects NO_COLOR (https://no-color.org/) and non-TTY environments (CI, Docker, pipes).
	private get useColor(): boolean {
		return (
			process.stdout.isTTY === true &&
			!this.isProduction &&
			process.env.NO_COLOR !== "1" &&
			process.env.NO_COLOR !== "true"
		);
	}

	private c(fn: (s: string) => string, s: string): string {
		return this.useColor ? fn(s) : s;
	}

	private formatTime(): string {
		if (this.isProduction) {
			return new Date().toISOString();
		}
		return new Date().toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	}

	private formatPrefix(emoji: string, label: string, color: (s: string) => string): string {
		const time = this.formatTime();
		if (this.isProduction) {
			return `[${time}] [${label}]`;
		}
		const text = `[${time}] ${emoji} ${label}`;
		return this.useColor ? chalk.bold(color(text)) : text;
	}

	info(message: string, ...args: unknown[]): void {
		const prefix = this.formatPrefix("ℹ️", "INFO", chalk.cyan);
		console.log(`${prefix} ${message}`, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		const prefix = this.formatPrefix("⚠️", "WARN", chalk.yellow);
		console.warn(`${prefix} ${message}`, ...args);
	}

	error(message: string, error?: unknown): void {
		const prefix = this.formatPrefix("❌", "ERROR", chalk.red);
		console.error(`${prefix} ${message}`);
		if (error) {
			console.error(error);
		}
	}

	debug(message: string, ...args: unknown[]): void {
		if (process.env.NODE_ENV === "development") {
			const prefix = this.formatPrefix("🔍", "DEBUG", chalk.gray);
			console.log(`${prefix} ${message}`, ...args);
		}
	}

	llmCall(log: {
		traceId?: string;
		promptId?: string;
		promptVersion?: string | number;
		model?: string;
		provider?: string;
		success: boolean;
		error?: string;
		usage?: {
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
		};
		cached?: boolean;
		retry?: boolean;
		durationMs: number;
	}): void {
		const prefix = this.formatPrefix("🤖", "LLM", chalk.magenta);
		const traceIdValue = log.traceId ? `[${log.traceId.slice(-8)}]` : "";
		const traceId = this.isProduction
			? log.traceId
				? ` [traceId: ${log.traceId}]`
				: ""
			: ` ${this.c(chalk.gray, traceIdValue)}`;

		const status = this.isProduction
			? log.success
				? "SUCCESS"
				: log.retry
					? "RETRY"
					: "FAILED"
			: log.success
				? this.c(chalk.green, "✓")
				: log.retry
					? this.c(chalk.yellow, "↻")
					: this.c(chalk.red, "✗");

		let message = `${prefix} ${status}${traceId}`;

		if (log.promptId) {
			message += ` ${this.c(chalk.cyan, log.promptId)}`;
			if (log.promptVersion) {
				message += this.c(chalk.gray, `@${log.promptVersion}`);
			}
		}

		if (log.model) {
			message += ` ${this.c(chalk.blue, log.model)}`;
		}

		if (log.provider) {
			message += this.c(chalk.gray, ` via ${log.provider}`);
		}

		if (log.cached) {
			message += ` ${this.c(chalk.yellow, "(cached)")}`;
		}

		if (log.usage) {
			const { totalTokens } = log.usage;
			message += ` ${this.c(chalk.green, `[${totalTokens} tokens]`)}`;
		}

		message += ` ${this.c(chalk.gray, `${log.durationMs}ms`)}`;

		if (log.error) {
			message += ` ${this.c(chalk.red, `→ ${log.error}`)}`;
		}

		if (log.success) {
			console.log(message);
		} else {
			console.error(message);
		}
	}

	pipelineEvent(log: {
		event: string;
		traceId: string;
		stepName?: string;
		attempt?: number;
		outcome?: string;
		durationMs?: number;
		error?: Error;
	}): void {
		const prefix = this.formatPrefix("⛓️", "PIPE", chalk.blueBright);
		const traceId = this.c(chalk.gray, ` [${log.traceId.slice(-8)}]`);
		const step = log.stepName ? ` ${this.c(chalk.yellow, log.stepName)}` : "";
		const eventName = this.c(chalk.bold, log.event);

		let message = `${prefix}${traceId}${step} ${eventName}`;

		if (log.outcome) {
			const outcomeColor =
				log.outcome === "ok" ? chalk.green : log.outcome === "failed" ? chalk.red : chalk.yellow;
			message += ` → ${this.c(outcomeColor, log.outcome)}`;
		}

		if (log.durationMs !== undefined) {
			message += this.c(chalk.gray, ` (${log.durationMs}ms)`);
		}

		if (log.error) {
			message += `\n   ${this.c(chalk.red, "Error:")} ${log.error.message}`;
		}

		console.log(message);
	}
}

export const logger = new ConsoleLogger();
