export interface OutputOptions {
  json: boolean;
  quiet: boolean;
}

export function emit(data: unknown, human: () => string, opts: OutputOptions): void {
  if (opts.quiet) return;
  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    process.stdout.write(human() + "\n");
  }
}

export function fail(message: string, code = 1): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}
