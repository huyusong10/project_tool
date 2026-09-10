import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist/**", "dist-server/**", ".playwright/**", "coverage/**", "playwright-report/**", "test-results/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-globals": ["error", { name: "alert", message: "请使用系统 ResultDialog 展示结果或错误。" }, { name: "confirm", message: "请使用系统 ConfirmDialog 处理确认操作。" }, { name: "prompt", message: "请使用系统 TextPromptModal 收集输入。" }],
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    ignores: ["src/client/random-uuid.ts"],
    rules: {
      "no-restricted-properties": ["error", {
        property: "randomUUID",
        message: "浏览器 UUID 请使用 random-uuid.ts 封装，兼容局域网 HTTP。",
      }],
    },
  },
);
