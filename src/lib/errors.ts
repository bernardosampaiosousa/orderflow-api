import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  // Lets route code send an intentional HTTP status and error code.
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

// Keep error JSON predictable and hide unexpected server details.
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON request body' } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with this value already exists' } });
    return;
  }
  console.error('Unhandled API error', error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
