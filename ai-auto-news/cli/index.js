#!/usr/bin/env node
/**
 * AI Auto News CLI Tool
 *
 * Command-line interface for managing AI Auto News platform
 * Commands:
 * - auth: Authentication management
 * - posts: Manage posts
 * - generate: Generate content
 * - deploy: Deployment operations
 * - backup: Backup and restore
 * - config: Configuration management
 * - logs: View logs
 * - metrics: View metrics
 */

const { Command } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const program = new Command();

// Configuration file location
const CONFIG_DIR = path.join(os.homedir(), '.ai-auto-news');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// CLI Version
program.version('2.0.0').description('AI Auto News CLI - Manage your AI-powered content platform');

/**
 * Auth Commands
 */
program
  .command('login')
  .description('Authenticate with AI Auto News')
  .option('-k, --api-key <key>', 'API key for authentication')
  .action(async (options) => {
    const spinner = ora('Authenticating...').start();

    try {
      let apiKey = options.apiKey;

      if (!apiKey) {
        const answers = await inquirer.prompt([
          {
            type: 'password',
            name: 'apiKey',
            message: 'Enter your API key:',
            mask: '*',
          },
        ]);
        apiKey = answers.apiKey;
      }

      // Verify API key
      const response = await fetch('https://api.ai-auto-news.com/api/v1/auth/verify', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error('Invalid API key');
      }

      // Save config
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      await fs.writeFile(
        CONFIG_FILE,
        JSON.stringify({ apiKey, baseURL: 'https://api.ai-auto-news.com' }, null, 2)
      );

      spinner.succeed(chalk.green('Successfully authenticated!'));
    } catch (error) {
      spinner.fail(chalk.red(`Authentication failed: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('logout')
  .description('Remove stored credentials')
  .action(async () => {
    try {
      await fs.unlink(CONFIG_FILE);
      console.log(chalk.green('Successfully logged out!'));
    } catch (error) {
      console.log(chalk.yellow('No active session found'));
    }
  });

/**
 * Posts Commands
 */
const postsCmd = program.command('posts').description('Manage posts');

postsCmd
  .command('list')
  .description('List all posts')
  .option('-c, --category <category>', 'Filter by category')
  .option('-l, --limit <number>', 'Number of posts to show', '20')
  .action(async (options) => {
    const spinner = ora('Fetching posts...').start();

    try {
      const config = await loadConfig();
      const params = new URLSearchParams({
        limit: options.limit,
        ...(options.category && { category: options.category }),
      });

      const response = await fetch(`${config.baseURL}/api/v1/posts?${params}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      const data = await response.json();

      spinner.stop();

      console.table(
        data.data.map((post) => ({
          ID: post.id,
          Title: post.title.substring(0, 50),
          Category: post.category,
          Published: post.published ? '✓' : '✗',
          Created: new Date(post.createdAt).toLocaleDateString(),
        }))
      );
    } catch (error) {
      spinner.fail(chalk.red(`Failed to fetch posts: ${error.message}`));
    }
  });

postsCmd
  .command('get <id>')
  .description('Get a single post')
  .action(async (id) => {
    const spinner = ora('Fetching post...').start();

    try {
      const config = await loadConfig();
      const response = await fetch(`${config.baseURL}/api/v1/posts/${id}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      const data = await response.json();
      spinner.stop();

      console.log(chalk.bold('\nTitle:'), data.data.title);
      console.log(chalk.bold('Category:'), data.data.category);
      console.log(chalk.bold('Published:'), data.data.published ? 'Yes' : 'No');
      console.log(chalk.bold('Created:'), new Date(data.data.createdAt).toLocaleString());
      console.log(chalk.bold('\nContent:'));
      console.log(data.data.content);
    } catch (error) {
      spinner.fail(chalk.red(`Failed to fetch post: ${error.message}`));
    }
  });

postsCmd
  .command('delete <id>')
  .description('Delete a post')
  .action(async (id) => {
    const confirm = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'delete',
        message: 'Are you sure you want to delete this post?',
        default: false,
      },
    ]);

    if (!confirm.delete) {
      console.log(chalk.yellow('Cancelled'));
      return;
    }

    const spinner = ora('Deleting post...').start();

    try {
      const config = await loadConfig();
      await fetch(`${config.baseURL}/api/v1/posts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      spinner.succeed(chalk.green('Post deleted successfully!'));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to delete post: ${error.message}`));
    }
  });

/**
 * Generate Commands
 */
const generateCmd = program.command('generate').description('Generate content');

generateCmd
  .command('blog <topic>')
  .description('Generate a blog post')
  .option('-t, --tone <tone>', 'Writing tone', 'professional')
  .option('-l, --length <number>', 'Target length in words', '1000')
  .action(async (topic, options) => {
    const spinner = ora('Generating blog post...').start();

    try {
      const config = await loadConfig();
      const response = await fetch(`${config.baseURL}/api/v1/generate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic,
          type: 'blog',
          tone: options.tone,
          targetLength: parseInt(options.length),
        }),
      });

      const data = await response.json();

      spinner.succeed(chalk.green('Blog post generated!'));
      console.log(chalk.bold('\nTitle:'), data.data.title);
      console.log(chalk.bold('Preview:'), data.data.content.substring(0, 200) + '...');
      console.log(chalk.bold('\nPost ID:'), data.data.id);
    } catch (error) {
      spinner.fail(chalk.red(`Failed to generate: ${error.message}`));
    }
  });

