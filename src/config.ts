import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  JWT_SECRET: z.string().min(32),
}).superRefine((value, ctx) => {
  if (value.JWT_SECRET.startsWith('replace-with-')) {
    ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'Generate a real random JWT secret' });
  }
  if (value.NODE_ENV === 'production' && value.DB_PASSWORD === 'change-me-locally') {
    ctx.addIssue({ code: 'custom', path: ['DB_PASSWORD'], message: 'Change the default database password before deployment' });
  }
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
