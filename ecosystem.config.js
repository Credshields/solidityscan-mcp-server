module.exports = {
  apps: [
    {
      name: "solidityscan-mcp-server",
      script: "dist/server-http.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
        HOST: "0.0.0.0",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 8080,
        HOST: "0.0.0.0",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "500M",
      watch: false,
      ignore_watch: ["node_modules", "logs", "dist"],
    },
  ],
};

