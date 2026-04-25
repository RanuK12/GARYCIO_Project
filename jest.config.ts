import type { Config } from "jest";

const config: Config = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/tests"],
    setupFiles: ["<rootDir>/jest.setup.ts"],
    collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/database/migrate.ts",
        "!src/database/seed.ts",
        "!src/index.ts",
    ],
    coverageReporters: ["text-summary", "lcov"],
    // Umbrales conservadores al baseline actual (abr-2026). La meta de P1.4 es
    // llegar a 60% progresivamente. Subir estos números a medida que se
    // agreguen tests o se arreglen los 24 flow tests que drifteó la lógica.
    coverageThreshold: {
        global: {
            statements: 40,
            branches: 25,
            functions: 40,
            lines: 40,
        },
    },
    moduleNameMapper: {
        "^@bot/(.*)$": "<rootDir>/src/bot/$1",
        "^@db/(.*)$": "<rootDir>/src/database/$1",
        "^@services/(.*)$": "<rootDir>/src/services/$1",
        "^@config/(.*)$": "<rootDir>/src/config/$1",
        "^@utils/(.*)$": "<rootDir>/src/utils/$1",
        "^tesseract\\.js$": "<rootDir>/tests/__mocks__/tesseract.js",
    },
    transformIgnorePatterns: [
        "node_modules/(?!(@whiskeysockets/baileys|@hapi)/)",
    ],
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { diagnostics: false }],
        "^.+\\.jsx?$": ["ts-jest", { tsconfig: { allowJs: true }, diagnostics: false }],
    },
    testMatch: ["**/*.test.ts"],
    verbose: true,
};

export default config;
