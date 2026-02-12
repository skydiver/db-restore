import * as logger from './logger.js';

interface ErrorHint {
  match: (err: Error) => boolean;
  message: (err: Error, context: ErrorContext) => string;
  hint: (err: Error, context: ErrorContext) => string;
}

export interface ErrorContext {
  profile?: string;
  provider?: string;
  host?: string;
  port?: number;
  dir?: string;
}

const errorHints: ErrorHint[] = [
  {
    match: (err) => err.message.includes('ECONNREFUSED'),
    message: (_err, ctx) => `Connection refused at ${ctx.host}:${ctx.port}`,
    hint: (_err, ctx) =>
      `Is ${ctx.provider} running? Check with: ${ctx.provider === 'postgres' ? 'pg_isready' : 'mysqladmin ping'}`,
  },
  {
    match: (err) => err.message.includes('authentication') || err.message.includes('Access denied'),
    message: (err) => err.message,
    hint: (_err, ctx) => `Check your password. Run: db-restore setup ${ctx.profile} to reconfigure`,
  },
  {
    match: (err) =>
      err.message.includes('does not exist') || err.message.includes('Unknown database'),
    message: (err) => err.message,
    hint: (_err, ctx) => `Create it first or check the profile: db-restore setup ${ctx.profile}`,
  },
];

export function handleError(err: unknown, context: ErrorContext = {}): void {
  if (!(err instanceof Error)) {
    logger.error(String(err));
    return;
  }

  for (const hint of errorHints) {
    if (hint.match(err)) {
      logger.error(hint.message(err, context), hint.hint(err, context));
      return;
    }
  }

  logger.error(err.message);
}
