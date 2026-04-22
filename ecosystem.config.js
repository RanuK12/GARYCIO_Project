module.exports = {
  apps: [
    {
      name: "garycio-bot",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1500M",
      env_production: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      },
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_file: "logs/combined.log",
      time: true,
    },
  ],
};
