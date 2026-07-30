import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_API_PROXY_TARGET = 'http://localhost:3001';

export function parseAllowedHosts(value: string | undefined): string[] {
  const hosts = [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((host) => host.trim().toLocaleLowerCase('en-US'))
        .filter(Boolean),
    ),
  ];

  for (const host of hosts) {
    let parsed: URL;
    try {
      parsed = new URL(`http://${host}`);
    } catch {
      throw new Error(`VITE_ALLOWED_HOSTS contains an invalid host: ${host}`);
    }

    if (
      host.includes('*') ||
      host.startsWith('.') ||
      host.includes('/') ||
      host.includes(':') ||
      parsed.hostname !== host ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        `VITE_ALLOWED_HOSTS must contain exact hostnames without protocols, ports, paths, or wildcards: ${host}`,
      );
    }
  }

  return hosts;
}

function apiProxy(target: string): Record<string, ProxyOptions> {
  return {
    '/api': {
      changeOrigin: false,
      target,
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, workspaceRoot, 'VITE_');
  const allowedHosts = parseAllowedHosts(environment.VITE_ALLOWED_HOSTS);
  const proxy = apiProxy(
    environment.VITE_API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET,
  );

  return {
    envDir: workspaceRoot,
    plugins: [react()],
    resolve: {
      alias: {
        '@bizziemoney/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      allowedHosts,
      host: '0.0.0.0',
      port: 5173,
      proxy,
    },
    preview: {
      allowedHosts,
      host: '0.0.0.0',
      port: 4173,
      proxy,
    },
  };
});
