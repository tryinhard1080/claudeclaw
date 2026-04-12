import { execFile } from 'child_process';
import { writeFile, unlink, access } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

/**
 * Controls regime-trader instances via subprocess calls to instance_manager.py
 * and direct file operations for halt/resume.
 */
export class InstanceController {
  private readonly pythonPath: string;

  constructor(private readonly basePath: string) {
    // Use the venv Python on Windows, system python3 elsewhere
    this.pythonPath = process.platform === 'win32'
      ? path.join(basePath, '.venv', 'Scripts', 'python.exe')
      : path.join(basePath, '.venv', 'bin', 'python3');
  }

  private async runManager(...args: string[]): Promise<string> {
    const managerPath = path.join(this.basePath, 'instance_manager.py');
    try {
      const { stdout, stderr } = await execFileAsync(
        this.pythonPath,
        [managerPath, ...args],
        { cwd: this.basePath, timeout: 30_000 },
      );
      if (stderr) logger.warn({ stderr: stderr.slice(0, 200) }, 'instance_manager stderr');
      return stdout.trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, args }, 'instance_manager failed');
      throw new Error(`instance_manager ${args.join(' ')} failed: ${msg}`);
    }
  }

  async listInstances(): Promise<string> {
    return this.runManager('list');
  }

  async startInstance(name: string, mode = 'paper'): Promise<string> {
    return this.runManager('start', name, '--mode', mode);
  }

  async stopInstance(name: string): Promise<string> {
    return this.runManager('stop', name);
  }

  async getStatus(): Promise<string> {
    return this.runManager('status');
  }

  async haltInstance(name: string): Promise<void> {
    const lockPath = path.join(this.basePath, 'instances', name, 'trading_halted.lock');
    await writeFile(lockPath, `Halted via Telegram at ${new Date().toISOString()}`);
    logger.info({ instance: name }, 'Instance halted via lock file');
  }

  async resumeInstance(name: string): Promise<void> {
    const lockPath = path.join(this.basePath, 'instances', name, 'trading_halted.lock');
    try {
      await unlink(lockPath);
      logger.info({ instance: name }, 'Instance resumed (lock file removed)');
    } catch {
      // Lock file didn't exist -- already resumed
    }
  }

  async isHalted(name: string): Promise<boolean> {
    const lockPath = path.join(this.basePath, 'instances', name, 'trading_halted.lock');
    try {
      await access(lockPath);
      return true;
    } catch {
      return false;
    }
  }

  async haltAll(): Promise<void> {
    return void this.runManager('halt-all');
  }

  async runBacktest(name: string): Promise<string> {
    const mainPath = path.join(this.basePath, 'main.py');
    try {
      const { stdout } = await execFileAsync(
        this.pythonPath,
        [mainPath, '--backtest', '--instance', name],
        { cwd: this.basePath, timeout: 300_000 }, // 5 min timeout for backtests
      );
      return stdout.trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Backtest failed for ${name}: ${msg}`);
    }
  }
}
