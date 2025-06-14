// lib/openapi.js
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import { extendZodWithOpenApi, createDocument } from 'zod-openapi';
import {
  addCardSchema,
  subscriptionCreateSchema,
  cardResponseSchema,
  subscriptionResponseSchema,
} from './schemas.js';

// Enable .openapi() annotations
extendZodWithOpenApi(z);

// Add OpenAPI metadata to schemas
addCardSchema.openapi({
  title: 'AddCardSchema',
  description: 'Payload to add a new payment card',
});
cardResponseSchema.openapi({
  title: 'CardResponseSchema',
  description: 'Returned card object after creation',
});
subscriptionCreateSchema.openapi({
  title: 'SubscriptionCreateSchema',
  description: 'Payload to create a subscription record',
});
subscriptionResponseSchema.openapi({
  title: 'SubscriptionResponseSchema',
  description: 'Returned subscription object after creation',
});

// Build the OpenAPI document
const openApiDocument = createDocument({
  openapi: '3.0.0',
  info: {
    title: 'DentGo Backend API',
    version: '1.0.0',
    description: 'Auto-generated from Zod schemas via zod-openapi',
  },
  servers: [{ url: 'http://localhost:4000' }],
  paths: {
    '/api/cards': {
      post: {
        summary: 'Add a new payment card',
        tags: ['Cards'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: addCardSchema },
          },
        },
        responses: {
          '201': {
            description: 'Created card',
            content: {
              'application/json': { schema: cardResponseSchema },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: z.object({ error: z.any() }).openapi({ title: 'ErrorResponse' }),
              },
            },
          },
        },
      },
    },
    '/api/subscriptions': {
      post: {
        summary: 'Create a new subscription record',
        tags: ['Subscriptions'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: subscriptionCreateSchema },
          },
        },
        responses: {
          '201': {
            description: 'Created subscription',
            content: {
              'application/json': { schema: subscriptionResponseSchema },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: z.object({ error: z.any() }).openapi({ title: 'ErrorResponse' }),
              },
            },
          },
        },
      },
    },
  },
});

export function setupOpenApi(app) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
}
