import net from 'node:net';

// Check the listener before importing the database or running migrations.
export async function isServerAlreadyRunning({ host, port }: { host: string; port: number }) {
  const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  const occupied = await new Promise<boolean>((resolve, reject) => {
    const probe = net.createConnection({ host: connectHost, port });
    probe.setTimeout(3000, () => probe.destroy(new Error(`检查端口 ${port} 超时`)));
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
  if (!occupied) return false;

  const address = connectHost.includes(':') ? `[${connectHost}]` : connectHost;
  try {
    const response = await fetch(`http://${address}:${port}/health`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (response.ok) {
      const health = await response.json() as { service?: string; status?: string };
      if (health.service === 'project-manage' && health.status === 'ok') return true;
    }
  } catch { /* An occupied port is not sufficient evidence of a healthy instance. */ }
  throw new Error(`端口 ${port} 已被占用，且未检测到正常运行的项目管理服务。请检查占用该端口的进程，或在 .env 中设置其他 PORT。`);
}
