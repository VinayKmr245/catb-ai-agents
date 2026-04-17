// src/utils/logger.ts
import chalk from "chalk";

export const logger = {
  info: (msg: string) => console.log(chalk.cyan(`ℹ  ${msg}`)),
  success: (msg: string) => console.log(chalk.green(`✓  ${msg}`)),
  warn: (msg: string) => console.log(chalk.yellow(`⚠  ${msg}`)),
  error: (msg: string) => console.log(chalk.red(`✗  ${msg}`)),
  agent: (name: string, msg: string) =>
    console.log(chalk.magenta(`[${name}]`) + " " + chalk.white(msg)),
  step: (msg: string) => console.log(chalk.gray(`   → ${msg}`)),
  divider: () => console.log(chalk.gray("─".repeat(50))),
};
