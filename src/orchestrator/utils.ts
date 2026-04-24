import { randomUUID } from "crypto";
import type { BaseContext, PipelineRunOptions } from "./types";

export function generateTraceId(): string {
	return randomUUID();
}

export function getTraceId<C extends BaseContext>(ctx: C, opts?: PipelineRunOptions): string {
	if (opts?.traceId) return opts.traceId;
	if (ctx.traceId) return ctx.traceId;
	return generateTraceId();
}
