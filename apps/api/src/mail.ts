/**
 * Outgoing e-mail (CMS-15): plain text over SMTP to any provider. Callers never log the
 * addresses, the message or the transport options.
 */
import { createTransport } from 'nodemailer';
import type { AppConfig } from './config.ts';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  /** Rejects when the server does not accept the message. */
  send(message: MailMessage): Promise<void>;
}

/** The SMTP sender of the configuration, or null when SMTP_HOST is unset (no alerts). */
export function createMailer(config: AppConfig['mail']): Mailer | null {
  if (config === null) return null;
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Never plain text over a network: STARTTLS or implicit TLS, except to a loopback address
    // (Mailpit in development). Not a name, even localhost: Nodemailer resolves names through
    // DNS, which may answer with another machine.
    requireTLS: !config.secure && config.host !== '127.0.0.1' && config.host !== '::1',
    ...(config.user === null || config.password === null
      ? {}
      : { auth: { user: config.user, pass: config.password } }),
    // A hung server must not hold the alert check for long.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(message) {
      await transport.sendMail({ from: config.from, ...message });
    },
  };
}
