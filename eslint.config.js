// ESLint flat config：TypeScript + React Hooks 静态审查（CI 门禁之一，配合 tsc）
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/target/", "src-tauri/gen/", "devvault/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 空 catch 是本项目既定风格（错误就地吞掉的地方都有注释说明去处）
      "no-empty": ["error", { allowEmptyCatch: true }],
      // 存量架构风格降为警告，不挡门禁；新增同款代码会在 PR 上显示黄标
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // 接口实现中占位参数用下划线前缀豁免
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
