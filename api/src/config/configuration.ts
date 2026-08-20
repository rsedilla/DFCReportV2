/**
 * Configuration comes from the environment and nowhere else (CLAUDE.md, Secrets).
 * The application refuses to start on a missing or implausible value rather than
 * falling back to a default that would be wrong in production.
 */

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsAllowedOrigins: string[];
}

const MINIMUM_SECRET_LENGTH = 32;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be development, test or production (got "${nodeEnv}")`);
  }

  const port = Number.parseInt(process.env.PORT ?? '3001', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number (got "${process.env.PORT ?? ''}")`);
  }

  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters`);
  }

  return {
    nodeEnv,
    port,
    databaseUrl: required('DATABASE_URL'),
    jwtSecret,
    corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
  };
}

export const APP_CONFIG = 'APP_CONFIG';
