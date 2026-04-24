import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async Express route handler so that rejected promises
 * are forwarded to Express's error-handling middleware via next().
 * Without this, async errors in Express 4 are swallowed.
 */
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
