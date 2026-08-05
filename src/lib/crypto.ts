import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from './env';

/**
 * AES-256-GCM para os tokens do Meta em repouso.
 *
 * O ciphertext carrega prefixo de versão (`v1:`) porque rotacionar
 * ENCRYPTION_KEY sem isso exigiria recifrar tudo de uma vez, com downtime.
 * Custo de incluir agora: zero.
 */

const VERSION = 'v1';

function key(): Buffer {
  const raw = Buffer.from(env.encryptionKey, 'base64');
  if (raw.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY deve ter 32 bytes em base64 (tem ${raw.length}). ` +
        `Gere com: openssl rand -base64 32`,
    );
  }
  return raw;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(
    ':',
  );
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== VERSION) {
    throw new Error(`Formato de ciphertext desconhecido: ${version}`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
