// Mock de tesseract.js para tests
module.exports = {
    default: {
        createWorker: () => ({
            load: async () => {},
            loadLanguage: async () => {},
            initialize: async () => {},
            recognize: async () => ({ data: { text: "", confidence: 0 } }),
            terminate: async () => {},
        }),
    },
    createWorker: () => ({
        load: async () => {},
        loadLanguage: async () => {},
        initialize: async () => {},
        recognize: async () => ({ data: { text: "", confidence: 0 } }),
        terminate: async () => {},
    }),
};
