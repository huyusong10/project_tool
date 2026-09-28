import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { config } from '../config';
import { fail } from '../errors';
import { jiraSetupMessages } from '../../shared/jira';

export function jiraEncryptionKey(settings: Pick<typeof config, 'jiraEncryptionKey' | 'dbPath'>) {
  try {
    let key = settings.jiraEncryptionKey;
    if (!key) {
      const file = `${settings.dbPath}.jira-key`;
      try {
        key = fs.readFileSync(file, 'utf8').trim();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // Never overwrite a key created by another process or an earlier run.
        try { fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
        catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError; }
        key = fs.readFileSync(file, 'utf8').trim();
      }
    }
    if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('Invalid key');
    return Buffer.from(key, 'hex');
  } catch {
    return fail(jiraSetupMessages.deployment, 'JIRA_KEY_UNAVAILABLE', 503);
  }
}
