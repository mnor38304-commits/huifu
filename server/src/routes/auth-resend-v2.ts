import { Router } from 'express';
// auth-resend-v2.ts is deprecated, redirecting all routes to auth.ts
// This file exists for backwards compatibility with existing imports
import authRouter from './auth';

const router = Router();
router.use('/', authRouter);
export default router;
