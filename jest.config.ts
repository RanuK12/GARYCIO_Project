import type { Config } from "jest";

const config: Config = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/tests"],
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
