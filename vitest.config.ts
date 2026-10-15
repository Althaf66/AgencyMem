import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "node",
          include: [
            "{packages,scripts}/**/*.test.ts",
            "apps/{gateway,runner,simulator}/**/*.test.ts",
            "tests/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
      "apps/web",
    ],
  },
});
