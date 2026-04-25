module.exports = {
  apps: [
    {
      name: "garycio-bot",
      // cwd EXPLÍCITO: dotenv busca .env en cwd. Sin esto, según el modo
      // de arranque de PM2 (cluster, fork, resurrect), el cwd puede ser
      // distinto y el .env no se carga → env.TEST_MODE termina en false
      // aunque el archivo diga true. Caso real visto el 25/4.
      cwd: "/opt/garycio",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork", // explícito: cluster cargaba el bot en otro cwd
      autorestart: true,
      watch: false,
      max_memory_restart: "1500M",
      // Hardening post-incidente: PM2 espera 60s de uptime antes de
      // contar el proceso como "estable"; max 10 reinicios antes de
      // pasar a errored; backoff exponencial entre reinicios.
      min_uptime: "60s",
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      kill_timeout: 10000,
      listen_timeout: 15000,
      env_production: {
        NODE_ENV: "production",
        LOG_LEVEL: "info",
      },
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_file: "logs/combined.log",
      merge_logs: true,
      time: true,
    },
  ],
};
