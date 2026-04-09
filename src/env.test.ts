import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { readEnvFile } from './env.js';

/**
 * readEnvFile resolves .env from __dirname (the compiled file's directory),
 * NOT process.cwd(). We mock fs.readFileSync to intercept the read.
 */

function mockEnvContent(content: string): void {
  const original = fs.readFileSync;
  vi.spyOn(fs, 'readFileSync').mockImplementation(((
    filePath: fs.PathOrFileDescriptor,
    options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null,
  ) => {
    if (typeof filePath === 'string' && filePath.endsWith('.env')) {
      return content;
    }
    return original.call(fs, filePath, options as BufferEncoding);
  }) as typeof fs.readFileSync);
}

describe('readEnvFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses KEY=value correctly', () => {
    mockEnvContent('FOO=bar\nBAZ=qux\n');
    const result = readEnvFile(['FOO', 'BAZ']);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('handles double-quoted values', () => {
    mockEnvContent('GREETING="hello world"\n');
    const result = readEnvFile(['GREETING']);
    expect(result).toEqual({ GREETING: 'hello world' });
  });

  it('handles single-quoted values', () => {
    mockEnvContent("NAME='John Doe'\n");
    const result = readEnvFile(['NAME']);
    expect(result).toEqual({ NAME: 'John Doe' });
  });

  it('ignores comment lines', () => {
    mockEnvContent('# This is a comment\nKEY=value\n# Another comment\n');
    const result = readEnvFile(['KEY']);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('ignores blank lines', () => {
    mockEnvContent('\n\nKEY=value\n\n\n');
    const result = readEnvFile(['KEY']);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('returns empty object if .env does not exist', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = readEnvFile(['FOO']);
    expect(result).toEqual({});
  });

  it('only returns requested keys', () => {
    mockEnvContent('A=1\nB=2\nC=3\n');
    const result = readEnvFile(['A', 'C']);
    expect(result).toEqual({ A: '1', C: '3' });
    expect(result).not.toHaveProperty('B');
  });

  it('strips surrounding whitespace from keys and values', () => {
    mockEnvContent('  MY_KEY  =  my_value  \n');
    const result = readEnvFile(['MY_KEY']);
    expect(result).toEqual({ MY_KEY: 'my_value' });
  });

  it('handles values containing = sign', () => {
    mockEnvContent('URL=https://example.com?a=1&b=2\n');
    const result = readEnvFile(['URL']);
    expect(result).toEqual({ URL: 'https://example.com?a=1&b=2' });
  });

  it('skips lines without = sign', () => {
    mockEnvContent('NOEQUALS\nKEY=value\n');
    const result = readEnvFile(['KEY', 'NOEQUALS']);
    expect(result).toEqual({ KEY: 'value' });
  });
});