generateCmd
  .command('news <topic>')
  .description('Generate a news article')
  .option('-u, --urgency <level>', 'Urgency level', 'medium')
  .action(async (topic, options) => {
    const spinner = ora('Generating news article...').start();

    try {
      const config = await loadConfig();
      const response = await fetch(`${config.baseURL}/api/v1/generate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic,
          type: 'news',
          urgency: options.urgency,
        }),
      });

      const data = await response.json();

      spinner.succeed(chalk.green('News article generated!'));
      console.log(chalk.bold('\nTitle:'), data.data.title);
      console.log(chalk.bold('Preview:'), data.data.content.substring(0, 200) + '...');
      console.log(chalk.bold('\nPost ID:'), data.data.id);
    } catch (error) {
      spinner.fail(chalk.red(`Failed to generate: ${error.message}`));
    }
  });

/**
 * Config Commands
 */
const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(async () => {
    try {
      const config = await loadConfig();
      console.log(chalk.bold('\nCurrent Configuration:'));
      console.log(chalk.gray('API URL:'), config.baseURL);
      console.log(chalk.gray('API Key:'), config.apiKey.substring(0, 10) + '...');
    } catch (error) {
      console.log(chalk.red('No configuration found. Run `ai-auto-news login` first.'));
    }
  });

configCmd
  .command('set <key> <value>')
  .description('Set configuration value')
  .action(async (key, value) => {
    try {
      const config = await loadConfig();
      config[key] = value;
      await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log(chalk.green(`Configuration updated: ${key} = ${value}`));
    } catch (error) {
      console.log(chalk.red(`Failed to update configuration: ${error.message}`));
    }
  });

/**
 * Metrics Commands
 */
program
  .command('metrics')
  .description('View platform metrics')
  .action(async () => {
    const spinner = ora('Fetching metrics...').start();

    try {
      const config = await loadConfig();
      const response = await fetch(`${config.baseURL}/api/analytics/metrics`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      const data = await response.json();

      spinner.stop();

      console.log(chalk.bold('\nPlatform Metrics:'));
      console.log(chalk.gray('API Requests:'), data.data.apiRequests);
      console.log(chalk.gray('Posts Generated:'), data.data.postsGenerated);
      console.log(chalk.gray('Active Users:'), data.data.activeUsers);
      console.log(chalk.gray('Avg Response Time:'), `${data.data.avgResponseTime}ms`);
    } catch (error) {
      spinner.fail(chalk.red(`Failed to fetch metrics: ${error.message}`));
    }
  });

/**
 * Logs Commands
 */
program
  .command('logs')
  .description('View application logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action(async (options) => {
    console.log(chalk.bold('Application Logs:\n'));

    try {
      const config = await loadConfig();
      const response = await fetch(
        `${config.baseURL}/api/admin/logs?lines=${options.lines}`,
        {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        }
      );

      const data = await response.json();

      data.data.forEach((log) => {
        const color =
          log.level === 'error'
            ? chalk.red
            : log.level === 'warn'
            ? chalk.yellow
            : chalk.white;

        console.log(
          color(`[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`)
        );
      });
    } catch (error) {
      console.log(chalk.red(`Failed to fetch logs: ${error.message}`));
    }
  });

/**
 * Helper Functions
 */
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error('Not authenticated. Run `ai-auto-news login` first.');
  }
}

// Parse arguments and run
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
