import nodemailer from "nodemailer";

export function createAuthMailer(config, logger = console) {
  if (config.mailMode === "console") {
    return {
      async sendLoginCode({ email, code, expiresInSeconds }) {
        logger.info(`[development auth mail] ${email}: ${code} (${expiresInSeconds}s)`);
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    family: 4,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async sendLoginCode({ email, code, expiresInSeconds }) {
      const minutes = Math.max(1, Math.ceil(expiresInSeconds / 60));
      await transporter.sendMail({
        from: config.smtp.from,
        to: email,
        subject: "Код входа в ВИЖУФАСАД",
        text: `Ваш одноразовый код: ${code}\n\nКод действует ${minutes} мин. Никому его не сообщайте.`,
      });
    },
  };
}
