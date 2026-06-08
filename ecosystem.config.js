module.exports = {
  apps: [
    {
      name: "kalnostics-dev",
      script: "./node_modules/@nestjs/cli/bin/nest.js",
      interpreter: "node",
      args: "start --watch",
      cwd: ".",
      watch: false
    }
  ]
};