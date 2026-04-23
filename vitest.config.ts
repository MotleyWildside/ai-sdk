import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: false,
		environment: "node",
		setupFiles: ["./tests/setup.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: ["src/**/examples/**", "src/**/index.ts"],
			thresholds: {
				lines: 90,
				branches: 85,
				functions: 90,
			},
		},
	},
});
