import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

/**
 * Schema definitions for common API endpoints
 */
export const shelterQuerySchema = z.object({
  city: z.string().min(1).optional(),
  tags: z.string().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  hasAvailability: z.coerce.boolean().optional(),
});

export const resourceQuerySchema = z.object({
  category: z.string().optional(),
  city: z.string().optional(),
  isFree: z.coerce.boolean().optional(),
});

export const volunteerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  city: z.string().min(2).max(100),
  phone: z.string().optional(),
  organization: z.string().optional(),
  skills: z.array(z.string()).default([]),
  availability: z.string(),
});

export const shelterFeedbackSchema = z.object({
  feltSafe: z.boolean(),
  womenSafetyScore: z.number().min(1).max(5),
  lgbtqSafetyScore: z.number().min(1).max(5),
  antiRacismScore: z.number().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export const resourceLiveStatusSchema = z.object({
  status: z.enum(['open', 'limited', 'full', 'closed']),
  essentials: z.object({
    food: z.boolean(),
    shower: z.boolean(),
    restroom: z.boolean(),
    charging: z.boolean(),
    laundry: z.boolean(),
  }),
  closesAt: z.string().optional(),
  note: z.string().max(500).optional(),
  verifier: z.string().optional(),
});

export const metricsEventSchema = z.object({
  eventType: z.string().min(1).max(100),
  metadata: z.record(z.unknown()).default({}),
});

/**
 * Middleware factory to validate request query parameters
 */
export function validateQuery<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: result.error.issues,
      });
    }
    // Attach validated data to request for use in route handler
    (req as any).validatedQuery = result.data;
    next();
  };
}

/**
 * Middleware factory to validate request body
 */
export function validateBody<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: result.error.issues,
      });
    }
    // Attach validated data to request for use in route handler
    (req as any).validatedBody = result.data;
    next();
  };
}

/**
 * Middleware to validate path parameters
 */
export function validateParams<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid path parameters',
        details: result.error.issues,
      });
    }
    (req as any).validatedParams = result.data;
    next();
  };
}
