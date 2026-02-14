module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  ignorePatterns: ["build/**", "node_modules/**", ".netlify/**"],
  overrides: [
    {
      files: ["app/**/*.ts", "app/**/*.tsx"],
      excludedFiles: ["app/**/*.server.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "~/lib/supabase.server",
                importNames: ["getServiceClient"],
                message:
                  "getServiceClient must only be imported from *.server.ts files.",
              },
            ],
          },
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector: "CallExpression[callee.name='getServiceClient']",
            message: "getServiceClient() may only be called from *.server.ts files.",
          },
        ],
      },
    },
    {
      files: ["app/routes/**/*.ts", "app/routes/**/*.tsx"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@supabase/supabase-js",
                importNames: ["createClient"],
                message:
                  "Do not import createClient in routes. Use server-only helpers from *.server.ts modules.",
              },
              {
                name: "~/lib/supabase.server",
                importNames: ["getServiceClient"],
                message:
                  "Do not import getServiceClient in routes. Call server-only wrappers from *.server.ts modules.",
              },
            ],
          },
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector: "CallExpression[callee.name='createClient']",
            message:
              "Do not call createClient in routes. Use server-only helpers from *.server.ts modules.",
          },
        ],
      },
    },
  ],
};
