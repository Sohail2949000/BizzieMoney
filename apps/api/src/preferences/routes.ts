import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  DATE_FORMATS,
  NUMBER_FORMATS,
  isSupportedCurrency,
  isSupportedTimeZone,
} from '@bizziemoney/shared';

import { requireCsrf, requireSession } from '../auth/routes.js';
import type { AuthServiceContract } from '../auth/types.js';
import type { PreferenceServiceContract } from './types.js';

const preferenceChangesSchema = z
  .object({
    dateFormat: z.enum(DATE_FORMATS).optional(),
    defaultCurrency: z
      .string()
      .trim()
      .transform((value) => value.toLocaleUpperCase('en-US'))
      .refine(isSupportedCurrency, 'Choose a supported ISO currency.')
      .optional(),
    firstDayOfWeek: z.number().int().min(0).max(6).optional(),
    numberFormat: z.enum(NUMBER_FORMATS).optional(),
    timeZone: z
      .string()
      .trim()
      .refine(isSupportedTimeZone, 'Choose a supported IANA time zone.')
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Choose at least one preference to update.',
  });

export function registerPreferenceRoutes(
  server: FastifyInstance,
  {
    authService,
    service,
  }: {
    authService: AuthServiceContract;
    service: PreferenceServiceContract;
  },
): void {
  server.get('/api/settings/preferences', async (request) => {
    const session = await requireSession(request, authService);
    return service.get(session.ownerId);
  });

  server.patch('/api/settings/preferences', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const parsed = preferenceChangesSchema.parse(request.body);
    const changes = Object.fromEntries(
      Object.entries(parsed).filter((entry) => entry[1] !== undefined),
    );
    return service.update(session.ownerId, session.id, changes);
  });
}
